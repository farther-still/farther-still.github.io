// No content display name may equal a name from the reference game (GDD 7.9, hard rule 7). The names themselves
// are private, so tests/refnames.hashes.json holds salted hashes of them, built locally by
// scripts/build-refnames.ts; this test hashes each content name the same way and looks it up
// (ARCHITECTURE section 11). A finding gives a content ID, never a name. Every name written in this file is made up.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsv, referenceNames } from '../scripts/build-refnames';
import { ROOT } from '../scripts/lib';
import { REFNAME_CANARY, REFNAME_SECTIONS, hashName, hashNames, holdsCanary, normalizeName, readRefNames, refNameFindings } from '../scripts/refnames';
import { loadBundled } from '../src/content';

const HASH_FILE = join(ROOT, 'tests/refnames.hashes.json');

// Two characters that cannot be seen in source, so they are made here and not typed: a no-break space and a byte-order mark.
const NBSP = String.fromCharCode(0xa0);
const BOM = String.fromCharCode(0xfeff);

describe('reference names', () => {
  it('normalizes a name to its letters and digits, whatever the case, spacing, accents or punctuation', () => {
    expect(normalizeName(`  Glass-Héron${NBSP}II! `)).toBe('glassheronii');
    expect(normalizeName('ＧＬＡＳＳ heron ２')).toBe('glassheron2');
    expect(normalizeName("Heron's  Glass")).toBe('heronsglass');
    expect(normalizeName(' -- ')).toBe('');
    expect(hashName('salt', 'Glass Heron')).toBe(hashName('salt', 'glass-HERON'));
    expect(hashName('salt', 'Glass Heron')).not.toBe(hashName('other salt', 'Glass Heron'));
    expect(hashName('salt', 'Glass Heron')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('still hashes a name the way the hash file was built', () => {
    // SHA-256 of "salt:glassheronii". If this changes, the stored hashes match nothing and the check below passes
    // by default: rebuild the hash file with npm run refnames:build where reference/ exists, then update this.
    expect(hashName('salt', `  Glass-Héron${NBSP}II! `)).toBe('4269a316cb23033fddfb1b31270c31bfb8a360abfa7812f4a9b29bb48ff56022');
  });

  it('has a hash file with a plausible number of names in it', () => {
    expect(existsSync(HASH_FILE), 'tests/refnames.hashes.json is missing: run npm run refnames:build where reference/ exists').toBe(true);
    const reference = readRefNames(readFileSync(HASH_FILE, 'utf8'));
    expect(reference).not.toBeNull();
    if (reference === null) return;
    expect(reference.salt.length).toBeGreaterThanOrEqual(16);
    expect(reference.hashes).toHaveLength(reference.count);
    // The reference game has several hundred enemies and several hundred items; far fewer means a bad build.
    expect(reference.count).toBeGreaterThan(500);
    expect(new Set(reference.hashes).size).toBe(reference.count);
    expect([...reference.hashes].sort()).toEqual(reference.hashes);
  });

  it('holds the canary under its own salt, so the salt and the hashes belong together', () => {
    const reference = readRefNames(readFileSync(HASH_FILE, 'utf8'));
    expect(reference).not.toBeNull();
    if (reference === null) return;
    expect(holdsCanary(reference)).toBe(true);
    // The same file with one character of the salt changed, or with the hashes of another build, is caught.
    const last = reference.salt.slice(-1);
    expect(holdsCanary({ ...reference, salt: `${reference.salt.slice(0, -1)}${last === '0' ? '1' : '0'}` })).toBe(false);
    expect(holdsCanary({ ...reference, salt: `${reference.salt} ` })).toBe(false);
    expect(holdsCanary({ salt: reference.salt, hashes: hashNames('another salt', [REFNAME_CANARY, 'Glass Heron']) })).toBe(false);
    expect(holdsCanary({ salt: reference.salt, hashes: [] })).toBe(false);
  });

  it('finds the canary in the real file, and nothing else it is shown', () => {
    const reference = readRefNames(readFileSync(HASH_FILE, 'utf8'));
    expect(reference).not.toBeNull();
    if (reference === null) return;
    // The canary is the only entry of the real file this test knows, so it is the only proof that a lookup
    // against that file can succeed at all. The made-up names beside it must not be found.
    const strings = {
      zones: { z97: 'Ashen Vale', z98: REFNAME_CANARY.toUpperCase(), z99: `${REFNAME_CANARY} two` },
      enemies: { e998: 'Glass Heron', e999: ` ${REFNAME_CANARY.replace(/ /g, '-')}! ` },
      families: { f99: 'The Herons' },
      items: { i998: 'Moss Cape', i999: REFNAME_CANARY },
      places: { p98: 'Bog Camp', p99: REFNAME_CANARY },
    };
    expect(refNameFindings(strings, reference)).toEqual([
      'zones.z98 has the name of something in the reference game',
      'enemies.e999 has the name of something in the reference game',
      'items.i999 has the name of something in the reference game',
      'places.p99 has the name of something in the reference game',
    ]);
    // Under any other salt the same file finds nothing, which is exactly the fault the canary test above catches.
    expect(refNameFindings(strings, { salt: `${reference.salt}x`, hashes: reference.hashes })).toEqual([]);
  });

  it('finds no content display name among them', () => {
    const reference = readRefNames(readFileSync(HASH_FILE, 'utf8'));
    expect(reference).not.toBeNull();
    if (reference === null) return;
    const { strings } = loadBundled().text;
    // The comparison must have had something to compare.
    const looked = REFNAME_SECTIONS.reduce((total, section) => total + Object.keys(strings[section]).length, 0);
    expect(looked).toBeGreaterThan(0);
    expect(refNameFindings(strings, reference)).toEqual([]);
  });

  it('fires on a name that is in the set, by content ID and without the name', () => {
    const salt = 'pepper';
    const reference = { salt, hashes: hashNames(salt, ['Glass Heron', 'Ashen Vale', 'Moss Cape', 'Bog Camp', 'The Herons']) };
    const strings = {
      zones: { z01: 'ashen  VALE', z02: 'Ashen Valley' },
      enemies: { e001: 'Glass-Héron', e002: 'Glass Herons', e003: 'Heron Glass' },
      families: { f01: 'The Herons' },
      items: { i001: 'Moss Cap', i002: 'Moss Cape!' },
      places: { p01: 'Bog Camp' },
      // Tags and lines of text are not names of things, so they are not compared.
      tags: { t1: 'Glass Heron' },
      lines: { 'handover.i001': 'Glass Heron' },
    };
    const findings = refNameFindings(strings, reference);
    expect(findings).toEqual([
      'zones.z01 has the name of something in the reference game',
      'enemies.e001 has the name of something in the reference game',
      'families.f01 has the name of something in the reference game',
      'items.i002 has the name of something in the reference game',
      'places.p01 has the name of something in the reference game',
    ]);
    for (const finding of findings) expect(finding).not.toMatch(/heron|vale|moss|bog/i);
    // The hashes are salted: the same names under another salt are different entries.
    expect(refNameFindings(strings, { salt: 'salt', hashes: reference.hashes })).toEqual([]);
    expect(refNameFindings(strings, { salt, hashes: [] })).toEqual([]);
  });

  it('rejects a hash file of the wrong shape', () => {
    const entry = hashName('salt', 'Glass Heron');
    expect(readRefNames(JSON.stringify({ salt: 'salt', count: 1, hashes: [entry] }))).toEqual({ salt: 'salt', count: 1, hashes: [entry] });
    expect(readRefNames('not json')).toBeNull();
    expect(readRefNames(JSON.stringify({ count: 1, hashes: [entry] }))).toBeNull();
    expect(readRefNames(JSON.stringify({ salt: 'salt', count: 1, hashes: ['Glass Heron'] }))).toBeNull();
    expect(readRefNames(JSON.stringify({ salt: 'salt', count: 1, hashes: entry }))).toBeNull();
  });
});

describe('build-refnames', () => {
  it('reads quoted cells, doubled quotes and both kinds of line ending', () => {
    expect(parseCsv(BOM + 'a,b\r\n"x, y","say ""hi"""\n,\n"two\nlines",z')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['', ''],
      ['two\nlines', 'z'],
    ]);
  });

  it('takes zone headings, enemies, their drops and items from files shaped like the reference data', () => {
    const enemies = [
      '0,1,2,3,4,5,6',
      'Id,Name,Level,Drop1,Drop1Chance,Drop2,Drop3',
      ',,,,,,',
      'Z,Made-Up Marsh,,,,,',
      '1,"Bog, the Elder",5,Tin Hat,10%,,',
      '2,Plain Newt,6,"Say ""Cheese"" Wheel",5%,Tin Hat,',
      'Z,Second Fen,,,,,',
      '3,Fen Moth,9,,,,Moth Dust',
    ].join('\n');
    const weapons = ['0,1', 'Name,Slot', 'Tin Stick,Weapon', ',', 'Bog Iron Pick,Weapon'].join('\r\n');
    const armors = ['0,1', 'Name,Slot', ',Back', 'Moss Cape,Back', ',Head', 'Tin Hat,Head'].join('\n');
    const found = referenceNames({ enemies, weapons, armors });
    expect(found?.counts).toEqual({ zones: 2, enemies: 3, drops: 4, weapons: 2, armor: 2 });
    expect([...new Set(found?.names)].sort()).toEqual(
      ['Bog Iron Pick', 'Bog, the Elder', 'Fen Moth', 'Made-Up Marsh', 'Moss Cape', 'Moth Dust', 'Plain Newt', 'Tin Hat', 'Tin Stick', 'Say "Cheese" Wheel', 'Second Fen'].sort(),
    );
    // A file with no header row is refused, so a changed layout cannot quietly hash nothing.
    expect(referenceNames({ enemies: '1,2\n3,4', weapons, armors })).toBeNull();
  });
});
