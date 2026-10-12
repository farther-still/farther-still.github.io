import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTENT, FIXED_NOW, payloadV1, record, recordV1 } from '../../../tests/helpers';
import { newGame, repairRun, step } from '../../engine';
import { classify } from '../classify';
import { SAVE_VERSION } from '../constants';
import { checkInvariants } from '../invariants';
import { checksumMatches, checksumOf } from '../record';
import { gameStateSchema } from '../schema';
import type { SlotRecord } from '../schema';
import { MIGRATIONS, migrateRecord } from './index';
import { migrateV1toV2 } from './v1-to-v2';

// The frozen record the walking skeleton wrote: run seed 123456789, written at 1791763200000, with an export
// recorded and two runs counted at it.
const FIXTURE_TEXT = readFileSync(join(import.meta.dirname, '../../../tests/fixtures/saves/v1.json'), 'utf8');
const fixture = (): Record<string, unknown> => JSON.parse(FIXTURE_TEXT) as Record<string, unknown>;
const FIXTURE_SEED = 123456789;
const FIXTURE_WRITTEN_AT = 1791763200000;

const NO_CELLS = {
  weapon: null,
  head: null,
  neck: null,
  shoulders: null,
  body: null,
  back: null,
  arms: null,
  hands: null,
  finger: null,
  waist: null,
  legs: null,
  feet: null,
  offhand: null,
  acc1: null,
  acc2: null,
  acc3: null,
  acc4: null,
  acc5: null,
};

/** Version 2's new game, spelled out: this step is frozen, so what it produces must never follow the engine. */
const newGameV2 = (seed: number): unknown => ({
  profile: {
    items: {},
    loadouts: [
      { name: '', slots: NO_CELLS },
      { name: '', slots: NO_CELLS },
    ],
    activeLoadout: 0,
    claimedBosses: [],
    gems: 0,
    waypointsVisited: [],
    waypointsUnlocked: [],
    bestiary: {},
    strongestEverBeaten: 0,
    secretsFound: [],
    autoAssign: { unlocked: false, on: false, split: { life: 30, damage: 30, defense: 30, dexterity: 10, luck: 0 } },
    hintsShown: [],
    counters: { runsStarted: 1, bestLevel: 1 },
  },
  run: {
    seed,
    battleCount: 0,
    spawnCount: 0,
    xp: 0,
    pointsSpent: { life: 0, damage: 0, defense: 0, dexterity: 0, luck: 0 },
    growthPointsEarned: 0,
    gold: 0,
    energySpent: 0,
    energyPaidBack: 0,
    bossesBeaten: [],
    strongestBeaten: 0,
    lastEnemy: null,
    salvageUsed: false,
    position: { zone: 'z01', x: -1, y: -1 },
    marks: {},
    stashesCollected: [],
    tallies: { wins: 0, losses: 0, itemsGained: [], claims: 0, gemsGained: 0 },
  },
});

const newAppV2 = (since: number): unknown => ({
  settings: { playbackSpeed: 1, skipPlayback: false, tapToMove: true, dragToSteer: true },
  exportTracking: { trackingSince: since, lastExportAt: null, runsAtLastExport: 0 },
  runTiming: { startedAt: since, activeMs: 0 },
  runLog: [],
});

const ENVELOPE = ['slot', 'seq', 'buildId', 'contentVersion', 'writtenAt'] as const;

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
};

const reseal = (fields: Record<string, unknown>): Record<string, unknown> => {
  const rest = { ...fields };
  delete rest['checksum'];
  return { ...rest, checksum: checksumOf(rest) };
};

/** Classifies a version 1 record that must come out good, and hands back the migrated record. */
const migrated = (raw: unknown, slot = 'hot'): SlotRecord => {
  const result = classify(slot, raw, CONTENT);
  if (result.kind !== 'good') throw new Error(`expected a good record, got ${result.kind}`);
  expect(result.migrated).toBe(true);
  return result.record;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('migrateV1toV2', () => {
  it('turns the version 1 fixture into a new game at run 1, discarding the dummy state', () => {
    expect(fixture()).toMatchObject({ saveVersion: 1, writtenAt: FIXTURE_WRITTEN_AT, payload: { game: { run: { seed: FIXTURE_SEED } } } });
    expect(checksumMatches(fixture())).toBe(true);

    const out = migrateV1toV2(fixture());
    expect(out['saveVersion']).toBe(2);
    expect(out['payload']).toEqual({ game: newGameV2(FIXTURE_SEED), app: newAppV2(FIXTURE_WRITTEN_AT) });
  });

  it('starts export tracking and the run timer at the moment the version 1 record was written', () => {
    // The fixture had an export recorded. An export of the dummy save is no backup of this game, so it is forgotten.
    expect(fixture()).toMatchObject({ payload: { app: { exportTracking: { lastExportAt: 1791500000000, runsAtLastExport: 2, trackingSince: 1791000000000 } } } });
    const { app } = migrated(fixture()).payload;
    expect(app.exportTracking).toEqual({ trackingSince: FIXTURE_WRITTEN_AT, lastExportAt: null, runsAtLastExport: 0 });
    expect(app.runTiming).toEqual({ startedAt: FIXTURE_WRITTEN_AT, activeMs: 0 });
    expect(app.runLog).toEqual([]);
    expect(app.settings).toEqual({ playbackSpeed: 1, skipPlayback: false, tapToMove: true, dragToSteer: true });
  });

  it('carries the run seed of any run version 1 could have had', () => {
    for (const seed of [0, 1, FIXTURE_SEED, 0xffffffff]) {
      expect(migrated(recordV1('hot', 5, payloadV1(seed))).payload.game.run.seed, String(seed)).toBe(seed);
    }
  });

  it('leaves the fields around the payload exactly as they were', () => {
    const before = fixture();
    const out = migrateV1toV2(fixture());
    for (const field of ENVELOPE) expect(out[field], field).toBe(before[field]);
    expect(Object.keys(out).sort()).toEqual(Object.keys(before).sort());
    // The step does not seal: the old checksum comes through, stale, and the loader computes the new one.
    expect(out['checksum']).toBe(before['checksum']);
    expect(checksumMatches(out)).toBe(false);

    const loaded = migrated(fixture());
    for (const field of ENVELOPE) expect(loaded[field], field).toBe(before[field]);
    expect(loaded).toMatchObject({ slot: 'hot', seq: 42, buildId: 'fixture-v1', contentVersion: 'fixture-content-v1', writtenAt: FIXTURE_WRITTEN_AT });
    expect(loaded.checksum).not.toBe(before['checksum']);
    expect(checksumMatches(loaded)).toBe(true);
  });

  it('is pure: the same record gives the same result, whatever the clock says, and the record is not changed', () => {
    // Frozen all the way down, so a write to the record would throw.
    const input = deepFreeze(fixture());
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const first = migrateV1toV2(input);
    vi.setSystemTime(FIXED_NOW);
    const second = migrateV1toV2(input);
    vi.useRealTimers();
    expect(second).toEqual(first);
    expect(input).toEqual(fixture());

    const now = vi.spyOn(Date, 'now');
    const random = vi.spyOn(Math, 'random');
    expect(migrateV1toV2(input)).toEqual(first);
    expect(now).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
    now.mockRestore();
    random.mockRestore();

    // Nothing is shared: not between two results, not with the record, and not between the two loadouts of one.
    const loadouts = (from: Record<string, unknown>): Array<{ slots: object }> =>
      (from as { payload: { game: { profile: { loadouts: Array<{ slots: object }> } } } }).payload.game.profile.loadouts;
    expect(first['payload']).not.toBe(second['payload']);
    expect(first['payload']).not.toBe(input['payload']);
    expect(loadouts(first)).toHaveLength(2);
    expect(loadouts(first)[0]).not.toBe(loadouts(first)[1]);
    expect(loadouts(first)[0]?.slots).not.toBe(loadouts(first)[1]?.slots);
    expect(loadouts(first)[0]).not.toBe(loadouts(second)[0]);
  });
});

describe('a version 1 record on its way in', () => {
  it('classifies as good and migrated, at the current save version', () => {
    const result = classify('hot', fixture(), CONTENT);
    expect(result).toMatchObject({ kind: 'good', migrated: true, seq: 42, record: { saveVersion: SAVE_VERSION } });
    expect(SAVE_VERSION).toBe(2);
    // The raw record is handed back as it was stored, for the routine copy made before the first write.
    expect(result.raw).toEqual(fixture());
    expect(migrated(fixture()).payload).toEqual({ game: newGameV2(FIXTURE_SEED), app: newAppV2(FIXTURE_WRITTEN_AT) });
  });

  it('is the only step so far, and the default path uses it', () => {
    expect(MIGRATIONS.map((migration) => migration.from)).toEqual(Array.from({ length: SAVE_VERSION - 1 }, (_, index) => index + 1));
    expect(migrateRecord(fixture())).toEqual(migrateV1toV2(fixture()));
    // A record already at this version is handed back untouched, which is how the loader knows nothing was migrated.
    const current: Record<string, unknown> = record('hot', 3);
    expect(migrateRecord(current)).toBe(current);
  });

  it('stands off the map until run repair puts the hero on the run start', () => {
    const game = migrated(fixture()).payload.game;
    // A migration knows no content, so it cannot know the run start. No tile has these coordinates.
    expect(game.run.position).toEqual({ zone: 'z01', x: -1, y: -1 });
    expect(checkInvariants(game, CONTENT)).toEqual([]);

    const repaired = repairRun(game, CONTENT);
    expect(repaired).not.toBe(game);
    expect(repaired.run.position).toEqual(CONTENT.start);
    // Nothing else moved, and the profile is the very same object.
    expect(repaired.run).toEqual({ ...game.run, position: CONTENT.start });
    expect(repaired.profile).toBe(game.profile);
    expect(gameStateSchema.safeParse(repaired).success).toBe(true);
    expect(checkInvariants(repaired, CONTENT)).toEqual([]);
    expect(repairRun(repaired, CONTENT)).toBe(repaired);
  });

  it('is a game that can be played once repaired, and a brand-new one in all but two figures', () => {
    const repaired = repairRun(migrated(fixture()).payload.game, CONTENT);
    const walked = step(repaired, { type: 'Step', dx: 0, dy: -1 }, CONTENT);
    expect('rejected' in walked ? walked.rejected : walked.state.run.position).toEqual({ ...CONTENT.start, y: CONTENT.start.y - 1 });
    const again = step(repaired, { type: 'NewRun', seed: 7 }, CONTENT);
    expect('rejected' in again ? again.rejected : again.state.profile.counters.runsStarted).toBe(2);

    // Against the engine's own new game with the same seed: marks are rolled from content when a run starts,
    // which a migration cannot do, so the migrated run has none and its spawn counter starts at 0.
    const fresh = newGame(FIXTURE_SEED, CONTENT);
    expect(repaired.profile).toEqual(fresh.profile);
    expect(repaired.run).toEqual({ ...fresh.run, spawnCount: 0, marks: {} });
  });
});

describe('a version 1 record that is intact but holds junk', () => {
  // The step reads two things from a version 1 record: the run seed and the time it was written. Everything
  // else in the payload is discarded unread. So a record whose checksum matches but whose payload is junk comes
  // out as a good record: a new game with seed 0. It cannot throw, and there is nothing in it to lose.
  const junk: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['text', 'junk'],
    ['a number', 7],
    ['a list', [1, 2, 3]],
    ['an empty object', {}],
    ['a game that is text', { game: 'x', app: 5 }],
    ['a run that is a list', { game: { run: [] } }],
    ['a run with no seed', { game: { profile: null, run: {} }, app: {} }],
    ['version 2 fields under version 1', { game: { profile: { items: { i001: 1 } }, run: { battleCount: 9 } } }],
  ];

  it.each(junk)('comes out as a new game with seed 0 when its payload is %s', (_name, payload) => {
    const raw = recordV1('hot', 5, payload);
    expect(checksumMatches(raw)).toBe(true);
    const loaded = migrated(raw);
    expect(loaded.payload).toEqual({ game: newGameV2(0), app: newAppV2(FIXED_NOW + 5) });
    expect(loaded).toMatchObject({ slot: 'hot', seq: 5, saveVersion: SAVE_VERSION });
  });

  it('uses seed 0 in place of a seed no run could have had', () => {
    for (const seed of [-1, 1.5, 2 ** 32, 2 ** 53, '7', null, [7], { seed: 7 }]) {
      const payload = { ...payloadV1(), game: { profile: {}, run: { seed } } };
      expect(migrated(recordV1('hot', 5, payload)).payload.game.run.seed, JSON.stringify(seed)).toBe(0);
    }
  });

  it('is damaged, not good and not a throw, when the fields around the payload are junk too', () => {
    const sealed = recordV1('hot', 5);
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>, RegExp]> = [
      ['a time that is text', reseal({ ...sealed, writtenAt: 'yesterday' }), /^schema: writtenAt/],
      ['a time with a fraction', reseal({ ...sealed, writtenAt: 1.5 }), /^schema: writtenAt/],
      ['no build', reseal({ ...sealed, buildId: null }), /^schema: buildId/],
      ['a slot that is not one', reseal({ ...sealed, slot: 'bogus' }), /^schema: slot/],
      ['a field nobody wrote', reseal({ ...sealed, extra: true }), /^schema: /],
      ['the wrong slot', recordV1('checkpoint-0', 5), /^stored under hot but says checkpoint-0$/],
      ['a checksum that does not match', { ...sealed, seq: 6 }, /^checksum does not match$/],
    ];
    for (const [name, raw, reason] of cases) {
      const result = classify('hot', raw, CONTENT);
      expect(result.kind, name).toBe('damaged');
      if (result.kind === 'damaged') expect(result.reason, name).toMatch(reason);
    }
    // The step itself falls back to 0 for a time it cannot read; the record is refused by the schema afterwards.
    const out = migrateV1toV2({ saveVersion: 1, writtenAt: 'yesterday' });
    expect(out['payload']).toEqual({ game: newGameV2(0), app: newAppV2(0) });
    expect(out['writtenAt']).toBe('yesterday');
  });

  it('never throws out of classify, whatever a sealed version 1 record holds', () => {
    const deep: unknown[] = [];
    let at = deep;
    for (let depth = 0; depth < 200; depth += 1) {
      const next: unknown[] = [];
      at.push(next);
      at = next;
    }
    const raws: unknown[] = [
      reseal({ saveVersion: 1 }),
      reseal({ saveVersion: 1, payload: deep }),
      reseal({ saveVersion: 1, seq: 'x', slot: 7, payload: { game: { run: { seed: { valueOf: 'x' } } } } }),
      reseal({ saveVersion: 1, seq: 9, slot: 'hot', writtenAt: -1, buildId: '', contentVersion: '', payload: '' }),
      { saveVersion: 1, checksum: 'x', payload: { game: { run: { seed: Number.NaN } } } },
      { saveVersion: 1 },
    ];
    for (const raw of raws) {
      const result = classify('hot', raw, CONTENT);
      expect(['good', 'damaged']).toContain(result.kind);
    }
    // Intact around the payload, junk inside it, and a time before 1970: still a new game, tracked from time 0.
    expect(migrated(raws[3]).payload).toEqual({ game: newGameV2(0), app: newAppV2(0) });
  });
});
