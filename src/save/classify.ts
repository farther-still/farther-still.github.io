// Sorts one raw record into the four kinds of ARCHITECTURE 7.3. Used for loaded slots, imports and
// quarantine restores alike, so all three are held to the same checks.

import type { Content } from '../engine';
import { readSeq } from './backend';
import { SAVE_VERSION } from './constants';
import { checkInvariants } from './invariants';
import { MIGRATIONS, migrateRecord } from './migrations';
import type { Migration } from './migrations';
import { checksumMatches, checksumOf, isObject } from './record';
import { slotRecordSchema } from './schema';
import type { SlotRecord } from './schema';

type Base = { slot: string; raw: unknown };

export type GoodRecord = Base & { kind: 'good'; seq: number; record: SlotRecord; migrated: boolean };
export type SuspectRecord = Base & { kind: 'suspect'; seq: number; record: SlotRecord; migrated: boolean; problems: string[] };
export type DamagedRecord = Base & { kind: 'damaged'; seq: number | null; reason: string };
export type NewerRecord = Base & { kind: 'newer'; seq: number | null; saveVersion: number };

export type Classified = GoodRecord | SuspectRecord | DamagedRecord | NewerRecord;

export type ClassifyOptions = { target?: number; migrations?: readonly Migration[] };

export const classify = (slot: string, raw: unknown, content: Content, options: ClassifyOptions = {}): Classified => {
  const target = options.target ?? SAVE_VERSION;
  const migrations = options.migrations ?? MIGRATIONS;
  const seq = readSeq(raw);
  const damaged = (reason: string): DamagedRecord => ({ kind: 'damaged', slot, raw, seq, reason });

  if (!isObject(raw)) return damaged('not a record');
  const version = raw['saveVersion'];
  if (typeof version === 'number' && Number.isInteger(version) && version > target) {
    return { kind: 'newer', slot, raw, seq, saveVersion: version };
  }
  if (!checksumMatches(raw)) return damaged('checksum does not match');

  let current: Record<string, unknown>;
  try {
    current = migrateRecord(raw, target, migrations);
  } catch (error) {
    return damaged(`migration failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const migrated = current !== raw;
  const candidate = migrated ? { ...current, checksum: checksumOf(current) } : raw;

  const parsed = slotRecordSchema.safeParse(candidate);
  if (!parsed.success) {
    const where = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(record)'}: ${issue.code}`);
    return damaged(`schema: ${where.join('; ')}`);
  }
  const record = parsed.data;
  if (record.slot !== slot) return damaged(`stored under ${slot} but says ${record.slot}`);

  const problems = checkInvariants(record.payload.game, content);
  if (problems.length > 0) return { kind: 'suspect', slot, raw, seq: record.seq, record, migrated, problems };
  return { kind: 'good', slot, raw, seq: record.seq, record, migrated };
};
