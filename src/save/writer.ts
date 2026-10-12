// The one writer (ARCHITECTURE 7.2): every write goes through it, in order, one at a time, and a write is done
// only when its IndexedDB transaction has completed.

import type { Content } from '../engine';
import type { LocalStore } from './backend';
import { CHECKPOINT_SLOTS, HOT_SLOT, SAVE_VERSION } from './constants';
import { checkInvariants } from './invariants';
import type { WriteCursor } from './load';
import { sealRecord } from './record';
import type { BuildInfo } from './record';
import { payloadSchema, slotRecordSchema } from './schema';
import type { SavePayload, SlotName, SlotRecord } from './schema';

export type CheckpointOutcome = 'none' | 'written' | 'skipped';

export type CommitResult =
  | { ok: true; record: SlotRecord; checkpoint: CheckpointOutcome; problems: string[] }
  /** The state failed the schema or the safe-integer check: an engine bug. Nothing was written over the good hot slot. */
  | { ok: false; reason: 'invalid-state'; detail: string; lastGood: SlotRecord | null }
  /** Storage refused the write twice. `unsaved` is the state that could not be written. */
  | { ok: false; reason: 'storage'; detail: string; unsaved: SlotRecord };

export type WriterDeps = {
  store: LocalStore;
  build: BuildInfo;
  content: Content;
  now: () => number;
  /** Goes to the diagnostics log. */
  log: (kind: string, message: string) => void;
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class SaveWriter {
  private queue: Promise<unknown> = Promise.resolve();
  private nextSeq: number;
  private readonly checkpointSeqs: Record<string, number>;
  private lastGoodRecord: SlotRecord | null;

  constructor(
    private readonly deps: WriterDeps,
    cursor: WriteCursor,
    lastGood: SlotRecord | null,
  ) {
    this.nextSeq = cursor.nextSeq;
    this.checkpointSeqs = { ...cursor.checkpointSeqs };
    this.lastGoodRecord = lastGood;
  }

  /** The newest record known to be in the hot slot. */
  get lastGood(): SlotRecord | null {
    return this.lastGoodRecord;
  }

  /** Writes the hot slot; with `checkpoint`, a checkpoint first (new run confirmed). */
  commit(payload: SavePayload, options: { checkpoint: boolean } = { checkpoint: false }): Promise<CommitResult> {
    return this.enqueue(() => this.write(payload, options.checkpoint));
  }

  /**
   * Replaces the game with an imported or restored one (ARCHITECTURE 7.5): the current hot record goes to
   * quarantine as a kept copy and to a checkpoint, then the incoming payload becomes the hot slot.
   */
  replaceWith(incoming: SavePayload): Promise<CommitResult> {
    return this.enqueue(async () => {
      const current = this.lastGoodRecord;
      if (current !== null) {
        try {
          await this.deps.store.addQuarantine([
            { slot: HOT_SLOT, kind: 'kept', reason: 'replaced-by-import', raw: current },
          ]);
        } catch (error) {
          // Without the kept copy the current game must not be replaced.
          return { ok: false, reason: 'storage', detail: message(error), unsaved: current };
        }
        const kept = await this.writeCheckpoint(current.payload);
        if (kept.outcome === 'failed') {
          return { ok: false, reason: 'storage', detail: kept.detail, unsaved: current };
        }
      }
      return this.write(incoming, false);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private seal(slot: SlotName, payload: SavePayload): SlotRecord {
    const record = sealRecord({
      slot,
      saveVersion: SAVE_VERSION,
      buildId: this.deps.build.buildId,
      contentVersion: this.deps.build.contentVersion,
      seq: this.nextSeq,
      writtenAt: this.deps.now(),
      payload,
    });
    this.nextSeq += 1;
    return slotRecordSchema.parse(record);
  }

  private async store(record: SlotRecord): Promise<{ ok: true } | { ok: false; detail: string }> {
    try {
      await this.deps.store.write(record);
      return { ok: true };
    } catch (first) {
      this.deps.log('save-retry', `write of ${record.slot} failed, retrying on a fresh connection: ${message(first)}`);
      try {
        await this.deps.store.reconnect();
        await this.deps.store.write(record);
        return { ok: true };
      } catch (second) {
        this.deps.log('save-failed', `write of ${record.slot} failed twice: ${message(second)}`);
        return { ok: false, detail: message(second) };
      }
    }
  }

  private async writeCheckpoint(
    payload: SavePayload,
  ): Promise<{ outcome: 'written' | 'skipped'; problems: string[] } | { outcome: 'failed'; detail: string }> {
    const problems = checkInvariants(payload.game, this.deps.content);
    if (problems.length > 0) {
      this.deps.log('checkpoint-skipped', problems.join('; '));
      return { outcome: 'skipped', problems };
    }
    // The checkpoint slot with the lowest seq is the one replaced; an empty slot counts as lowest.
    let slot: SlotName = CHECKPOINT_SLOTS[0];
    for (const candidate of CHECKPOINT_SLOTS) {
      if ((this.checkpointSeqs[candidate] ?? 0) < (this.checkpointSeqs[slot] ?? 0)) slot = candidate;
    }
    const record = this.seal(slot, payload);
    const stored = await this.store(record);
    if (!stored.ok) return { outcome: 'failed', detail: stored.detail };
    this.checkpointSeqs[slot] = record.seq;
    return { outcome: 'written', problems: [] };
  }

  private async write(payload: SavePayload, checkpoint: boolean): Promise<CommitResult> {
    const valid = payloadSchema.safeParse(payload);
    if (!valid.success) {
      const detail = valid.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`).join('; ');
      this.deps.log('invalid-state', detail);
      return { ok: false, reason: 'invalid-state', detail, lastGood: this.lastGoodRecord };
    }
    let hot: SlotRecord;
    let outcome: CheckpointOutcome = 'none';
    let problems: string[] = [];
    try {
      if (checkpoint) {
        const result = await this.writeCheckpoint(valid.data);
        if (result.outcome === 'failed') {
          return { ok: false, reason: 'storage', detail: result.detail, unsaved: this.seal(HOT_SLOT, valid.data) };
        }
        outcome = result.outcome;
        problems = result.problems;
      }
      hot = this.seal(HOT_SLOT, valid.data);
    } catch (error) {
      // Sealing throws only if the state cannot be serialized exactly, which is also an engine bug.
      this.deps.log('invalid-state', message(error));
      return { ok: false, reason: 'invalid-state', detail: message(error), lastGood: this.lastGoodRecord };
    }
    const stored = await this.store(hot);
    if (!stored.ok) return { ok: false, reason: 'storage', detail: stored.detail, unsaved: hot };
    this.lastGoodRecord = hot;
    return { ok: true, record: hot, checkpoint: outcome, problems };
  }
}
