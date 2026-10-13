// The build scan (ARCHITECTURE section 11): reads the built app in dist/ and fails on anything that must never
// ship. Run after `npm run build`. CI runs it before a deploy.
//
//   - media elements, audio calls or media files (hard rule 2)
//   - a URL that points off the site (hard rule 3: no ads, no third parties)
//   - the reference game's title or its developer's name (hard rule 7); both are already public in docs/KICKOFF.md
//   - a content security policy that is not exactly the pinned one, or a viewport tag that allows zoom
//   - a `:hover` rule
//   - a manifest whose display mode, start URL or scope is not the pinned value (ARCHITECTURE 7.6)
//   - a missing service worker, one that does not precache the page, or one that takes over without being asked

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, report } from './lib';

const TEXT_FILE = /\.(html|js|mjs|css|json|webmanifest|svg|txt|map)$/i;
const MEDIA_FILE = /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|mp4|m4v|webm|mov|mid|midi)$/i;

export const MEDIA_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'an <audio> or <video> element', pattern: /<\s*(audio|video)[\s>/]/i },
  // The bare tag name as a string, which is how a tag reaches createElement through any helper once minified.
  { name: 'the tag name "audio" or "video" as text', pattern: /["'`]\s*(audio|video)\s*["'`]/i },
  { name: 'new Audio()', pattern: /\bnew\s+Audio\b/ },
  { name: 'Web Audio', pattern: /\b(webkit)?(Offline)?AudioContext\b/ },
  { name: 'a media element class', pattern: /\bHTML(Audio|Video|Media)Element\b/ },
  { name: 'the media session', pattern: /\bmediaSession\b/ },
  { name: 'media capture', pattern: /\b(mediaDevices|getUserMedia|MediaRecorder)\b/ },
  { name: 'speech synthesis', pattern: /\b(speechSynthesis|SpeechSynthesisUtterance)\b/ },
];

// URL-shaped text that is an identifier or a parsing template, not a place anything is loaded from. Each entry
// names where it comes from. Any other URL written out plainly fails. This is a tripwire and not a proof: text
// put together at run time is not followed. What stops a call is the policy's `connect-src`, pinned below.
// `tests/checks.test.ts` pins this list, so that adding to it takes a second, deliberate edit.
export const ALLOWED_URLS: readonly RegExp[] = [
  // XML namespaces (SVG, XHTML).
  /^http:\/\/www\.w3\.org\//,
  // zod: the `$schema` names of the JSON Schema drafts it can describe a schema in.
  /^https?:\/\/json-schema\.org\/draft[-/][0-9-]+\/schema#?$/,
  // zod: its IPv6 check parses `http://[<address>]` locally; the bundle holds the template, not an address.
  /^http:\/\/\[\$\{[A-Za-z_$][\w$]*\}\]$/,
];

// Compared with everything but letters and digits removed, so spacing, hyphens and line breaks do not hide them.
export const REFERENCE_NAMES = ['resolutehero', 'geometricapplications'];

export const REQUIRED_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://api.github.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
];

export const REQUIRED_VIEWPORT: Readonly<Record<string, string>> = {
  width: 'device-width',
  'initial-scale': '1',
  'maximum-scale': '1',
  'user-scalable': 'no',
  'viewport-fit': 'cover',
};

export const PINNED_MANIFEST = { display: 'standalone', start_url: '/', scope: '/', name: 'Farther Still' } as const;

export const fileFindings = (file: string): string[] => {
  const found: string[] = [];
  if (MEDIA_FILE.test(file)) found.push(`${file} is a media file`);
  if (/\.map$/i.test(file)) found.push(`${file} is a source map; the build must not ship one`);
  return found;
};

export const mediaFindings = (file: string, text: string): string[] =>
  MEDIA_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => `${file} contains ${name}`);

/** The one address the page may call: the cloud backup's (ARCHITECTURE 7.5). Pinned here and in `vite.config.ts`. */
export const BACKUP_ADDRESS = 'https://api.github.com';

const QUOTES = ['"', "'", '`'];

/**
 * The backup's address is allowed in two shapes and no other. In code: as a whole string, opened and closed by
 * the same quote, with nothing after the host. In the page: as the content security policy names it. A string
 * that only begins with the address is not the address: what follows can name another host altogether.
 */
const isBackupAddress = (file: string, url: string, before: string, after: string): boolean =>
  (url === BACKUP_ADDRESS && QUOTES.includes(before) && after === before) ||
  (file.endsWith('.html') && url === `${BACKUP_ADDRESS};` && before === ' ' && after === ' ');

export const urlFindings = (file: string, text: string): string[] => {
  const found = new Set<string>();
  for (const match of text.matchAll(/\b(?:https?|wss?|ftp):\/\/[^\s"'`<>)\\]+/gi)) {
    const url = match[0];
    const at = match.index;
    if (isBackupAddress(file, url, text[at - 1] ?? '', text[at + url.length] ?? '')) continue;
    if (!ALLOWED_URLS.some((allowed) => allowed.test(url))) found.add(url);
  }
  // Protocol-relative URLs load from another host just the same: in markup, in styles, or as a string in code.
  for (const match of text.matchAll(/(?:src|href)\s*=\s*["']\/\/[^"']+|url\(\s*["']?\/\/[^)"']+/gi)) found.add(match[0]);
  for (const match of text.matchAll(/["'`]\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?=[/"'`?#:])/gi)) found.add(match[0].slice(1));
  return [...found].map((url) => `${file} points off the site: ${url}`);
};

export const referenceFindings = (file: string, text: string): string[] => {
  const squeezed = text.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return REFERENCE_NAMES.filter((name) => squeezed.includes(name)).map(
    () => `${file} contains the reference game's title or developer name`,
  );
};

export const hoverFindings = (file: string, text: string): string[] =>
  /:hover\b/.test(text) ? [`${file} has a :hover rule; nothing may depend on hover`] : [];

const attribute = (tag: string, name: string): string | null => {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
  return match === null ? null : (match[1] ?? match[2] ?? null);
};

export const pageFindings = (html: string): string[] => {
  const found: string[] = [];
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];

  const policies = metas.filter((tag) => /http-equiv\s*=\s*["']content-security-policy["']/i.test(tag));
  if (policies.length !== 1) {
    found.push(policies.length === 0 ? 'index.html has no content security policy' : 'index.html has more than one content security policy');
  } else {
    // The policy must be exactly the pinned one: a missing directive loosens it, and so does an extra one
    // such as `media-src` or `script-src-elem`, which would override the fallback to `default-src 'none'`.
    const policy = (attribute(policies[0] ?? '', 'content') ?? '')
      .split(';')
      .map((part) => part.trim().replace(/\s+/g, ' '))
      .filter((part) => part !== '');
    for (const directive of REQUIRED_CSP) {
      if (!policy.includes(directive)) found.push(`index.html content security policy lacks exactly: ${directive}`);
    }
    for (const part of policy) {
      if (!REQUIRED_CSP.includes(part)) found.push(`index.html content security policy has a directive that is not pinned: ${part}`);
    }
  }

  const viewport = metas.find((tag) => /name\s*=\s*["']viewport["']/i.test(tag));
  if (viewport === undefined) {
    found.push('index.html has no viewport tag');
  } else {
    const settings = new Map<string, string>();
    for (const part of (attribute(viewport, 'content') ?? '').split(',')) {
      const [key, value] = part.split('=').map((piece) => piece.trim().toLowerCase());
      if (key !== undefined && key !== '') settings.set(key, value ?? '');
    }
    for (const [key, value] of Object.entries(REQUIRED_VIEWPORT)) {
      if (settings.get(key) !== value) found.push(`index.html viewport tag must set ${key}=${value}`);
    }
  }

  if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i.test(html)) found.push('index.html has an inline script');
  if (/<style\b/i.test(html) || /\sstyle\s*=\s*["']/i.test(html)) found.push('index.html has inline styles');
  if (!/<link\b[^>]*rel\s*=\s*["']manifest["']/i.test(html)) found.push('index.html does not link the manifest');
  return found;
};

export const manifestFindings = (text: string): string[] => {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return ['manifest.webmanifest is not valid JSON'];
  }
  const found: string[] = [];
  for (const [key, value] of Object.entries(PINNED_MANIFEST)) {
    if (manifest[key] !== value) found.push(`manifest.webmanifest ${key} must be ${JSON.stringify(value)}`);
  }
  // `display_override` would take precedence over `display`, and the storage exemption depends on standalone.
  if ('display_override' in manifest) found.push('manifest.webmanifest must not set display_override');
  if (!Array.isArray(manifest['icons']) || manifest['icons'].length === 0) found.push('manifest.webmanifest lists no icons');
  return found;
};

/** The built service worker: it must hold its file list, precache the page, and wait until it is asked. */
export const workerFindings = (worker: string): string[] => {
  const found: string[] = [];
  if (worker.includes('__WB_MANIFEST')) found.push('sw.js still holds the placeholder for the file list');
  if (!worker.includes('index.html')) found.push('sw.js does not precache index.html');
  const skips = worker.match(/skipWaiting\s*\(/g) ?? [];
  // One call, and only as the answer to the page's message. A call anywhere else would let a new version take
  // over while the app is open.
  if (skips.length !== 1 || !/SKIP_WAITING[^;{}]{0,80}skipWaiting\s*\(/.test(worker)) {
    found.push('sw.js must call skipWaiting exactly once, in answer to the SKIP_WAITING message');
  }
  return found;
};

/**
 * Every script and stylesheet the page asks for must be in the worker's file list. The worker makes the same
 * check when it installs, so a build that fails here could never install on the phone.
 */
export const precacheFindings = (html: string, worker: string): string[] => {
  // Resolved the way the worker resolves them (src/platform/sw.ts): against the site root, relative or not,
  // same site only, compared by path. The two must agree, or CI could pass a build that cannot install.
  const site = 'https://site.invalid/';
  const listed = new Set([...worker.matchAll(/"url"\s*:\s*"([^"]+)"/g)].map((match) => new URL(match[1] ?? '', site).pathname));
  const found: string[] = [];
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*"([^"]+)"/gi)) {
    const url = new URL(match[1] ?? '', site);
    if (url.origin === new URL(site).origin && !listed.has(url.pathname)) {
      found.push(`index.html asks for ${url.pathname}, which sw.js does not precache`);
    }
  }
  return found;
};

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );

const main = (): void => {
  const dist = join(ROOT, 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    report('check-dist', ['dist/index.html does not exist; run `npm run build` first']);
    return;
  }
  const problems: string[] = [];
  for (const path of filesUnder(dist)) {
    const file = relative(dist, path).split('\\').join('/');
    problems.push(...fileFindings(file));
    if (!TEXT_FILE.test(file)) continue;
    const text = readFileSync(path, 'utf8');
    problems.push(...mediaFindings(file, text), ...urlFindings(file, text), ...referenceFindings(file, text), ...hoverFindings(file, text));
  }

  problems.push(...pageFindings(readFileSync(join(dist, 'index.html'), 'utf8')));

  const manifestPath = join(dist, 'manifest.webmanifest');
  if (existsSync(manifestPath)) problems.push(...manifestFindings(readFileSync(manifestPath, 'utf8')));
  else problems.push('dist/manifest.webmanifest does not exist');

  const workerPath = join(dist, 'sw.js');
  if (existsSync(workerPath)) {
    const worker = readFileSync(workerPath, 'utf8');
    problems.push(...workerFindings(worker), ...precacheFindings(readFileSync(join(dist, 'index.html'), 'utf8'), worker));
  } else {
    problems.push('dist/sw.js does not exist');
  }

  report('check-dist', problems);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
