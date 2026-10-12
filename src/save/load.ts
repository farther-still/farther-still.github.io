// Loading (ARCHITECTURE 7.3). The rule this file exists to keep: the app never quietly falls back past a
// record it could not use and then writes over it.

import type { Content } from '../engine';
import { quarantineKey } from './backend';
import type { LocalStore, QuarantineCopy } from './backend';
import { classify } from './classify';
import type { Classified, ClassifyOptions, DamagedRecord, GoodRecord } from './classify';
import { CHECKPOINT_SLOTS, HOT_SLOT } from './constants';
import { checksumMatches } from './record';
import type { SlotRecord } from './schema';

export type LoadNotice = { kind: 'fallback' | 'hot-missing'; text: string };

export type LoadPlan =
  | { kind: 'new-install' }
  /** `skipped` are the damaged records that ranked above the chosen one. */
  | { kind: 'use'; chosen: GoodRecord; skipped: DamagedRecord[] }
  | { kind: 'recovery'; reason: 'suspect' | 'newer' | 'none-usable' };

/** Where the writer carries on from: one past the highest seq seen, and each checkpoint slot's seq. */
export type WriteCursor = { nextSeq: number; checkpointSeqs: Record<string, number> };

export type LoadResult =
  | { kind: 'new-install'; cursor: WriteCursor }
  | {
      kind: 'ready';
      record: SlotRecord;
      cursor: WriteCursor;
      notices: LoadNotice[];
      records: Classified[];
      /** True when the hot slot does not hold this record as it stands: a fallback, or a migrated record. */
      rewriteHot: boolean;
    }
  | {
      kind: 'recovery';
      reason: 'unreadable' | 'suspect' | 'newer' | 'none-usable';
      records: Classified[];
      detail: string;
    };

// A record whose seq cannot be read might be the newest, so it is looked at first.
const rank = (record: Classified): number => record.seq ?? Number.POSITIVE_INFINITY;

const newestFirst = (records: readonly Classified[]): Classified[] =>
  [...records].sort((a, b) => {
    const byRank = rank(a) === rank(b) ? 0 : rank(b) > rank(a) ? 1 : -1;
    return byRank || (a.slot === HOT_SLOT ? -1 : 0) - (b.slot === HOT_SLOT ? -1 : 0);
  });

/** Step 4 of ARCHITECTURE 7.3, with no side effects. */
export const planLoad = (records: readonly Classified[]): LoadPlan => {
  if (records.length === 0) return { kind: 'new-install' };
  const skipped: DamagedRecord[] = [];
  for (const record of newestFirst(records)) {
    if (record.kind === 'damaged') {
      skipped.push(record);
      continue;
    }
    if (record.kind !== 'good') return { kind: 'recovery', reason: record.kind };
    return { kind: 'use', chosen: record, skipped };
  }
  return { kind: 'recovery', reason: 'none-usable' };
};

/**
 * The sequence carries on after the highest seq among records whose checksum matches, of any kind: such a seq
 * is one the app really wrote. A seq inside a record whose checksum fails is part of the damage and is never
 * built on, so damage cannot leave the sequence somewhere it cannot go on from. Nothing is lost by ignoring
 * it: a damaged record never wins a load, whatever seq it claims.
 *
 * A checkpoint slot holding a record the app could not use counts as empty: by the time anything is written it
 * has a kept copy, and it should be the first to be replaced.
 */
export const cursorFor = (records: readonly Classified[]): WriteCursor => {
  const checkpointSeqs: Record<string, number> = {};
  for (const slot of CHECKPOINT_SLOTS) checkpointSeqs[slot] = 0;
  let highest = 0;
  for (const record of records) {
    const usable = record.kind === 'good' || record.kind === 'suspect';
    const seq = record.seq ?? 0;
    if (seq > highest && (usable || checksumMatches(record.raw))) highest = seq;
    if (record.slot in checkpointSeqs) checkpointSeqs[record.slot] = usable ? seq : 0;
  }
  return { nextSeq: highest + 1, checkpointSeqs };
};

/**
 * Copies to make before any slot is written: a kept copy of every record the app could not use, and a routine
 * copy of every record that was migrated in memory, so its raw form outlives the first write over it.
 */
export const copiesBeforeUse = (records: readonly Classified[]): QuarantineCopy[] => {
  const copies: QuarantineCopy[] = [];
  for (const record of records) {
    if (record.kind !== 'good') {
      copies.push({ slot: record.slot, kind: 'kept', reason: record.kind, raw: record.raw });
    } else if (record.migrated) {
      copies.push({ slot: record.slot, kind: 'routine', reason: 'before-migration', raw: record.raw });
    }
  }
  return copies;
};

/**
 * Copies to make when the player picks a way out of the recovery screen: everything the app could not use, and
 * the hot record whatever its kind, since the next write replaces it.
 */
export const copiesBeforeRecovery = (records: readonly Classified[]): QuarantineCopy[] => {
  const copies = copiesBeforeUse(records);
  for (const record of records) {
    if (record.kind === 'good' && record.slot === HOT_SLOT) {
      copies.push({ slot: record.slot, kind: 'kept', reason: 'set-aside', raw: record.raw });
    }
  }
  return copies;
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const readAndClassify = async (store: LocalStore, content: Content, options: ClassifyOptions): Promise<Classified[]> =>
  (await store.readSlots()).map(({ slot, raw }) => classify(slot, raw, content, options));

/**
 * Reads and sorts every slot, then decides. Slots are never written here. On the way to "ready" the quarantine
 * copies are committed first; on the way to "recovery" nothing at all is written until the player chooses.
 */
export const loadSave = async (store: LocalStore, content: Content, options: ClassifyOptions = {}): Promise<LoadResult> => {
  let records: Classified[];
  try {
    records = await readAndClassify(store, content, options);
  } catch (error) {
    return { kind: 'recovery', reason: 'unreadable', records: [], detail: message(error) };
  }
  const plan = planLoad(records);
  if (plan.kind === 'new-install') return { kind: 'new-install', cursor: cursorFor(records) };
  if (plan.kind === 'recovery') return { kind: 'recovery', reason: plan.reason, records, detail: '' };

  let newlyKept: string[];
  try {
    newlyKept = await store.addQuarantine(copiesBeforeUse(records));
  } catch (error) {
    return { kind: 'recovery', reason: 'unreadable', records, detail: message(error) };
  }

  // The fallback is announced once: when the unreadable record is first set aside, not on every later launch
  // that finds it still sitting in its slot.
  const { chosen, skipped } = plan;
  const notices: LoadNotice[] = [];
  if (skipped.some((record) => newlyKept.includes(quarantineKey(record.slot, record.raw)))) {
    notices.push({
      kind: 'fallback',
      text: `A save could not be read, so an older one was loaded (run ${chosen.record.payload.game.profile.runsStarted}). The unreadable copy is kept: Settings, Set-aside saves.`,
    });
  } else if (chosen.slot !== HOT_SLOT && skipped.length === 0) {
    notices.push({ kind: 'hot-missing', text: 'The main save slot was missing, so the newest checkpoint was loaded.' });
  }

  return {
    kind: 'ready',
    record: chosen.record,
    cursor: cursorFor(records),
    notices,
    records,
    rewriteHot: chosen.slot !== HOT_SLOT || chosen.migrated,
  };
};

export type RecoveryExit =
  | { ok: true; cursor: WriteCursor; records: Classified[] }
  | { ok: false; detail: string };

/**
 * The one write a recovery choice makes before the game takes over. It reads the slots again, as they are at
 * this moment, and sets aside whatever the choice is about to replace. It never trusts what was read when the
 * recovery screen opened: after an unreadable start that was nothing at all. If the slots cannot be read now,
 * or the copies cannot be made, it fails and the caller must change nothing.
 */
export const prepareRecoveryExit = async (
  store: LocalStore,
  content: Content,
  options: ClassifyOptions = {},
): Promise<RecoveryExit> => {
  try {
    const records = await readAndClassify(store, content, options);
    await store.addQuarantine(copiesBeforeRecovery(records));
    return { ok: true, cursor: cursorFor(records), records };
  } catch (error) {
    return { ok: false, detail: message(error) };
  }
};
