// Shared by the tests beside the code: a fresh fake IndexedDB per test, sample states and records, and stores
// that fail or stall on demand.

// Defines IDBRequest, IDBKeyRange and the rest as globals, which `idb` needs; each test then gets its own factory.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { emptyLoadout } from '../src/engine';
import type { Content, GameState, ItemId, Loadout, SlotId } from '../src/engine';
import { sampleContent } from '../src/engine/sample.fixture';
import { STORE_QUARANTINE, STORE_SLOTS, checksumOf, sealRecord } from '../src/save';
import type { BuildInfo, LocalBackend, LocalStore, QuarantineCopy, SavePayload, SlotName, SlotRecord } from '../src/save';

/** The made-up world of `src/engine/sample.fixture.ts`: two zones, four enemies, eight items. */
export const CONTENT: Content = sampleContent();

export const BUILD: BuildInfo = { buildId: 'test-build', contentVersion: 'test-content' };

export const FIXED_NOW = 1791800000000;

const MINUTE = 60 * 1000;

/** Each call gives the save code an empty database of its own. */
export const freshIndexedDb = (): void => {
  globalThis.indexedDB = new IDBFactory();
};

const loadout = (name: string, worn: Partial<Record<SlotId, ItemId>>): Loadout => ({ name, slots: { ...emptyLoadout().slots, ...worn } });

/**
 * A valid game in the sample world, part-way through its third run: gear bought, dropped and handed over, two
 * loadouts in use (the first wears both owned copies of one accessory), the boss claimed in an earlier run, a
 * secret and a stash found, one enemy marked. It passes the schema and the invariants, and `repairRun` leaves
 * it alone. `overrides` replaces whole fields of either half.
 */
export const game = (overrides: { profile?: Partial<GameState['profile']>; run?: Partial<GameState['run']> } = {}): GameState => ({
  profile: {
    items: { i001: 1, i002: 1, i003: 2, i004: 1, i005: 1 },
    loadouts: [
      loadout('', { weapon: 'i001', body: 'i002', acc1: 'i003', acc2: 'i003' }),
      loadout('Claim', { weapon: 'i005', body: 'i002', acc1: 'i003' }),
    ],
    activeLoadout: 0,
    claimedBosses: ['e003'],
    gems: 4,
    waypointsVisited: [],
    waypointsUnlocked: [],
    bestiary: { e001: { timesBeaten: 14 }, e002: { timesBeaten: 9 }, e003: { timesBeaten: 2 }, e004: { timesBeaten: 0 } },
    strongestEverBeaten: 10,
    secretsFound: ['x01', 'x02'],
    autoAssign: { unlocked: false, on: false, split: { life: 30, damage: 30, defense: 30, dexterity: 10, luck: 0 } },
    hintsShown: ['map', 'prefight', 'hero'],
    counters: { runsStarted: 3, bestLevel: 6 },
    ...overrides.profile,
  },
  run: {
    seed: 123456789,
    battleCount: 5,
    spawnCount: 6,
    // Level 4, so 15 stat points earned.
    xp: 74,
    pointsSpent: { life: 4, damage: 6, defense: 3, dexterity: 0, luck: 0 },
    growthPointsEarned: 0,
    gold: 77,
    energySpent: 3,
    energyPaidBack: 0,
    bossesBeaten: [],
    strongestBeaten: 4,
    lastEnemy: 'e002',
    salvageUsed: false,
    position: { zone: 'z01', x: 2, y: 2 },
    marks: { s001: { stat: 'xp', percent: 100 } },
    stashesCollected: ['x02'],
    tallies: { wins: 3, losses: 2, itemsGained: ['i003'], claims: 0, gemsGained: 1 },
    ...overrides.run,
  },
});

/** The sample game with a different run count: what the recovery screen and the import comparison show. */
export const gameAtRun = (runsStarted: number): GameState => {
  const base = game();
  return { ...base, profile: { ...base.profile, counters: { ...base.profile.counters, runsStarted } } };
};

/** An item of the sample world that the sample game does not own. */
export const UNOWNED_ITEM = 'i008';

/** Intact but failing an invariant, so "suspect": the first loadout wears an item that is not owned. */
export const suspectGame = (): GameState => {
  const base = game();
  const [first, ...rest] = base.profile.loadouts;
  if (first === undefined) throw new Error('the sample game has no loadout');
  return { ...base, profile: { ...base.profile, loadouts: [{ ...first, slots: { ...first.slots, head: UNOWNED_ITEM } }, ...rest] } };
};

export const payload = (state: GameState = game()): SavePayload => ({
  game: state,
  app: {
    // Not the defaults, so a test that loses the settings cannot pass by accident.
    settings: { playbackSpeed: 2, skipPlayback: true, tapToMove: true, dragToSteer: false },
    exportTracking: { trackingSince: FIXED_NOW - 60 * MINUTE, lastExportAt: null, runsAtLastExport: 0 },
    runTiming: { startedAt: FIXED_NOW - 30 * MINUTE, activeMs: 4 * MINUTE },
    runLog: [
      { run: 1, startedAt: FIXED_NOW - 60 * MINUTE, endedAt: FIXED_NOW - 50 * MINUTE, activeMs: 7 * MINUTE, wins: 9, losses: 3, level: 4, strongest: 4 },
      { run: 2, startedAt: FIXED_NOW - 50 * MINUTE, endedAt: FIXED_NOW - 30 * MINUTE, activeMs: 11 * MINUTE, wins: 14, losses: 1, level: 6, strongest: 10 },
    ],
  },
});

export const record = (slot: SlotName, seq: number, state: GameState = game()): SlotRecord =>
  sealRecord({
    slot,
    saveVersion: 2,
    buildId: BUILD.buildId,
    contentVersion: BUILD.contentVersion,
    seq,
    writtenAt: FIXED_NOW + seq,
    payload: payload(state),
  });

/** The payload save version 1 held: Phase 3a's dummy state, a counter and a fake inventory. */
export const payloadV1 = (seed = 123456789): Record<string, unknown> => ({
  game: {
    profile: { inventory: { d01: 2, d03: 1 }, equipped: 'd01', runsStarted: 3 },
    run: { seed, counter: 7, lastRoll: 4242, steps: 4, target: 'd03' },
  },
  app: {
    settings: { testToggle: true },
    exportTracking: { trackingSince: FIXED_NOW - 1000, lastExportAt: FIXED_NOW - 500, runsAtLastExport: 2 },
  },
});

/**
 * A sealed version 1 record, as the build before the real game wrote it. `payloadOrJunk` can be anything at all,
 * for a record whose checksum matches but whose contents are not a version 1 payload.
 */
export const recordV1 = (slot: string, seq: number, payloadOrJunk: unknown = payloadV1()): Record<string, unknown> => {
  const fields: Record<string, unknown> = {
    slot,
    saveVersion: 1,
    buildId: 'test-build-v1',
    contentVersion: 'test-content-v1',
    seq,
    writtenAt: FIXED_NOW + seq,
    payload: payloadOrJunk,
  };
  return { ...fields, checksum: checksumOf(fields) };
};

/** A record's fields without its checksum, ready to be changed and sealed again. */
export const unsealed = (sealed: SlotRecord): Omit<SlotRecord, 'checksum'> => {
  const fields: Partial<SlotRecord> = { ...sealed };
  delete fields.checksum;
  return fields as Omit<SlotRecord, 'checksum'>;
};

/** Puts anything at all into a slot, the way a bug or a damaged disk might. */
export const putRaw = async (backend: LocalBackend, slot: string, raw: unknown): Promise<void> => {
  const db = await backend.handle();
  await db.put(STORE_SLOTS, raw, slot);
};

export const dump = async (backend: LocalBackend): Promise<{ slots: Record<string, unknown>; quarantine: unknown[] }> => {
  const db = await backend.handle();
  const slots: Record<string, unknown> = {};
  for (const key of await db.getAllKeys(STORE_SLOTS)) slots[key] = await db.get(STORE_SLOTS, key);
  return { slots, quarantine: await db.getAll(STORE_QUARANTINE) };
};

export type FlakyOptions = {
  /** How many writes fail before one succeeds. */
  failWrites?: number;
  /** Fail the quarantine store instead. */
  failQuarantine?: boolean;
  /** Every write waits for this to resolve before it commits. */
  gate?: Promise<void>;
};

/** Wraps a real backend, failing or stalling as asked, and counting what was called. */
export const flaky = (inner: LocalBackend, options: FlakyOptions = {}): LocalStore & { calls: string[] } => {
  let failuresLeft = options.failWrites ?? 0;
  const calls: string[] = [];
  return {
    calls,
    readAll: () => inner.readAll(),
    readSlots: () => inner.readSlots(),
    async write(rec: SlotRecord) {
      calls.push(`write:${rec.slot}:${rec.seq}`);
      if (options.gate !== undefined) await options.gate;
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('simulated storage failure');
      }
      await inner.write(rec);
      calls.push(`committed:${rec.slot}:${rec.seq}`);
    },
    async reconnect() {
      calls.push('reconnect');
      await inner.reconnect();
    },
    async addQuarantine(copies: readonly QuarantineCopy[]) {
      calls.push(`quarantine:${copies.length}`);
      if (options.failQuarantine === true) throw new Error('simulated quarantine failure');
      return inner.addQuarantine(copies);
    },
    listQuarantine: () => inner.listQuarantine(),
    readDiagnostics: () => inner.readDiagnostics(),
  };
};
