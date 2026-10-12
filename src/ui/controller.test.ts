import { beforeEach, describe, expect, it } from 'vitest';
import { BUILD, CONTENT, FIXED_NOW, dump, flaky, freshIndexedDb, game, payload, record } from '../../tests/helpers';
import type { Content } from '../engine';
import { LocalBackend, SaveWriter, checkImport, cursorFor } from '../save';
import type { LocalStore, SavePayload } from '../save';
import { GameController } from './controller';

let backend: LocalBackend;

beforeEach(() => {
  freshIndexedDb();
  backend = new LocalBackend();
});

const start = (store: LocalStore = backend, initial: SavePayload = payload(), content: Content = CONTENT): GameController => {
  const writer = new SaveWriter({ store, build: BUILD, content, now: () => FIXED_NOW, log: () => undefined }, cursorFor([]), null);
  return new GameController({ content, writer, build: BUILD, randomSeed: () => 777 }, initial);
};

const stored = async (slot: string): Promise<SavePayload['game'] | undefined> =>
  ((await dump(backend)).slots[slot] as { payload: SavePayload } | undefined)?.payload.game;

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

describe('GameController', () => {
  it('saves before it shows: nobody is told, and the state does not change, until the write has committed', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const store = flaky(backend, { gate });
    const controller = start(store);
    let shown = 0;
    controller.subscribe(() => {
      shown += 1;
    });

    const pending = controller.dispatch({ type: 'Count' });
    await tick();
    expect(store.calls).toEqual(['write:hot:1']);
    expect(shown).toBe(0);
    expect(controller.game.run.counter).toBe(7);

    open();
    const outcome = await pending;
    expect(outcome.kind).toBe('done');
    expect(shown).toBe(1);
    expect(controller.game.run.counter).toBe(8);
    expect((await stored('hot'))?.run.counter).toBe(8);
  });

  it('makes later input wait for a pending write, and applies it to the state that write produced', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const store = flaky(backend, { gate });
    const controller = start(store);
    const first = controller.dispatch({ type: 'Count' });
    const second = controller.dispatch({ type: 'Count' });
    await tick();
    expect(store.calls).toEqual(['write:hot:1']);
    open();
    await Promise.all([first, second]);
    expect(controller.game.run.counter).toBe(9);
    expect(store.calls).toEqual(['write:hot:1', 'committed:hot:1', 'write:hot:2', 'committed:hot:2']);
  });

  it('does not write for a move-only step, then writes it when the page is hidden', async () => {
    const controller = start();
    let shown = 0;
    controller.subscribe(() => {
      shown += 1;
    });
    await controller.dispatch({ type: 'Step' });
    await controller.dispatch({ type: 'Step' });
    expect(controller.game.run.steps).toBe(6);
    expect(controller.dirty).toBe(true);
    expect(shown).toBe(2);
    expect((await dump(backend)).slots).toEqual({});

    await controller.flush();
    expect(controller.dirty).toBe(false);
    expect((await stored('hot'))?.run.steps).toBe(6);
    // Nothing unsaved: a second flush writes nothing.
    const before = await dump(backend);
    await controller.flush();
    expect(await dump(backend)).toEqual(before);
  });

  it('sends an unsaved step out with the next write', async () => {
    const controller = start();
    await controller.dispatch({ type: 'Step' });
    await controller.dispatch({ type: 'Count' });
    expect(controller.dirty).toBe(false);
    expect((await stored('hot'))?.run).toMatchObject({ steps: 5, counter: 8 });
  });

  it('writes a checkpoint, then the hot slot, when a new run is confirmed', async () => {
    const controller = start();
    const outcome = await controller.newRun();
    expect(outcome).toMatchObject({ kind: 'done', checkpoint: 'written' });
    const slots = (await dump(backend)).slots;
    expect(slots['checkpoint-0']).toMatchObject({ seq: 1, payload: { game: { profile: { runsStarted: 4 }, run: { seed: 777, counter: 0 } } } });
    expect(slots['hot']).toMatchObject({ seq: 2, payload: { game: { profile: { runsStarted: 4 } } } });
  });

  it('writes nothing and tells nobody when the engine rejects an action', async () => {
    const controller = start();
    let shown = 0;
    controller.subscribe(() => {
      shown += 1;
    });
    expect(await controller.dispatch({ type: 'Equip', item: 'd02' })).toEqual({ kind: 'rejected', reason: 'not-owned' });
    expect(shown).toBe(0);
    expect((await dump(backend)).slots).toEqual({});
  });

  it('writes a settings change at once', async () => {
    const controller = start();
    await controller.updateApp((app) => ({ ...app, settings: { testToggle: false } }));
    expect(controller.app.settings.testToggle).toBe(false);
    expect(((await dump(backend)).slots['hot'] as { payload: SavePayload }).payload.app.settings.testToggle).toBe(false);
  });

  it('stops on the save-failed notice, with the unsaved game as a text code, when storage fails twice', async () => {
    const controller = start(flaky(backend, { failWrites: 2 }));
    let shown = 0;
    controller.subscribe(() => {
      shown += 1;
    });
    expect(await controller.dispatch({ type: 'Count' })).toEqual({ kind: 'halted' });
    const halt = controller.halt;
    if (halt === null || halt.kind !== 'save-failed') throw new Error('expected the save-failed halt');
    // The game on screen is still the saved one; the code holds what could not be written.
    expect(controller.game.run.counter).toBe(7);
    expect(shown).toBe(1);
    const decoded = checkImport(halt.code, CONTENT);
    expect(decoded.ok && decoded.record.payload.game.run.counter).toBe(8);
    // Play is blocked from here on.
    expect(await controller.dispatch({ type: 'Count' })).toEqual({ kind: 'halted' });
    expect(await controller.flush()).toEqual({ kind: 'halted' });
  });

  it('stops with the last good save as a text code when the state fails its checks', async () => {
    const controller = start();
    await controller.dispatch({ type: 'Count' });
    const before = await dump(backend);
    await controller.updateApp((app) => ({ ...app, exportTracking: { ...app.exportTracking, runsAtLastExport: 0.5 } }));
    const halt = controller.halt;
    if (halt === null || halt.kind !== 'engine-bug' || halt.code === null) throw new Error('expected the engine-bug halt');
    const decoded = checkImport(halt.code, CONTENT);
    expect(decoded.ok && decoded.record.payload.game.run.counter).toBe(8);
    expect(await dump(backend)).toEqual(before);
  });

  describe('replaceWith', () => {
    it('swaps in a record from the same content unchanged', async () => {
      const controller = start();
      await controller.dispatch({ type: 'Count' });
      const incoming = record('hot', 50, game({ profile: { runsStarted: 20 }, run: { target: 'd03' } }));
      const result = await controller.replaceWith(incoming);
      expect(result).toEqual({ outcome: { kind: 'done', events: [], checkpoint: 'none', problems: [] }, repaired: false });
      expect(controller.game).toEqual(incoming.payload.game);
      expect((await backend.listQuarantine()).map((entry) => entry.reason)).toEqual(['replaced-by-import']);
    });

    it('repairs the run of a record written under other content, leaving its profile alone', async () => {
      const smaller: Content = { items: ['d01', 'd02', 'd03'].filter((item) => item !== 'd02') };
      const controller = start(backend, payload(), smaller);
      const incoming = { ...record('hot', 50, game({ profile: { inventory: { d01: 1 }, equipped: 'd01' }, run: { target: 'd02' } })), contentVersion: 'older-content' };
      const result = await controller.replaceWith(incoming);
      expect(result.repaired).toBe(true);
      expect(controller.game.run.target).toBeNull();
      expect(controller.game.profile).toEqual(incoming.payload.game.profile);
      expect((await stored('hot'))?.run.target).toBeNull();
    });
  });
});
