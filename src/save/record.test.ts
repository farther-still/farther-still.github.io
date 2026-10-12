import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { canonicalJson, hash } from '../engine';
import { CONTENT, record } from '../../tests/helpers';
import { classify } from './classify';
import { ALL_SLOTS, DB_NAME, SAVE_VERSION, STORE_DEVICE, STORE_DIAGNOSTICS, STORE_QUARANTINE, STORE_SLOTS } from './constants';
import { checksumMatches, checksumOf, sealRecord, serializeRecord } from './record';
import { gameStateSchema, slotRecordSchema } from './schema';

const FIXTURES = join(import.meta.dirname, '../../tests/fixtures/saves');

describe('checksum', () => {
  it('covers every field of the record except itself', () => {
    const good = record('hot', 5);
    expect(checksumMatches(good)).toBe(true);
    const fields = ['slot', 'saveVersion', 'buildId', 'contentVersion', 'seq', 'writtenAt'] as const;
    for (const field of fields) {
      const changed: Record<string, unknown> = { ...good, [field]: field === 'slot' ? 'checkpoint-0' : `${String(good[field])}x` };
      expect(checksumMatches(changed), field).toBe(false);
    }
    const deep = structuredClone(good);
    deep.payload.game.profile.runsStarted += 1;
    expect(checksumMatches(deep)).toBe(false);
    const app = structuredClone(good);
    app.payload.app.settings.testToggle = !app.payload.app.settings.testToggle;
    expect(checksumMatches(app)).toBe(false);
  });

  it('does not depend on key order', () => {
    const good = record('hot', 5);
    const reversed = Object.fromEntries(Object.entries(good).reverse());
    expect(checksumMatches(reversed)).toBe(true);
  });

  it('is false, without throwing, for anything that is not a sealed record', () => {
    for (const junk of [null, undefined, 7, 'text', [], {}, { checksum: 5 }, { checksum: 'x', bad: Number.NaN }]) {
      expect(checksumMatches(junk)).toBe(false);
    }
  });

  it('is the hash of the sorted-key serialization of the other fields', () => {
    const { checksum, ...rest } = record('hot', 9);
    expect(checksum).toBe(hash(canonicalJson(rest)));
    expect(sealRecord(rest).checksum).toBe(checksumOf(rest));
  });
});

describe('save fixtures', () => {
  const files = readdirSync(FIXTURES).filter((name) => /^v\d+\.json$/.test(name));

  it('has one fixture for every save version so far', () => {
    expect(files.map((name) => Number(name.slice(1, -5))).sort((a, b) => a - b)).toEqual(
      Array.from({ length: SAVE_VERSION }, (_, index) => index + 1),
    );
  });

  it.each(files)('%s loads and migrates to a good record', (name) => {
    const raw: unknown = JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
    const result = classify('hot', raw, CONTENT);
    expect(result.kind).toBe('good');
    if (result.kind === 'good') expect(result.record.saveVersion).toBe(SAVE_VERSION);
  });

  it('loads the current version with no migration and writes back the same bytes', () => {
    const bytes = readFileSync(join(FIXTURES, `v${SAVE_VERSION}.json`), 'utf8');
    const result = classify('hot', JSON.parse(bytes), CONTENT);
    if (result.kind !== 'good') throw new Error('fixture is not good');
    expect(result.migrated).toBe(false);
    // Byte-exact: this freezes the hash and the serialization together.
    expect(`${serializeRecord(result.record)}\n`).toBe(bytes);
  });
});

describe('schema', () => {
  // A hash of the schema's shape, pinned per save version. If this fails, the schema changed: bump SAVE_VERSION,
  // add a migration and a fixture (CLAUDE.md save-change checklist), then add the new version's hash here.
  // Never edit an existing entry.
  const SHAPE: Record<number, string> = {
    1: '5f6d43d215c338816165690f7fe58b8d1afcd1828e3e51e7894414b5ae0b37c4',
  };

  it('has not changed shape without a new save version', () => {
    expect(hash(canonicalJson(z.toJSONSchema(slotRecordSchema)))).toBe(SHAPE[SAVE_VERSION]);
  });

  it('rejects an unknown field anywhere instead of dropping it', () => {
    const good = record('hot', 1);
    expect(slotRecordSchema.safeParse(good).success).toBe(true);
    expect(slotRecordSchema.safeParse({ ...good, extra: 1 }).success).toBe(false);
    const inner = structuredClone(good) as unknown as { payload: { game: { run: Record<string, unknown> } } };
    inner.payload.game.run['bonus'] = 1;
    expect(slotRecordSchema.safeParse(inner).success).toBe(false);
  });

  it('rejects whole-number fields that are not safe integers', () => {
    const base = record('hot', 1).payload.game;
    for (const bad of [1.5, Number.MAX_SAFE_INTEGER + 2, Number.NaN, Number.POSITIVE_INFINITY, '3']) {
      expect(gameStateSchema.safeParse({ ...base, run: { ...base.run, counter: bad } }).success, String(bad)).toBe(false);
      expect(gameStateSchema.safeParse({ ...base, profile: { ...base.profile, inventory: { d01: bad } } }).success, String(bad)).toBe(false);
    }
  });
});

describe('pinned names', () => {
  // Renaming any of these would make the save on Michael's phone invisible to the app.
  it('keeps the database, store and slot names', () => {
    expect(DB_NAME).toBe('farther-still');
    expect([STORE_SLOTS, STORE_QUARANTINE, STORE_DEVICE, STORE_DIAGNOSTICS]).toEqual(['slots', 'quarantine', 'device', 'diagnostics']);
    expect([...ALL_SLOTS]).toEqual(['hot', 'checkpoint-0', 'checkpoint-1', 'checkpoint-2', 'checkpoint-3', 'checkpoint-4']);
  });
});
