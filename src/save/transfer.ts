// Export and import (ARCHITECTURE 7.5): a JSON file for the share sheet and a text code that can be copied.
// An import is checked exactly as a loaded record is.

import type { Content } from '../engine';
import type { LocalStore, StoredSlot } from './backend';
import { fromBase64, toBase64 } from './base64';
import { classify } from './classify';
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION, EXPORT_REMINDER_DAYS, EXPORT_REMINDER_RUNS, HOT_SLOT, TEXT_CODE_PREFIX } from './constants';
import type { DiagnosticEntry, QuarantineEntry } from './db';
import { isObject, serializeRecord } from './record';
import type { BuildInfo } from './record';
import type { AppState, SlotRecord } from './schema';

export type ExportBundle = {
  format: typeof EXPORT_FORMAT;
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  exportedAt: number;
  buildId: string;
  /** The newest valid record, or null in a raw export made from the recovery screen. */
  record: SlotRecord | null;
  /** Raw exports only: every slot exactly as stored. */
  slots: StoredSlot[];
  quarantine: QuarantineEntry[];
  diagnostics: DiagnosticEntry[];
};

/** `raw` is the recovery screen's "export everything as it is": storage is copied out untouched. */
export const buildExport = async (
  store: LocalStore,
  record: SlotRecord | null,
  build: BuildInfo,
  now: number,
  options: { raw: boolean } = { raw: false },
): Promise<string> => {
  const bundle: ExportBundle = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: now,
    buildId: build.buildId,
    record,
    slots: options.raw ? await store.readSlots() : [],
    quarantine: await store.listQuarantine(),
    diagnostics: await store.readDiagnostics(),
  };
  return JSON.stringify(bundle);
};

/** The record alone, as text that survives being pasted into a note or a message. */
export const encodeTextCode = (record: SlotRecord): string => TEXT_CODE_PREFIX + toBase64(serializeRecord(record));

export type ImportCheck =
  /** `problems` is empty for a good record. A suspect one is offered with its problems, to be used anyway or not. */
  | { ok: true; record: SlotRecord; problems: string[]; /** The save version the record was stored at, if it had to be migrated; otherwise null. */ migratedFrom: number | null }
  | { ok: false; reason: string };

const storedVersion = (raw: unknown): number | null => {
  const version = isObject(raw) ? raw['saveVersion'] : undefined;
  return typeof version === 'number' ? version : null;
};

const judge = (raw: unknown, content: Content): ImportCheck => {
  const slot = isObject(raw) && typeof raw['slot'] === 'string' ? raw['slot'] : HOT_SLOT;
  const result = classify(slot, raw, content);
  switch (result.kind) {
    case 'good':
      return { ok: true, record: result.record, problems: [], migratedFrom: result.migrated ? storedVersion(raw) : null };
    case 'suspect':
      return { ok: true, record: result.record, problems: result.problems, migratedFrom: result.migrated ? storedVersion(raw) : null };
    case 'newer':
      return { ok: false, reason: `This save was written by a newer version of the game (save version ${result.saveVersion}). Update the app, then import it.` };
    case 'damaged':
      return { ok: false, reason: `This save is damaged: ${result.reason}.` };
  }
};

// A raw export, made from the recovery screen, holds every slot as it was. The newest one that is intact is the
// one to offer: a good one if there is any, otherwise a suspect one.
const fromRawSlots = (slots: unknown, content: Content): ImportCheck => {
  const candidates = (Array.isArray(slots) ? slots : [])
    .map((stored: unknown) => (isObject(stored) ? judge(stored['raw'], content) : null))
    .filter((checked): checked is Extract<ImportCheck, { ok: true }> => checked !== null && checked.ok)
    .sort((a, b) => b.record.seq - a.record.seq);
  const best = candidates.find((checked) => checked.problems.length === 0) ?? candidates[0];
  return best ?? { ok: false, reason: 'This export holds no save that can be read.' };
};

/**
 * Accepts an export file's text, a bare record's JSON, or a text code, and holds it to the checks a loaded
 * record gets. A suspect record comes back usable but with its problems listed; the caller must ask first.
 */
export const checkImport = (text: string, content: Content): ImportCheck => {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, reason: 'Nothing to import.' };
  let raw: unknown;
  try {
    raw = trimmed.startsWith(TEXT_CODE_PREFIX)
      ? JSON.parse(fromBase64(trimmed.slice(TEXT_CODE_PREFIX.length).replace(/\s+/g, '')))
      : JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: 'This is not a Farther Still export: it could not be read.' };
  }
  if (isObject(raw) && raw['format'] === EXPORT_FORMAT) {
    return raw['record'] === null || raw['record'] === undefined ? fromRawSlots(raw['slots'], content) : judge(raw['record'], content);
  }
  return judge(raw, content);
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since the last export, or since the save began if there has been none. */
export const daysSinceExport = (app: AppState, now: number): number => {
  const since = app.exportTracking.lastExportAt ?? app.exportTracking.trackingSince;
  return Math.max(0, Math.floor((now - since) / DAY_MS));
};

/** The reminder after 10 runs or 7 days without an export. It never blocks play. */
export const exportReminderDue = (app: AppState, runsStarted: number, now: number): boolean =>
  runsStarted - app.exportTracking.runsAtLastExport >= EXPORT_REMINDER_RUNS ||
  daysSinceExport(app, now) >= EXPORT_REMINDER_DAYS;

export const withExportRecorded = (app: AppState, runsStarted: number, now: number): AppState => ({
  ...app,
  exportTracking: { ...app.exportTracking, lastExportAt: now, runsAtLastExport: runsStarted },
});
