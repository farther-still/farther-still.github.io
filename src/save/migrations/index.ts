// Ordered migrations, one per version step (ARCHITECTURE 7.4). A migration takes the whole raw record at
// version `from` and returns it at version `from + 1`. Version 1 is the first, so the list starts empty;
// Phase 3b adds the step from 1 to 2 that discards the dummy fields.

import { SAVE_VERSION } from '../constants';

export type Migration = {
  from: number;
  migrate: (record: Record<string, unknown>) => Record<string, unknown>;
};

export const MIGRATIONS: readonly Migration[] = [];

/**
 * Brings a raw record up to `target`. Throws if a step is missing or a step fails; the loader treats that
 * record as damaged. The result's checksum is stale and must be recomputed by the caller.
 */
export const migrateRecord = (
  record: Record<string, unknown>,
  target: number = SAVE_VERSION,
  migrations: readonly Migration[] = MIGRATIONS,
): Record<string, unknown> => {
  let current = record;
  const stored = current['saveVersion'];
  if (typeof stored !== 'number' || !Number.isInteger(stored) || stored < 0) {
    throw new Error('migrate: record has no usable saveVersion');
  }
  let version: number = stored;
  while (version < target) {
    const from = version;
    const next = migrations.find((migration) => migration.from === from);
    if (next === undefined) throw new Error(`migrate: no migration from version ${from}`);
    current = next.migrate(current);
    if (current['saveVersion'] !== from + 1) {
      throw new Error(`migrate: migration from ${from} did not produce version ${from + 1}`);
    }
    version = from + 1;
  }
  return current;
};
