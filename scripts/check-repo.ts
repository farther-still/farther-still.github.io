// Repo checks (ARCHITECTURE section 11). They read file contents directly, because sealed paths print as binary
// in diffs, and they report paths, lines and IDs only.
//
//   1. Nothing under reference/ is tracked by git.
//   2. No token pattern in a tracked file.
//   3. No content display name from data/strings.en.json in unsealed tracked text, or in the message of a commit
//      made since the previous commit. A name that is also an ordinary word the unsealed docs use can be exempted
//      by its key in data/name-scan-exceptions.json, a sealed file.
//   4. No ID removed from data/ids.lock.json, or changed in kind, since the previous commit.
//   5. No existing save fixture changed since the previous commit.
//
// "Previous commit" is HEAD in the pre-commit hook, where the working tree holds the commit being made. In CI it
// is the commit before the push, passed as PREVIOUS_COMMIT, since the checkout already is the new HEAD.
//
// With `--message <file>` it scans that one file for content names and does nothing else: this is what the
// commit-msg hook runs, on the message git is about to keep.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, gitOrNull, report, trackedFiles } from './lib';

// Each pattern is written so that this file does not match itself.
export const TOKEN_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { name: 'private key', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'API secret key', pattern: /\bsk-[A-Za-z0-9_-]{32,}\b/ },
  { name: 'Supabase or JWT secret', pattern: /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
];

const BINARY = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|pdf|zip)$/i;

/** Sealed paths: spoilers live here, so names are expected in them (CLAUDE.md, Spoilers). */
export const isSealed = (file: string): boolean =>
  file.startsWith('docs/sealed/') ||
  (file.startsWith('data/') && !['data/balance.json', 'data/content-spec.json', 'data/ids.lock.json'].includes(file));

export const tokenFindings = (file: string, text: string): string[] => {
  const found: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const { name, pattern } of TOKEN_PATTERNS) {
      if (pattern.test(line)) found.push(`${file}:${index + 1} looks like a ${name}`);
    }
  });
  return found;
};

/** Every string in the strings file with the path of keys that leads to it, such as `tags.t1`. */
const keyedStrings = (value: unknown, path: string): Array<{ key: string; name: string }> => {
  if (typeof value === 'string') return [{ key: path, name: value }];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => keyedStrings(inner, path === '' ? key : `${path}.${key}`));
};

/** One display name the scan looks for, with every strings-file key that holds it. */
export type ScanName = { name: string; keys: string[] };

/**
 * The names to scan for. A name is left out only when every key that holds it is in `exempt`: the scan cannot
 * tell two uses of one word apart, so exempting the word under one key must not hide it under another.
 */
export const scanNames = (strings: unknown, exempt: ReadonlySet<string> = new Set()): ScanName[] => {
  const byName = new Map<string, string[]>();
  for (const { key, name } of keyedStrings(strings, '')) {
    if (name.trim().length <= 1) continue;
    const keys = byName.get(name);
    if (keys === undefined) byName.set(name, [key]);
    else keys.push(key);
  }
  return [...byName].filter(([, keys]) => !keys.every((key) => exempt.has(key))).map(([name, keys]) => ({ name, keys }));
};

export const EXCEPTIONS_FILE = 'data/name-scan-exceptions.json';

/**
 * The keys the name scan skips (ARCHITECTURE section 11), from a sealed file of the form
 * `{ "exceptions": [{ "key": "tags.t1", "reason": "one line" }] }`. `text` is null when there is no such file,
 * which means no exceptions. An entry without a reason, or for a key the strings file does not hold, is a problem:
 * an exception nobody can account for is how a real leak would be waved through.
 */
export const readExceptions = (text: string | null, strings: unknown): { keys: Set<string>; problems: string[] } => {
  const keys = new Set<string>();
  if (text === null) return { keys, problems: [] };
  const malformed = { keys, problems: [`${EXCEPTIONS_FILE} is not {"exceptions": [{"key": "<section>.<id>", "reason": "<one line>"}]}`] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return malformed;
  }
  const list = typeof parsed === 'object' && parsed !== null ? (parsed as { exceptions?: unknown }).exceptions : undefined;
  if (!Array.isArray(list)) return malformed;

  const problems: string[] = [];
  const known = new Set(keyedStrings(strings, '').map((entry) => entry.key));
  list.forEach((entry: unknown, index) => {
    const { key, reason } = typeof entry === 'object' && entry !== null ? (entry as { key?: unknown; reason?: unknown }) : {};
    if (typeof key !== 'string' || key === '') {
      problems.push(`${EXCEPTIONS_FILE} entry ${index + 1} has no key`);
      return;
    }
    if (typeof reason !== 'string' || reason.trim() === '' || /[\r\n]/.test(reason)) {
      problems.push(`${EXCEPTIONS_FILE} entry ${index + 1} (${key}) needs a one-line reason`);
      return;
    }
    if (!known.has(key)) {
      problems.push(`${EXCEPTIONS_FILE} entry ${index + 1} (${key}) is not a key in data/strings.en.json`);
      return;
    }
    keys.add(key);
  });
  return { keys, problems };
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What counts as writing a name: the whole name, in any case, with its words joined by spaces or hyphens, and
 * with or without a plain plural ending. Part of a longer word is not the name.
 */
const nameMatcher = (name: string): RegExp => {
  const words = name
    .trim()
    .split(/[\s-]+/)
    .filter((word) => word !== '')
    .map(escapeRegExp);
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join('[\\s-]+')}(?:e?s)?(?![\\p{L}\\p{N}])`, 'iu');
};

/** Where `names` appear in `text`: the 1-based line, and which name by its place in the list. */
export const nameHits = (text: string, names: readonly string[]): Array<{ line: number; which: number }> => {
  const hits: Array<{ line: number; which: number }> = [];
  const matchers = names.map(nameMatcher);
  text.split(/\r?\n/).forEach((line, index) => {
    matchers.forEach((matcher, which) => {
      if (matcher.test(line)) hits.push({ line: index + 1, which });
    });
  });
  return hits;
};

/**
 * Lines of `text` that contain one of `names`. The finding gives the line and the name's label, which is its
 * strings-file key where `labels` is given and its position in the list otherwise. It never gives the name itself.
 */
export const nameFindings = (file: string, text: string, names: readonly string[], labels?: readonly string[]): string[] =>
  nameHits(text, names).map(({ line, which }) => `${file}:${line} contains content name ${labels?.[which] ?? `#${which + 1}`}`);

const numbersOf = (text: string, names: readonly string[]): number[] => [...new Set(nameHits(text, names).map((hit) => hit.which + 1))].sort((a, b) => a - b);

/**
 * A commit message is public and cannot be taken back once pushed, so it is scanned like any unsealed file. The
 * whole file git hands the hook is scanned, comment lines included: what git will strip is not worth guessing.
 */
export const messageFindings = (message: string, names: readonly string[]): string[] =>
  numbersOf(message, names).map((number) => `the commit message contains content name #${number}`);

/** The format `logFindings` reads: each commit's hash on a line, then its whole message, then a NUL. */
export const LOG_FORMAT = '--format=%H%n%B%x00';

/** The same scan over the messages of commits already made, from `git log` in `LOG_FORMAT`. */
export const logFindings = (log: string, names: readonly string[]): string[] => {
  const found: string[] = [];
  for (const entry of log.split('\0')) {
    const commit = entry.replace(/^\s+/, '');
    if (commit === '') continue;
    const firstBreak = commit.indexOf('\n');
    const hash = (firstBreak < 0 ? commit : commit.slice(0, firstBreak)).slice(0, 7);
    const message = firstBreak < 0 ? '' : commit.slice(firstBreak + 1);
    for (const number of numbersOf(message, names)) found.push(`the message of commit ${hash} contains content name #${number}`);
  }
  return found;
};

type IdLock = Record<string, string>;

const readLock = (text: string): IdLock | null => {
  try {
    const parsed = JSON.parse(text) as { ids?: unknown };
    if (typeof parsed.ids !== 'object' || parsed.ids === null || Array.isArray(parsed.ids)) return null;
    const lock: IdLock = {};
    for (const [id, kind] of Object.entries(parsed.ids)) {
      if (typeof kind !== 'string') return null;
      lock[id] = kind;
    }
    return lock;
  } catch {
    return null;
  }
};

/** IDs are permanent: none may disappear from the lock or change kind. */
export const lockFindings = (previousText: string | null, currentText: string | null): string[] => {
  if (currentText === null) return previousText === null ? [] : ['data/ids.lock.json was removed'];
  const current = readLock(currentText);
  if (current === null) return ['data/ids.lock.json is not {"ids": {"<id>": "<kind>"}}'];
  if (previousText === null) return [];
  const previous = readLock(previousText);
  if (previous === null) return [];
  const found: string[] = [];
  for (const [id, kind] of Object.entries(previous)) {
    if (!(id in current)) found.push(`ID ${id} was removed from data/ids.lock.json`);
    else if (current[id] !== kind) found.push(`ID ${id} changed kind in data/ids.lock.json`);
  }
  return found;
};

const FIXTURE = /^tests\/fixtures\/saves\/v\d+\.json$/;

const normalize = (text: string): string => text.replace(/\r\n/g, '\n');

const previousCommit = (): string | null => {
  const fromCi = process.env['PREVIOUS_COMMIT'];
  // A first push reports forty zeros, which is not a commit.
  if (fromCi !== undefined && fromCi !== '' && !/^0+$/.test(fromCi)) {
    return gitOrNull('rev-parse', '--verify', '--quiet', `${fromCi}^{commit}`) === null ? null : fromCi;
  }
  return gitOrNull('rev-parse', '--verify', '--quiet', 'HEAD^{commit}') === null ? null : 'HEAD';
};

const readWorking = (file: string): string | null => {
  const path = join(ROOT, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};

/** The names to scan for, from the strings file and the exceptions file as they stand in the working tree. */
const namesToScan = (problems: string[]): ScanName[] => {
  const stringsText = readWorking('data/strings.en.json');
  if (stringsText === null) return [];
  let strings: unknown = null;
  try {
    strings = JSON.parse(stringsText);
  } catch {
    problems.push('data/strings.en.json is not valid JSON');
  }
  const exceptions = readExceptions(readWorking(EXCEPTIONS_FILE), strings);
  problems.push(...exceptions.problems);
  return scanNames(strings, exceptions.keys);
};

/** The commit-msg hook. It prints one line per name found, and never the name. */
const checkMessage = (file: string | undefined): void => {
  let message: string | null = null;
  try {
    if (file !== undefined && file !== '') message = readFileSync(resolve(file), 'utf8');
  } catch {
    message = null;
  }
  if (message === null) {
    // Refused, not waved through: a hook that cannot read the message has checked nothing.
    console.error('check-repo --message needs the path of the commit message file');
    process.exitCode = 1;
    return;
  }
  // A broken strings or exceptions file is the main check's finding, not a reason to refuse a message.
  const names = namesToScan([]).map((entry) => entry.name);
  const problems = messageFindings(message, names);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exitCode = 1;
};

const main = (): void => {
  const messageFlag = process.argv.indexOf('--message');
  if (messageFlag >= 0) {
    checkMessage(process.argv[messageFlag + 1]);
    return;
  }

  const problems: string[] = [];
  const files = trackedFiles();

  for (const file of files) {
    if (file === 'reference' || file.startsWith('reference/')) problems.push(`${file} is tracked by git; reference/ must stay private`);
  }

  const names = namesToScan(problems);
  const wanted = names.map((entry) => entry.name);
  const labels = names.map((entry) => entry.keys.join(' and '));

  for (const file of files) {
    if (BINARY.test(file)) continue;
    const text = readWorking(file);
    if (text === null) continue;
    problems.push(...tokenFindings(file, text));
    if (wanted.length > 0 && !isSealed(file)) problems.push(...nameFindings(file, text, wanted, labels));
  }

  const previous = previousCommit();
  if (previous !== null) {
    // The hook scans a message before the commit is made; this catches one made without the hook. In the
    // pre-commit hook the range is empty.
    if (wanted.length > 0) problems.push(...logFindings(gitOrNull('log', LOG_FORMAT, `${previous}..HEAD`) ?? '', wanted));
    problems.push(...lockFindings(gitOrNull('show', `${previous}:data/ids.lock.json`), readWorking('data/ids.lock.json')));
    const before = gitOrNull('ls-tree', '-r', '--name-only', previous, 'tests/fixtures/saves/') ?? '';
    for (const file of before.split('\n').filter((name) => FIXTURE.test(name))) {
      const then = gitOrNull('show', `${previous}:${file}`);
      const now = readWorking(file);
      if (now === null) problems.push(`${file} was removed; a save fixture is never deleted`);
      else if (then !== null && normalize(then) !== normalize(now)) problems.push(`${file} was changed; a save fixture is never edited`);
    }
  } else {
    problems.push(...lockFindings(null, readWorking('data/ids.lock.json')));
  }

  report('check-repo', problems);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
