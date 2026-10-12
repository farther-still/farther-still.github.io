// A slot record's checksum and its one serialization (ARCHITECTURE 7.1).

import { canonicalJson, hash } from '../engine';
import type { SlotRecord } from './schema';

export type BuildInfo = {
  /** The git commit the build was made from. */
  buildId: string;
  /** A hash of everything under `data/`. */
  contentVersion: string;
};

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The checksum covers every other field of the record, serialized with sorted keys. */
export const checksumOf = (record: Record<string, unknown>): string => {
  const rest: Record<string, unknown> = { ...record };
  delete rest['checksum'];
  return hash(canonicalJson(rest));
};

export const sealRecord = (fields: Omit<SlotRecord, 'checksum'>): SlotRecord => ({
  ...fields,
  checksum: checksumOf(fields),
});

/** False for anything that is not an object with a matching checksum; never throws. */
export const checksumMatches = (raw: unknown): boolean => {
  if (!isObject(raw) || typeof raw['checksum'] !== 'string') return false;
  try {
    return checksumOf(raw) === raw['checksum'];
  } catch {
    return false;
  }
};

/** The bytes a record is stored and exported as. Fixtures hold exactly this text plus a final newline. */
export const serializeRecord = (record: SlotRecord): string => canonicalJson(record);
