import { beforeEach, describe, expect, it } from 'vitest';
import { BUILD, CONTENT, FIXED_NOW, dump, flaky, freshIndexedDb, game, payload, record } from '../../tests/helpers';
import { LocalBackend } from './backend';
import type { LocalStore } from './backend';
import { classify } from './classify';
import { CHECKPOINT_SLOTS } from './constants';
import { cursorFor, loadSave } from './load';
import { checksumMatches } from './record';
import type { SavePayload } from './schema';
import { SaveWriter } from './writer';

let backend: LocalBackend;
let logged: string[];

beforeEach(() => {
  freshIndexedDb();
  backend = new LocalBackend();
  logged = [];
});

const writer = (store: LocalStore = backend, nextSeq = 1): SaveWriter =>
  new SaveWriter(
    { store, build: BUILD, content: CONTENT, now: () => FIXED_NOW, log: (kind) => logged.push(kind) },
    { ...cursorFor([]), nextSeq },
    null,
  );

const seqs = async (): Promise<Record<string, number>> => {
  const out: Record<string, number> = {};
  for (const { slot, raw } of await backend.readSlots()) out[slot] = (raw as { seq: number }).seq;
  return out;
};

describe('SaveWriter', () => {
  it('writes the hot slot as a sealed record that carries the build and content version', async () => {
    const result = await writer().commit(payload());
    if (!result.ok) throw new Error('write failed');
    expect(result.checkpoint).toBe('none');
    const stored = (await dump(backend)).slots['hot'];
    expect(stored).toEqual(result.record);
    expect(checksumMatches(stored)).toBe(true);
    expect(stored).toMatchObject({ slot: 'hot', seq: 1, saveVersion: 1, buildId: BUILD.buildId, contentVersion: BUILD.contentVersion, writtenAt: FIXED_NOW });
  });

  it('raises seq by one on every write', async () => {
    const w = writer(backend, 41);
    await w.commit(payload());
    await w.commit(payload());
    const third = await w.commit(payload(), { checkpoint: true });
    if (!third.ok) throw new Error('write failed');
    // Checkpoint first (43), then the hot slot (44): the hot slot is always the newest.
    expect(await seqs()).toEqual({ 'checkpoint-0': 43, hot: 44 });
  });

  it('rotates five checkpoints, always replacing the one with the lowest seq', async () => {
    const w = writer();
    for (let run = 0; run < 8; run += 1) await w.commit(payload(game({ profile: { runsStarted: run + 1 } })), { checkpoint: true });
    const held = await seqs();
    expect(Object.keys(held).sort()).toEqual([...CHECKPOINT_SLOTS, 'hot'].sort());
    // Sixteen writes: checkpoints took the odd seqs. The five newest checkpoints survive.
    expect(CHECKPOINT_SLOTS.map((slot) => held[slot]).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([7, 9, 11, 13, 15]);
    expect(held['hot']).toBe(16);
  });

  it('carries on the rotation from what was loaded', async () => {
    await backend.write(record('checkpoint-0', 30));
    await backend.write(record('checkpoint-1', 10));
    await backend.write(record('checkpoint-2', 20));
    await backend.write(record('checkpoint-3', 40));
    await backend.write(record('checkpoint-4', 50));
    await backend.write(record('hot', 51));
    const loaded = await loadSave(backend, CONTENT);
    if (loaded.kind !== 'ready') throw new Error('expected ready');
    const w = new SaveWriter({ store: backend, build: BUILD, content: CONTENT, now: () => FIXED_NOW, log: () => undefined }, loaded.cursor, loaded.record);
    await w.commit(payload(), { checkpoint: true });
    expect(await seqs()).toMatchObject({ 'checkpoint-1': 52, hot: 53, 'checkpoint-2': 20 });
  });

  it('skips the checkpoint, but still writes the hot slot, when an invariant fails', async () => {
    const broken = payload(game({ profile: { equipped: 'd02' } }));
    const result = await writer().commit(broken, { checkpoint: true });
    if (!result.ok) throw new Error('write failed');
    expect(result.checkpoint).toBe('skipped');
    expect(result.problems.join(' ')).toContain('d02');
    expect(Object.keys(await seqs())).toEqual(['hot']);
    expect(logged).toContain('checkpoint-skipped');
    // Loading treats that hot record the same way: suspect, never silently dropped.
    expect(classify('hot', (await dump(backend)).slots['hot'], CONTENT).kind).toBe('suspect');
  });

  it.each([
    ['a fraction where a whole number belongs', (p: SavePayload) => ({ ...p, game: { ...p.game, run: { ...p.game.run, counter: 1.5 } } })],
    ['a number past the exact range', (p: SavePayload) => ({ ...p, game: { ...p.game, run: { ...p.game.run, counter: 2 ** 60 } } })],
    ['not-a-number', (p: SavePayload) => ({ ...p, game: { ...p.game, run: { ...p.game.run, counter: Number.NaN } } })],
    ['an unknown field', (p: SavePayload) => ({ ...p, game: { ...p.game, run: { ...p.game.run, extra: 1 } } })],
  ])('refuses to write a state with %s over the good hot slot', async (_name, breakIt) => {
    const w = writer();
    const good = await w.commit(payload());
    if (!good.ok) throw new Error('write failed');
    const before = await dump(backend);
    const bad = await w.commit(breakIt(payload()) as SavePayload, { checkpoint: true });
    expect(bad).toMatchObject({ ok: false, reason: 'invalid-state' });
    if (!bad.ok && bad.reason === 'invalid-state') expect(bad.lastGood).toEqual(good.record);
    expect(await dump(backend)).toEqual(before);
    expect(logged).toContain('invalid-state');
  });

  it('retries a failed write once, on a fresh connection', async () => {
    const store = flaky(backend, { failWrites: 1 });
    const result = await writer(store).commit(payload());
    expect(result.ok).toBe(true);
    expect(store.calls).toEqual(['write:hot:1', 'reconnect', 'write:hot:1', 'committed:hot:1']);
    expect(logged).toEqual(['save-retry']);
    expect((await seqs())['hot']).toBe(1);
  });

  it('reports the unsaved state when the write fails twice, and leaves the old hot slot in place', async () => {
    await backend.write(record('hot', 4));
    const before = await dump(backend);
    const store = flaky(backend, { failWrites: 2 });
    const changed = payload(game({ run: { counter: 999 } }));
    const result = await writer(store, 5).commit(changed);
    expect(result).toMatchObject({ ok: false, reason: 'storage' });
    if (!result.ok && result.reason === 'storage') {
      expect(result.unsaved.payload.game.run.counter).toBe(999);
      expect(checksumMatches(result.unsaved)).toBe(true);
    }
    expect(logged).toEqual(['save-retry', 'save-failed']);
    expect(await dump(backend)).toEqual(before);
  });

  it('handles writes one at a time, in the order they were asked for', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const store = flaky(backend, { gate });
    const w = writer(store);
    const first = w.commit(payload(game({ run: { counter: 1 } })));
    const second = w.commit(payload(game({ run: { counter: 2 } })));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The second write has not even started while the first is uncommitted.
    expect(store.calls).toEqual(['write:hot:1']);
    open();
    await Promise.all([first, second]);
    expect(store.calls).toEqual(['write:hot:1', 'committed:hot:1', 'write:hot:2', 'committed:hot:2']);
    expect(((await dump(backend)).slots['hot'] as { payload: SavePayload }).payload.game.run.counter).toBe(2);
  });

  it('keeps working after a failed write', async () => {
    const store = flaky(backend, { failWrites: 2 });
    const w = writer(store);
    expect((await w.commit(payload())).ok).toBe(false);
    const again = await w.commit(payload());
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.record.seq).toBe(2);
  });

  describe('replaceWith (import and restore)', () => {
    it('sets the current game aside, copies it to a checkpoint, then writes the incoming one as the newest', async () => {
      const w = writer();
      const mine = await w.commit(payload(game({ profile: { runsStarted: 12 } })));
      if (!mine.ok) throw new Error('write failed');
      const incoming = payload(game({ profile: { runsStarted: 2 } }));
      const result = await w.replaceWith(incoming);
      if (!result.ok) throw new Error('replace failed');
      const after = await dump(backend);
      expect(after.quarantine).toMatchObject([{ kind: 'kept', reason: 'replaced-by-import', slot: 'hot', seq: 1, raw: mine.record }]);
      expect(after.slots['checkpoint-0']).toMatchObject({ seq: 2, payload: { game: { profile: { runsStarted: 12 } } } });
      expect(after.slots['hot']).toMatchObject({ seq: 3, payload: { game: { profile: { runsStarted: 2 } } } });
      expect(w.lastGood).toEqual(result.record);
    });

    it('replaces nothing when the current game cannot be set aside first', async () => {
      const store = flaky(backend, { failQuarantine: true });
      const w = writer(store);
      await w.commit(payload(game({ profile: { runsStarted: 12 } })));
      const before = await dump(backend);
      const result = await w.replaceWith(payload(game({ profile: { runsStarted: 2 } })));
      expect(result).toMatchObject({ ok: false, reason: 'storage' });
      expect(await dump(backend)).toEqual(before);
    });
  });
});
