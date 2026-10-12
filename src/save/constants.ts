// Names and limits the save system is pinned to. `record.test.ts` fails if a database or store name changes:
// a renamed database would look like an empty install on Michael's phone.

export const DB_NAME = 'farther-still';
export const DB_VERSION = 1;

export const STORE_SLOTS = 'slots';
export const STORE_QUARANTINE = 'quarantine';
export const STORE_DEVICE = 'device';
export const STORE_DIAGNOSTICS = 'diagnostics';

/** Bump with a migration and a fixture: see the save-change checklist in CLAUDE.md. */
export const SAVE_VERSION = 1;

export const HOT_SLOT = 'hot';
export const CHECKPOINT_SLOTS = ['checkpoint-0', 'checkpoint-1', 'checkpoint-2', 'checkpoint-3', 'checkpoint-4'] as const;
export const ALL_SLOTS = [HOT_SLOT, ...CHECKPOINT_SLOTS] as const;

/** The schema's limit on seq: 2^52. No real save comes near this many writes. */
export const SEQ_CEILING = 4503599627370496;

export const ROUTINE_QUARANTINE_LIMIT = 10;
export const DIAGNOSTICS_LIMIT = 200;

export const EXPORT_REMINDER_RUNS = 10;
export const EXPORT_REMINDER_DAYS = 7;

export const EXPORT_FORMAT = 'farther-still-export';
export const EXPORT_FORMAT_VERSION = 1;
export const TEXT_CODE_PREFIX = 'FS1.';
