// Each check script is shown to fire on the thing it exists to catch, and to stay quiet on what is allowed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../vite.config.ts';
import {
  contentChecks,
  contentFindings,
  countFindings,
  enemyFindings,
  gearLimitFindings,
  idLockFindings,
  itemFindings,
  loadoutFindings,
  lockOf,
  mapFindings,
  schemaFindings,
  stringFindings,
} from '../scripts/check-content';
import {
  ALLOWED_URLS,
  BACKUP_ADDRESS,
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
import { BACKUP_ORIGIN } from '../src/save';
import {
  EXCEPTIONS_FILE,
  LOG_FORMAT,
  isSealed,
  lockFindings,
  logFindings,
  messageFindings,
  nameFindings,
  nameHits,
  readExceptions,
  scanNames,
  tokenFindings,
} from '../scripts/check-repo';
import { ROOT } from '../scripts/lib';
import { BUNDLED, loadBundled, lockSchema, specSchema } from '../src/content';
import type { LockFile, SpecFile, StringsFile } from '../src/content';
import { ACCESSORY_SLOTS, ARMOR_SLOTS, TAGS } from '../src/engine';
import type { Content, ItemDef, ItemLines, LineKey, SlotId } from '../src/engine';
import { sampleContent, sampleItem } from '../src/engine/sample.fixture';

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

  it('finds a content name in unsealed text as a whole name, without printing it', () => {
    const names = ['Glass Heron', 'Ash'];
    expect(nameFindings('docs/STATUS.md', 'We met the Glass Heron today.', names)).toEqual(['docs/STATUS.md:1 contains content name #1']);
    expect(nameFindings('docs/STATUS.md', 'line\nAsh fell.', names)).toEqual(['docs/STATUS.md:2 contains content name #2']);
    // Part of a longer word is not the name.
    expect(nameFindings('docs/STATUS.md', 'crASH, smash, ashen, washes and a glass heronry.', names)).toEqual([]);
  });

  it('finds a name in any case, as a plain plural, and with its words joined by hyphens or spaces', () => {
    const names = ['Glass Heron', 'Ash', 'Tin-Pot Newt'];
    const lines = (text: string): number[] => nameHits(text, names).map((hit) => hit.line);
    const which = (text: string): number[] => nameHits(text, names).map((hit) => hit.which);
    for (const text of ['a glass heron', 'GLASS HERON', 'two Glass Herons', 'glass-heron', 'Glass  Heron', "the glass heron's nest"]) {
      expect(which(text), text).toEqual([0]);
    }
    for (const text of ['ash', 'ASH', 'Ashes to ashes', 'ash-grey', '(ash)', 'ash.']) expect(which(text), text).toEqual([1]);
    for (const text of ['tin-pot newt', 'Tin Pot Newts', 'TIN-POT-NEWT']) expect(which(text), text).toEqual([2]);
    // Still whole names only: a longer word, the words in another order, or the words apart are not the name.
    for (const text of ['glassheron', 'heron glass', 'glass and heron', 'ashy', 'ashess', 'tinpot newt', 'newts']) expect(which(text), text).toEqual([]);
    expect(lines('nothing\nan ash tree\nnothing\nGlass Herons')).toEqual([2, 4]);
  });

  it('scans a commit message, and prints which name by number only', () => {
    const names = ['Glass Heron', 'Ash'];
    expect(messageFindings('Phase 3b: retune e003 and Z1\n\nNo names here.\n', names)).toEqual([]);
    expect(messageFindings('Phase 3b: nerf the glass herons\n', names)).toEqual(['the commit message contains content name #1']);
    // One line per name however often it is written, and comment lines are scanned too.
    const message = 'Phase 3b: ash\n\nAsh again, and the Glass Heron.\n# Ash in a comment\n';
    expect(messageFindings(message, names)).toEqual(['the commit message contains content name #1', 'the commit message contains content name #2']);
    for (const finding of messageFindings(message, names)) expect(finding).not.toMatch(/heron|ash/i);
  });

  it('scans the messages of commits already made, naming the commit and not the name', () => {
    const names = ['Glass Heron', 'Ash'];
    const first = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const second = '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const third = '3333333ccccccccccccccccccccccccccccccccc';
    // As `git log` prints them in LOG_FORMAT: hash, message, NUL, then a line break before the next.
    const log = `${first}\nPhase 3b: tune Z1\n\nNothing to see.\n\0\n${second}\nPhase 3b: the ashes\n\nAnd a glass-heron.\n\0\n${third}\n\0\n`;
    expect(LOG_FORMAT).toBe('--format=%H%n%B%x00');
    expect(logFindings(log, names)).toEqual(['the message of commit 2222222 contains content name #1', 'the message of commit 2222222 contains content name #2']);
    expect(logFindings('', names)).toEqual([]);
    // A hash is not text to scan: one that happens to spell a name is not a finding.
    expect(logFindings('a5h\nPhase 3b: fine\n\0', ['a5h'])).toEqual([]);
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

  it('lets the page call its own site and the cloud backup, and nowhere else', () => {
    expect(REQUIRED_CSP.filter((directive) => directive.startsWith('connect-src'))).toEqual([`connect-src 'self' ${BACKUP_ORIGIN}`]);
    // Every other directive names the site itself, inline data or nothing: no second address anywhere.
    expect(REQUIRED_CSP.join(' ').match(/https?:\/\/[^\s;]+/g)).toEqual([BACKUP_ORIGIN]);
    expect(pageFindings(page(CONTENT_SECURITY_POLICY.replace(BACKUP_ORIGIN, `${BACKUP_ORIGIN} https://uploads.github.com`), VIEWPORT)).length).toBeGreaterThan(0);
    expect(pageFindings(page(CONTENT_SECURITY_POLICY.replace(BACKUP_ORIGIN, 'https://*.github.com'), VIEWPORT)).length).toBeGreaterThan(0);
    expect(pageFindings(page(CONTENT_SECURITY_POLICY.replace(` ${BACKUP_ORIGIN}`, ''), VIEWPORT)).length).toBeGreaterThan(0);
  });

  it('allows the cloud backup address in the bundle only as a whole string, and that host exactly', () => {
    expect(BACKUP_ADDRESS).toBe(BACKUP_ORIGIN);
    expect(urlFindings('a.js', `fetch("${BACKUP_ORIGIN}")`)).toEqual([]);
    expect(urlFindings('a.js', `const a='${BACKUP_ORIGIN}';`)).toEqual([]);
    expect(urlFindings('a.js', 'const a=`' + BACKUP_ORIGIN + '`;')).toEqual([]);
    // A string that begins with the address can name any host at all. Each of these did, or could, pass a check
    // that looked only at where the address-shaped text stopped.
    for (const literal of [
      `"${BACKUP_ORIGIN})@evil.example/x"`,
      `"${BACKUP_ORIGIN} @evil.example/x"`,
      `"${BACKUP_ORIGIN}<@evil.example/x"`,
      `"${BACKUP_ORIGIN}'@evil.example/x"`,
      `"${BACKUP_ORIGIN}\\@evil.example/x"`,
      `"${BACKUP_ORIGIN}\\x40evil.example/x"`,
      `"${BACKUP_ORIGIN}\\u002eevil.example/x"`,
      `"${BACKUP_ORIGIN}@evil.example/x"`,
      `"${BACKUP_ORIGIN}.example.net/repos"`,
      `"${BACKUP_ORIGIN}:8443/x"`,
      `"${BACKUP_ORIGIN}/repos/a/b"`,
      `"${BACKUP_ORIGIN};"`,
      `'${BACKUP_ORIGIN}"`,
      `"x ${BACKUP_ORIGIN}"`,
      '"https://uploads.github.com/x"',
      '"http://api.github.com"',
      '"wss://api.github.com"',
      '"https://github.com/login"',
      '"https://API.github.com.example.net"',
    ]) {
      expect(urlFindings('a.js', `fetch(${literal})`).length, literal).toBeGreaterThan(0);
    }
    // Nor is it let through where it merely stands between two of the same character that are not quotes.
    expect(urlFindings('a.js', `// see ${BACKUP_ORIGIN} for the address`).length).toBeGreaterThan(0);
    expect(urlFindings('a.js', `fetch( ${BACKUP_ORIGIN} )`).length).toBeGreaterThan(0);
  });

  it('allows the address in the page only as the content security policy names it', () => {
    const policy = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`;
    expect(policy).toContain(` ${BACKUP_ORIGIN}; `);
    expect(urlFindings('index.html', policy)).toEqual([]);
    expect(urlFindings('a.js', policy).length).toBeGreaterThan(0);
    expect(urlFindings('index.html', policy.replace(`${BACKUP_ORIGIN}; `, `${BACKUP_ORIGIN};x `)).length).toBeGreaterThan(0);
    expect(urlFindings('index.html', `<a href="${BACKUP_ORIGIN}/x">`).length).toBeGreaterThan(0);
  });

  it('pins the list of URL shapes that are let through, so that adding one is a deliberate act', () => {
    expect(ALLOWED_URLS.map((allowed) => allowed.source)).toEqual([
      '^http:\\/\\/www\\.w3\\.org\\/',
      '^https?:\\/\\/json-schema\\.org\\/draft[-/][0-9-]+\\/schema#?$',
      '^http:\\/\\/\\[\\$\\{[A-Za-z_$][\\w$]*\\}\\]$',
    ]);
    for (const url of ['https://example.com/x.js', 'https://cdn.example.net/lib.js', 'https://fonts.example.org/f.css', 'https://www.w3.org/x', 'https://api.example.com']) {
      expect(urlFindings('a.js', `fetch("${url}")`), url).toHaveLength(1);
    }
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

describe('check-repo name scan exceptions', () => {
  // Made-up names. One of them is held by two keys.
  const strings = {
    zones: { z01: 'Ashen Vale' },
    items: { i001: 'Glass Heron', i002: 'Ash' },
    tags: { t1: 'Ash', t2: 'Ember' },
    lines: { 'handover.i001': 'Take this.', short: 'A' },
  };
  const file = (exceptions: unknown): string => JSON.stringify({ exceptions });

  it('labels each name with the strings-file keys that hold it', () => {
    expect(scanNames(strings)).toEqual([
      { name: 'Ashen Vale', keys: ['zones.z01'] },
      { name: 'Glass Heron', keys: ['items.i001'] },
      { name: 'Ash', keys: ['items.i002', 'tags.t1'] },
      { name: 'Ember', keys: ['tags.t2'] },
      { name: 'Take this.', keys: ['lines.handover.i001'] },
    ]);
    const names = scanNames(strings);
    const found = nameFindings(
      'docs/GDD.md',
      'An Ember glows.\nNothing here.\nAsh fell.',
      names.map((entry) => entry.name),
      names.map((entry) => entry.keys.join(' and ')),
    );
    expect(found).toEqual(['docs/GDD.md:1 contains content name tags.t2', 'docs/GDD.md:3 contains content name items.i002 and tags.t1']);
  });

  it('skips an exempted key, and a name held by two keys only when both are exempt', () => {
    const scanned = (exempt: string[]): string[] => scanNames(strings, new Set(exempt)).map((entry) => entry.name);
    expect(scanned(['tags.t2'])).toEqual(['Ashen Vale', 'Glass Heron', 'Ash', 'Take this.']);
    expect(scanned(['tags.t1'])).toContain('Ash');
    expect(scanned(['tags.t1', 'items.i002'])).not.toContain('Ash');
    // Exempting one key never loosens the scan for any other name.
    expect(scanned(['tags.t1', 'items.i002'])).toEqual(['Ashen Vale', 'Glass Heron', 'Ember', 'Take this.']);
  });

  it('reads the exceptions file, and treats a missing file as no exceptions', () => {
    expect(readExceptions(null, strings)).toEqual({ keys: new Set(), problems: [] });
    expect(readExceptions(file([]), strings)).toEqual({ keys: new Set(), problems: [] });
    expect(readExceptions(file([{ key: 'tags.t2', reason: 'an ordinary word the design document uses for something else' }]), strings)).toEqual({
      keys: new Set(['tags.t2']),
      problems: [],
    });
  });

  it('refuses an exception nobody can account for', () => {
    const malformed = [`${EXCEPTIONS_FILE} is not {"exceptions": [{"key": "<section>.<id>", "reason": "<one line>"}]}`];
    expect(readExceptions('not json', strings).problems).toEqual(malformed);
    expect(readExceptions(JSON.stringify(['tags.t2']), strings).problems).toEqual(malformed);
    expect(readExceptions(JSON.stringify({ exceptions: 'tags.t2' }), strings).problems).toEqual(malformed);
    for (const entry of [{ key: 'tags.t2' }, { key: 'tags.t2', reason: '  ' }, { key: 'tags.t2', reason: 'two\nlines' }]) {
      const read = readExceptions(file([entry]), strings);
      expect(read.problems, JSON.stringify(entry)).toEqual([`${EXCEPTIONS_FILE} entry 1 (tags.t2) needs a one-line reason`]);
      expect(read.keys.size).toBe(0);
    }
    expect(readExceptions(file(['tags.t2']), strings).problems).toEqual([`${EXCEPTIONS_FILE} entry 1 has no key`]);
    // A key the strings file does not hold: a stale exception, or a mistyped one that exempts nothing.
    const stale = readExceptions(file([{ key: 'tags.t9', reason: 'gone' }]), strings);
    expect(stale.problems).toEqual([`${EXCEPTIONS_FILE} entry 1 (tags.t9) is not a key in data/strings.en.json`]);
    expect(stale.keys.size).toBe(0);
  });

  it('has a well-formed exceptions file, and that file is sealed', () => {
    const real: unknown = JSON.parse(readFileSync(join(ROOT, 'data/strings.en.json'), 'utf8'));
    expect(readExceptions(readFileSync(join(ROOT, EXCEPTIONS_FILE), 'utf8'), real).problems).toEqual([]);
    expect(isSealed(EXCEPTIONS_FILE)).toBe(true);
  });
});

// ---- check-content (GDD 7.9) ----
//
// The worlds below are made up: the engine's sample world, patched, with names of the form "name of <id>". Every
// limit a test leans on is read from the world's own balance table or set by the test, so nothing here depends
// on what data/balance.json is tuned to. Findings name IDs and tiles only, so a failure message is safe to print.

type Deep<T> = T extends readonly (infer U)[] ? Deep<U>[] : T extends object ? { -readonly [K in keyof T]: Deep<T[K]> } : T;
type World = Deep<Content>;

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('the test world lacks something this test needs');
  return value;
};

/** A copy with nothing shared, inside it or with the original: content is plain data, so a trip through JSON does it. */
const copyOf = (content: Content): World => JSON.parse(JSON.stringify(content)) as World;

const without = <T>(record: Record<string, T>, id: string): Record<string, T> => Object.fromEntries(Object.entries(record).filter(([key]) => key !== id));

const fires = (findings: readonly string[], pattern: RegExp): void => {
  expect(findings.some((finding) => pattern.test(finding)), `nothing matches ${String(pattern)} among: ${findings.join(' | ') || 'no findings'}`).toBe(true);
};

/**
 * A small valid world, as a copy a test may break. It is the engine's sample world with three changes: the one
 * tile nobody could reach in z02 is walled up, z01 has a place name, and z01 has a reference loadout made of
 * eighteen shop items sized to the budget (i101 the weapon, i102 to i113 the armor, i114 and i115 accessories).
 *
 *   z01                 z02
 *   #########           #####
 *   #..2#...#           #.4##     1, 2, 4  normal enemies s001, s002, s004
 *   #...B..>#           #..<#     B        gate boss s003; > and < exits
 *   #..1#...#           #####
 *   #.S.#####                     S        Salvage site
 *   #.@.%_###                     @ start; % hidden tile x01; _ stash x02
 *   #...#####
 *   #D#######                     D        door, opened by key i004, which s001's enemy drops
 *   #.#######
 *   #########
 */
const world = (): World => {
  const w = copyOf(sampleContent());
  must(w.zones['z02']).map.tiles[1] = '#..##';
  must(w.zones['z01']).map.places.push({ key: 'p01', x: 2, y: 5 });

  const { budget, priceFactorMin } = w.balance.items;
  const row = must(w.balance.zones['Z1']);
  const add = (id: string, kind: ItemDef['kind'], lines: ItemLines, copyCap = 1): string => {
    w.items[id] = sampleItem(id, kind, { lines: { ...lines }, copyCap, priceFactor: priceFactorMin });
    w.itemOrder.push(id);
    return id;
  };
  const slots = {} as Record<SlotId, string | null>;
  slots.weapon = add('i101', 'weapon', { damageFlat: budget.damagePerLevel * row.levelMax, damagePct: row.pctBudget });
  ARMOR_SLOTS.forEach((slot, index) => {
    const share = { defenseFlat: (budget.defensePerLevel * row.levelMax) / ARMOR_SLOTS.length, lifeFlat: (budget.lifePerLevel * row.levelMax) / ARMOR_SLOTS.length };
    slots[slot] = add(`i${102 + index}`, slot, index === 0 ? { ...share, lifePct: row.pctBudget, defensePct: row.pctBudget } : share);
  });
  const dexterity = { dexterityFlat: (budget.dexterityPerLevel * row.levelMax) / ACCESSORY_SLOTS.length };
  const threeWorn = add('i114', 'accessory', dexterity, 3);
  const twoWorn = add('i115', 'accessory', dexterity, 3);
  ACCESSORY_SLOTS.forEach((slot, index) => {
    slots[slot] = index < 3 ? threeWorn : twoWorn;
  });
  must(w.zones['z01']).referenceLoadout = slots;
  return w;
};

const named = (ids: Iterable<string>): Record<string, string> => Object.fromEntries([...ids].map((id) => [id, `name of ${id}`]));

const stringsFor = (w: Content): StringsFile => ({
  zones: named(Object.keys(w.zones)),
  enemies: named(Object.keys(w.enemies)),
  families: named(new Set(Object.values(w.enemies).map((enemy) => enemy.family))),
  items: named(Object.keys(w.items)),
  tags: named(TAGS),
  places: named(Object.values(w.zones).flatMap((zone) => zone.map.places.map((place) => place.key))),
  lines: {},
});

const lockFor = (w: Content): LockFile => ({ ids: lockOf(w) });

/** Counted here on its own, not by the check, so the two have to agree. */
const specFor = (w: Content): SpecFile => {
  const group = (kinds: readonly string[]): { total: number; sold: number } => {
    const members = Object.values(w.items).filter((item) => kinds.includes(item.kind));
    return { total: members.length, sold: members.filter((item) => item.priceFactor !== null).length };
  };
  const enemies: SpecFile['enemies'] = {};
  for (const zone of Object.keys(w.zones)) {
    const here = Object.values(w.enemies).filter((enemy) => enemy.zone === zone);
    enemies[zone] = { total: here.length, bosses: here.filter((enemy) => enemy.boss).length };
  }
  return {
    completeZones: ['z01'],
    zones: Object.keys(w.zones).length,
    enemies,
    items: { weapons: group(['weapon']), armor: group(ARMOR_SLOTS), accessories: group(['accessory']), keys: group(['key']) },
  };
};

describe('check-content', () => {
  it('passes a small valid world on every check', () => {
    const w = world();
    expect(contentFindings(w, stringsFor(w), lockFor(w), specFor(w))).toEqual([]);
    expect(contentChecks(w, stringsFor(w), lockFor(w), specFor(w)).map((check) => check.name)).toEqual([
      'ids',
      'counts',
      'items',
      'enemies',
      'loadouts',
      'gear limits',
      'maps',
      'strings',
    ]);
  });

  describe('ids', () => {
    it('gives every ID its kind, sorted', () => {
      const w = world();
      w.waypoints['w01'] = { id: 'w01', zone: 'z01', x: 2, y: 2 };
      const lock = lockOf(w);
      expect(lock).toMatchObject({
        z01: 'zone',
        e001: 'enemy',
        e003: 'boss',
        i001: 'weapon',
        i002: 'body',
        i003: 'accessory',
        i004: 'key',
        s001: 'spawn',
        x01: 'secret',
        x02: 'secret',
        w01: 'waypoint',
      });
      expect(Object.keys(lock)).toEqual(Object.keys(lock).sort());
      expect(lockSchema.safeParse({ ids: lock }).success).toBe(true);
    });

    it('fires on an ID missing from the lock, locked as another kind, or gone from the data', () => {
      const w = world();
      const lock = lockFor(w);
      expect(idLockFindings(w, lock)).toEqual([]);
      expect(idLockFindings(w, { ids: without(lock.ids, 'i002') })).toEqual(['i002 is not in data/ids.lock.json']);
      expect(idLockFindings(w, { ids: without(lock.ids, 's003') })).toEqual(['s003 is not in data/ids.lock.json']);
      expect(idLockFindings(w, { ids: { ...lock.ids, e003: 'enemy' } })).toEqual(['e003 is locked as enemy but the data makes it boss']);
      expect(idLockFindings(w, { ids: { ...lock.ids, i002: 'head' } })).toEqual(['i002 is locked as head but the data makes it body']);
      expect(idLockFindings(w, { ids: { ...lock.ids, x01: 'spawn' } })).toEqual(['x01 is locked as spawn but the data makes it secret']);
      expect(idLockFindings(w, { ids: { ...lock.ids, i999: 'weapon' } })).toEqual(['i999 is in data/ids.lock.json but no longer in the data']);
      expect(idLockFindings(w, { ids: {} })).toHaveLength(Object.keys(lock.ids).length);
    });
  });

  describe('counts', () => {
    it('fires on any count that differs from the spec', () => {
      const w = world();
      const spec = specFor(w);
      expect(countFindings(w, spec)).toEqual([]);
      expect(countFindings(w, { ...spec, zones: spec.zones + 1 })).toHaveLength(1);
      const z01 = must(spec.enemies['z01']);
      expect(countFindings(w, { ...spec, enemies: { ...spec.enemies, z01: { ...z01, total: z01.total + 1 } } })).toEqual([
        `z01 has ${z01.total} enemies; the spec says ${z01.total + 1}`,
      ]);
      expect(countFindings(w, { ...spec, enemies: { ...spec.enemies, z01: { ...z01, bosses: z01.bosses + 1 } } })).toEqual([
        `z01 has ${z01.bosses} boss(es); the spec says ${z01.bosses + 1}`,
      ]);
      expect(countFindings(w, { ...spec, enemies: without(spec.enemies, 'z02') })).toEqual(['z02 has no enemy counts in the spec']);
      expect(countFindings(w, { ...spec, enemies: { ...spec.enemies, z09: { total: 0, bosses: 0 } } })).toEqual(['the spec counts enemies for z09, which is not a zone']);
      for (const group of ['weapons', 'armor', 'accessories', 'keys'] as const) {
        const counts = spec.items[group];
        fires(countFindings(w, { ...spec, items: { ...spec.items, [group]: { ...counts, total: counts.total + 1 } } }), new RegExp(`^the data has ${counts.total} ${group}`));
        fires(countFindings(w, { ...spec, items: { ...spec.items, [group]: { ...counts, sold: counts.sold + 1 } } }), new RegExp(`^the shop sells ${counts.sold} ${group}`));
      }
    });

    it('counts what is in the data, not what the spec expects', () => {
      const w = world();
      const spec = specFor(w);
      w.enemies['e099'] = { ...must(w.enemies['e002']), id: 'e099', boss: true };
      fires(countFindings(w, spec), /^z01 has \d+ enemies; the spec says/);
      fires(countFindings(w, spec), /^z01 has \d+ boss\(es\); the spec says/);
      w.items['i199'] = sampleItem('i199', 'key');
      fires(countFindings(w, spec), /^the data has \d+ keys; the spec says/);
    });
  });

  describe('items', () => {
    const cannot = (id: string): string => `${id} cannot be obtained: it is not sold, and no enemy with a spawn drops it`;

    it('fires on an item nothing drops and nobody sells', () => {
      const w = world();
      expect(itemFindings(w)).toEqual([]);
      const e002 = must(w.enemies['e002']);
      e002.drops = e002.drops.filter((drop) => drop.item !== 'i008');
      expect(itemFindings(w)).toEqual([cannot('i008')]);
    });

    it('does not count a drop from an enemy that has no spawn', () => {
      const w = world();
      w.spawns = without(w.spawns, 's002');
      expect(itemFindings(w)).toEqual([cannot('i003'), cannot('i008')]);
    });

    it('fires on a drop that points at no item', () => {
      const w = world();
      must(w.enemies['e001']).drops.push({ item: 'i999', chance: 50 });
      expect(itemFindings(w)).toEqual(['e001 drops i999, which is not an item']);
    });

    it('fires on a price factor or a drop chance outside the balance limits', () => {
      const { priceFactorMin, priceFactorMax, dropChanceMin } = world().balance.items;
      for (const factor of [priceFactorMin / 2, priceFactorMax * 2]) {
        const w = world();
        must(w.items['i001']).priceFactor = factor;
        fires(itemFindings(w), /^i001 has a price factor outside /);
        expect(itemFindings(w)).toHaveLength(1);
      }
      for (const factor of [priceFactorMin, priceFactorMax]) {
        const w = world();
        must(w.items['i001']).priceFactor = factor;
        expect(itemFindings(w)).toEqual([]);
      }
      for (const chance of [dropChanceMin / 2, 100.5]) {
        const w = world();
        must(must(w.enemies['e001']).drops[0]).chance = chance;
        fires(itemFindings(w), /^e001 drops i002 at a chance outside /);
        expect(itemFindings(w)).toHaveLength(1);
      }
      for (const chance of [dropChanceMin, 100]) {
        const w = world();
        must(must(w.enemies['e001']).drops[0]).chance = chance;
        expect(itemFindings(w)).toEqual([]);
      }
    });

    it("fires on a dropped item whose level is not its enemy's", () => {
      const w = world();
      must(w.items['i002']).level += 1;
      expect(itemFindings(w)).toEqual(['i002 is dropped, but its level is not the level of an enemy that drops it']);
    });

    it('fires on a copy cap the item kind does not allow', () => {
      const cases: Array<[string, number, RegExp]> = [
        ['i001', 3, /^i001 is a weapon with a copy cap that is not 1$/],
        ['i002', 3, /^i002 is a piece of armor with a copy cap that is not 1$/],
        ['i004', 3, /^i004 is a key with a copy cap that is not 1$/],
        ['i003', 2, /^i003 is an accessory with a copy cap that is not 1 or 3$/],
        ['i003', 4, /^i003 is an accessory with a copy cap that is not 1 or 3$/],
      ];
      for (const [id, cap, pattern] of cases) {
        const w = world();
        must(w.items[id]).copyCap = cap;
        fires(itemFindings(w), pattern);
        expect(itemFindings(w), id).toHaveLength(1);
      }
      for (const cap of [1, 3]) {
        const w = world();
        must(w.items['i003']).copyCap = cap;
        expect(itemFindings(w)).toEqual([]);
      }
    });

    it('fires on a key that is sold and on a claim item that is not a weapon', () => {
      const sold = world();
      must(sold.items['i004']).priceFactor = sold.balance.items.priceFactorMin;
      expect(itemFindings(sold)).toEqual(['i004 is a key and is sold; a key is never sold']);
      const claim = world();
      must(claim.items['i008']).claim = true;
      fires(itemFindings(claim), /^i008 carries the claim effect but is not a weapon$/);
    });

    it('fires on a claim item that is not a guaranteed handover from a boss', () => {
      const handover = 'i005 carries the claim effect, so a boss must drop it at a chance of 100';
      expect(itemFindings(world())).toEqual([]);

      // Dropped by the boss, but not every time.
      const chancy = world();
      must(must(chancy.enemies['e003']).drops[0]).chance = 99;
      expect(itemFindings(chancy)).toEqual([handover]);

      // Dropped every time, but by an enemy that is not a boss.
      const lowly = world();
      const e003 = must(lowly.enemies['e003']);
      e003.boss = false;
      e003.gate = false;
      expect(itemFindings(lowly)).toEqual([handover]);

      // Sold in the shop and dropped by nobody.
      const sold = world();
      must(sold.enemies['e003']).drops = [{ item: 'i008', chance: 10 }];
      must(sold.items['i005']).priceFactor = sold.balance.items.priceFactorMin;
      expect(itemFindings(sold)).toEqual([handover]);
    });
  });

  describe('enemies', () => {
    it('fires on a modifier outside the balance range', () => {
      const { modifierMin, modifierMax } = world().balance.enemy;
      expect(enemyFindings(world())).toEqual([]);
      for (const stat of ['life', 'damage', 'defense'] as const) {
        for (const value of [modifierMin / 2, modifierMax * 2]) {
          const w = world();
          must(w.enemies['e001']).mods[stat] = value;
          fires(enemyFindings(w), new RegExp(`^e001 has a ${stat} modifier outside `));
          expect(enemyFindings(w)).toHaveLength(1);
        }
        for (const value of [modifierMin, modifierMax]) {
          const w = world();
          must(w.enemies['e001']).mods[stat] = value;
          expect(enemyFindings(w)).toEqual([]);
        }
      }
    });

    it("fires on a level outside its zone's band", () => {
      const band = must(world().balance.zones['Z1']);
      for (const level of [band.levelMin - 1, band.levelMax + 1]) {
        const w = world();
        must(w.enemies['e001']).level = level;
        expect(enemyFindings(w)).toEqual(['e001 has a level outside the band of z01']);
      }
      for (const level of [band.levelMin, band.levelMax]) {
        const w = world();
        must(w.enemies['e001']).level = level;
        expect(enemyFindings(w)).toEqual([]);
      }
      const lost = world();
      must(lost.enemies['e001']).zone = 'z09';
      expect(enemyFindings(lost)).toEqual(['e001 is in z09, which is not a zone with a balance row']);
    });

    it('fires on a gate that is not a boss, an enemy with no spawn, and too few or too many drops', () => {
      const gate = world();
      must(gate.enemies['e001']).gate = true;
      expect(enemyFindings(gate)).toEqual(['e001 is a gate but not a boss']);

      const absent = world();
      absent.spawns = without(absent.spawns, 's001');
      expect(enemyFindings(absent)).toEqual(['e001 has no spawn']);

      const none = world();
      must(none.enemies['e001']).drops = [];
      expect(enemyFindings(none)).toEqual(['e001 has 0 drops; an enemy holds 1 to 3']);

      const many = world();
      const e001 = must(many.enemies['e001']);
      e001.drops = [...e001.drops, ...must(many.enemies['e002']).drops];
      expect(enemyFindings(many)).toEqual(['e001 has 4 drops; an enemy holds 1 to 3']);
    });

    it('fires on an enemy that lists one item twice in its drops', () => {
      const w = world();
      const e001 = must(w.enemies['e001']);
      e001.drops = [...e001.drops, { ...must(e001.drops[0]), chance: 5 }];
      expect(enemyFindings(w)).toEqual(['e001 lists i002 more than once in its drops']);
    });

    it('fires on a boss with more than one spawn, and not on a normal enemy with two', () => {
      const boss = world();
      boss.spawns['s009'] = { id: 's009', enemy: 'e003', zone: 'z01', x: 6, y: 1 };
      expect(enemyFindings(boss)).toEqual(['e003 is a boss with 2 spawns; a boss has exactly one']);

      const normal = world();
      normal.spawns['s009'] = { id: 's009', enemy: 'e002', zone: 'z01', x: 6, y: 1 };
      expect(enemyFindings(normal)).toEqual([]);
    });
  });

  describe('loadouts', () => {
    const loadoutOf = (w: World): Record<SlotId, string | null> => must(must(w.zones['z01']).referenceLoadout);

    it('fires when a complete zone has no loadout, or a zone not listed has one', () => {
      const w = world();
      const spec = specFor(w);
      expect(loadoutFindings(w, spec)).toEqual([]);

      const none = world();
      must(none.zones['z01']).referenceLoadout = null;
      expect(loadoutFindings(none, spec)).toEqual(['z01 is listed as complete but has no reference loadout']);

      const extra = world();
      must(extra.zones['z02']).referenceLoadout = { ...loadoutOf(extra) };
      expect(loadoutFindings(extra, spec)).toEqual(['z02 is not listed as complete, so its reference loadout must be null']);

      expect(loadoutFindings(w, { ...spec, completeZones: ['z01', 'z09'] })).toEqual(['the spec lists z09 as complete, which is not a zone']);
      expect(loadoutFindings(w, { ...spec, completeZones: [] })).toEqual(['z01 is not listed as complete, so its reference loadout must be null']);
    });

    it('fires on an empty cell, an item in the wrong kind of cell, and an item that does not exist', () => {
      const spec = specFor(world());
      const empty = world();
      loadoutOf(empty).acc5 = null;
      fires(loadoutFindings(empty, spec), /^z01 reference loadout: acc5 is empty$/);

      const wrong = world();
      loadoutOf(wrong).head = loadoutOf(wrong).weapon;
      fires(loadoutFindings(wrong, spec), /^z01 reference loadout: head holds i101, which does not go in that slot$/);

      const armorAsAccessory = world();
      loadoutOf(armorAsAccessory).acc1 = loadoutOf(armorAsAccessory).head;
      fires(loadoutFindings(armorAsAccessory, spec), /^z01 reference loadout: acc1 holds i\d+, which does not go in that slot$/);

      const missing = world();
      loadoutOf(missing).weapon = 'i999';
      fires(loadoutFindings(missing, spec), /^z01 reference loadout: weapon holds i999, which is not an item$/);
    });

    it('fires on an accessory worn in more cells than its copy cap, and on an item above the top level', () => {
      const spec = specFor(world());
      const capped = world();
      must(capped.items['i114']).copyCap = 1;
      expect(loadoutFindings(capped, spec)).toEqual(['z01 reference loadout: i114 is worn in 3 cells, more than its copy cap']);

      const high = world();
      must(high.items['i101']).level = must(high.balance.zones['Z1']).levelMax + 1;
      expect(loadoutFindings(high, spec)).toEqual(["z01 reference loadout: i101 has a level above the zone's top level"]);

      const top = world();
      must(top.items['i101']).level = must(top.balance.zones['Z1']).levelMax;
      expect(loadoutFindings(top, spec)).toEqual([]);
    });

    it('fires on each budget line outside the tolerance, above or below, and not inside it', () => {
      const spec = specFor(world());
      const carriers: Array<[LineKey, RegExp]> = [
        ['damageFlat', /^i101$/],
        ['defenseFlat', /^i1(0[2-9]|1[0-3])$/],
        ['lifeFlat', /^i1(0[2-9]|1[0-3])$/],
        ['dexterityFlat', /^i11[45]$/],
        ['lifePct', /^i102$/],
        ['damagePct', /^i101$/],
        ['defensePct', /^i102$/],
      ];
      // The test sets the tolerance, so the factors below are on the right side of it whatever the game uses.
      const scaled = (line: LineKey, carrier: RegExp, factor: number): string[] => {
        const w = world();
        w.balance.items.budget.tolerance = 0.1;
        for (const item of Object.values(w.items)) {
          const value = item.lines[line];
          if (carrier.test(item.id) && value !== undefined) item.lines[line] = value * factor;
        }
        return loadoutFindings(w, spec);
      };
      for (const [line, carrier] of carriers) {
        for (const factor of [0, 0.85, 1.15, 3]) {
          const findings = scaled(line, carrier, factor);
          fires(findings, new RegExp(`^z01 reference loadout: ${line} totals `));
          expect(findings, `${line} x ${factor}`).toHaveLength(1);
        }
        for (const factor of [0.95, 1, 1.05]) expect(scaled(line, carrier, factor), `${line} x ${factor}`).toEqual([]);
      }
    });
  });

  describe('gear limits', () => {
    // The limits are set here, so the sums below are exact whatever the game's limits are.
    const limited = (): World => {
      const w = world();
      w.balance.items.limits = { reflect: 10, lifeRegen: 10, lastStand: 2 };
      return w;
    };
    const give = (w: World, id: string, lines: ItemLines): void => {
      const item = must(w.items[id]);
      item.lines = { ...item.lines, ...lines };
    };

    it('adds the best item of each weapon and armor cell', () => {
      for (const line of ['reflect', 'lifeRegen'] as const) {
        const w = limited();
        expect(gearLimitFindings(w)).toEqual([]);
        give(w, 'i101', { [line]: 6 });
        give(w, 'i102', { [line]: 4 });
        // A second weapon cannot be worn with the first, and a negative line takes nothing off the total.
        give(w, 'i001', { [line]: 6 });
        give(w, 'i103', { [line]: -5 });
        expect(gearLimitFindings(w)).toEqual([]);
        give(w, 'i104', { [line]: 1 });
        expect(gearLimitFindings(w)).toEqual([`gear worn together can reach 11 ${line}; the limit is 10`]);
      }
    });

    it('adds the best five accessory cells, with as many copies of an accessory as its cap allows', () => {
      const w = limited();
      // Two accessories with a cap of 3: six copies, of which five can be worn.
      give(w, 'i114', { reflect: 2 });
      give(w, 'i115', { reflect: 2 });
      expect(gearLimitFindings(w)).toEqual([]);
      give(w, 'i114', { reflect: 3 });
      expect(gearLimitFindings(w)).toEqual(['gear worn together can reach 13 reflect; the limit is 10']);
      // With a cap of 1 only one copy of it counts.
      must(w.items['i114']).copyCap = 1;
      expect(gearLimitFindings(w)).toEqual([]);
    });

    it('holds the largest single Last Stand to its limit', () => {
      const w = limited();
      give(w, 'i007', { lastStand: 2 });
      give(w, 'i101', { lastStand: 2 });
      expect(gearLimitFindings(w)).toEqual([]);
      give(w, 'i007', { lastStand: 3 });
      expect(gearLimitFindings(w)).toEqual(['i007 has lastStand above the limit of 2']);
    });
  });

  describe('maps', () => {
    const mapOf = (w: World, zone: string): World['zones'][string]['map'] => must(w.zones[zone]).map;
    const place = (w: World, spawn: string, x: number, y: number): void => {
      const moved = must(w.spawns[spawn]);
      moved.x = x;
      moved.y = y;
    };
    const unreachable = (what: string): string => `${what} cannot be reached from the run start`;

    it('passes the small world, with a waypoint and its Salvage site added', () => {
      const w = world();
      expect(mapFindings(w)).toEqual([]);
      w.waypoints['w01'] = { id: 'w01', zone: 'z01', x: 6, y: 3 };
      mapOf(w, 'z01').salvageSites.push({ x: 6, y: 1 });
      expect(mapFindings(w)).toEqual([]);
    });

    it('does not trust lookups that are older than the content', () => {
      // The copy's lookups by tile still say the door is where it was; the check must go by the map.
      const w = world();
      const door = must(mapOf(w, 'z01').doors[0]);
      door.x = 7;
      door.y = 7;
      fires(mapFindings(w), /^door z01:7:7 cannot be reached/);
    });

    it('fires on a spawn with no reachable tile beside it', () => {
      const w = world();
      mapOf(w, 'z01').tiles[7] = '#.###.###';
      place(w, 's002', 5, 7);
      expect(mapFindings(w)).toEqual([unreachable('spawn s002')]);
    });

    it('fires on a Salvage site, a stash, a waypoint or an exit that cannot be reached', () => {
      const site = world();
      mapOf(site, 'z01').salvageSites.push({ x: 7, y: 7 });
      expect(mapFindings(site)).toEqual([unreachable('Salvage site z01:7:7')]);

      // A stash on a floor tile that nothing leads to.
      const stash = world();
      mapOf(stash, 'z01').tiles[8] = '#.###.###';
      const x02 = must(stash.secrets['x02']);
      if (x02.kind === 'stash') x02.y = 8;
      expect(mapFindings(stash)).toEqual([unreachable('secret x02'), 'z01: 1 floor tile(s) cannot be reached from the run start, the first at z01:5:8']);

      const waypoint = world();
      waypoint.waypoints['w01'] = { id: 'w01', zone: 'z01', x: 7, y: 8 };
      mapOf(waypoint, 'z01').salvageSites.push({ x: 7, y: 7 });
      expect(mapFindings(waypoint)).toEqual([unreachable('Salvage site z01:7:7'), unreachable('waypoint w01')]);

      const exit = world();
      mapOf(exit, 'z02').exits.push({ x: 3, y: 0, to: { zone: 'z01', x: 2, y: 5 } });
      expect(mapFindings(exit)).toEqual([unreachable('exit z02:3:0')]);
    });

    it('fires on floor nobody can get to, and on a hidden tile nobody can get to', () => {
      const w = world();
      mapOf(w, 'z01').tiles[8] = '#.###.###';
      expect(mapFindings(w)).toEqual(['z01: 1 floor tile(s) cannot be reached from the run start, the first at z01:5:8']);

      const hidden = world();
      const x01 = must(hidden.secrets['x01']);
      if (x01.kind === 'hidden') x01.tiles = [{ x: 7, y: 7 }];
      // The stash behind the old hidden tile is cut off with it.
      expect(mapFindings(hidden)).toEqual([unreachable('secret x01'), unreachable('secret x02'), 'z01: 1 floor tile(s) cannot be reached from the run start, the first at z01:5:5']);
    });

    it('does not let the hero cut a corner, walk through a wall or walk through a standing enemy', () => {
      // A floor tile that touches the rest only at a corner.
      const corner = world();
      mapOf(corner, 'z01').tiles[7] = '#.##.####';
      expect(mapFindings(corner)).toEqual(['z01: 1 floor tile(s) cannot be reached from the run start, the first at z01:4:7']);

      // The same enemy in the gap, no longer a boss: it is back at once after every win, so the gap never opens.
      const standing = world();
      const e003 = must(standing.enemies['e003']);
      e003.boss = false;
      e003.gate = false;
      const findings = mapFindings(standing);
      fires(findings, /^exit z01:7:2 cannot be reached/);
      fires(findings, /^spawn s004 cannot be reached/);
      fires(findings, /^z01: \d+ floor tile\(s\) cannot be reached/);
    });

    it('fires on a place the hero cannot get back from', () => {
      const w = world();
      mapOf(w, 'z02').exits = [];
      expect(mapFindings(w)).toEqual(['z02: the run start cannot be reached from 4 tile(s), the first at z02:1:1']);
    });

    it('fires when the required path needs a hidden tile', () => {
      const site = world();
      mapOf(site, 'z01').salvageSites.push({ x: 6, y: 5 });
      expect(mapFindings(site)).toEqual(['Salvage site z01:6:5 can be reached only over a hidden tile']);

      // The way on, moved behind the hidden tile.
      const exit = world();
      mapOf(exit, 'z01').exits = [{ x: 5, y: 5, to: { zone: 'z02', x: 1, y: 1 } }];
      fires(mapFindings(exit), /^exit z01:5:5 can be reached only over a hidden tile$/);

      // A stash may sit behind a hidden tile: that is what the small world has.
      expect(mapFindings(world())).toEqual([]);
    });

    it('fires on a gate boss that stands off the only path', () => {
      const w = world();
      place(w, 's003', 6, 1);
      expect(mapFindings(w)).toEqual(['e003 is a gate but blocks nothing: every exit and every other boss can be reached without beating it']);

      // A second boss behind the gate is enough for the gate to count, even with no exit beyond it.
      const second = world();
      mapOf(second, 'z01').exits = [];
      mapOf(second, 'z02').exits = [];
      must(second.enemies['e002']).boss = true;
      place(second, 's002', 6, 1);
      second.spawns = without(second.spawns, 's004');
      fires(mapFindings(second), /^z02: /);
      expect(mapFindings(second).filter((finding) => finding.includes('is a gate'))).toEqual([]);
    });

    it('fires on a key that can only be had from behind its own door', () => {
      const w = world();
      place(w, 's001', 1, 8);
      expect(mapFindings(w)).toEqual(['door z01:1:7: nothing that gives its key i004 can be reached while the door is closed']);
    });

    it('fires on a door whose key zone is wrong, whose key is no key, or that is sealed and still names a zone', () => {
      const door = (w: World): World['zones'][string]['map']['doors'][number] => must(mapOf(w, 'z01').doors[0]);
      for (const keyZone of ['z02', null]) {
        const w = world();
        door(w).keyZone = keyZone;
        expect(mapFindings(w)).toEqual(['door z01:1:7: its keyZone is not the zone of an enemy that drops i004']);
      }
      const notKey = world();
      door(notKey).key = 'i001';
      fires(mapFindings(notKey), /^door z01:1:7 is opened by i001, which is not a key$/);

      const sealed = world();
      door(sealed).key = null;
      fires(mapFindings(sealed), /^door z01:1:7 is sealed, so its keyZone must be null$/);
      // A sealed door is walked up to, never through, so nothing may lie behind it.
      door(sealed).keyZone = null;
      expect(mapFindings(sealed)).toEqual(['z01: 1 floor tile(s) cannot be reached from the run start, the first at z01:1:8']);
      mapOf(sealed, 'z01').tiles[8] = '#########';
      expect(mapFindings(sealed)).toEqual([]);
    });

    it('fires on an exit that lands on a wall, an enemy or another exit', () => {
      for (const [x, y] of [
        [0, 0],
        [2, 1],
        [3, 2],
      ]) {
        const w = world();
        must(mapOf(w, 'z01').exits[0]).to = { zone: 'z02', x: must(x), y: must(y) };
        fires(mapFindings(w), new RegExp(`^exit z01:7:2 lands on z02:${x}:${y}, which is not open floor$`));
      }
      const nowhere = world();
      must(mapOf(nowhere, 'z01').exits[0]).to = { zone: 'z09', x: 1, y: 1 };
      fires(mapFindings(nowhere), /^exit z01:7:2 lands on z09:1:1, which is not open floor$/);
    });

    it('fires on a spawn that is badly placed', () => {
      const cases: Array<[number, number, RegExp]> = [
        [4, 4, /^spawn s001 is not on floor$/],
        [3, 1, /^spawns s00[12] and s00[12] are on one tile$/],
        [2, 5, /^spawn s001 is on the run start$/],
        [7, 2, /^spawn s001 is on an exit$/],
        [1, 7, /^spawn s001 is on a door$/],
        [2, 4, /^spawn s001 is on a Salvage site$/],
        [5, 5, /^spawn s001 is on a secret$/],
        [4, 5, /^spawn s001 is on a secret$/],
      ];
      for (const [x, y, pattern] of cases) {
        const w = world();
        place(w, 's001', x, y);
        fires(mapFindings(w), pattern);
      }
    });

    it('fires on a run start that is not open floor, and on a spawn in a zone its enemy does not belong to', () => {
      const start = world();
      start.start = { zone: 'z01', x: 0, y: 0 };
      fires(mapFindings(start), /^the run start is not on open floor$/);

      const zone = world();
      must(zone.spawns['s004']).enemy = 'e002';
      fires(mapFindings(zone), /^spawn s004 is in z02 but holds e002, which belongs to z01$/);

      const nobody = world();
      must(nobody.spawns['s004']).enemy = 'e999';
      fires(mapFindings(nobody), /^spawn s004 holds e999, which is not an enemy$/);
    });

    it('fires on a door on the required path whose key is not a guaranteed handover from a boss', () => {
      const finding = 'door z01:5:2 is on the required path, so a boss must drop its key i004 at a chance of 100';
      // The door moves into the one way from the gate boss to the exit. Its key still comes from a normal enemy.
      const required = (): World => {
        const w = world();
        const door = must(mapOf(w, 'z01').doors[0]);
        door.x = 5;
        door.y = 2;
        return w;
      };
      expect(mapFindings(required())).toEqual([finding]);

      // The boss before the door hands the key over every time: that is what the rule asks for.
      const handed = required();
      must(handed.enemies['e003']).drops.push({ item: 'i004', chance: 100 });
      expect(mapFindings(handed)).toEqual([]);

      // A boss that only sometimes drops it is not a handover.
      const chancy = required();
      must(chancy.enemies['e003']).drops.push({ item: 'i004', chance: 99 });
      expect(mapFindings(chancy)).toEqual([finding]);

      // A second door with the same key, off the path, is still free to take its key from anyone: the small
      // world's own door is such a door, and it passes.
      const both = required();
      mapOf(both, 'z01').doors.push({ x: 1, y: 7, key: 'i004', keyZone: 'z01' });
      expect(mapFindings(both)).toEqual([finding]);
      expect(mapFindings(world())).toEqual([]);
    });

    it('fires on a hidden tile the map would draw as floor', () => {
      const finding = 'secret x01 has a tile that is not a wall character on its map';
      const drawn = world();
      mapOf(drawn, 'z01').tiles[5] = '#...._###';
      expect(mapFindings(drawn)).toEqual([finding]);

      const outside = world();
      const x01 = must(outside.secrets['x01']);
      if (x01.kind === 'hidden') x01.tiles.push({ x: 99, y: 99 });
      expect(mapFindings(outside)).toEqual(['secret x01 cannot be reached from the run start', finding]);
    });

    it('fires on a stash in a plain wall, and on a hidden one that could be collected without finding the way in', () => {
      const moveStash = (w: World, x: number, y: number): void => {
        const x02 = must(w.secrets['x02']);
        if (x02.kind === 'stash') {
          x02.x = x;
          x02.y = y;
        }
      };
      // In a wall beside its old tile: it can be collected from there, but it is drawn inside the wall.
      const walled = world();
      moveStash(walled, 6, 5);
      expect(mapFindings(walled)).toEqual(['secret x02 sits in a plain wall']);

      // On the hidden tile itself, which has ordinary floor on one side.
      const exposed = world();
      moveStash(exposed, 4, 5);
      expect(mapFindings(exposed)).toEqual(['secret x02 can be collected from an ordinary tile beside it, without finding the way in']);

      // A hidden path two tiles long with the stash on its far tile: nothing ordinary is beside it.
      const deep = world();
      mapOf(deep, 'z01').tiles[5] = '#...%%###';
      const x01 = must(deep.secrets['x01']);
      if (x01.kind === 'hidden') x01.tiles = [{ x: 4, y: 5 }, { x: 5, y: 5 }];
      expect(mapFindings(deep)).toEqual([]);
    });

    it('fires when there is no Salvage site beside the run start or beside a waypoint', () => {
      const none = 'no Salvage site within 2 tiles of the run start';
      const sites = (w: World, zone: string, list: Array<{ x: number; y: number }>): void => {
        mapOf(w, zone).salvageSites = list;
      };
      // Two tiles away counts as beside; three does not.
      const two = world();
      sites(two, 'z01', [{ x: 2, y: 3 }]);
      expect(mapFindings(two)).toEqual([]);
      const three = world();
      sites(three, 'z01', [{ x: 2, y: 2 }]);
      expect(mapFindings(three)).toEqual([none]);
      const far = world();
      sites(far, 'z01', [{ x: 6, y: 1 }]);
      expect(mapFindings(far)).toEqual([none]);

      // The same coordinates in another zone are not beside the start.
      const elsewhere = world();
      sites(elsewhere, 'z01', []);
      sites(elsewhere, 'z02', [{ x: 2, y: 3 }]);
      expect(mapFindings(elsewhere)).toEqual([none]);

      const waypoint = world();
      waypoint.waypoints['w01'] = { id: 'w01', zone: 'z01', x: 6, y: 3 };
      expect(mapFindings(waypoint)).toEqual(['no Salvage site within 2 tiles of waypoint w01']);
    });

    it('fires on a place name pinned outside its map', () => {
      const w = world();
      mapOf(w, 'z01').places.push({ key: 'p02', x: 9, y: 0 }, { key: 'p03', x: 8, y: 9 }, { key: 'p04', x: 0, y: 10 });
      expect(mapFindings(w)).toEqual(['place p02 lies outside the map of z01', 'place p04 lies outside the map of z01']);
    });
  });

  describe('strings', () => {
    it('fires on anything shown that has no name', () => {
      const w = world();
      const strings = stringsFor(w);
      expect(stringFindings(w, strings)).toEqual([]);
      const cases: Array<['zones' | 'enemies' | 'families' | 'items' | 'tags' | 'places', string]> = [
        ['zones', 'z02'],
        ['enemies', 'e004'],
        ['families', 'f01'],
        ['items', 'i007'],
        ['tags', 't3'],
        ['places', 'p01'],
      ];
      for (const [section, id] of cases) {
        expect(stringFindings(w, { ...strings, [section]: without(strings[section], id) })).toEqual([`${section}.${id} has no name in data/strings.en.json`]);
        expect(stringFindings(w, { ...strings, [section]: { ...strings[section], [id]: '  ' } })).toEqual([`${section}.${id} has no name in data/strings.en.json`]);
      }
    });

    it('fires on two items or two enemies with one name, and names them by ID', () => {
      const w = world();
      const strings = stringsFor(w);
      const items = stringFindings(w, { ...strings, items: { ...strings.items, i001: 'Glass Heron', i005: 'glass-heron', i008: 'Glass  Heron!' } });
      expect(items).toEqual(['items i001, i005, i008 share a name']);
      const enemies = stringFindings(w, { ...strings, enemies: { ...strings.enemies, e001: 'Ash', e004: 'Ash' } });
      expect(enemies).toEqual(['enemies e001, e004 share a name']);
      // An enemy and an item may share a name: an item is often named for what drops it.
      expect(stringFindings(w, { ...strings, enemies: { ...strings.enemies, e001: 'Ash' }, items: { ...strings.items, i001: 'Ash' } })).toEqual([]);
    });
  });

  describe('files', () => {
    it('fires on a file that does not fit its schema, without quoting what is in it', () => {
      const findings = schemaFindings({
        ...BUNDLED,
        items: { items: [{ id: 'Glass Heron' }] },
        strings: { ...BUNDLED.strings, zones: { z01: '' } },
        maps: [{ zone: 'z01', tiles: ['Ashen Vale'] }],
      });
      fires(findings, /^data\/items\.json does not fit its schema at items\.0\.id \(/);
      fires(findings, /^data\/strings\.en\.json does not fit its schema at zones\.z01 \(/);
      fires(findings, /^data\/maps, file 1 in src\/content\/bundle\.ts does not fit its schema at tiles\.0 \(/);
      for (const finding of findings) expect(finding).not.toMatch(/Heron|Ashen/);
    });
  });
});

describe('check-content on the content that ships', () => {
  const readData = (file: string): unknown => JSON.parse(readFileSync(join(ROOT, 'data', file), 'utf8')) as unknown;

  it('passes every check', () => {
    expect(schemaFindings(BUNDLED)).toEqual([]);
    const { content, text } = loadBundled();
    const lock = lockSchema.parse(readData('ids.lock.json'));
    const spec = specSchema.parse(readData('content-spec.json'));
    for (const check of contentChecks(content, text.strings, lock, spec)) expect(check.findings, check.name).toEqual([]);
  });

  it('names things by ID only, however badly the content is broken', () => {
    const { content, text } = loadBundled();
    const { limits, priceFactorMax } = content.balance.items;
    const emptySpec: SpecFile = {
      completeZones: [],
      zones: 0,
      enemies: {},
      items: { weapons: { total: 0, sold: 0 }, armor: { total: 0, sold: 0 }, accessories: { total: 0, sold: 0 }, keys: { total: 0, sold: 0 } },
    };

    // Nothing spawns, nothing is inside a limit, nothing is locked, counted or told apart by name.
    const numbers = copyOf(content);
    numbers.spawns = {};
    for (const item of Object.values(numbers.items)) {
      item.priceFactor = priceFactorMax * 2;
      item.copyCap = 2;
      item.level += 1;
      item.lines = { ...item.lines, lastStand: limits.lastStand + 1, reflect: limits.reflect + 1 };
    }
    for (const enemy of Object.values(numbers.enemies)) {
      enemy.mods.life = content.balance.enemy.modifierMax * 2;
      enemy.level = 0;
      enemy.gate = true;
      enemy.boss = false;
    }
    const oneName: StringsFile = { ...text.strings, zones: {}, families: {}, places: {}, tags: {}, items: named([]), enemies: named([]) };
    for (const id of Object.keys(content.items)) oneName.items[id] = 'one name';
    for (const id of Object.keys(content.enemies)) oneName.enemies[id] = 'one name';

    // Nothing can be reached: the run starts inside a wall.
    const walled = copyOf(content);
    walled.start = { zone: walled.start.zone, x: 0, y: 0 };

    const findings = [...contentFindings(numbers, oneName, { ids: {} }, emptySpec), ...mapFindings(walled)];
    expect(findings.length).toBeGreaterThan(Object.keys(content.items).length + Object.keys(content.enemies).length + Object.keys(content.spawns).length);

    const names = [text.strings.zones, text.strings.enemies, text.strings.families, text.strings.items, text.strings.tags, text.strings.places]
      .flatMap((section) => Object.values(section))
      .filter((name) => name.trim().length > 1);
    expect(names.length).toBeGreaterThan(0);
    // Counted, not listed: a failure here must not print the names it found.
    expect(names.filter((name) => findings.some((finding) => finding.includes(name))).length).toBe(0);
  });
});
