import { beforeEach, describe, expect, it } from 'vitest';
import { BUILD, CONTENT, FIXED_NOW, UNOWNED_ITEM, freshIndexedDb, gameAtRun, payload, record, recordV1, suspectGame, unsealed } from '../../tests/helpers';
import { canonicalJson } from '../engine';
import { LocalBackend } from './backend';
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION, SAVE_VERSION, STORE_DIAGNOSTICS, TEXT_CODE_PREFIX } from './constants';
import { checksumMatches, sealRecord } from './record';
import { buildExport, checkImport, daysSinceExport, encodeTextCode, exportReminderDue, withExportRecorded } from './transfer';
import type { ExportBundle } from './transfer';

let backend: LocalBackend;

beforeEach(() => {
  freshIndexedDb();
  backend = new LocalBackend();
});

const DAY = 24 * 60 * 60 * 1000;

describe('export', () => {
  it('holds the record, the set-aside saves and the diagnostics log', async () => {
    const mine = record('hot', 6);
    await backend.addQuarantine([{ slot: 'hot', kind: 'kept', reason: 'damaged', raw: { broken: true } }]);
    const db = await backend.handle();
    await db.add(STORE_DIAGNOSTICS, { at: FIXED_NOW, kind: 'error', message: 'boom', stack: '', buildId: BUILD.buildId });
    const bundle = JSON.parse(await buildExport(backend, mine, BUILD, FIXED_NOW)) as ExportBundle;
    expect(bundle).toMatchObject({ format: 'farther-still-export', formatVersion: 1, exportedAt: FIXED_NOW, buildId: BUILD.buildId, slots: [] });
    expect(bundle.record).toEqual(mine);
    expect(bundle.quarantine).toMatchObject([{ kind: 'kept', raw: { broken: true } }]);
    expect(bundle.diagnostics).toMatchObject([{ message: 'boom' }]);
  });

  it('copies storage out untouched in a raw export', async () => {
    const db = await backend.handle();
    await db.put('slots', 'garbage', 'hot');
    const bundle = JSON.parse(await buildExport(backend, null, BUILD, FIXED_NOW, { raw: true })) as ExportBundle;
    expect(bundle.record).toBeNull();
    expect(bundle.slots).toEqual([{ slot: 'hot', raw: 'garbage' }]);
  });
});

describe('import', () => {
  const mine = record('hot', 6);

  it('round-trips a record through an export file', async () => {
    const file = await buildExport(backend, mine, BUILD, FIXED_NOW);
    expect(checkImport(file, CONTENT)).toEqual({ ok: true, record: mine, problems: [], migratedFrom: null });
  });

  it('round-trips a record through a text code, even with stray whitespace from pasting', () => {
    const code = encodeTextCode(mine);
    expect(code.startsWith(TEXT_CODE_PREFIX)).toBe(true);
    expect(checkImport(code, CONTENT)).toEqual({ ok: true, record: mine, problems: [], migratedFrom: null });
    const pasted = `  ${code.slice(0, 20)}\n${code.slice(20, 60)} ${code.slice(60)}\n`;
    expect(checkImport(pasted, CONTENT)).toEqual({ ok: true, record: mine, problems: [], migratedFrom: null });
  });

  it('carries text beyond ASCII through a text code exactly', () => {
    // Sealed with the odd text in it, so the checksum only matches if every byte arrives as it left.
    const odd = sealRecord({ ...unsealed(mine), buildId: 'bÿild—\u{1F600}世界' });
    const code = encodeTextCode(odd);
    expect(/^[A-Za-z0-9+/=.]+$/.test(code)).toBe(true);
    expect(checkImport(code, CONTENT)).toEqual({ ok: true, record: odd, problems: [], migratedFrom: null });
  });

  it('accepts a bare record as JSON', () => {
    expect(checkImport(JSON.stringify(mine), CONTENT)).toEqual({ ok: true, record: mine, problems: [], migratedFrom: null });
  });

  it('refuses a damaged record and one from a newer version, saying why', () => {
    const damaged = { ...mine, seq: 7 };
    const newer = { ...mine, saveVersion: 9 };
    for (const [raw, word] of [[damaged, 'damaged'], [newer, 'newer version']] as const) {
      const result = checkImport(JSON.stringify(raw), CONTENT);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain(word);
    }
  });

  it('offers a suspect record with its problems listed, so the player can be asked before it is used', () => {
    // This is the save the app itself tells the player to export when a checkpoint is skipped.
    const suspect = record('hot', 6, suspectGame());
    const result = checkImport(encodeTextCode(suspect), CONTENT);
    if (!result.ok) throw new Error('expected the suspect record to be offered');
    expect(result.record).toEqual(suspect);
    expect(result.problems.join(' ')).toContain(UNOWNED_ITEM);
  });

  // Michael exported from the build before the real game, as a file and as a text code in a note. Either may
  // be imported into this one.
  it('takes an export made at save version 1 and offers it migrated', async () => {
    const old = recordV1('hot', 6);
    const file = JSON.stringify({ format: EXPORT_FORMAT, formatVersion: EXPORT_FORMAT_VERSION, exportedAt: FIXED_NOW, buildId: 'test-build-v1', record: old, slots: [], quarantine: [], diagnostics: [] });
    const code = TEXT_CODE_PREFIX + btoa(canonicalJson(old));
    const db = await backend.handle();
    await db.put('slots', old, 'hot');
    const raw = await buildExport(backend, null, BUILD, FIXED_NOW, { raw: true });
    for (const text of [file, code, JSON.stringify(old), raw]) {
      const result = checkImport(text, CONTENT);
      if (!result.ok) throw new Error(`expected the version 1 record to be offered: ${result.reason}`);
      expect(result.problems).toEqual([]);
      // The sheet that asks before replacing uses this to say that a version 1 save holds nothing of the real game.
      expect(result.migratedFrom).toBe(1);
      expect(result.record).toMatchObject({ slot: 'hot', seq: 6, saveVersion: SAVE_VERSION, buildId: 'test-build-v1' });
      expect(result.record.payload.game.profile.counters.runsStarted).toBe(1);
      expect(checksumMatches(result.record)).toBe(true);
    }
  });

  it('reads the newest good record out of a raw export', async () => {
    const db = await backend.handle();
    await db.put('slots', { ...record('hot', 9), writtenAt: 1 }, 'hot'); // damaged
    await db.put('slots', record('checkpoint-0', 7, gameAtRun(7)), 'checkpoint-0');
    await db.put('slots', record('checkpoint-1', 5, gameAtRun(5)), 'checkpoint-1');
    await db.put('slots', record('checkpoint-2', 8, suspectGame()), 'checkpoint-2'); // suspect, newer than the good ones
    const raw = await buildExport(backend, null, BUILD, FIXED_NOW, { raw: true });
    const result = checkImport(raw, CONTENT);
    expect(result).toMatchObject({ ok: true, problems: [], record: { seq: 7, payload: { game: { profile: { counters: { runsStarted: 7 } } } } } });
  });

  it('offers a suspect record from a raw export when no good one is in it', async () => {
    const db = await backend.handle();
    await db.put('slots', record('hot', 9, suspectGame()), 'hot');
    await db.put('slots', 'garbage', 'checkpoint-0');
    const result = checkImport(await buildExport(backend, null, BUILD, FIXED_NOW, { raw: true }), CONTENT);
    if (!result.ok) throw new Error('expected the suspect record to be offered');
    expect(result.record.seq).toBe(9);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('refuses text that is not an export, without throwing', () => {
    const empty = '{"format":"farther-still-export","record":null}';
    const nothingUsable = '{"format":"farther-still-export","record":null,"slots":[{"slot":"hot","raw":"garbage"},7,null]}';
    for (const text of ['', '   ', 'hello', '{', 'FS1.!!!not-base64!!!', 'FS1.aGVsbG8=', '[1,2,3]', 'null', empty, nothingUsable]) {
      expect(checkImport(text, CONTENT).ok, text).toBe(false);
    }
  });
});

describe('export reminder', () => {
  const app = payload().app;
  const since = app.exportTracking.trackingSince;

  it('counts days from the start of the save until there has been an export', () => {
    expect(daysSinceExport(app, since)).toBe(0);
    expect(daysSinceExport(app, since + 3 * DAY + 5)).toBe(3);
    // A phone clock set backwards must not produce a negative count.
    expect(daysSinceExport(app, since - 5 * DAY)).toBe(0);
  });

  it('is due after 10 runs or 7 days without an export, and not before', () => {
    expect(exportReminderDue(app, 9, since + 6 * DAY)).toBe(false);
    expect(exportReminderDue(app, 10, since)).toBe(true);
    expect(exportReminderDue(app, 1, since + 7 * DAY)).toBe(true);
  });

  it('starts counting again from a recorded export', () => {
    const exported = withExportRecorded(app, 14, since + 20 * DAY);
    expect(exported.exportTracking).toEqual({ trackingSince: since, lastExportAt: since + 20 * DAY, runsAtLastExport: 14 });
    // Nothing else in the app half is touched: the settings, the run timer and the run log come through as they were.
    expect({ ...exported, exportTracking: app.exportTracking }).toEqual(app);
    expect(app.exportTracking.lastExportAt).toBeNull();
    expect(exportReminderDue(exported, 23, since + 26 * DAY)).toBe(false);
    expect(exportReminderDue(exported, 24, since + 21 * DAY)).toBe(true);
    expect(exportReminderDue(exported, 15, since + 27 * DAY)).toBe(true);
  });
});
