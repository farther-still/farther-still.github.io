// Each check script is shown to fire on the thing it exists to catch, and to stay quiet on what is allowed.

import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../vite.config.ts';
import {
  REQUIRED_CSP,
  fileFindings,
  hoverFindings,
  manifestFindings,
  mediaFindings,
  pageFindings,
  precacheFindings,
  referenceFindings,
  urlFindings,
  workerFindings,
} from '../scripts/check-dist';
import { hardWrappedLines } from '../scripts/check-prose';
import { isSealed, lockFindings, nameFindings, tokenFindings } from '../scripts/check-repo';

describe('check-prose', () => {
  it('flags a line that continues the paragraph or bullet above it', () => {
    expect(hardWrappedLines('One sentence that was\nwrapped by hand.\n')).toEqual([2]);
    expect(hardWrappedLines('- a bullet that was\n  wrapped by hand\n- next\n')).toEqual([2]);
    expect(hardWrappedLines('# Title\n\nFirst.\nSecond.\nThird.\n')).toEqual([4, 5]);
  });

  it('accepts one line per paragraph or bullet, lists, tables, headings and code', () => {
    const fine = [
      '---',
      'name: front-matter',
      'description: is not prose',
      '---',
      '# Title',
      'Text right under a heading.',
      '',
      'A paragraph on one line, however long it is.',
      '',
      '- bullet one',
      '- bullet two',
      '  - nested bullet',
      '1. numbered',
      '2. numbered',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      'Text right after a table.',
      '',
      '```text',
      'code may',
      'wrap freely',
      '```',
      '> a quote on one line',
      '',
      '> another quote',
      '>',
      '> - a list inside a quote',
      '',
    ].join('\n');
    expect(hardWrappedLines(fine)).toEqual([]);
  });

  it('flags a quoted paragraph that was wrapped by hand', () => {
    expect(hardWrappedLines('> a quote that was\n> wrapped by hand\n')).toEqual([2]);
  });
});

describe('check-repo', () => {
  // Built from pieces so that this file does not itself look like it holds a token.
  const filler = 'a1B2'.repeat(10);

  it('finds token patterns', () => {
    const samples = [
      `ghp_${filler}`,
      `gho_${filler}`,
      `github_pat_${filler}${filler}`,
      `-----BEGIN ${'RSA'} PRIVATE KEY-----`,
      `-----BEGIN ${'PRIVATE'} KEY-----`,
      `AKIA${'ABCDEFGHIJKLMNOP'}`,
      `xoxb-${filler}`,
      `sk-${filler}`,
      `eyJ${filler}.eyJ${filler}.${filler}`,
    ];
    for (const sample of samples) {
      expect(tokenFindings('file.ts', `const x = "${sample}";`), sample).toHaveLength(1);
    }
    expect(tokenFindings('file.ts', `line one\nkey = ${samples[0]}\n`)).toEqual(['file.ts:2 looks like a GitHub token']);
  });

  it('does not mistake ordinary text for a token', () => {
    const text = ['ghp_short', 'a task-list', 'risk-free', 'sha 4b825dc642cb6eb9a060e54bf8d69288fbee4904', 'BEGIN PRIVATE KEY'].join('\n');
    expect(tokenFindings('file.md', text)).toEqual([]);
  });

  it('finds a content name in unsealed text as a whole name, case-sensitively, without printing it', () => {
    const names = ['Glass Heron', 'Ash'];
    expect(nameFindings('docs/STATUS.md', 'We met the Glass Heron today.', names)).toEqual(['docs/STATUS.md:1 contains content name #1']);
    expect(nameFindings('docs/STATUS.md', 'line\nAsh fell.', names)).toEqual(['docs/STATUS.md:2 contains content name #2']);
    // Part of a longer word, or a different case, is not the name.
    expect(nameFindings('docs/STATUS.md', 'Ashes, ash, crASH and a glass heron.', names)).toEqual([]);
  });

  it('knows which paths are sealed', () => {
    expect(isSealed('docs/sealed/gdd-appendix-content.md')).toBe(true);
    expect(isSealed('data/strings.en.json')).toBe(true);
    expect(isSealed('data/maps/z01.json')).toBe(true);
    expect(isSealed('data/balance.json')).toBe(false);
    expect(isSealed('data/ids.lock.json')).toBe(false);
    expect(isSealed('docs/STATUS.md')).toBe(false);
  });

  it('fails when an ID leaves the lock or changes kind', () => {
    const before = JSON.stringify({ ids: { e001: 'enemy', i001: 'item' } });
    expect(lockFindings(before, JSON.stringify({ ids: { e001: 'enemy', i001: 'item', i002: 'item' } }))).toEqual([]);
    expect(lockFindings(before, JSON.stringify({ ids: { e001: 'enemy' } }))).toEqual(['ID i001 was removed from data/ids.lock.json']);
    expect(lockFindings(before, JSON.stringify({ ids: { e001: 'item', i001: 'item' } }))).toEqual(['ID e001 changed kind in data/ids.lock.json']);
    expect(lockFindings(before, null)).toEqual(['data/ids.lock.json was removed']);
    expect(lockFindings(before, '{"ids": []}')).toHaveLength(1);
    expect(lockFindings(null, JSON.stringify({ ids: {} }))).toEqual([]);
  });
});

describe('check-dist', () => {
  it('finds media in built files', () => {
    const cases = [
      '<audio src="a.mp3"></audio>',
      'x=`<video autoplay>`',
      'document.createElement("audio")',
      "e.createElementNS('http://www.w3.org/1999/xhtml','video')",
      'const a=new Audio(u)',
      'new AudioContext',
      'new webkitAudioContext()',
      'x instanceof HTMLMediaElement',
      'navigator.mediaSession.metadata=m',
      'navigator.mediaDevices.getUserMedia(c)',
      'speechSynthesis.speak(u)',
      // The tag name alone, which is how it reaches createElement through a helper once the code is minified.
      'Q("audio",{class:"x"})',
      "t.createElement(n?'video':'div')",
      'const tag=`audio`',
    ];
    for (const text of cases) expect(mediaFindings('assets/app.js', text).length, text).toBeGreaterThan(0);
  });

  it('does not see media in ordinary code', () => {
    expect(mediaFindings('assets/app.js', 'const audience=1;const video_id="x";createElement("div");const Audit=2;')).toEqual([]);
  });

  it('finds media files and source maps by name', () => {
    for (const file of ['assets/theme.mp3', 'assets/intro.MP4', 'sounds/hit.ogg', 'a.wav', 'clip.webm', 'assets/app.js.map']) {
      expect(fileFindings(file), file).toHaveLength(1);
    }
    for (const file of ['assets/app.js', 'icons/icon-192.png', 'index.html', 'manifest.webmanifest']) {
      expect(fileFindings(file), file).toEqual([]);
    }
  });

  it('finds URLs that point off the site', () => {
    expect(urlFindings('a.js', 'fetch("//ads.example.com/x.js")')).toHaveLength(1);
    expect(urlFindings('a.js', "import('//cdn.example.com/lib.js')")).toHaveLength(1);
    expect(urlFindings('a.js', 'fetch("https://ads.example.com/x.js")')).toHaveLength(1);
    expect(urlFindings('a.css', '@import url(//fonts.example.com/f.css)')).toHaveLength(1);
    // Seen both as markup and as a quoted host; one finding or two, it must not pass.
    expect(urlFindings('index.html', '<script src="//cdn.example.com/a.js"></script>').length).toBeGreaterThan(0);
    expect(urlFindings('a.js', 'new WebSocket("wss://example.com")')).toHaveLength(1);
  });

  it('allows same-site paths and the SVG namespace', () => {
    expect(urlFindings('a.js', 'fetch("/data.json");createElementNS("http://www.w3.org/2000/svg","g");x="./sw.js";y="// a comment";z=a//b\n')).toEqual([]);
  });

  it("finds the reference game's title and its developer's name in any case, spacing or punctuation", () => {
    const words = ['Resolute', 'Hero'];
    const developer = ['geometric', 'applications'];
    for (const joiner of [' ', '', '  ', '-', '_', '\n', ' \t ', '&nbsp;'.slice(0, 1)]) {
      expect(referenceFindings('a.js', `x="${words.join(joiner)} RPG"`), JSON.stringify(joiner)).toHaveLength(1);
      expect(referenceFindings('a.js', developer.join(joiner).toUpperCase()), JSON.stringify(joiner)).toHaveLength(1);
    }
    expect(referenceFindings('a.js', 'a resolute hero of geometric shapes')).toHaveLength(1);
    expect(referenceFindings('a.js', 'Farther Still, a resolute game for heroes')).toEqual([]);
  });

  it('finds a :hover rule', () => {
    expect(hoverFindings('a.css', '.btn:hover{color:red}')).toHaveLength(1);
    expect(hoverFindings('a.css', '.btn:active{color:red}')).toEqual([]);
  });

  const page = (csp: string, viewport: string): string =>
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="${viewport}"><link rel="manifest" href="/manifest.webmanifest"><script type="module" src="/assets/a.js"></script><link rel="stylesheet" href="/assets/a.css"></head><body><div id="app"></div></body></html>`;
  const VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

  it('accepts the page the build makes', () => {
    expect(pageFindings(page(CONTENT_SECURITY_POLICY, VIEWPORT))).toEqual([]);
  });

  it('holds the build to the exact policy the check requires', () => {
    expect(CONTENT_SECURITY_POLICY.split('; ')).toEqual(REQUIRED_CSP);
  });

  it('finds a missing or loosened content security policy', () => {
    expect(pageFindings(page(CONTENT_SECURITY_POLICY, VIEWPORT).replace(/<meta http-equiv[^>]*>/, ''))).toEqual(['index.html has no content security policy']);
    expect(pageFindings(page(CONTENT_SECURITY_POLICY.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"), VIEWPORT)).length).toBeGreaterThan(0);
    expect(pageFindings(page(CONTENT_SECURITY_POLICY.replace("connect-src 'self'", "connect-src 'self' https://ads.example.com"), VIEWPORT)).length).toBeGreaterThan(0);
    expect(pageFindings(page(CONTENT_SECURITY_POLICY.replace("default-src 'none'", 'default-src *'), VIEWPORT)).length).toBeGreaterThan(0);
  });

  it('finds an added directive, which would override the fallback to "nothing allowed"', () => {
    for (const extra of ["media-src 'self' data: blob:", "script-src-elem 'self' blob:", "frame-src 'self'", "font-src 'self'"]) {
      expect(pageFindings(page(`${CONTENT_SECURITY_POLICY}; ${extra}`, VIEWPORT)), extra).toEqual([
        `index.html content security policy has a directive that is not pinned: ${extra}`,
      ]);
    }
  });

  it('finds a second content security policy tag', () => {
    const twice = page(CONTENT_SECURITY_POLICY, VIEWPORT).replace('<meta name="viewport"', `<meta http-equiv="Content-Security-Policy" content="default-src 'self'"><meta name="viewport"`);
    expect(pageFindings(twice)).toEqual(['index.html has more than one content security policy']);
  });

  it('finds a viewport tag that allows zoom or ignores the safe area', () => {
    expect(pageFindings(page(CONTENT_SECURITY_POLICY, 'width=device-width, initial-scale=1'))).toEqual([
      'index.html viewport tag must set maximum-scale=1',
      'index.html viewport tag must set user-scalable=no',
      'index.html viewport tag must set viewport-fit=cover',
    ]);
    // A value that merely starts with the right digits is still wrong.
    expect(pageFindings(page(CONTENT_SECURITY_POLICY, VIEWPORT.replace('maximum-scale=1', 'maximum-scale=10')))).toEqual([
      'index.html viewport tag must set maximum-scale=1',
    ]);
    expect(pageFindings(page(CONTENT_SECURITY_POLICY, VIEWPORT.replace('user-scalable=no', 'user-scalable=yes')))).toHaveLength(1);
  });

  it('finds inline scripts and styles, which the policy would block on the phone', () => {
    const good = page(CONTENT_SECURITY_POLICY, VIEWPORT);
    expect(pageFindings(good.replace('<body>', '<body><script>alert(1)</script>'))).toEqual(['index.html has an inline script']);
    expect(pageFindings(good.replace('<div id="app">', '<div id="app" style="color:red">'))).toEqual(['index.html has inline styles']);
  });

  it('pins the manifest to standalone at the site root', () => {
    const good = { name: 'Farther Still', display: 'standalone', start_url: '/', scope: '/', icons: [{ src: '/icons/icon-192.png' }] };
    expect(manifestFindings(JSON.stringify(good))).toEqual([]);
    expect(manifestFindings(JSON.stringify({ ...good, display: 'browser' }))).toHaveLength(1);
    expect(manifestFindings(JSON.stringify({ ...good, display: 'minimal-ui' }))).toHaveLength(1);
    expect(manifestFindings(JSON.stringify({ ...good, start_url: '/steadfast/' }))).toHaveLength(1);
    expect(manifestFindings(JSON.stringify({ ...good, scope: '/game/' }))).toHaveLength(1);
    expect(manifestFindings(JSON.stringify({ ...good, icons: [] }))).toHaveLength(1);
    expect(manifestFindings(JSON.stringify({ ...good, display_override: ['minimal-ui'] }))).toHaveLength(1);
    expect(manifestFindings('not json')).toHaveLength(1);
  });

  const WORKER = 'var t=[{"revision":"a","url":"index.html"},{"revision":null,"url":"assets/app-1.js"},{"revision":null,"url":"assets/app-1.css"},{"revision":"b","url":"manifest.webmanifest"}];e.addEventListener(`install`,e=>{e.waitUntil(x())}),e.addEventListener(`message`,t=>{let n=t.data;typeof n==`object`&&n&&n.type===`SKIP_WAITING`&&e.skipWaiting()});';

  it('accepts a worker that waits to be asked', () => {
    expect(workerFindings(WORKER)).toEqual([]);
  });

  it('finds a worker that takes over without being asked', () => {
    // skipWaiting at install time as well as in the message handler: the string SKIP_WAITING is still there.
    const eager = WORKER.replace('e.waitUntil(x())', 'e.waitUntil(x()),e.skipWaiting()');
    expect(workerFindings(eager)).toHaveLength(1);
    const onlyEager = 'var t=[{"url":"index.html"}];e.addEventListener(`install`,()=>{self.skipWaiting()});';
    expect(workerFindings(onlyEager)).toHaveLength(1);
    const never = WORKER.replace('&&e.skipWaiting()', '');
    expect(workerFindings(never)).toHaveLength(1);
  });

  it('finds a worker with no file list or no page in it', () => {
    expect(workerFindings(WORKER.replace('"url":"index.html"', '"url":"other.html"'))).toHaveLength(1);
    expect(workerFindings(`${WORKER};self.__WB_MANIFEST`)).toHaveLength(1);
  });

  it('finds a page that asks for a file the worker does not precache', () => {
    const html = (script: string): string => `<head><link rel="manifest" href="/manifest.webmanifest" /><script type="module" crossorigin src="${script}"></script><link rel="stylesheet" crossorigin href="/assets/app-1.css"></head>`;
    expect(precacheFindings(html('/assets/app-1.js'), WORKER)).toEqual([]);
    expect(precacheFindings(html('/assets/app-2.js'), WORKER)).toEqual(['index.html asks for /assets/app-2.js, which sw.js does not precache']);
    // Relative references resolve against the site root, exactly as the worker resolves them at install.
    expect(precacheFindings(html('assets/app-1.js'), WORKER)).toEqual([]);
    expect(precacheFindings(html('./assets/app-1.js?v=3'), WORKER)).toEqual([]);
    expect(precacheFindings(html('assets/app-2.js'), WORKER)).toHaveLength(1);
    const withExtra = (tag: string): string => html('/assets/app-1.js').replace('</head>', `${tag}</head>`);
    for (const tag of ['<link rel="icon" href="favicon.ico">', '<link rel="preload" as="font" href="./fonts/a.woff2" crossorigin>', '<link rel="canonical" href="/">']) {
      expect(precacheFindings(withExtra(tag), WORKER), tag).toHaveLength(1);
    }
    // Another site is not this check's business; the URL scan catches it.
    expect(precacheFindings(withExtra('<link rel="preconnect" href="https://elsewhere.test/">'), WORKER)).toEqual([]);
  });
});
