// The one IndexedDB database and its four stores (ARCHITECTURE 7.1). `src/platform/` uses the handle type and
// the store names from here and nothing else from the save module.

import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION, STORE_DEVICE, STORE_DIAGNOSTICS, STORE_QUARANTINE, STORE_SLOTS } from './constants';

export type QuarantineKind = 'kept' | 'routine';

export type QuarantineReason =
  | 'damaged'
  | 'suspect'
  | 'newer'
  | 'replaced-by-import'
  | 'set-aside'
  | 'before-migration';

export type QuarantineEntry = {
  /** `slot|seq|checksum of the raw copy`, so one record is stored once however often it is seen. */
  key: string;
  /** A kept copy is never removed automatically. Only the newest routine copies are held. */
  kind: QuarantineKind;
  reason: QuarantineReason;
  slot: string;
  seq: number | null;
  /** Insertion order. The clock is not used: a phone's clock can change. */
  order: number;
  raw: unknown;
};

export type DiagnosticEntry = {
  at: number;
  kind: string;
  message: string;
  stack: string;
  buildId: string;
};

export interface SaveDbSchema extends DBSchema {
  [STORE_SLOTS]: { key: string; value: unknown };
  [STORE_QUARANTINE]: { key: string; value: QuarantineEntry };
  [STORE_DEVICE]: { key: string; value: unknown };
  [STORE_DIAGNOSTICS]: { key: number; value: DiagnosticEntry };
}

export type SaveDb = IDBPDatabase<SaveDbSchema>;

export const openSaveDb = (): Promise<SaveDb> =>
  openDB<SaveDbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_SLOTS)) db.createObjectStore(STORE_SLOTS);
      if (!db.objectStoreNames.contains(STORE_QUARANTINE)) db.createObjectStore(STORE_QUARANTINE);
      if (!db.objectStoreNames.contains(STORE_DEVICE)) db.createObjectStore(STORE_DEVICE);
      if (!db.objectStoreNames.contains(STORE_DIAGNOSTICS)) {
        db.createObjectStore(STORE_DIAGNOSTICS, { autoIncrement: true });
      }
    },
    blocking(_current, _blocked, event) {
      // A newer build wants to upgrade the database. Let go; this page's next write reconnects or fails loudly.
      (event.target as IDBDatabase | null)?.close();
    },
  });
