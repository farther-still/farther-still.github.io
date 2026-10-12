// How a content display name is compared with the reference game's names without publishing them
// (ARCHITECTURE section 11). scripts/build-refnames.ts runs locally against reference/ and stores only salted
// hashes of normalized names in tests/refnames.hashes.json; tests/refnames.test.ts hashes each content name the
// same way and looks it up. Both go through `hashName`, so they cannot drift apart.

import { hash } from '../src/engine/hash';

/** The sections of data/strings.en.json that hold names of things, as opposed to tags and lines of text. */
export const REFNAME_SECTIONS = ['zones', 'enemies', 'families', 'items', 'places'] as const;

/** Letters and digits only, lowercase, accents removed: two names that differ in case, spacing or punctuation are one name. */
export const normalizeName = (name: string): string =>
  name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

export const hashName = (salt: string, name: string): string => hash(`${salt}:${normalizeName(name)}`);

export type RefNames = { salt: string; count: number; hashes: string[] };

/**
 * A made-up string, the name of nothing, that the build hashes in among the real names. The real names are not
 * known to the test, so without it a hash file whose salt no longer goes with its hashes would match nothing and
 * pass. This is the one entry the test can look for.
 */
export const REFNAME_CANARY = 'refnames canary zq7';

/** True when the file's hashes were made with the file's salt, as far as the one known entry can show. */
export const holdsCanary = (reference: Pick<RefNames, 'salt' | 'hashes'>): boolean => reference.hashes.includes(hashName(reference.salt, REFNAME_CANARY));

const HASH = /^[0-9a-f]{64}$/;

/** The parsed hash file, or null when the text is not `{ "salt": "...", "count": N, "hashes": [...] }`. */
export const readRefNames = (text: string): RefNames | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { salt, count, hashes } = parsed as { salt?: unknown; count?: unknown; hashes?: unknown };
  if (typeof salt !== 'string' || salt === '' || typeof count !== 'number' || !Array.isArray(hashes)) return null;
  const list: string[] = [];
  for (const entry of hashes) {
    if (typeof entry !== 'string' || !HASH.test(entry)) return null;
    list.push(entry);
  }
  return { salt, count, hashes: list };
};

/** The salted hashes of `names`, sorted, with no duplicate and no entry for a name that normalizes to nothing. */
export const hashNames = (salt: string, names: readonly string[]): string[] => {
  const hashes = new Set<string>();
  for (const name of names) if (normalizeName(name) !== '') hashes.add(hashName(salt, name));
  return [...hashes].sort();
};

/**
 * One finding for each content display name that is also a reference name. `strings` is the parsed strings
 * file. A finding gives the section and the content ID, never the name.
 */
export const refNameFindings = (strings: unknown, reference: Pick<RefNames, 'salt' | 'hashes'>): string[] => {
  const known = new Set(reference.hashes);
  const found: string[] = [];
  if (typeof strings !== 'object' || strings === null) return ['the strings file is not an object'];
  for (const section of REFNAME_SECTIONS) {
    const names = (strings as Record<string, unknown>)[section];
    if (typeof names !== 'object' || names === null) continue;
    for (const [id, name] of Object.entries(names)) {
      if (typeof name === 'string' && normalizeName(name) !== '' && known.has(hashName(reference.salt, name))) {
        found.push(`${section}.${id} has the name of something in the reference game`);
      }
    }
  }
  return found;
};
