// Shared by the tests beside the code: a fresh fake IndexedDB per test, sample states and records, and stores
// that fail or stall on demand.

// Defines IDBRequest, IDBKeyRange and the rest as globals, which `idb` needs; each test then gets its own factory.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import type { Content, GameState } from '../src/engine';
import { STORE_QUARANTINE, STORE_SLOTS, sealRecord } from '../src/save';
import type { BuildInfo, LocalBackend, LocalStore, QuarantineCopy, SavePayload, SlotName, SlotRecord } from '../src/save';

export const CONTENT: Content = { items: ['d01', 'd02', 'd03'] };

export const BUILD: BuildInfo = { buildId: 'test-build', contentVersion: 'test-content' };

export const FIXED_NOW = 1791800000000;

/** Each call gives the save code an empty database of its own. */
export const freshIndexedDb = (): void => {
  globalThis.indexedDB = new IDBFactory();
};

export const game = (overrides: { profile?: Partial<GameState['profile']>; run?: Partial<GameState['run']> } = {}): GameState => ({
  profile: { inventory: { d01: 2, d03: 1 }, equipped: 'd01', runsStarted: 3, ...overrides.profile },
  run: { seed: 123456789, counter: 7, lastRoll: 4242, steps: 4, target: 'd03', ...overrides.run },
});

export const payload = (state: GameState = game()): SavePayload => ({
  game: state,
  app: {
    settings: { testToggle: true },
    exportTracking: { trackingSince: FIXED_NOW - 1000, lastExportAt: null, runsAtLastExport: 0 },
  },
});

export const record = (slot: SlotName, seq: number, state: GameState = game()): SlotRecord =>
  sealRecord({
    slot,
    saveVersion: 1,
    buildId: BUILD.buildId,
    contentVersion: BUILD.contentVersion,
    seq,
    writtenAt: FIXED_NOW + seq,
    payload: payload(state),
  });

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
