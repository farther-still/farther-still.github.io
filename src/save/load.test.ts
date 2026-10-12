import { beforeEach, describe, expect, it } from 'vitest';
import { BUILD, CONTENT, FIXED_NOW, dump, flaky, freshIndexedDb, game, payload, putRaw, record, unsealed } from '../../tests/helpers';
import { LocalBackend, readSeq } from './backend';
import { classify } from './classify';
import { DB_NAME, SEQ_CEILING } from './constants';
import { copiesBeforeRecovery, cursorFor, loadSave, planLoad, prepareRecoveryExit } from './load';
import type { Migration } from './migrations';
import { checksumOf, sealRecord } from './record';
import type { SlotRecord } from './schema';
import { SaveWriter } from './writer';

let backend: LocalBackend;

beforeEach(() => {
  freshIndexedDb();
  backend = new LocalBackend();
});

const damage = (good: SlotRecord): unknown => ({ ...good, writtenAt: good.writtenAt + 1 });
const suspect = (slot: SlotRecord['slot'], seq: number): SlotRecord => record(slot, seq, game({ profile: { equipped: 'd02' } }));
const newer = (slot: string, seq: number): unknown => ({ ...record('hot', seq), slot, saveVersion: 2, future: true });

describe('classify', () => {
  it('calls an intact record that passes everything good', () => {
    const result = classify('hot', record('hot', 3), CONTENT);
    expect(result.kind).toBe('good');
  });

  it('calls a record whose checksum does not match damaged', () => {
    expect(classify('hot', damage(record('hot', 3)), CONTENT)).toMatchObject({ kind: 'damaged', seq: 3, reason: 'checksum does not match' });
  });

  it('calls junk damaged, with no seq', () => {
    for (const junk of [null, 5, 'text', [], {}]) {
      expect(classify('hot', junk, CONTENT)).toMatchObject({ kind: 'damaged', seq: null });
    }
  });

  it('calls an intact record that fails the schema damaged', () => {
    const base = record('hot', 3);
    const withExtra: Record<string, unknown> = { ...base, extra: true };
    withExtra['checksum'] = checksumOf(withExtra);
    expect(classify('hot', withExtra, CONTENT)).toMatchObject({ kind: 'damaged' });
  });

  it('calls a record stored under the wrong slot damaged', () => {
    expect(classify('checkpoint-1', record('hot', 3), CONTENT)).toMatchObject({ kind: 'damaged' });
  });

  it('calls an intact record that fails an invariant suspect, and says why', () => {
    const cases = [
      game({ profile: { equipped: 'd02' } }),
      game({ profile: { inventory: { d01: -1 }, equipped: null } }),
      game({ profile: { inventory: { d99: 1 }, equipped: null } }),
      game({ profile: { runsStarted: 0 } }),
      game({ run: { counter: -1 } }),
    ];
    for (const state of cases) {
      const result = classify('hot', record('hot', 3, state), CONTENT);
      expect(result.kind).toBe('suspect');
      if (result.kind === 'suspect') expect(result.problems.length).toBeGreaterThan(0);
    }
  });

  it('calls a record from a later save version newer, whatever else is true of it', () => {
    expect(classify('hot', newer('hot', 8), CONTENT)).toMatchObject({ kind: 'newer', seq: 8, saveVersion: 2 });
  });

  it('reads a seq only if this app could have written it', () => {
    for (const seq of [1, 2, 57, SEQ_CEILING - 1]) expect(readSeq({ seq })).toBe(seq);
    for (const seq of [0, -1, 1.5, SEQ_CEILING, Number.MAX_SAFE_INTEGER, 1e308, Number.NaN, Number.POSITIVE_INFINITY, '7', null]) {
      expect(readSeq({ seq }), String(seq)).toBeNull();
    }
    expect(readSeq(null)).toBeNull();
    expect(readSeq('text')).toBeNull();
  });

  it('calls even a correctly sealed record damaged if its seq is at or beyond the ceiling', () => {
    const huge = sealRecord({ ...unsealed(record('hot', 3)), seq: SEQ_CEILING });
    expect(classify('hot', huge, CONTENT)).toMatchObject({ kind: 'damaged', seq: null });
  });

  describe('with a migration', () => {
    // A stand-in for a real version step: version 0 kept the counter under another name.
    const v0 = (seq: number): Record<string, unknown> => {
      const current = record('hot', seq);
      const { counter, ...run } = current.payload.game.run;
      const old: Record<string, unknown> = {
        ...current,
        saveVersion: 0,
        payload: { ...current.payload, game: { ...current.payload.game, run: { ...run, oldCounter: counter } } },
      };
      delete old['checksum'];
      return { ...old, checksum: checksumOf(old) };
    };
    const up: Migration = {
      from: 0,
      migrate: (raw) => {
        const data = structuredClone(raw) as { saveVersion: number; payload: { game: { run: Record<string, unknown> } } };
        data.payload.game.run['counter'] = data.payload.game.run['oldCounter'];
        delete data.payload.game.run['oldCounter'];
        data.saveVersion = 1;
        return data as unknown as Record<string, unknown>;
      },
    };

    it('migrates an older record and marks it migrated', () => {
      const result = classify('hot', v0(4), CONTENT, { migrations: [up] });
      expect(result).toMatchObject({ kind: 'good', migrated: true, seq: 4 });
      if (result.kind === 'good') expect(result.record.payload.game.run.counter).toBe(7);
    });

    it('calls an older record damaged when its migration is missing or throws', () => {
      expect(classify('hot', v0(4), CONTENT, { migrations: [] })).toMatchObject({ kind: 'damaged' });
      const broken: Migration = { from: 0, migrate: () => { throw new Error('boom'); } };
      expect(classify('hot', v0(4), CONTENT, { migrations: [broken] })).toMatchObject({ kind: 'damaged' });
    });

    it('copies the raw record to quarantine before the migrated form can replace it', async () => {
      const raw = v0(4);
      await putRaw(backend, 'hot', raw);
      const result = await loadSave(backend, CONTENT, { migrations: [up] });
      expect(result).toMatchObject({ kind: 'ready', rewriteHot: true });
      const quarantine = await backend.listQuarantine();
      expect(quarantine).toHaveLength(1);
      expect(quarantine[0]).toMatchObject({ kind: 'routine', reason: 'before-migration', slot: 'hot', seq: 4 });
      expect(quarantine[0]?.raw).toEqual(raw);
      // Loading again stores nothing new: each record is quarantined once.
      await loadSave(backend, CONTENT, { migrations: [up] });
      expect(await backend.listQuarantine()).toHaveLength(1);
    });
  });
});

describe('planLoad', () => {
  const c = (slot: SlotRecord['slot'], raw: unknown) => classify(slot, raw, CONTENT);

  it('starts a new game only when there are no records at all', () => {
    expect(planLoad([])).toEqual({ kind: 'new-install' });
  });

  it('uses the record with the highest seq even when a lower one carries a later clock time', () => {
    // Lower seq, but written "tomorrow": a phone whose clock was set forward and back again.
    const laterByClock = sealRecord({ ...unsealed(record('checkpoint-0', 4)), writtenAt: FIXED_NOW + 24 * 60 * 60 * 1000 });
    const newestBySeq = record('hot', 9);
    expect(laterByClock.writtenAt).toBeGreaterThan(newestBySeq.writtenAt);
    for (const order of [[c('checkpoint-0', laterByClock), c('hot', newestBySeq)], [c('hot', newestBySeq), c('checkpoint-0', laterByClock)]]) {
      expect(planLoad(order)).toMatchObject({ kind: 'use', chosen: { slot: 'hot', seq: 9 }, skipped: [] });
    }
  });

  it('falls back past a damaged newest record and reports which it skipped', () => {
    const plan = planLoad([c('hot', damage(record('hot', 9))), c('checkpoint-0', record('checkpoint-0', 7)), c('checkpoint-1', record('checkpoint-1', 5))]);
    expect(plan).toMatchObject({ kind: 'use', chosen: { slot: 'checkpoint-0', seq: 7 } });
    if (plan.kind === 'use') expect(plan.skipped.map((skipped) => `${skipped.slot}:${skipped.seq}`)).toEqual(['hot:9']);
  });

  it('never falls back past a suspect or newer record by itself', () => {
    const older = c('checkpoint-0', record('checkpoint-0', 7));
    expect(planLoad([c('hot', suspect('hot', 9)), older])).toEqual({ kind: 'recovery', reason: 'suspect' });
    expect(planLoad([c('hot', newer('hot', 9)), older])).toEqual({ kind: 'recovery', reason: 'newer' });
    // Even when the suspect one is reached only after skipping a damaged one.
    expect(planLoad([c('hot', damage(record('hot', 9))), c('checkpoint-1', suspect('checkpoint-1', 8)), older])).toEqual({ kind: 'recovery', reason: 'suspect' });
  });

  it('treats a record whose seq cannot be read as possibly the newest', () => {
    const plan = planLoad([c('checkpoint-0', record('checkpoint-0', 7)), c('hot', 'garbage')]);
    expect(plan).toMatchObject({ kind: 'use', chosen: { seq: 7 } });
    if (plan.kind === 'use') expect(plan.skipped.map((skipped) => skipped.slot)).toEqual(['hot']);
  });

  it('goes to recovery when nothing is usable', () => {
    expect(planLoad([c('hot', damage(record('hot', 9))), c('checkpoint-0', 'junk')])).toEqual({ kind: 'recovery', reason: 'none-usable' });
  });
});

describe('cursorFor', () => {
  const c = (slot: string, raw: unknown) => classify(slot, raw, CONTENT);

  it('builds on the seq of any record whose checksum matches, including one from a newer version', () => {
    const fromTheFuture = sealRecord({ ...unsealed(record('checkpoint-1', 500)), saveVersion: 2 as never });
    const cursor = cursorFor([c('hot', record('hot', 12)), c('checkpoint-1', fromTheFuture), c('checkpoint-0', suspect('checkpoint-0', 40))]);
    expect(c('checkpoint-1', fromTheFuture).kind).toBe('newer');
    expect(cursor.nextSeq).toBe(501);
  });

  it('never builds on a seq inside a record whose checksum fails, whatever it claims', () => {
    for (const seq of [57, SEQ_CEILING - 1, SEQ_CEILING - 4, SEQ_CEILING, Number.MAX_SAFE_INTEGER, 1e308, -5, 2.5]) {
      const cursor = cursorFor([c('hot', record('hot', 12)), c('checkpoint-2', { ...record('checkpoint-2', 3), seq })]);
      expect(cursor.nextSeq, String(seq)).toBe(13);
    }
  });

  it('can still write, and load what it wrote, beside a damaged record claiming the highest seq there is', async () => {
    await putRaw(backend, 'checkpoint-4', { ...record('checkpoint-4', 3), seq: SEQ_CEILING - 1 });
    await backend.write(record('checkpoint-0', 2));
    await backend.write(record('hot', 5));
    const loaded = await loadSave(backend, CONTENT);
    if (loaded.kind !== 'ready') throw new Error('expected ready');
    expect(loaded.cursor.nextSeq).toBe(6);
    const writer = new SaveWriter({ store: backend, build: BUILD, content: CONTENT, now: () => FIXED_NOW, log: () => undefined }, loaded.cursor, loaded.record);
    for (let i = 0; i < 6; i += 1) expect((await writer.commit(payload(), { checkpoint: true })).ok).toBe(true);
    expect(await loadSave(backend, CONTENT)).toMatchObject({ kind: 'ready', record: { seq: 17, slot: 'hot' }, notices: [] });
  });

  it('counts a checkpoint slot that holds an unusable record as empty, so it is replaced first', () => {
    const cursor = cursorFor([
      c('hot', record('hot', 30)),
      c('checkpoint-0', record('checkpoint-0', 10)),
      c('checkpoint-1', damage(record('checkpoint-1', 29))),
      c('checkpoint-2', newer('checkpoint-2', 28)),
      c('checkpoint-3', suspect('checkpoint-3', 20)),
    ]);
    expect(cursor.checkpointSeqs).toEqual({ 'checkpoint-0': 10, 'checkpoint-1': 0, 'checkpoint-2': 0, 'checkpoint-3': 20, 'checkpoint-4': 0 });
  });
});

describe('loadSave', () => {
  it('reports a new install on an empty database and writes nothing', async () => {
    const result = await loadSave(backend, CONTENT);
    expect(result).toEqual({ kind: 'new-install', cursor: cursorFor([]) });
    expect(result.kind === 'new-install' && result.cursor.nextSeq).toBe(1);
    expect(await dump(backend)).toEqual({ slots: {}, quarantine: [] });
  });

  it('loads a good hot slot and continues the sequence after the highest seq', async () => {
    await backend.write(record('checkpoint-2', 4));
    await backend.write(record('hot', 9));
    const before = await dump(backend);
    const result = await loadSave(backend, CONTENT);
    if (result.kind !== 'ready') throw new Error('expected ready');
    expect(result.record.seq).toBe(9);
    expect(result.rewriteHot).toBe(false);
    expect(result.notices).toEqual([]);
    expect(result.cursor).toEqual({
      nextSeq: 10,
      checkpointSeqs: { 'checkpoint-0': 0, 'checkpoint-1': 0, 'checkpoint-2': 4, 'checkpoint-3': 0, 'checkpoint-4': 0 },
    });
    expect(await dump(backend)).toEqual(before);
  });

  it('keeps a copy of a damaged hot slot before falling back, and leaves the slots alone', async () => {
    const bad = damage(record('hot', 9));
    await putRaw(backend, 'hot', bad);
    await backend.write(record('checkpoint-0', 7));
    const slotsBefore = (await dump(backend)).slots;
    const result = await loadSave(backend, CONTENT);
    if (result.kind !== 'ready') throw new Error('expected ready');
    expect(result.record.seq).toBe(7);
    expect(result.rewriteHot).toBe(true);
    expect(result.notices.map((notice) => notice.kind)).toEqual(['fallback']);
    // The sequence carries on from the record that was loaded; the damaged one's seq is not built on.
    expect(result.cursor.nextSeq).toBe(8);
    const after = await dump(backend);
    expect(after.slots).toEqual(slotsBefore);
    expect(after.quarantine).toMatchObject([{ kind: 'kept', reason: 'damaged', slot: 'hot', seq: 9, raw: bad }]);

    // The rewrite the app makes next replaces the damaged hot slot, and the following launch is clean.
    const writer = new SaveWriter({ store: backend, build: BUILD, content: CONTENT, now: () => FIXED_NOW, log: () => undefined }, result.cursor, result.record);
    await writer.commit(result.record.payload);
    expect(await loadSave(backend, CONTENT)).toMatchObject({ kind: 'ready', record: { seq: 8, slot: 'hot' }, notices: [], rewriteHot: false });
  });

  it('says the hot slot was missing when it simply is not there', async () => {
    await backend.write(record('checkpoint-0', 7));
    const result = await loadSave(backend, CONTENT);
    if (result.kind !== 'ready') throw new Error('expected ready');
    expect(result.notices.map((notice) => notice.kind)).toEqual(['hot-missing']);
    expect(result.rewriteHot).toBe(true);
  });

  it('announces a fallback once, not on every launch that still finds the unreadable record', async () => {
    // A damaged checkpoint with an unreadable seq ranks first on every load until it is rotated out, and
    // garbage under a key no slot uses is never overwritten at all.
    await backend.write(record('hot', 9));
    await putRaw(backend, 'checkpoint-3', { ...record('checkpoint-3', 5), seq: 1e308 });
    await putRaw(backend, 'not-a-slot', 'garbage');
    const first = await loadSave(backend, CONTENT);
    if (first.kind !== 'ready') throw new Error('expected ready');
    expect(first.record.seq).toBe(9);
    expect(first.notices.map((notice) => notice.kind)).toEqual(['fallback']);
    expect(first.rewriteHot).toBe(false);
    expect(first.cursor.nextSeq).toBe(10);
    expect(await backend.listQuarantine()).toHaveLength(2);

    for (let launch = 0; launch < 3; launch += 1) {
      const again = await loadSave(backend, CONTENT);
      if (again.kind !== 'ready') throw new Error('expected ready');
      expect(again.notices).toEqual([]);
      expect(again.record.seq).toBe(9);
    }
    expect(await backend.listQuarantine()).toHaveLength(2);
  });

  it('rotates a damaged checkpoint out at the next new run, its copy already kept', async () => {
    await backend.write(record('hot', 9));
    for (const [slot, seq] of [['checkpoint-0', 4], ['checkpoint-1', 5], ['checkpoint-2', 6], ['checkpoint-4', 8]] as const) {
      await backend.write(record(slot, seq));
    }
    const bad = { ...record('checkpoint-3', 7), seq: Number.MAX_SAFE_INTEGER };
    await putRaw(backend, 'checkpoint-3', bad);
    const loaded = await loadSave(backend, CONTENT);
    if (loaded.kind !== 'ready') throw new Error('expected ready');
    const writer = new SaveWriter({ store: backend, build: BUILD, content: CONTENT, now: () => FIXED_NOW, log: () => undefined }, loaded.cursor, loaded.record);
    const result = await writer.commit(payload(), { checkpoint: true });
    expect(result).toMatchObject({ ok: true, checkpoint: 'written' });
    const after = await dump(backend);
    expect(after.slots['checkpoint-3']).toMatchObject({ seq: 10 });
    expect(after.slots['hot']).toMatchObject({ seq: 11 });
    expect(after.quarantine).toMatchObject([{ kind: 'kept', reason: 'damaged', slot: 'checkpoint-3', raw: bad }]);
  });

  it('also keeps a copy of an unusable record that is not the newest', async () => {
    await backend.write(record('hot', 9));
    await putRaw(backend, 'checkpoint-3', damage(record('checkpoint-3', 5)));
    const result = await loadSave(backend, CONTENT);
    expect(result).toMatchObject({ kind: 'ready', notices: [] });
    expect(await backend.listQuarantine()).toMatchObject([{ kind: 'kept', reason: 'damaged', slot: 'checkpoint-3' }]);
  });

  it.each([
    ['suspect', (): unknown => suspect('hot', 9)],
    ['newer', (): unknown => newer('hot', 9)],
  ])('shows recovery for a %s newest record and writes nothing at all', async (reason, make) => {
    await putRaw(backend, 'hot', make());
    await backend.write(record('checkpoint-0', 7));
    const before = await dump(backend);
    const result = await loadSave(backend, CONTENT);
    expect(result).toMatchObject({ kind: 'recovery', reason });
    expect(await dump(backend)).toEqual(before);
  });

  it('shows recovery and writes nothing when every record is damaged', async () => {
    await putRaw(backend, 'hot', damage(record('hot', 9)));
    await putRaw(backend, 'checkpoint-0', { nonsense: true });
    const before = await dump(backend);
    expect(await loadSave(backend, CONTENT)).toMatchObject({ kind: 'recovery', reason: 'none-usable' });
    expect(await dump(backend)).toEqual(before);
  });

  it('shows recovery when storage cannot be read', async () => {
    const broken = { ...flaky(backend), readSlots: () => Promise.reject(new Error('cannot open')) };
    expect(await loadSave(broken, CONTENT)).toEqual({ kind: 'recovery', reason: 'unreadable', records: [], detail: 'cannot open' });
  });

  it('shows recovery instead of playing on when the kept copies cannot be made', async () => {
    await putRaw(backend, 'hot', damage(record('hot', 9)));
    await backend.write(record('checkpoint-0', 7));
    const result = await loadSave(flaky(backend, { failQuarantine: true }), CONTENT);
    expect(result).toMatchObject({ kind: 'recovery', reason: 'unreadable' });
  });

  it('uses the database name it is pinned to', async () => {
    await backend.write(record('hot', 1));
    const names = (await indexedDB.databases()).map((info) => info.name);
    expect(names).toEqual([DB_NAME]);
    const db = await backend.handle();
    expect([...db.objectStoreNames].sort()).toEqual(['device', 'diagnostics', 'quarantine', 'slots']);
  });
});

describe('leaving the recovery screen', () => {
  it('sets aside every unusable record and the hot record before anything is replaced', () => {
    const records = [
      classify('hot', record('hot', 9), CONTENT),
      classify('checkpoint-0', suspect('checkpoint-0', 8), CONTENT),
      classify('checkpoint-1', newer('checkpoint-1', 7), CONTENT),
      classify('checkpoint-2', 'junk', CONTENT),
      classify('checkpoint-3', record('checkpoint-3', 5), CONTENT),
    ];
    const copies = copiesBeforeRecovery(records);
    expect(copies.every((copy) => copy.kind === 'kept')).toBe(true);
    expect(copies.map((copy) => `${copy.slot}:${copy.reason}`).sort()).toEqual([
      'checkpoint-0:suspect',
      'checkpoint-1:newer',
      'checkpoint-2:damaged',
      'hot:set-aside',
    ]);
  });

  // The hole the first verifier pass found: storage could not be read at startup, so the recovery screen knew
  // of no records at all, and a choice made from it wrote the hot slot as save 1 over a save 57 it had never
  // seen, with no copy kept. The exit now reads the slots as they are when the choice is made.
  it('reads the slots afresh, so a choice made after an unreadable start cannot overwrite what was never read', async () => {
    const mine = record('hot', 57, game({ profile: { runsStarted: 12 } }));
    await backend.write(mine);
    await backend.write(record('checkpoint-0', 40, game({ profile: { runsStarted: 8 } })));
    const old = record('hot', 20, game({ profile: { runsStarted: 5 } }));
    await backend.addQuarantine([{ slot: 'hot', kind: 'kept', reason: 'replaced-by-import', raw: old }]);

    const exit = await prepareRecoveryExit(backend, CONTENT);
    if (!exit.ok) throw new Error('expected the exit to succeed');
    expect(exit.cursor.nextSeq).toBe(58);
    const kept = await backend.listQuarantine();
    expect(kept.map((entry) => `${entry.slot}:${entry.seq}:${entry.kind}:${entry.reason}`).sort()).toEqual([
      'hot:20:kept:replaced-by-import',
      'hot:57:kept:set-aside',
    ]);
    expect(kept.find((entry) => entry.seq === 57)?.raw).toEqual(mine);

    // Restoring the old save now writes it as the newest record, and the next launch loads it.
    const writer = new SaveWriter({ store: backend, build: BUILD, content: CONTENT, now: () => FIXED_NOW, log: () => undefined }, exit.cursor, null);
    const written = await writer.commit(old.payload);
    expect(written).toMatchObject({ ok: true, record: { seq: 58 } });
    const next = await loadSave(backend, CONTENT);
    expect(next).toMatchObject({ kind: 'ready', record: { seq: 58, payload: { game: { profile: { runsStarted: 5 } } } }, notices: [], rewriteHot: false });
  });

  it('changes nothing when the slots still cannot be read', async () => {
    await backend.write(record('hot', 57));
    const before = await dump(backend);
    const broken = { ...flaky(backend), readSlots: () => Promise.reject(new Error('still cannot open')) };
    expect(await prepareRecoveryExit(broken, CONTENT)).toEqual({ ok: false, detail: 'still cannot open' });
    expect(await dump(backend)).toEqual(before);
  });

  it('changes nothing when the copies cannot be made', async () => {
    await putRaw(backend, 'hot', suspect('hot', 57));
    const before = await dump(backend);
    const result = await prepareRecoveryExit(flaky(backend, { failQuarantine: true }), CONTENT);
    expect(result).toMatchObject({ ok: false });
    expect(await dump(backend)).toEqual(before);
  });
});

describe('quarantine', () => {
  const copy = (seq: number, kind: 'kept' | 'routine') => ({
    slot: 'hot',
    kind,
    reason: kind === 'kept' ? ('damaged' as const) : ('before-migration' as const),
    raw: { ...record('hot', seq), buildId: BUILD.buildId, at: FIXED_NOW, p: payload() },
  });

  it('stores one record once however often it is seen, and says which copies were new', async () => {
    expect(await backend.addQuarantine([copy(1, 'kept')])).toHaveLength(1);
    expect(await backend.addQuarantine([copy(1, 'kept'), copy(1, 'kept')])).toEqual([]);
    expect(await backend.addQuarantine([copy(1, 'kept'), copy(2, 'kept')])).toHaveLength(1);
    expect(await backend.listQuarantine()).toHaveLength(2);
  });

  it('holds only the newest ten routine copies', async () => {
    for (let seq = 1; seq <= 14; seq += 1) await backend.addQuarantine([copy(seq, 'routine')]);
    const held = await backend.listQuarantine();
    expect(held.map((entry) => entry.seq)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  });

  it('never lets a routine copy push out a kept one', async () => {
    await backend.addQuarantine([copy(1, 'kept'), copy(2, 'kept')]);
    for (let seq = 10; seq < 40; seq += 1) await backend.addQuarantine([copy(seq, 'routine')]);
    const held = await backend.listQuarantine();
    expect(held.filter((entry) => entry.kind === 'kept').map((entry) => entry.seq).sort()).toEqual([1, 2]);
    expect(held.filter((entry) => entry.kind === 'routine')).toHaveLength(10);
  });

  it('promotes a routine copy to kept and never demotes a kept one', async () => {
    await backend.addQuarantine([copy(1, 'routine')]);
    await backend.addQuarantine([copy(1, 'kept')]);
    expect((await backend.listQuarantine())[0]).toMatchObject({ kind: 'kept', reason: 'damaged' });
    await backend.addQuarantine([copy(1, 'routine')]);
    expect((await backend.listQuarantine())[0]).toMatchObject({ kind: 'kept' });
  });

  it('keeps two different damaged copies of the same slot and seq apart', async () => {
    const one = { ...record('hot', 3), writtenAt: 1 };
    const two = { ...record('hot', 3), writtenAt: 2 };
    await backend.addQuarantine([
      { slot: 'hot', kind: 'kept', reason: 'damaged', raw: one },
      { slot: 'hot', kind: 'kept', reason: 'damaged', raw: two },
    ]);
    expect(await backend.listQuarantine()).toHaveLength(2);
  });
});
