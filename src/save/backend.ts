// SaveBackend is the seam for Phase 5's cloud backup. LocalBackend is IndexedDB and is always the primary.

import { canonicalJson, hash } from '../engine';
import { ROUTINE_QUARANTINE_LIMIT, SEQ_CEILING, STORE_DEVICE, STORE_DIAGNOSTICS, STORE_QUARANTINE, STORE_SLOTS } from './constants';
import { openSaveDb } from './db';
import type { DiagnosticEntry, QuarantineEntry, QuarantineKind, QuarantineReason, SaveDb } from './db';
import { isObject } from './record';
import type { SlotRecord } from './schema';

export interface SaveBackend {
  /** Every slot record exactly as stored. A record may be damaged, so nothing is assumed about its shape. */
  readAll(): Promise<unknown[]>;
  /** Resolves only once the record is committed. */
  write(record: SlotRecord): Promise<void>;
}

export type StoredSlot = { slot: string; raw: unknown };

export type QuarantineCopy = { slot: string; kind: QuarantineKind; reason: QuarantineReason; raw: unknown };

/** What the save system needs from local storage beyond SaveBackend. Tests substitute it to inject failures. */
export interface LocalStore extends SaveBackend {
  readSlots(): Promise<StoredSlot[]>;
  reconnect(): Promise<void>;
  /** Resolves with the keys of the copies that were not already held. */
  addQuarantine(copies: readonly QuarantineCopy[]): Promise<string[]>;
  listQuarantine(): Promise<QuarantineEntry[]>;
  readDiagnostics(): Promise<DiagnosticEntry[]>;
}

const fingerprint = (raw: unknown): string => {
  try {
    return hash(canonicalJson(raw));
  } catch {
    // Not plain JSON, so it was not written by this app. Any stable text will do for a key.
    try {
      return hash(JSON.stringify(raw) ?? String(raw));
    } catch {
      return hash(String(raw));
    }
  }
};

/**
 * A record's seq, if it has the form of one this app writes: a whole number from 1 up to the schema's ceiling.
 * It says where the record ranks. Whether the write sequence may build on it is a separate question, answered
 * by whether the record is usable and whether the seq is plausible (see `cursorFor`).
 */
export const readSeq = (raw: unknown): number | null => {
  const seq = isObject(raw) ? raw['seq'] : undefined;
  return typeof seq === 'number' && Number.isSafeInteger(seq) && seq > 0 && seq < SEQ_CEILING ? seq : null;
};

export const quarantineKey = (slot: string, raw: unknown): string =>
  `${slot}|${readSeq(raw) ?? 'x'}|${fingerprint(raw)}`;

export class LocalBackend implements LocalStore {
  private db: SaveDb | null = null;

  /** What the last slot write reported: "strict" where the browser honours it. Shown in Settings. */
  lastDurability = 'not written yet';

  constructor(private readonly open: () => Promise<SaveDb> = openSaveDb) {}

  async handle(): Promise<SaveDb> {
    this.db ??= await this.open();
    return this.db;
  }

  async reconnect(): Promise<void> {
    try {
      this.db?.close();
    } catch {
      // A connection that is already gone cannot be closed; a fresh one is opened below either way.
    }
    this.db = null;
    await this.handle();
  }

  async readSlots(): Promise<StoredSlot[]> {
    const db = await this.handle();
    const tx = db.transaction(STORE_SLOTS, 'readonly');
    const [keys, values] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
    await tx.done;
    return keys.map((slot, index) => ({ slot, raw: values[index] }));
  }

  async readAll(): Promise<unknown[]> {
    return (await this.readSlots()).map((stored) => stored.raw);
  }

  async write(record: SlotRecord): Promise<void> {
    const db = await this.handle();
    const tx = db.transaction(STORE_SLOTS, 'readwrite', { durability: 'strict' });
    await tx.store.put(record, record.slot);
    await tx.done;
    this.lastDurability = (tx as { durability?: string }).durability ?? 'not reported';
  }

  async addQuarantine(copies: readonly QuarantineCopy[]): Promise<string[]> {
    const added: string[] = [];
    if (copies.length === 0) return added;
    const db = await this.handle();
    const tx = db.transaction(STORE_QUARANTINE, 'readwrite', { durability: 'strict' });
    const existing = await tx.store.getAll();
    let order = existing.reduce((highest, entry) => Math.max(highest, entry.order), 0);
    const byKey = new Map(existing.map((entry) => [entry.key, entry]));
    for (const copy of copies) {
      const key = quarantineKey(copy.slot, copy.raw);
      const found = byKey.get(key);
      if (found === undefined) {
        order += 1;
        const entry: QuarantineEntry = { key, order, seq: readSeq(copy.raw), ...copy };
        byKey.set(key, entry);
        await tx.store.put(entry, key);
        added.push(key);
      } else if (found.kind === 'routine' && copy.kind === 'kept') {
        // A copy can be promoted to kept, never demoted to routine.
        const entry: QuarantineEntry = { ...found, kind: 'kept', reason: copy.reason };
        byKey.set(key, entry);
        await tx.store.put(entry, key);
      }
    }
    const routine = [...byKey.values()].filter((entry) => entry.kind === 'routine').sort((a, b) => b.order - a.order);
    for (const extra of routine.slice(ROUTINE_QUARANTINE_LIMIT)) await tx.store.delete(extra.key);
    await tx.done;
    return added;
  }

  async listQuarantine(): Promise<QuarantineEntry[]> {
    const db = await this.handle();
    return (await db.getAll(STORE_QUARANTINE)).sort((a, b) => b.order - a.order);
  }

  async readDiagnostics(): Promise<DiagnosticEntry[]> {
    const db = await this.handle();
    return db.getAll(STORE_DIAGNOSTICS);
  }

  async getDevice(key: string): Promise<unknown> {
    const db = await this.handle();
    return db.get(STORE_DEVICE, key);
  }

  async setDevice(key: string, value: unknown): Promise<void> {
    const db = await this.handle();
    await db.put(STORE_DEVICE, value, key);
  }
}
