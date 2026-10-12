// The loop between input and storage (ARCHITECTURE 7.2 and 8), in the sample world: what is written, when, and
// that nobody is shown a result before it is committed.

import { beforeEach, describe, expect, it } from 'vitest';
import { BUILD, CONTENT, FIXED_NOW, dump, flaky, freshIndexedDb, game, gameAtRun, payload, record } from '../../tests/helpers';
import type { Action, Content, GameState } from '../engine';
import { LocalBackend, RUN_LOG_LIMIT, SaveWriter, checkImport, cursorFor } from '../save';
import type { AppState, LocalStore, RunLogEntry, SavePayload, SlotRecord } from '../save';
import { GameController } from './controller';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
/** A gap between two actions longer than this is the player being away (the controller's idle cap). */
const IDLE_CAP = 60 * SECOND;

let backend: LocalBackend;
/** The controller's clock. A test moves it by hand; nothing here reads the real time. */
let clock: number;

beforeEach(() => {
  freshIndexedDb();
  backend = new LocalBackend();
  clock = FIXED_NOW;
});

const start = (store: LocalStore = backend, initial: SavePayload = payload(), content: Content = CONTENT): GameController => {
  const writer = new SaveWriter({ store, build: BUILD, content, now: () => clock, log: () => undefined }, cursorFor([]), null);
  return new GameController({ content, writer, build: BUILD, randomSeed: () => 777, now: () => clock }, initial);
};

const storedRecord = async (slot: string): Promise<SlotRecord | undefined> => (await dump(backend)).slots[slot] as SlotRecord | undefined;
const stored = async (slot: string): Promise<GameState | undefined> => (await storedRecord(slot))?.payload.game;
const storedApp = async (slot: string): Promise<AppState | undefined> => (await storedRecord(slot))?.payload.app;

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

/** A gate that every write waits behind until it is opened. */
const gated = (): { store: ReturnType<typeof flaky>; open: () => void } => {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { store: flaky(backend, { gate }), open };
};

const counted = (controller: GameController): { shown: () => number } => {
  let shown = 0;
  controller.subscribe(() => {
    shown += 1;
  });
  return { shown: () => shown };
};

// The sample game stands at 2,2 beside two enemies, with two stat points unspent and three hints already seen.
const FIGHT: Action = { type: 'Fight', spawn: 's001' };
const HINT: Action = { type: 'MarkHintShown', hint: 'gear' };
const SPEND_ONE: Action = { type: 'Allocate', points: { life: 0, damage: 1, defense: 0, dexterity: 0, luck: 0 } };
const WEST: Action = { type: 'Step', dx: -1, dy: 0 };
const EAST: Action = { type: 'Step', dx: 1, dy: 0 };

describe('GameController', () => {
  describe('save before show', () => {
    it('tells nobody, and does not change the state, until the write has committed', async () => {
      const { store, open } = gated();
      const controller = start(store);
      // What storage had been asked and had answered at the moment each listener was told.
      const toldAfter: string[][] = [];
      controller.subscribe(() => toldAfter.push([...store.calls]));

      const pending = controller.dispatch(FIGHT);
      await tick();
      expect(store.calls).toEqual(['write:hot:1']);
      expect(toldAfter).toEqual([]);
      expect(controller.game.run.battleCount).toBe(5);
      expect(controller.lastSaved).toBeNull();
      expect((await dump(backend)).slots).toEqual({});

      open();
      const outcome = await pending;
      if (outcome.kind !== 'done') throw new Error(`expected the fight to be done, not ${outcome.kind}`);
      expect(outcome.events[0]?.type).toBe('Battle');
      // Told once, and only after the commit.
      expect(toldAfter).toEqual([['write:hot:1', 'committed:hot:1']]);
      expect(controller.game.run.battleCount).toBe(6);
      expect((await stored('hot'))?.run.battleCount).toBe(6);
      expect(await stored('hot')).toEqual(controller.game);
      expect(controller.lastSaved?.seq).toBe(1);
    });

    it('handles actions one at a time: later input waits for a pending write, and is applied to the state that write produced', async () => {
      const { store, open } = gated();
      const controller = start(store);
      const first = controller.dispatch(SPEND_ONE);
      const second = controller.dispatch(SPEND_ONE);
      // Two points were unspent, so a third is refused, but only because the first two are in by then.
      const third = controller.dispatch(SPEND_ONE);
      await tick();
      expect(store.calls).toEqual(['write:hot:1']);
      expect(controller.game.run.pointsSpent.damage).toBe(6);

      open();
      expect(await Promise.all([first, second, third])).toMatchObject([{ kind: 'done' }, { kind: 'done' }, { kind: 'rejected', reason: 'bad-points' }]);
      expect(controller.game.run.pointsSpent.damage).toBe(8);
      expect(store.calls).toEqual(['write:hot:1', 'committed:hot:1', 'write:hot:2', 'committed:hot:2']);
      expect((await stored('hot'))?.run.pointsSpent.damage).toBe(8);
    });
  });

  describe('a step', () => {
    it('that only moves the hero is not written at once, then is written when the page is hidden', async () => {
      const controller = start();
      const listener = counted(controller);
      expect(await controller.dispatch(WEST)).toMatchObject({ kind: 'done', events: [{ type: 'Moved', to: { zone: 'z01', x: 1, y: 2 } }], checkpoint: 'none' });
      expect(await controller.dispatch({ type: 'Step', dx: 0, dy: -1 })).toMatchObject({ kind: 'done' });
      expect(controller.game.run.position).toEqual({ zone: 'z01', x: 1, y: 1 });
      expect(controller.dirty).toBe(true);
      // The move is shown at once: there is nothing to wait for.
      expect(listener.shown()).toBe(2);
      expect((await dump(backend)).slots).toEqual({});

      expect(await controller.flush()).toMatchObject({ kind: 'done' });
      expect(controller.dirty).toBe(false);
      expect((await stored('hot'))?.run.position).toEqual({ zone: 'z01', x: 1, y: 1 });
      expect((await storedRecord('hot'))?.seq).toBe(1);
      // Nothing unsaved: a second flush writes nothing.
      const before = await dump(backend);
      await controller.flush();
      expect(await dump(backend)).toEqual(before);
    });

    it('that only moves goes out with the next write', async () => {
      const controller = start();
      await controller.dispatch(WEST);
      expect((await dump(backend)).slots).toEqual({});
      await controller.dispatch(HINT);
      expect(controller.dirty).toBe(false);
      expect(await stored('hot')).toMatchObject({ run: { position: { zone: 'z01', x: 1, y: 2 } }, profile: { hintsShown: ['map', 'prefight', 'hero', 'gear'] } });
      // It went out with that write: there is nothing left for a flush to do.
      const before = await dump(backend);
      await controller.flush();
      expect(await dump(backend)).toEqual(before);
    });

    it('through an exit into the next zone is still only a move', async () => {
      const controller = start(backend, payload(game({ run: { position: { zone: 'z01', x: 6, y: 2 } } })));
      const outcome = await controller.dispatch(EAST);
      expect(outcome).toMatchObject({ kind: 'done', events: [{ type: 'Moved' }, { type: 'ZoneEntered', zone: 'z02' }] });
      expect(controller.game.run.position).toEqual({ zone: 'z02', x: 1, y: 1 });
      expect(controller.dirty).toBe(true);
      expect((await dump(backend)).slots).toEqual({});
    });

    it('that finds a hidden tile is written at once', async () => {
      // One tile west of the hidden one, which nobody has found yet.
      const unfound = game({ profile: { secretsFound: ['x02'] }, run: { position: { zone: 'z01', x: 3, y: 5 } } });
      const store = flaky(backend);
      const controller = start(store, payload(unfound));
      const outcome = await controller.dispatch(EAST);
      expect(outcome).toMatchObject({ kind: 'done', events: [{ type: 'Moved' }, { type: 'SecretFound', secret: 'x01' }] });
      expect(store.calls).toEqual(['write:hot:1', 'committed:hot:1']);
      expect(controller.dirty).toBe(false);
      expect(await stored('hot')).toMatchObject({ profile: { secretsFound: ['x02', 'x01'] }, run: { position: { zone: 'z01', x: 4, y: 5 } } });
    });

    it('onto a tile already found is only a move again', async () => {
      const controller = start(backend, payload(game({ run: { position: { zone: 'z01', x: 3, y: 5 } } })));
      expect(await controller.dispatch(EAST)).toMatchObject({ kind: 'done', events: [{ type: 'Moved' }] });
      expect(controller.dirty).toBe(true);
      expect((await dump(backend)).slots).toEqual({});
    });
  });

  describe('a new run', () => {
    it('writes a checkpoint, then the hot slot', async () => {
      const store = flaky(backend);
      const controller = start(store);
      const outcome = await controller.newRun();
      expect(outcome).toMatchObject({ kind: 'done', checkpoint: 'written', events: [{ type: 'RunStarted', run: 4 }] });
      expect(store.calls).toEqual(['write:checkpoint-0:1', 'committed:checkpoint-0:1', 'write:hot:2', 'committed:hot:2']);
      const slots = (await dump(backend)).slots;
      expect(Object.keys(slots).sort()).toEqual(['checkpoint-0', 'hot']);
      const fresh = { profile: { counters: { runsStarted: 4 } }, run: { seed: 777, battleCount: 0, xp: 0, gold: 0, energySpent: 0, position: CONTENT.start } };
      expect(slots['checkpoint-0']).toMatchObject({ seq: 1, payload: { game: fresh } });
      expect(slots['hot']).toMatchObject({ seq: 2, payload: { game: fresh } });
      expect(controller.game.profile.counters.runsStarted).toBe(4);
    });

    it('tells nobody until both writes have committed', async () => {
      const { store, open } = gated();
      const controller = start(store);
      const toldAfter: string[][] = [];
      controller.subscribe(() => toldAfter.push([...store.calls]));
      const pending = controller.newRun();
      await tick();
      expect(toldAfter).toEqual([]);
      expect(controller.game.profile.counters.runsStarted).toBe(3);
      open();
      await pending;
      expect(toldAfter).toEqual([['write:checkpoint-0:1', 'committed:checkpoint-0:1', 'write:hot:2', 'committed:hot:2']]);
    });

    it('files the finished run in the run-duration log and starts timing the next', async () => {
      const controller = start();
      const before = controller.app;
      clock += 20 * SECOND;
      await controller.newRun();

      const entry: RunLogEntry = {
        // The run that ended, with what it reached: the sample game is in its third run, at level 4.
        run: 3,
        startedAt: before.runTiming.startedAt,
        endedAt: FIXED_NOW + 20 * SECOND,
        activeMs: before.runTiming.activeMs + 20 * SECOND,
        wins: 3,
        losses: 2,
        level: 4,
        strongest: 4,
      };
      expect(controller.app.runLog).toEqual([...before.runLog, entry]);
      expect(controller.app.runTiming).toEqual({ startedAt: FIXED_NOW + 20 * SECOND, activeMs: 0 });
      // Both records hold it, and nothing else in the app half moved.
      expect(await storedApp('hot')).toEqual({ ...before, runLog: [...before.runLog, entry], runTiming: { startedAt: FIXED_NOW + 20 * SECOND, activeMs: 0 } });
      expect(await storedApp('checkpoint-0')).toEqual(await storedApp('hot'));
    });

    it('appends one entry per run, each timed from its own start', async () => {
      const controller = start();
      await controller.newRun();
      clock += 5 * SECOND;
      await controller.dispatch(HINT);
      clock += 7 * SECOND;
      await controller.newRun();
      const log = controller.app.runLog;
      expect(log.map((entry) => entry.run)).toEqual([1, 2, 3, 4]);
      expect(log[3]).toEqual({ run: 4, startedAt: FIXED_NOW, endedAt: FIXED_NOW + 12 * SECOND, activeMs: 12 * SECOND, wins: 0, losses: 0, level: 1, strongest: 0 });
      expect(controller.game.profile.counters.runsStarted).toBe(5);
    });

    it('keeps at most RUN_LOG_LIMIT entries, dropping the oldest', async () => {
      const full = payload(gameAtRun(RUN_LOG_LIMIT + 1));
      const logged = (run: number): RunLogEntry => ({ run, startedAt: FIXED_NOW - MINUTE, endedAt: FIXED_NOW, activeMs: 30 * SECOND, wins: run, losses: 0, level: 2, strongest: 2 });
      const entries: RunLogEntry[] = [];
      for (let run = 1; run <= RUN_LOG_LIMIT; run += 1) entries.push(logged(run));
      const controller = start(backend, { game: full.game, app: { ...full.app, runLog: entries } });

      await controller.newRun();
      expect(controller.app.runLog).toHaveLength(RUN_LOG_LIMIT);
      expect(controller.app.runLog[0]).toEqual(logged(2));
      expect(controller.app.runLog[RUN_LOG_LIMIT - 1]).toMatchObject({ run: RUN_LOG_LIMIT + 1, wins: 3, losses: 2 });
      expect((await storedApp('hot'))?.runLog).toHaveLength(RUN_LOG_LIMIT);

      await controller.newRun();
      expect(controller.app.runLog).toHaveLength(RUN_LOG_LIMIT);
      expect(controller.app.runLog.map((entry) => entry.run).slice(0, 2)).toEqual([3, 4]);
      expect(controller.app.runLog[RUN_LOG_LIMIT - 1]?.run).toBe(RUN_LOG_LIMIT + 2);
    });

    it('fills the log up to the limit before it drops anything', async () => {
      const base = payload();
      const entries: RunLogEntry[] = [];
      for (let run = 1; run < RUN_LOG_LIMIT; run += 1) entries.push({ run, startedAt: 0, endedAt: 1, activeMs: 1, wins: 0, losses: 0, level: 1, strongest: 0 });
      const controller = start(backend, { game: base.game, app: { ...base.app, runLog: entries } });
      await controller.newRun();
      expect(controller.app.runLog).toHaveLength(RUN_LOG_LIMIT);
      expect(controller.app.runLog[0]?.run).toBe(1);
    });
  });

  describe('run timing', () => {
    const activeMs = (controller: GameController): number => controller.app.runTiming.activeMs;

    it('adds the time between actions to the run in progress', async () => {
      const controller = start();
      const base = activeMs(controller);
      clock += 10 * SECOND;
      await controller.dispatch(HINT);
      expect(activeMs(controller)).toBe(base + 10 * SECOND);
      expect((await storedApp('hot'))?.runTiming).toEqual({ startedAt: controller.app.runTiming.startedAt, activeMs: base + 10 * SECOND });

      // A walk counts as play too, and its time goes out with the next write.
      clock += 5 * SECOND;
      await controller.dispatch(WEST);
      expect(activeMs(controller)).toBe(base + 15 * SECOND);
      clock += 2 * SECOND;
      await controller.dispatch(SPEND_ONE);
      expect(activeMs(controller)).toBe(base + 17 * SECOND);
      expect((await storedApp('hot'))?.runTiming.activeMs).toBe(base + 17 * SECOND);
    });

    it('counts a gap longer than the idle cap only up to the cap', async () => {
      const controller = start();
      const base = activeMs(controller);
      clock += 5 * MINUTE;
      await controller.dispatch(HINT);
      expect(activeMs(controller)).toBe(base + IDLE_CAP);
      // Exactly the cap, and just under it, both count in full.
      clock += IDLE_CAP;
      await controller.dispatch(SPEND_ONE);
      expect(activeMs(controller)).toBe(base + 2 * IDLE_CAP);
      clock += IDLE_CAP - 1;
      await controller.dispatch(SPEND_ONE);
      expect(activeMs(controller)).toBe(base + 3 * IDLE_CAP - 1);
    });

    it('drops the time the player was away when the app comes back', async () => {
      const controller = start();
      const base = activeMs(controller);
      clock += 30 * SECOND;
      controller.resume();
      clock += 2 * SECOND;
      await controller.dispatch(HINT);
      expect(activeMs(controller)).toBe(base + 2 * SECOND);
    });

    it('never counts backwards when the clock is set back', async () => {
      const controller = start();
      const base = activeMs(controller);
      clock -= 10 * MINUTE;
      await controller.dispatch(HINT);
      expect(activeMs(controller)).toBe(base);
      clock += 3 * SECOND;
      await controller.dispatch(SPEND_ONE);
      expect(activeMs(controller)).toBe(base + 3 * SECOND);
    });

    it('changes nothing else in the app half', async () => {
      const controller = start();
      const before = controller.app;
      clock += 4 * SECOND;
      await controller.dispatch(HINT);
      expect(controller.app).toEqual({ ...before, runTiming: { ...before.runTiming, activeMs: before.runTiming.activeMs + 4 * SECOND } });
    });
  });

  it('writes nothing, changes nothing and tells nobody when the engine rejects an action', async () => {
    const store = flaky(backend);
    const controller = start(store);
    const listener = counted(controller);
    const before = { game: controller.game, app: controller.app };
    clock += 9 * SECOND;
    // An item that is not owned; a step onto an enemy's tile; a fight with an enemy that is not beside the hero.
    expect(await controller.dispatch({ type: 'Equip', loadout: 0, slot: 'head', item: 'i008' })).toEqual({ kind: 'rejected', reason: 'not-owned' });
    expect(await controller.dispatch({ type: 'Step', dx: 1, dy: 1 })).toEqual({ kind: 'rejected', reason: 'blocked' });
    expect(await controller.dispatch({ type: 'Fight', spawn: 's004' })).toEqual({ kind: 'rejected', reason: 'not-adjacent' });
    expect(listener.shown()).toBe(0);
    expect(controller.game).toBe(before.game);
    expect(controller.app).toBe(before.app);
    expect(controller.dirty).toBe(false);
    expect(controller.halt).toBeNull();
    expect(store.calls).toEqual([]);
    expect((await dump(backend)).slots).toEqual({});
  });

  describe('updateApp', () => {
    it('writes a settings change at once', async () => {
      const controller = start();
      const listener = counted(controller);
      const outcome = await controller.updateApp((app) => ({ ...app, settings: { ...app.settings, skipPlayback: false, playbackSpeed: 4 } }));
      expect(outcome).toEqual({ kind: 'done', events: [], checkpoint: 'none', problems: [] });
      expect(controller.app.settings).toEqual({ playbackSpeed: 4, skipPlayback: false, tapToMove: true, dragToSteer: false });
      expect((await storedApp('hot'))?.settings).toEqual({ playbackSpeed: 4, skipPlayback: false, tapToMove: true, dragToSteer: false });
      expect(listener.shown()).toBe(1);
      // The game half is written with it, untouched.
      expect(await stored('hot')).toEqual(game());
    });

    it('takes an unsaved move out with it', async () => {
      const controller = start();
      await controller.dispatch(WEST);
      await controller.updateApp((app) => ({ ...app, settings: { ...app.settings, dragToSteer: true } }));
      expect(controller.dirty).toBe(false);
      expect((await stored('hot'))?.run.position).toEqual({ zone: 'z01', x: 1, y: 2 });
    });

    it('waits its turn behind a pending write', async () => {
      const { store, open } = gated();
      const controller = start(store);
      const action = controller.dispatch(HINT);
      const setting = controller.updateApp((app) => ({ ...app, settings: { ...app.settings, tapToMove: false } }));
      await tick();
      expect(store.calls).toEqual(['write:hot:1']);
      expect(controller.app.settings.tapToMove).toBe(true);
      open();
      await Promise.all([action, setting]);
      expect(store.calls).toEqual(['write:hot:1', 'committed:hot:1', 'write:hot:2', 'committed:hot:2']);
      // The setting was written on top of the action, not in place of it.
      expect(await storedRecord('hot')).toMatchObject({ seq: 2, payload: { game: { profile: { hintsShown: ['map', 'prefight', 'hero', 'gear'] } }, app: { settings: { tapToMove: false } } } });
    });
  });

  describe('a halt', () => {
    /** Every way in is shut once the controller has stopped. */
    const expectShut = async (controller: GameController): Promise<void> => {
      expect(await controller.dispatch(HINT)).toEqual({ kind: 'halted' });
      expect(await controller.dispatch(WEST)).toEqual({ kind: 'halted' });
      expect(await controller.newRun()).toEqual({ kind: 'halted' });
      expect(await controller.flush()).toEqual({ kind: 'halted' });
      expect(await controller.updateApp((app) => app)).toEqual({ kind: 'halted' });
      expect(await controller.replaceWith(record('hot', 50, gameAtRun(20)))).toEqual({ outcome: { kind: 'halted' }, repaired: false });
    };

    it('when storage fails twice stops play, with the unsaved game as a text code', async () => {
      const store = flaky(backend, { failWrites: 2 });
      const controller = start(store);
      const listener = counted(controller);
      const before = controller.game;
      expect(await controller.dispatch(HINT)).toEqual({ kind: 'halted' });
      expect(store.calls).toEqual(['write:hot:1', 'reconnect', 'write:hot:1']);
      const halt = controller.halt;
      if (halt === null || halt.kind !== 'save-failed') throw new Error('expected the save-failed halt');
      // The game on screen is still the saved one; the code holds what could not be written.
      expect(controller.game).toBe(before);
      expect(listener.shown()).toBe(1);
      const decoded = checkImport(halt.code, CONTENT);
      if (!decoded.ok) throw new Error(`the text code does not import: ${decoded.reason}`);
      expect(decoded.record.payload.game.profile.hintsShown).toEqual(['map', 'prefight', 'hero', 'gear']);
      expect(decoded.problems).toEqual([]);

      // Play is blocked from here on, and storage is left alone even though it would now take a write.
      await expectShut(controller);
      expect(controller.game).toBe(before);
      expect(listener.shown()).toBe(1);
      expect(store.calls).toEqual(['write:hot:1', 'reconnect', 'write:hot:1']);
      expect((await dump(backend)).slots).toEqual({});
    });

    it('when storage fails once is not a halt: the retry on a fresh connection saves it', async () => {
      const store = flaky(backend, { failWrites: 1 });
      const controller = start(store);
      expect(await controller.dispatch(HINT)).toMatchObject({ kind: 'done' });
      expect(controller.halt).toBeNull();
      expect(store.calls).toEqual(['write:hot:1', 'reconnect', 'write:hot:1', 'committed:hot:1']);
      expect((await stored('hot'))?.profile.hintsShown).toContain('gear');
    });

    it('when the state fails its checks stops play, with the last good save as a text code', async () => {
      const controller = start();
      await controller.dispatch(HINT);
      const before = await dump(backend);
      const listener = counted(controller);
      // Half a run is not a whole number: the state fails the save schema, as an engine bug would make it.
      expect(await controller.updateApp((app) => ({ ...app, exportTracking: { ...app.exportTracking, runsAtLastExport: 0.5 } }))).toEqual({ kind: 'halted' });
      const halt = controller.halt;
      if (halt === null || halt.kind !== 'engine-bug' || halt.code === null) throw new Error('expected the engine-bug halt with a text code');
      const decoded = checkImport(halt.code, CONTENT);
      if (!decoded.ok) throw new Error(`the text code does not import: ${decoded.reason}`);
      // The code is the record in the hot slot, which the bad state was not written over.
      expect(decoded.record).toEqual(before.slots['hot']);
      expect(controller.app.exportTracking.runsAtLastExport).toBe(0);
      expect(listener.shown()).toBe(1);

      await expectShut(controller);
      expect(await dump(backend)).toEqual(before);
    });

    it('when the state fails its checks before anything was saved says there is no earlier save', async () => {
      const controller = start();
      expect(await controller.updateApp((app) => ({ ...app, runTiming: { ...app.runTiming, activeMs: 1.5 } }))).toEqual({ kind: 'halted' });
      expect(controller.halt).toMatchObject({ kind: 'engine-bug', code: null });
      await expectShut(controller);
      expect((await dump(backend)).slots).toEqual({});
    });

    it('from a failed flush keeps the unsaved position in the text code', async () => {
      const controller = start(flaky(backend, { failWrites: 2 }));
      await controller.dispatch(WEST);
      expect(await controller.flush()).toEqual({ kind: 'halted' });
      const halt = controller.halt;
      if (halt === null || halt.kind !== 'save-failed') throw new Error('expected the save-failed halt');
      const decoded = checkImport(halt.code, CONTENT);
      expect(decoded.ok && decoded.record.payload.game.run.position).toEqual({ zone: 'z01', x: 1, y: 2 });
    });
  });

  describe('replaceWith', () => {
    it('sets the current game aside, then swaps in a record that fits this content unchanged', async () => {
      const controller = start();
      await controller.dispatch(HINT);
      const current = await storedRecord('hot');
      const listener = counted(controller);
      const incoming = record('hot', 50, gameAtRun(20));

      const result = await controller.replaceWith(incoming);
      expect(result).toEqual({ outcome: { kind: 'done', events: [], checkpoint: 'none', problems: [] }, repaired: false });
      expect(controller.game).toEqual(incoming.payload.game);
      expect(controller.app).toEqual(incoming.payload.app);
      expect(listener.shown()).toBe(1);

      // The game that was replaced is kept twice over: as a set-aside copy and in a checkpoint.
      const after = await dump(backend);
      expect(await backend.listQuarantine()).toMatchObject([{ kind: 'kept', reason: 'replaced-by-import', slot: 'hot', seq: 1, raw: current }]);
      expect(after.slots['checkpoint-0']).toMatchObject({ seq: 2, payload: current?.payload });
      // The incoming game is written by this build, with the next seq, not the one it arrived with.
      expect(after.slots['hot']).toMatchObject({ seq: 3, buildId: BUILD.buildId, payload: incoming.payload });
      expect(controller.lastSaved?.seq).toBe(3);
    });

    it('repairs the run of a record that does not fit this content, says so, and leaves its profile alone', async () => {
      const controller = start();
      await controller.dispatch(HINT);
      // A position no map has, and a boss win and a mark that name things this content lacks.
      const lost = game({ run: { position: { zone: 'z01', x: -1, y: -1 }, bossesBeaten: ['e999'], marks: { s999: { stat: 'gold', percent: 100 } } } });
      const incoming = { ...record('hot', 50, lost), contentVersion: 'older-content' };

      const result = await controller.replaceWith(incoming);
      expect(result).toEqual({ outcome: { kind: 'done', events: [], checkpoint: 'none', problems: [] }, repaired: true });
      expect(controller.game.run.position).toEqual(CONTENT.start);
      expect(controller.game.run.bossesBeaten).toEqual([]);
      expect(controller.game.run.marks).toEqual({});
      // The rest of the run and the whole profile are as they arrived.
      expect(controller.game.profile).toEqual(incoming.payload.game.profile);
      expect(controller.game.run).toEqual({ ...incoming.payload.game.run, position: CONTENT.start, bossesBeaten: [], marks: {} });
      expect(await stored('hot')).toEqual(controller.game);
      expect((await storedRecord('hot'))?.contentVersion).toBe(BUILD.contentVersion);
    });

    it('repairs a record even when it claims to be from this content', async () => {
      const controller = start();
      const incoming = record('hot', 50, game({ run: { position: { zone: 'z09', x: 3, y: 3 } } }));
      expect((await controller.replaceWith(incoming)).repaired).toBe(true);
      expect(controller.game.run.position).toEqual(CONTENT.start);
    });

    it('with no save of its own yet has nothing to set aside, and still takes the record', async () => {
      const controller = start();
      const incoming = record('hot', 50, gameAtRun(20));
      expect((await controller.replaceWith(incoming)).outcome).toMatchObject({ kind: 'done' });
      expect(await backend.listQuarantine()).toEqual([]);
      expect(Object.keys((await dump(backend)).slots)).toEqual(['hot']);
      expect(await stored('hot')).toEqual(incoming.payload.game);
    });

    it('does not replace the game when the current one cannot be set aside first', async () => {
      const store = flaky(backend, { failQuarantine: true });
      const controller = start(store);
      await controller.dispatch(HINT);
      const before = await dump(backend);
      const kept = controller.game;

      const result = await controller.replaceWith(record('hot', 50, gameAtRun(20)));
      expect(result).toEqual({ outcome: { kind: 'halted' }, repaired: false });
      expect(controller.game).toBe(kept);
      expect(controller.halt).toMatchObject({ kind: 'save-failed' });
      expect(await dump(backend)).toEqual(before);
    });

    it('starts the run timer from the moment of the swap, not from the last action before it', async () => {
      const controller = start();
      const incoming = record('hot', 50, gameAtRun(20));
      clock += 45 * SECOND;
      await controller.replaceWith(incoming);
      clock += 3 * SECOND;
      await controller.dispatch(HINT);
      expect(controller.app.runTiming.activeMs).toBe(incoming.payload.app.runTiming.activeMs + 3 * SECOND);
    });
  });
});
