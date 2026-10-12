import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SLOT_IDS, canonicalJson, hash } from '../engine';
import { CONTENT, FIXED_NOW, record } from '../../tests/helpers';
import { classify } from './classify';
import { ALL_SLOTS, DB_NAME, SAVE_VERSION, STORE_DEVICE, STORE_DIAGNOSTICS, STORE_QUARANTINE, STORE_SLOTS } from './constants';
import { checksumMatches, checksumOf, sealRecord, serializeRecord } from './record';
import { appStateSchema, gameStateSchema, newAppState, payloadSchema, slotRecordSchema } from './schema';

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
    deep.payload.game.profile.counters.runsStarted += 1;
    expect(checksumMatches(deep)).toBe(false);
    const app = structuredClone(good);
    app.payload.app.settings.skipPlayback = !app.payload.app.settings.skipPlayback;
    expect(checksumMatches(app)).toBe(false);
    // The deepest corners of both halves: one cell of one loadout, and one figure of one finished run.
    const cell = structuredClone(good);
    const worn = cell.payload.game.profile.loadouts[1];
    if (worn === undefined) throw new Error('the sample game has two loadouts');
    worn.slots.acc5 = 'i003';
    expect(checksumMatches(cell)).toBe(false);
    const logged = structuredClone(good);
    const finished = logged.payload.app.runLog[0];
    if (finished === undefined) throw new Error('the sample payload has a finished run');
    finished.activeMs += 1;
    expect(checksumMatches(logged)).toBe(false);
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
    2: 'f9a0e65ec34073c6f8ccad6f575407f05436c9281e782d2f8b4bde1f144c5cc0',
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
    // Every object in the record, down to one cell of one list.
    const places: ReadonlyArray<ReadonlyArray<string | number>> = [
      ['payload'],
      ['payload', 'game'],
      ['payload', 'game', 'profile'],
      ['payload', 'game', 'profile', 'loadouts', 0],
      ['payload', 'game', 'profile', 'loadouts', 1, 'slots'],
      ['payload', 'game', 'profile', 'bestiary', 'e001'],
      ['payload', 'game', 'profile', 'autoAssign'],
      ['payload', 'game', 'profile', 'autoAssign', 'split'],
      ['payload', 'game', 'profile', 'counters'],
      ['payload', 'game', 'run', 'pointsSpent'],
      ['payload', 'game', 'run', 'position'],
      ['payload', 'game', 'run', 'marks', 's001'],
      ['payload', 'game', 'run', 'tallies'],
      ['payload', 'app'],
      ['payload', 'app', 'settings'],
      ['payload', 'app', 'exportTracking'],
      ['payload', 'app', 'runTiming'],
      ['payload', 'app', 'runLog', 0],
    ];
    for (const place of places) {
      const changed: unknown = structuredClone(good);
      let at: unknown = changed;
      for (const key of place) at = (at as Record<string | number, unknown>)[key];
      (at as Record<string, unknown>)['extra'] = 1;
      expect(slotRecordSchema.safeParse(changed).success, place.join('.')).toBe(false);
    }
  });

  it('rejects whole-number fields that are not safe integers', () => {
    const base = record('hot', 1).payload.game;
    expect(gameStateSchema.safeParse(base).success).toBe(true);
    for (const bad of [1.5, Number.MAX_SAFE_INTEGER + 2, Number.NaN, Number.POSITIVE_INFINITY, '3']) {
      expect(gameStateSchema.safeParse({ ...base, run: { ...base.run, battleCount: bad } }).success, String(bad)).toBe(false);
      expect(gameStateSchema.safeParse({ ...base, profile: { ...base.profile, items: { i001: bad } } }).success, String(bad)).toBe(false);
      expect(gameStateSchema.safeParse({ ...base, run: { ...base.run, pointsSpent: { ...base.run.pointsSpent, luck: bad } } }).success, String(bad)).toBe(false);
      expect(gameStateSchema.safeParse({ ...base, profile: { ...base.profile, bestiary: { e001: { timesBeaten: bad } } } }).success, String(bad)).toBe(false);
    }
  });

  it('lets XP alone pass the exact range, as long as it is still a number', () => {
    // GDD 6.2: in full scope XP may grow past what a whole number can hold exactly. Whether it is whole is an
    // invariant, not part of the shape.
    const base = record('hot', 1).payload.game;
    for (const fine of [0, 74, 2 ** 60, 1e300]) {
      expect(gameStateSchema.safeParse({ ...base, run: { ...base.run, xp: fine } }).success, String(fine)).toBe(true);
    }
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '3', null]) {
      expect(gameStateSchema.safeParse({ ...base, run: { ...base.run, xp: bad } }).success, String(bad)).toBe(false);
    }
  });

  it('holds a loadout to exactly its eighteen cells, and marks and settings to their listed values', () => {
    const good = record('hot', 1).payload;
    const first = good.game.profile.loadouts[0];
    if (first === undefined) throw new Error('the sample game has two loadouts');
    const withLoadout = (slots: Record<string, unknown>): unknown => ({ ...good, game: { ...good.game, profile: { ...good.game.profile, loadouts: [{ name: '', slots }] } } });
    expect(Object.keys(first.slots).sort()).toEqual([...SLOT_IDS].sort());
    expect(SLOT_IDS).toHaveLength(18);
    expect(payloadSchema.safeParse(withLoadout(first.slots)).success).toBe(true);
    for (const slot of SLOT_IDS) {
      const missing = Object.fromEntries(Object.entries(first.slots).filter(([cell]) => cell !== slot));
      expect(payloadSchema.safeParse(withLoadout(missing)).success, slot).toBe(false);
    }
    expect(payloadSchema.safeParse(withLoadout({ ...first.slots, acc6: null })).success).toBe(false);

    const withMark = (mark: unknown): unknown => ({ ...good, game: { ...good.game, run: { ...good.game.run, marks: { s001: mark } } } });
    for (const stat of ['xp', 'drops', 'gold']) expect(payloadSchema.safeParse(withMark({ stat, percent: 200 })).success, stat).toBe(true);
    for (const mark of [{ stat: 'luck', percent: 100 }, { stat: 'xp' }, { stat: 'xp', percent: 1.5 }, null]) {
      expect(payloadSchema.safeParse(withMark(mark)).success, JSON.stringify(mark)).toBe(false);
    }

    const withSpeed = (playbackSpeed: unknown): unknown => ({ ...good, app: { ...good.app, settings: { ...good.app.settings, playbackSpeed } } });
    for (const speed of [1, 2, 4]) expect(payloadSchema.safeParse(withSpeed(speed)).success, String(speed)).toBe(true);
    for (const speed of [0, 3, 8, '2', null]) expect(payloadSchema.safeParse(withSpeed(speed)).success, String(speed)).toBe(false);
  });

  it('starts a new save with default settings, no export and an empty run log', () => {
    const app = newAppState(FIXED_NOW);
    expect(appStateSchema.safeParse(app).success).toBe(true);
    expect(app).toEqual({
      settings: { playbackSpeed: 1, skipPlayback: false, tapToMove: true, dragToSteer: true },
      exportTracking: { trackingSince: FIXED_NOW, lastExportAt: null, runsAtLastExport: 0 },
      runTiming: { startedAt: FIXED_NOW, activeMs: 0 },
      runLog: [],
    });
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
