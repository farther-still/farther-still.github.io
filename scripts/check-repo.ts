// Repo checks (ARCHITECTURE section 11). They read file contents directly, because sealed paths print as binary
// in diffs, and they report paths, lines and IDs only.
//
//   1. Nothing under reference/ is tracked by git.
//   2. No token pattern in a tracked file.
//   3. No content display name in unsealed tracked text (vacuous until data/strings.en.json exists in Phase 3b).
//   4. No ID removed from data/ids.lock.json, or changed in kind, since the previous commit.
//   5. No existing save fixture changed since the previous commit.
//
// "Previous commit" is HEAD in the pre-commit hook, where the working tree holds the commit being made. In CI it
// is the commit before the push, passed as PREVIOUS_COMMIT, since the checkout already is the new HEAD.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

const stringLeaves = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringLeaves);
  return [];
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Lines of `text` that contain one of `names` as a whole name, case-sensitively. The finding gives the line and
 * the name's position in the list, never the name itself.
 */
export const nameFindings = (file: string, text: string, names: readonly string[]): string[] => {
  const found: string[] = [];
  const matchers = names.map((name) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'u'));
  text.split(/\r?\n/).forEach((line, index) => {
    matchers.forEach((matcher, which) => {
      if (matcher.test(line)) found.push(`${file}:${index + 1} contains content name #${which + 1}`);
    });
  });
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

const main = (): void => {
  const problems: string[] = [];
  const files = trackedFiles();

  for (const file of files) {
    if (file === 'reference' || file.startsWith('reference/')) problems.push(`${file} is tracked by git; reference/ must stay private`);
  }

  const stringsText = readWorking('data/strings.en.json');
  let names: string[] = [];
  if (stringsText !== null) {
    try {
      names = [...new Set(stringLeaves(JSON.parse(stringsText)).filter((name) => name.trim().length > 1))];
    } catch {
      problems.push('data/strings.en.json is not valid JSON');
    }
  }

  for (const file of files) {
    if (BINARY.test(file)) continue;
    const text = readWorking(file);
    if (text === null) continue;
    problems.push(...tokenFindings(file, text));
    if (names.length > 0 && !isSealed(file)) problems.push(...nameFindings(file, text, names));
  }

  const previous = previousCommit();
  if (previous !== null) {
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
