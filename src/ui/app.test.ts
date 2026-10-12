// The app's wiring, driven through the real `startApp` with a stand-in DOM, a fake IndexedDB and the content
// that ships. These tests exist because the first verifier pass lost a save through this wiring while every
// function underneath it was correct: the recovery screen acted on what it had read at startup, which after an
// unreadable start was nothing.
//
// Spoilers: the real content's names are sealed. Everything here is found by structure and named by ID, and
// what is on screen is only ever checked as a yes or a no, so a failure cannot print a screen that holds a name.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeCanvas, installFakeDom } from '../../tests/fake-dom';
import type { FakeDom, FakePoint } from '../../tests/fake-dom';
import { BUILD, FIXED_NOW, dump, freshIndexedDb, putRaw, recordV1 } from '../../tests/helpers';
import { loadBundledContent } from '../content';
import { STAT_KEYS, emptyLoadout, findPath, loadoutPrice, newGame, remainingEnergy, shopPrice, tileKey, unspentPoints, xpForLevel } from '../engine';
import type { Action, Content, GameState, ItemDef, Point, Position, SlotId, SpawnId, StatKey, StatPoints } from '../engine';
import { LocalBackend, SAVE_VERSION, checkImport, newAppState, sealRecord } from '../save';
import type { AppState, SlotName, SlotRecord } from '../save';
import { startApp } from './app';
import { GameController } from './controller';
import { formatNumber, formatPair } from './format';
import { REJECTIONS, SLOT_NAME } from './labels';
import { COLUMNS, pointOfTile, viewportFor } from './mapview';
import { MapScreen } from './screens';

const OPTIONS = { ...BUILD, serviceWorker: false, baseUrl: '/' };

/** The content that ships: `startApp` loads this, so every save seeded here has to fit it. */
const WORLD: Content = loadBundledContent();

/** Where the map's canvas sits on a phone: below the status strip, 402 points wide. */
const PHONE_CANVAS = { left: 0, top: 88, width: 402, height: 560 };

const UPGRADE_NOTICE = 'This save came from the test build, so it has been upgraded to the real game, which starts at run 1.';
const UPDATED_NOTICE = 'The game was updated to a new version.';

let dom: FakeDom;

beforeEach(() => {
  freshIndexedDb();
  dom = installFakeDom();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---- storage ----

/** What is in storage now, read through a connection of its own. */
const storage = async (): Promise<Awaited<ReturnType<typeof dump>>> => {
  const backend = new LocalBackend();
  const snapshot = await dump(backend);
  (await backend.handle()).close();
  return snapshot;
};

const seed = async (fill: (backend: LocalBackend) => Promise<void>): Promise<void> => {
  const backend = new LocalBackend();
  await fill(backend);
  (await backend.handle()).close();
};

/** The record in the hot slot. Throws if the slot is empty. */
const hot = async (): Promise<SlotRecord> => {
  const raw = (await storage()).slots['hot'];
  if (raw === undefined) throw new Error('the hot slot is empty');
  return raw as SlotRecord;
};

/** What the device store holds under a key. It is not part of a save, so `storage()` does not show it. */
const device = async (key: string): Promise<unknown> => {
  const backend = new LocalBackend();
  const value = await backend.getDevice(key);
  (await backend.handle()).close();
  return value;
};

/** The next `count` attempts to open the database throw, as when storage will not open at launch. */
const failOpens = (count: number): void => {
  const factory = indexedDB;
  const open = factory.open.bind(factory);
  let left = count;
  factory.open = ((...args: Parameters<IDBFactory['open']>) => {
    if (left > 0) {
      left -= 1;
      throw new Error('simulated: storage would not open');
    }
    return open(...args);
  }) as IDBFactory['open'];
};

type WriteWatch = {
  /** Every slot write the app has asked for, as `slot:seq`, in order. */
  asked: string[];
  /** Those that have committed. */
  committed: string[];
  /** What `observe` answered at the moment each write committed. */
  seenAtCommit: boolean[];
  /** From now on every write waits; the function returned lets them all through. */
  hold: () => () => void;
};

/** Watches the app's slot writes, and can hold them back. Seeding goes round it, straight into the database. */
const watchWrites = (observe: () => boolean = () => false): WriteWatch => {
  const write = LocalBackend.prototype.write;
  let gate: Promise<void> = Promise.resolve();
  const watch: WriteWatch = {
    asked: [],
    committed: [],
    seenAtCommit: [],
    hold: () => {
      let open: () => void = () => undefined;
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return open;
    },
  };
  vi.spyOn(LocalBackend.prototype, 'write').mockImplementation(async function (this: LocalBackend, record: SlotRecord): Promise<void> {
    watch.asked.push(`${record.slot}:${record.seq}`);
    await gate;
    await write.call(this, record);
    watch.committed.push(`${record.slot}:${record.seq}`);
    watch.seenAtCommit.push(observe());
  });
  return watch;
};

const settle = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---- a clock the test moves ----

/**
 * From here the test owns `setTimeout`: battle playback and walking wait until it moves the clock. Storage is
 * left alone, because the fake database works on `setImmediate`. `settle` and `vi.waitFor` are not for use
 * after this: the first would never return, and the second moves the clock on every look.
 */
const holdTheClock = (): void => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
};

/** Lets promises and storage run on without the clock moving. */
const turns = async (count = 25): Promise<void> => {
  for (let i = 0; i < count; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

/** Waits for something to become true without the clock moving. */
const until = async (check: () => boolean | Promise<boolean>, what: string): Promise<void> => {
  for (let i = 0; i < 400; i += 1) {
    if (await check()) return;
    await turns(5);
  }
  throw new Error(`timed out waiting for ${what}`);
};

// ---- saves that fit the real content ----

/** A new game in the real content, at the run count the Run menu and the recovery screen show. */
const realGame = (runsStarted = 1): GameState => {
  const base = newGame(20261012, WORLD);
  return { ...base, profile: { ...base.profile, counters: { ...base.profile.counters, runsStarted } } };
};

/** Intact but failing an invariant, so "suspect": the first loadout wears an item that is not owned. */
const suspectGame = (runsStarted: number): GameState => {
  const base = realGame(runsStarted);
  const item = WORLD.itemOrder.map((id) => WORLD.items[id]).find((candidate) => candidate !== undefined && candidate.kind !== 'key');
  const [first, ...rest] = base.profile.loadouts;
  if (item === undefined || first === undefined) throw new Error('the real content has no item to wear, or a new game has no loadout');
  const slot: SlotId = item.kind === 'accessory' ? 'acc1' : item.kind === 'key' ? 'weapon' : item.kind;
  return { ...base, profile: { ...base.profile, loadouts: [{ ...first, slots: { ...first.slots, [slot]: item.id } }, ...rest] } };
};

/** A sealed record written by this build, so loading it gives the app no reason to write. */
const realRecord = (slot: SlotName, seq: number, state: GameState = realGame(), settings: Partial<AppState['settings']> = {}): SlotRecord => {
  const app = newAppState(FIXED_NOW);
  return sealRecord({
    slot,
    saveVersion: SAVE_VERSION,
    buildId: BUILD.buildId,
    contentVersion: BUILD.contentVersion,
    seq,
    writtenAt: FIXED_NOW + seq,
    payload: { game: state, app: { ...app, settings: { ...app.settings, ...settings } } },
  });
};

// ---- the screen ----

/** The text of each element on screen. */
const lines = (): string[] => dom.text().split(' | ');
/** True when some element on screen says exactly this. */
const shows = (words: string): boolean => lines().includes(words);
/** True when some element on screen starts with this. */
const showsStart = (words: string): boolean => lines().some((line) => line.startsWith(words));
const count = (words: string): number => lines().filter((line) => line.startsWith(words)).length;

const onMap = (): boolean => dom.canvas() !== null && dom.buttons().includes('Map');
const resultShowing = (): boolean => shows('Victory') || shows('Defeat');

const mapShows = (): Promise<void> => vi.waitFor(() => expect(onMap(), 'the map screen is showing').toBe(true));

/** Waits for the game to be on the map, reads the run number off the Run menu, and comes back. The recovery screen can mention runs too. */
const gameShowsRun = async (run: number): Promise<void> => {
  await mapShows();
  dom.tap('Run');
  expect(shows(`Run ${run}`), `the Run menu is headed "Run ${run}"`).toBe(true);
  dom.tap('Map');
  expect(onMap(), 'back on the map').toBe(true);
};

const mapCanvas = (): FakeCanvas => {
  const canvas = dom.canvas();
  if (canvas === null) throw new Error('the map is not on screen');
  canvas.box = { ...PHONE_CANVAS };
  return canvas;
};

/**
 * Where on the page a tile is drawn while the camera follows a hero standing at `hero`, or null if it is off the
 * canvas. `columns` is how many tiles the map shows across: nine unless the test has zoomed out.
 */
const pagePoint = (hero: Position, tile: Point, columns: number = COLUMNS.near): FakePoint | null => {
  const map = WORLD.zones[hero.zone]?.map;
  if (map === undefined) throw new Error(`no map for ${hero.zone}`);
  const at = pointOfTile(viewportFor(PHONE_CANVAS.width, PHONE_CANVAS.height, map, hero, columns), tile.x, tile.y);
  if (at.x < 0 || at.x >= PHONE_CANVAS.width || at.y < 0 || at.y >= PHONE_CANVAS.height) return null;
  return { clientX: PHONE_CANVAS.left + at.x, clientY: PHONE_CANVAS.top + at.y };
};

/** A finger down and up on a tile of the map, as the player standing at `hero` sees it. */
const tapTile = (hero: Position, tile: Point, columns: number = COLUMNS.near): void => {
  const canvas = mapCanvas();
  const point = pagePoint(hero, tile, columns);
  // A player can only tap what is on the screen.
  if (point === null) throw new Error(`tile ${tile.x},${tile.y} is not on screen from ${hero.x},${hero.y}`);
  canvas.fire('pointerdown', point);
  canvas.fire('pointerup', point);
};

// ---- the real map, by structure ----

/** The lowest-level enemy standing in the zone the run starts in, and not a boss: the first fight of the game. */
const firstEnemy = (): { spawn: SpawnId; at: Point } => {
  let best: { spawn: SpawnId; at: Point; level: number } | null = null;
  for (const id of WORLD.spawnOrder) {
    const spawn = WORLD.spawns[id];
    const enemy = spawn === undefined ? undefined : WORLD.enemies[spawn.enemy];
    if (spawn === undefined || enemy === undefined || enemy.boss || spawn.zone !== WORLD.start.zone) continue;
    if (best === null || enemy.level < best.level) best = { spawn: id, at: { x: spawn.x, y: spawn.y }, level: enemy.level };
  }
  if (best === null) throw new Error('the real content has no enemy in the starting zone');
  return best;
};

/**
 * A plain floor tile a short walk from the run start and on screen from it, with nothing on the way that is
 * written at once: no stash within reach of any step, no hidden tile, no exit.
 */
const quietTile = (): Point => {
  const state = newGame(1, WORLD);
  const { zone } = WORLD.start;
  const { index } = WORLD;
  const stashes = WORLD.secretOrder.flatMap((id) => {
    const secret = WORLD.secrets[id];
    return secret !== undefined && secret.kind === 'stash' && secret.zone === zone ? [secret] : [];
  });
  const quiet = (at: Point): boolean => {
    const key = tileKey(zone, at.x, at.y);
    return index.exitAt[key] === undefined && index.hiddenAt[key] === undefined && stashes.every((stash) => Math.abs(stash.x - at.x) > 1 || Math.abs(stash.y - at.y) > 1);
  };
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      const tile = { x: WORLD.start.x + dx, y: WORLD.start.y + dy };
      const key = tileKey(zone, tile.x, tile.y);
      if (index.spawnAt[key] !== undefined || index.doorAt[key] !== undefined || index.siteAt[key] !== undefined) continue;
      if (pagePoint(WORLD.start, tile) === null) continue;
      const path = findPath(state, WORLD, WORLD.start, tile);
      if (path !== null && path.length >= 2 && path.every(quiet)) return tile;
    }
  }
  throw new Error('the real map has no quiet tile two steps from the run start');
};

/** Taps the first enemy from the run start and waits for the sheet that asks about the fight. The hero walks up to it first. */
const walkUpToFirstEnemy = async (): Promise<{ spawn: SpawnId; at: Point }> => {
  const enemy = firstEnemy();
  tapTile(WORLD.start, enemy.at);
  await vi.waitFor(() => expect(dom.buttons().includes('Fight'), 'the pre-fight sheet is showing').toBe(true));
  expect(showsStart('Win chance: ')).toBe(true);
  // A forecast is a count of trial battles: it never promises a certainty, even when every trial went one way.
  expect(shows('Win chance: 100%')).toBe(false);
  expect(shows('Win chance: 0%')).toBe(false);
  return enemy;
};

describe('startApp', () => {
  it('starts a new install at run 1 on the map, and writes the hot slot once', async () => {
    const writes = watchWrites();
    await startApp(dom.root, OPTIONS);
    expect(onMap()).toBe(true);
    expect(writes.asked).toEqual(['hot:1']);
    expect(writes.committed).toEqual(['hot:1']);

    const saved = await storage();
    expect(Object.keys(saved.slots)).toEqual(['hot']);
    expect(saved.quarantine).toEqual([]);
    const record = await hot();
    expect(record).toMatchObject({ slot: 'hot', seq: 1, saveVersion: SAVE_VERSION, buildId: BUILD.buildId, contentVersion: BUILD.contentVersion });
    // What was written is a new game on its seed, untouched: run 1, the hero on the run start.
    expect(record.payload.game).toEqual(newGame(record.payload.game.run.seed, WORLD));
    expect(record.payload.game.profile.counters.runsStarted).toBe(1);
    expect(record.payload.game.run.position).toEqual(WORLD.start);
    expect(record.payload.app.runLog).toEqual([]);

    // Looking around writes nothing more, and one game is running.
    await gameShowsRun(1);
    await settle();
    expect(writes.asked).toEqual(['hot:1']);
    expect(dom.listenerCount('pagehide')).toBe(1);
    expect(dom.listenerCount('visibilitychange')).toBe(1);
    expect(dom.listenerCount('resize')).toBe(1);
  });

  it('loads a good save on a normal start and writes nothing', async () => {
    await seed(async (backend) => {
      await putRaw(backend, 'checkpoint-0', realRecord('checkpoint-0', 40, realGame(8)));
      await putRaw(backend, 'hot', realRecord('hot', 57, realGame(12)));
    });
    const before = await storage();
    const writes = watchWrites();
    await startApp(dom.root, OPTIONS);
    await gameShowsRun(12);
    await settle(50);
    expect(writes.asked).toEqual([]);
    expect(await storage()).toEqual(before);
    // Nothing happened that the player needs telling about.
    expect(dom.buttons()).not.toContain('Dismiss');
  });

  it('saves a fight, started by tapping an enemy on the map, before the result sheet shows', async () => {
    await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 5, realGame(), { skipPlayback: true })));
    const writes = watchWrites(resultShowing);
    await startApp(dom.root, OPTIONS);
    const enemy = await walkUpToFirstEnemy();
    const before = await hot();
    const asked = writes.asked.length;

    const open = writes.hold();
    dom.tap('Fight');
    await settle();
    // The battle is resolved and on its way to storage. Nothing shows it yet.
    expect(writes.asked.slice(asked)).toEqual([`hot:${before.seq + 1}`]);
    expect(writes.committed.length).toBe(asked);
    expect(shows('Saving…')).toBe(true);
    expect(resultShowing()).toBe(false);
    expect((await hot()).payload.game.run.battleCount).toBe(0);

    open();
    await vi.waitFor(() => expect(resultShowing(), 'the result sheet is showing').toBe(true));
    // It is in storage by the time it shows, and it was not showing at the moment it was committed.
    const saved = await hot();
    const { run } = saved.payload.game;
    expect(saved.seq).toBe(before.seq + 1);
    expect(run.battleCount).toBe(1);
    expect(run.tallies.wins + run.tallies.losses).toBe(1);
    expect(writes.seenAtCommit.slice(asked)).toEqual([false]);
    // The sheet says what the saved game says.
    expect(shows('Victory')).toBe(run.tallies.wins === 1);
    expect(shows('Defeat')).toBe(run.tallies.losses === 1);
    // The walk went out with the same write: the hero stands beside the enemy, not on it and not at the start.
    const reach = Math.max(Math.abs(run.position.x - enemy.at.x), Math.abs(run.position.y - enemy.at.y));
    expect({ zone: run.position.zone, reach }).toEqual({ zone: WORLD.start.zone, reach: 1 });
    expect(run.lastEnemy).toBe(WORLD.spawns[enemy.spawn]?.enemy);
  });

  it('starts one battle, not two, when Fight is tapped again while the first is being saved', async () => {
    // A new install plays every battle back, so this one goes through the playback sheet and its Skip.
    await startApp(dom.root, OPTIONS);
    const writes = watchWrites();
    await walkUpToFirstEnemy();
    const before = await hot();

    const open = writes.hold();
    dom.tap('Fight');
    dom.tap('Fight');
    await settle();
    // Still saving, and the button is still there to be tapped.
    dom.tap('Fight');
    open();

    await vi.waitFor(() => expect(dom.buttons().includes('Skip'), 'the playback sheet is showing').toBe(true));
    expect(shows('Battle')).toBe(true);
    expect(resultShowing()).toBe(false);
    // A second battle, had one been started, would have been saved by now.
    await settle(60);
    dom.tap('Skip');
    expect(resultShowing()).toBe(true);
    const saved = await hot();
    expect(saved.payload.game.run.battleCount).toBe(1);
    expect(saved.seq).toBe(before.seq + 1);
    expect(writes.asked).toEqual([`hot:${before.seq + 1}`]);
  });

  it('shows the save-failed screen, never the result, when a fight cannot be saved', async () => {
    await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 5, realGame(), { skipPlayback: true })));
    await startApp(dom.root, OPTIONS);
    await walkUpToFirstEnemy();
    const before = await storage();

    const failing = vi.spyOn(LocalBackend.prototype, 'write').mockRejectedValue(new Error('simulated: the write was refused'));
    dom.tap('Fight');
    await vi.waitFor(() => expect(shows('Save failed'), 'the save-failed screen is showing').toBe(true));
    // One try and one retry on a fresh connection, then the app stops.
    expect(failing).toHaveBeenCalledTimes(2);
    expect(resultShowing()).toBe(false);
    expect(dom.canvas()).toBeNull();
    expect(dom.buttons()).toEqual(['Copy the text code', 'Reload the app']);

    // The text code is the game as it stands, with the battle in it, and it imports.
    const [code = ''] = dom.fields();
    const decoded = checkImport(code, WORLD);
    if (!decoded.ok) throw new Error(`the text code does not import: ${decoded.reason}`);
    expect(decoded.record.payload.game.run.battleCount).toBe(1);
    expect(decoded.record.seq).toBe(6);

    failing.mockRestore();
    expect(await storage()).toEqual(before);
    dom.tap('Reload the app');
    expect(dom.reloads()).toBe(1);
  });

  it('writes an unsaved walk when the page is hidden (pagehide)', async () => {
    await startApp(dom.root, OPTIONS);
    const writes = watchWrites();
    const target = quietTile();
    tapTile(WORLD.start, target);
    await settle();
    // The hero has walked, and nothing has been written: storage still has it on the run start.
    expect(writes.asked).toEqual([]);
    expect((await hot()).payload.game.run.position).toEqual(WORLD.start);

    dom.fire('pagehide');
    await vi.waitFor(async () => expect((await hot()).payload.game.run.position).toEqual({ zone: WORLD.start.zone, ...target }));
    expect(writes.asked).toEqual(['hot:2']);
    // Nothing is unsaved now, so hiding again writes nothing.
    dom.fire('pagehide');
    await settle();
    expect(writes.asked).toEqual(['hot:2']);
  });

  it('writes an unsaved walk when the app goes to the background (visibilitychange), and nothing when it comes back', async () => {
    await startApp(dom.root, OPTIONS);
    const writes = watchWrites();
    const target = quietTile();
    tapTile(WORLD.start, target);
    await settle();
    expect(writes.asked).toEqual([]);

    dom.setVisibility('hidden');
    await vi.waitFor(async () => expect((await hot()).payload.game.run.position).toEqual({ zone: WORLD.start.zone, ...target }));
    dom.setVisibility('visible');
    await settle();
    expect(writes.asked).toEqual(['hot:2']);
  });

  it('starts one run, and writes one checkpoint, when "Start the run" is tapped twice', async () => {
    await startApp(dom.root, OPTIONS);
    const writes = watchWrites();
    dom.tap('Run');
    dom.tap('New run…');
    expect(shows('Start run 2?')).toBe(true);

    const open = writes.hold();
    dom.tap('Start the run');
    dom.tap('Start the run');
    await settle();
    // Still saving: the run on screen is the old one, and a third tap is one more chance to start a second run.
    expect(shows('Saving…')).toBe(true);
    dom.tap('Start the run');
    open();

    await gameShowsRun(2);
    await settle(60);
    // A checkpoint, then the hot slot, once each.
    expect(writes.asked).toEqual(['checkpoint-0:2', 'hot:3']);
    const after = await storage();
    expect(Object.keys(after.slots).sort()).toEqual(['checkpoint-0', 'hot']);
    const saved = await hot();
    expect(saved.payload.game.profile.counters.runsStarted).toBe(2);
    expect(saved.payload.game.run.position).toEqual(WORLD.start);
    expect(saved.payload.app.runLog).toMatchObject([{ run: 1, wins: 0, losses: 0, level: 1, strongest: 0 }]);
    expect(after.slots['checkpoint-0']).toMatchObject({ seq: 2, payload: { game: { profile: { counters: { runsStarted: 2 } } } } });
  });
});

// The first real migration (ARCHITECTURE 7.4). The owner's phone holds version 1 records, written by the build
// before the real game: this is what the first launch of this build finds, and what it must leave behind.
describe('a version 1 save from the test build', () => {
  const FIXTURE_TEXT = readFileSync(join(import.meta.dirname, '../../tests/fixtures/saves/v1.json'), 'utf8');

  const checkpoints = (): Record<string, unknown>[] => [recordV1('checkpoint-0', 30), recordV1('checkpoint-1', 36)];

  /** Seeds the three records, starts the app, and checks everything the first launch must do. */
  const firstLaunch = async (oldHot: Record<string, unknown>): Promise<WriteWatch> => {
    const [first, second] = checkpoints();
    if (first === undefined || second === undefined) throw new Error('two checkpoints expected');
    // The hot slot is the newest of the three, as on the phone: it is written after every checkpoint.
    expect(oldHot).toMatchObject({ slot: 'hot', saveVersion: 1, seq: 42 });
    await seed(async (backend) => {
      await putRaw(backend, 'checkpoint-0', first);
      await putRaw(backend, 'checkpoint-1', second);
      await putRaw(backend, 'hot', oldHot);
    });
    const writes = watchWrites();
    await startApp(dom.root, OPTIONS);

    // The map, at run 1, with the notice that says what happened.
    await gameShowsRun(1);
    expect(count(UPGRADE_NOTICE)).toBe(1);

    // One write: the hot slot, as a version 2 record one past the highest seq that was in storage.
    expect(writes.asked).toEqual(['hot:43']);
    const after = await storage();
    expect(Object.keys(after.slots).sort()).toEqual(['checkpoint-0', 'checkpoint-1', 'hot']);
    const record = await hot();
    expect(record).toMatchObject({ slot: 'hot', saveVersion: 2, seq: 43, buildId: BUILD.buildId, contentVersion: BUILD.contentVersion });
    const { profile, run } = record.payload.game;
    expect(profile.counters).toEqual({ runsStarted: 1, bestLevel: 1 });
    expect(profile.items).toEqual({});
    // The hero is on the run start: the migration cannot know where that is, so the run repair put it there.
    expect(run.position).toEqual(WORLD.start);
    expect(run).toMatchObject({ seed: 123456789, battleCount: 0, xp: 0, gold: 0, energySpent: 0 });
    expect(record.payload.app.runLog).toEqual([]);

    // Each version 1 record has its routine copy, exactly as it was stored.
    const copies = [...after.quarantine].sort((a, b) => String((a as { slot: string }).slot).localeCompare(String((b as { slot: string }).slot)));
    expect(copies).toHaveLength(3);
    expect(copies).toMatchObject([
      { kind: 'routine', reason: 'before-migration', slot: 'checkpoint-0', seq: 30, raw: first },
      { kind: 'routine', reason: 'before-migration', slot: 'checkpoint-1', seq: 36, raw: second },
      { kind: 'routine', reason: 'before-migration', slot: 'hot', seq: 42, raw: oldHot },
    ]);
    // The checkpoint slots still hold their version 1 records, untouched.
    expect(after.slots['checkpoint-0']).toEqual(first);
    expect(after.slots['checkpoint-1']).toEqual(second);
    return writes;
  };

  /** Closes the app and opens it again: a fresh page on the same database. */
  const relaunch = async (): Promise<void> => {
    dom = installFakeDom();
    await startApp(dom.root, OPTIONS);
  };

  it('is upgraded on the first launch, keeping every old record, and the launch after that loads the upgraded game and writes nothing', async () => {
    const writes = await firstLaunch(recordV1('hot', 42));

    // The player reads the notice and dismisses it, and the app has put that away before it is closed.
    dom.tap('Dismiss');
    expect(count(UPGRADE_NOTICE)).toBe(0);
    await vi.waitFor(async () => expect(await device('notices')).toEqual([]));
    const before = await storage();

    await relaunch();
    await gameShowsRun(1);
    await settle(50);
    expect(count(UPGRADE_NOTICE)).toBe(0);
    expect(dom.buttons()).not.toContain('Dismiss');
    expect(writes.asked).toEqual(['hot:43']);
    expect(await storage()).toEqual(before);
    expect(await hot()).toMatchObject({ saveVersion: 2, seq: 43 });
  });

  it('is upgraded the same way from the frozen version 1 fixture, byte for byte, on a phone that had seen the test build', async () => {
    const fixture = JSON.parse(FIXTURE_TEXT) as Record<string, unknown>;
    // The device store is not part of a save: the test build left its own name there.
    await seed((backend) => backend.setDevice('lastBuildSeen', 'test-build-v1'));
    const writes = await firstLaunch(fixture);
    expect(count(UPDATED_NOTICE)).toBe(1);
    await vi.waitFor(async () => expect(await device('notices')).toHaveLength(2));
    const before = await storage();

    // Not dismissed: the notice is still waiting at the next launch, once, and nothing is upgraded a second time.
    await relaunch();
    await gameShowsRun(1);
    await settle(50);
    expect(count(UPGRADE_NOTICE)).toBe(1);
    expect(count(UPDATED_NOTICE)).toBe(1);
    expect(writes.asked).toEqual(['hot:43']);
    expect(await storage()).toEqual(before);
  });

  it('can be played at once: a fight in the upgraded game is saved like any other', async () => {
    const writes = await firstLaunch(recordV1('hot', 42));
    await walkUpToFirstEnemy();
    dom.tap('Fight');
    await vi.waitFor(() => expect(dom.buttons().includes('Skip'), 'the playback sheet is showing').toBe(true));
    dom.tap('Skip');
    expect(resultShowing()).toBe(true);
    expect(writes.asked).toEqual(['hot:43', 'hot:44']);
    expect(await hot()).toMatchObject({ saveVersion: 2, seq: 44, payload: { game: { run: { battleCount: 1 } } } });
    // The old records are still where they were.
    const after = await storage();
    expect(after.slots['checkpoint-0']).toMatchObject({ saveVersion: 1, seq: 30 });
    expect(after.slots['checkpoint-1']).toMatchObject({ saveVersion: 1, seq: 36 });
    expect(after.quarantine).toHaveLength(3);
  });
});

describe('recovery wiring', () => {
  it('after an unreadable start offers only what writes nothing, and changes nothing', async () => {
    await seed(async (backend) => {
      await putRaw(backend, 'checkpoint-0', realRecord('checkpoint-0', 40, realGame(8)));
      await putRaw(backend, 'hot', realRecord('hot', 57, realGame(12)));
      await backend.addQuarantine([{ slot: 'hot', kind: 'kept', reason: 'replaced-by-import', raw: realRecord('hot', 20, realGame(5)) }]);
    });
    const before = await storage();
    const writes = watchWrites();
    failOpens(1);

    await startApp(dom.root, OPTIONS);
    await vi.waitFor(() => expect(showsStart('The save storage could not be opened or read.')).toBe(true));
    // Give the screen time to list the set-aside saves it can now read; it must still not offer them.
    await settle(50);
    expect(dom.buttons()).toEqual(['Export everything as it is', 'Try again']);
    expect(await storage()).toEqual(before);

    // Trying again loads the real save. The tap replaces the screen at once, so there is nothing left to tap twice.
    dom.tap('Try again');
    expect(dom.buttons()).toEqual([]);
    await gameShowsRun(12);
    expect(writes.asked).toEqual([]);
    expect(await storage()).toEqual(before);
    // The game carries on from the save that was there all along: its next write is save 58.
    dom.tap('Got it');
    await vi.waitFor(async () => expect((await hot()).seq).toBe(58));
    expect(writes.asked).toEqual(['hot:58']);
  });

  it('sets aside what is in storage at the moment of the choice, not what was read when the screen opened', async () => {
    await seed(async (backend) => {
      await putRaw(backend, 'checkpoint-0', realRecord('checkpoint-0', 7, realGame(2)));
      await putRaw(backend, 'hot', realRecord('hot', 9, suspectGame(3)));
    });
    await startApp(dom.root, OPTIONS);
    await vi.waitFor(() => expect(showsStart('The newest save is intact but fails a consistency check')).toBe(true));
    expect(dom.buttons()).toEqual([
      'Export everything as it is',
      'Try again',
      'Use hot anyway (run 3)',
      expect.stringMatching(/^Use checkpoint-0 \(run 2,/),
      'Start a new game…',
    ]);
    const untouched = await storage();
    expect(untouched.quarantine).toEqual([]);

    // Something else writes the hot slot while the screen is open.
    const later = realRecord('hot', 30, realGame(9));
    await seed((backend) => putRaw(backend, 'hot', later));

    dom.tap(/^Use checkpoint-0/);
    dom.tap(/^Use checkpoint-0/);
    await gameShowsRun(2);
    const after = await storage();
    expect(after.quarantine).toMatchObject([{ kind: 'kept', reason: 'set-aside', slot: 'hot', seq: 30, raw: later }]);
    expect(after.slots['hot']).toMatchObject({ seq: 31, payload: { game: { profile: { counters: { runsStarted: 2 } } } } });

    // One game is running, not two. The second tap on the choice did nothing: a second game would have
    // registered its own listeners.
    expect(dom.listenerCount('pagehide')).toBe(1);
    expect(dom.listenerCount('visibilitychange')).toBe(1);
    expect(dom.listenerCount('resize')).toBe(1);
    dom.tap('Got it');
    await vi.waitFor(async () => expect((await hot()).seq).toBe(32));
    await settle(50);
    expect((await hot()).seq).toBe(32);
  });

  it('uses a suspect record only when asked, and sets it aside first', async () => {
    await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 9, suspectGame(3))));
    const stored = (await storage()).slots['hot'];
    const writes = watchWrites();
    await startApp(dom.root, OPTIONS);
    await vi.waitFor(() => expect(dom.buttons()).toContain('Use hot anyway (run 3)'));
    await settle(50);
    // Nothing is written until the player chooses.
    expect(writes.asked).toEqual([]);
    expect((await storage()).quarantine).toEqual([]);

    dom.tap('Use hot anyway (run 3)');
    await gameShowsRun(3);
    const after = await storage();
    expect(after.quarantine).toMatchObject([{ kind: 'kept', reason: 'suspect', slot: 'hot', seq: 9, raw: stored }]);
    expect(after.slots['hot']).toMatchObject({ seq: 10, payload: { game: { profile: { counters: { runsStarted: 3 } } } } });
    expect(writes.asked).toEqual(['hot:10']);
  });

  it('starts a new game from the recovery screen only on a second tap, and only after setting everything aside', async () => {
    await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 9, suspectGame(3))));
    const before = await storage();
    await startApp(dom.root, OPTIONS);
    await vi.waitFor(() => expect(dom.buttons()).toContain('Start a new game…'));
    dom.tap('Start a new game…');
    // The first tap only asks; nothing has been written, and a redraw of the screen does not forget the question.
    await settle(50);
    expect(await storage()).toEqual(before);
    expect(dom.buttons()).not.toContain('Start a new game…');

    dom.tap(/^Tap again to start a new game/);
    dom.tap(/^Tap again to start a new game/);
    await gameShowsRun(1);
    const after = await storage();
    expect(after.quarantine).toMatchObject([{ kind: 'kept', reason: 'suspect', slot: 'hot', seq: 9, raw: before.slots['hot'] }]);
    expect(after.slots['hot']).toMatchObject({ seq: 10, payload: { game: { profile: { counters: { runsStarted: 1 } } } } });
    // One new game, however often the confirmation was tapped.
    expect(dom.listenerCount('pagehide')).toBe(1);
    dom.tap('Got it');
    await vi.waitFor(async () => expect((await hot()).seq).toBe(11));
    await settle(50);
    expect((await hot()).seq).toBe(11);
  });

  it('changes nothing, and stays on the recovery screen, when the saves cannot be set aside at the moment of the choice', async () => {
    await seed(async (backend) => {
      await putRaw(backend, 'checkpoint-0', realRecord('checkpoint-0', 7, realGame(2)));
      await putRaw(backend, 'hot', realRecord('hot', 9, suspectGame(3)));
    });
    const before = await storage();
    const writes = watchWrites();
    await startApp(dom.root, OPTIONS);
    await vi.waitFor(() => expect(dom.buttons()).toContain('Use hot anyway (run 3)'));

    const refusing = vi.spyOn(LocalBackend.prototype, 'addQuarantine').mockRejectedValue(new Error('simulated: no room for a copy'));
    dom.tap('Use hot anyway (run 3)');
    await vi.waitFor(() => expect(showsStart('Could not read the existing saves and set them aside, so nothing was changed')).toBe(true));
    expect(onMap()).toBe(false);
    expect(writes.asked).toEqual([]);
    refusing.mockRestore();
    expect(await storage()).toEqual(before);

    // The choice can be made again once the copy can be kept.
    dom.tap('Use hot anyway (run 3)');
    await gameShowsRun(3);
    expect(writes.asked).toEqual(['hot:10']);
    expect((await storage()).quarantine).toMatchObject([{ kind: 'kept', reason: 'suspect', slot: 'hot', seq: 9 }]);
  });

  it('after a start that fails part-way offers only what writes nothing, and trying again reloads the page', async () => {
    await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 57, realGame(12))));
    const before = await storage();
    const writes = watchWrites();
    // The save loads, and then the first draw of the map throws.
    vi.spyOn(MapScreen.prototype, 'update').mockImplementationOnce(() => {
      throw new Error('simulated: the map could not be drawn');
    });

    await startApp(dom.root, OPTIONS);
    expect(showsStart('The game hit an error while starting.')).toBe(true);
    expect(shows('simulated: the map could not be drawn')).toBe(true);
    await settle(50);
    expect(dom.buttons()).toEqual(['Export everything as it is', 'Try again']);
    expect(writes.asked).toEqual([]);
    expect(await storage()).toEqual(before);

    // A game may be half set up in this page, so trying again starts the page over. A second tap does nothing.
    dom.tap('Try again');
    dom.tap('Try again');
    expect(dom.reloads()).toBe(1);
    expect(await storage()).toEqual(before);
  });

  it('leaves nothing of a start that failed part-way listening for a later change', async () => {
    await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 57, realGame(12))));
    vi.spyOn(MapScreen.prototype, 'update').mockImplementationOnce(() => {
      throw new Error('simulated: the map could not be drawn');
    });
    await startApp(dom.root, OPTIONS);
    expect(showsStart('The game hit an error while starting.')).toBe(true);
    // The half-built game registered no listeners of its own.
    expect(dom.listenerCount('pagehide')).toBe(0);
    expect(dom.listenerCount('visibilitychange')).toBe(0);
    expect(dom.listenerCount('resize')).toBe(0);
    // Hiding the page and coming back draws nothing over the failed-start screen.
    dom.setVisibility('hidden');
    dom.setVisibility('visible');
    dom.fire('pagehide');
    await settle(50);
    expect(dom.buttons()).toEqual(['Export everything as it is', 'Try again']);
    expect(onMap()).toBe(false);
  });
});

// Found by the Phase 3b verifier through the real app. Each was a way for something on screen to disagree with
// what was saved, or to act twice on one intention.
describe('faults the verifier found', () => {
  const HALT_BUTTONS = ['Copy the text code', 'Reload the app'];
  const TEST_BUILD_WARNING = 'The incoming save is from the test build.';

  /**
   * A canvas context that takes every call and draws nothing, so that walking is animated and takes time. A
   * caption is measured before it is placed, so that one call has an answer.
   */
  const paintless = (): unknown => new Proxy({}, { get: (_target, name) => (name === 'measureText' ? () => ({ width: 0 }) : () => undefined), set: () => true });

  describe('a halt while a battle plays back', () => {
    it('stops the playback, and never opens the result sheet over the save-failed screen', async () => {
      await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 5)));
      await startApp(dom.root, OPTIONS);
      const enemy = await walkUpToFirstEnemy();
      const canvas = mapCanvas();

      holdTheClock();
      dom.tap('Fight');
      await until(() => dom.buttons().includes('Skip'), 'the playback sheet');
      // The fight is saved. From here on storage refuses every write.
      const fought = await hot();
      expect(fought).toMatchObject({ seq: 6, payload: { game: { run: { battleCount: 1 } }, app: { settings: { playbackSpeed: 1 } } } });
      const failing = vi.spyOn(LocalBackend.prototype, 'write').mockRejectedValue(new Error('simulated: the write was refused'));

      // The battle has begun to play. Choosing a speed is remembered, and remembering it is a write.
      vi.advanceTimersByTime(400);
      expect(dom.buttons()).toContain('Skip');
      dom.tap('2×');
      await until(() => shows('Save failed'), 'the save-failed screen');
      expect(failing).toHaveBeenCalledTimes(2);
      expect(dom.buttons()).toEqual(HALT_BUTTONS);

      // The playback stops at its next beat: it has no more timers waiting, well before it would have ended.
      vi.advanceTimersByTime(600);
      await turns();
      expect(vi.getTimerCount()).toBe(0);
      // Long past where it would have ended, the result sheet has not opened over the save-failed screen.
      vi.advanceTimersByTime(600_000);
      await turns();
      expect(resultShowing()).toBe(false);
      expect(shows('Save failed')).toBe(true);
      expect(dom.buttons()).toEqual(HALT_BUTTONS);

      // Nor does a tap on the enemy the hero stands beside open anything: the map is no longer on screen.
      const point = pagePoint(fought.payload.game.run.position, enemy.at);
      if (point === null) throw new Error('the enemy is not on screen from beside it');
      canvas.fire('pointerdown', point);
      canvas.fire('pointerup', point);
      await turns();
      expect(dom.buttons()).toEqual(HALT_BUTTONS);

      // The text code is the game as it stands: the fight, and the speed that could not be saved.
      const [code = ''] = dom.fields();
      const decoded = checkImport(code, WORLD);
      if (!decoded.ok) throw new Error(`the text code does not import: ${decoded.reason}`);
      expect(decoded.record.payload.game.run.battleCount).toBe(1);
      expect(decoded.record.payload.app.settings.playbackSpeed).toBe(2);
      failing.mockRestore();
      expect(await hot()).toEqual(fought);
    });

    it('opens no sheet once the game has stopped, even one that was on its way when the save failed', async () => {
      await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 57, realGame(12))));
      await startApp(dom.root, OPTIONS);
      dom.tap('Run');
      dom.tap('Settings');
      const before = await storage();

      vi.spyOn(LocalBackend.prototype, 'write').mockRejectedValue(new Error('simulated: the write was refused'));
      // A setting is a write, which will fail; the export sheet is asked for in the same breath, and is built
      // only after the save before it has been tried.
      dom.tap('Skip every battle to its result: off');
      dom.tap('Export…');
      await vi.waitFor(() => expect(shows('Save failed'), 'the save-failed screen is showing').toBe(true));
      await settle(80);
      expect(dom.buttons()).toEqual(HALT_BUTTONS);
      expect(shows('Export')).toBe(false);
      vi.restoreAllMocks();
      expect(await storage()).toEqual(before);
    });
  });

  describe('a second tap while the first is being saved', () => {
    /** The first item the shop sells with this copy cap, at a price no other item on sale has, so its Buy button can be told apart. */
    const onSale = (copyCap: number): { item: ItemDef; price: number } => {
      const sold = WORLD.itemOrder.flatMap((id) => {
        const item = WORLD.items[id];
        const price = item === undefined ? null : shopPrice(item, WORLD.balance);
        return item === undefined || price === null ? [] : [{ item, price }];
      });
      const found = sold.find((entry) => entry.item.copyCap === copyCap && sold.filter((other) => other.price === entry.price).length === 1);
      if (found === undefined) throw new Error(`the shop sells no item with a copy cap of ${copyCap} at a price of its own`);
      return found;
    };

    const rich = (gold: number): GameState => {
      const base = realGame();
      return { ...base, run: { ...base.run, gold } };
    };

    const GOLD = 500_000;

    it.each([3, 1])('buys one copy and charges once when Buy is tapped twice, for an item with a copy cap of %i', async (copyCap) => {
      const { item, price } = onSale(copyCap);
      await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 5, rich(GOLD))));
      await startApp(dom.root, OPTIONS);
      const writes = watchWrites();
      dom.tap('Items');
      const label = `Buy for ${formatPair(price, GOLD)[0]} gold`;

      const open = writes.hold();
      dom.tap(label);
      dom.tap(label);
      await settle();
      // Still being saved, and the button is still there to be tapped.
      dom.tap(label);
      expect(writes.asked).toEqual(['hot:6']);
      open();

      await vi.waitFor(() => expect(shows('Bought. Put it on from Gear.'), 'the purchase is confirmed').toBe(true));
      // A second purchase, had one been started, would have been saved, or refused, by now.
      await settle(60);
      const saved = await hot();
      expect(saved.payload.game.profile.items).toEqual({ [item.id]: 1 });
      expect(saved.payload.game.run.gold).toBe(GOLD - price);
      expect(saved.payload.game.run.tallies.itemsGained).toEqual([item.id]);
      expect(writes.asked).toEqual(['hot:6']);
      // What the player is told is that it was bought, not that a second copy was refused.
      expect(shows('Bought. Put it on from Gear.')).toBe(true);
      expect(shows(REJECTIONS['cap-reached'])).toBe(false);
    });

    it('buys and wears once when "Buy and wear" is tapped twice in the slot picker', async () => {
      const { item, price } = onSale(1);
      const slot: SlotId = item.kind === 'accessory' ? 'acc1' : item.kind === 'key' ? 'weapon' : item.kind;
      await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 5, rich(GOLD))));
      await startApp(dom.root, OPTIONS);
      const writes = watchWrites();
      dom.tap('Gear');
      dom.tap(`${SLOT_NAME[slot]}Empty`);
      const label = `Buy for ${formatPair(price, GOLD)[0]} gold and wear`;
      dom.tap(label);
      dom.tap(label);

      // One purchase and one change of gear.
      await vi.waitFor(async () => expect((await hot()).seq).toBe(7));
      await settle(60);
      const saved = await hot();
      expect(saved.payload.game.profile.items).toEqual({ [item.id]: 1 });
      expect(saved.payload.game.run.gold).toBe(GOLD - price);
      expect(saved.payload.game.profile.loadouts[0]?.slots[slot]).toBe(item.id);
      expect(writes.asked).toEqual(['hot:6', 'hot:7']);
      expect(shows(REJECTIONS['cap-reached'])).toBe(false);
      expect(shows(REJECTIONS['not-owned'])).toBe(false);
    });

    it('buys one loadout when "Buy a loadout" is tapped twice', async () => {
      const base = realGame();
      const price = loadoutPrice(base, WORLD.balance);
      const nextPrice = loadoutPrice({ ...base, profile: { ...base.profile, loadouts: [...base.profile.loadouts, emptyLoadout()] } }, WORLD.balance);
      if (price === null || nextPrice === null) throw new Error('a new game has fewer than two loadouts left to buy');
      // Enough gold for this loadout and the one after, so that only the guard stands between the second tap
      // and a second loadout.
      const gold = price + nextPrice;
      await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 5, rich(gold))));
      await startApp(dom.root, OPTIONS);
      const writes = watchWrites();
      dom.tap('Gear');
      const label = `Buy a loadout: ${formatNumber(price)} gold`;
      dom.tap(label);
      dom.tap(label);

      await vi.waitFor(async () => expect((await hot()).seq).toBe(6));
      await settle(60);
      const saved = await hot();
      expect(saved.payload.game.profile.loadouts).toHaveLength(WORLD.balance.loadouts.free + 1);
      expect(saved.payload.game.run.gold).toBe(gold - price);
      expect(writes.asked).toEqual(['hot:6']);
      expect(shows(REJECTIONS['no-gold'])).toBe(false);
    });

    it('spends exactly the chosen points, once, when a stat on the Hero screen is tapped twice', async () => {
      // Level 5 with nothing spent.
      const base = realGame();
      const levelled: GameState = { ...base, run: { ...base.run, xp: xpForLevel(5, WORLD.balance.xp.perLevel) } };
      const unspent = unspentPoints(levelled, WORLD.balance);
      expect(unspent).toBeGreaterThanOrEqual(8);
      await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 5, levelled)));
      await startApp(dom.root, OPTIONS);
      const writes = watchWrites();
      const dispatched = vi.spyOn(GameController.prototype, 'dispatch');
      const allocations = (): StatPoints[] =>
        dispatched.mock.calls.flatMap(([action]: [Action]) => (action.type === 'Allocate' ? [action.points] : []));
      const points = (stat: StatKey, amount: number): StatPoints => ({ life: 0, damage: 0, defense: 0, dexterity: 0, luck: 0, [stat]: amount });

      /** Two taps, in one breath, on the button that gives `amount` points to `stat`. */
      const tapTwice = (stat: StatKey, amount: number): void => {
        const label = `+${formatNumber(amount)}`;
        // The row of amounts to choose from comes first, and has buttons of its own that read +1, +10 and +100.
        const nth = (['+1', '+10', '+100'].includes(label) ? 1 : 0) + STAT_KEYS.indexOf(stat);
        dom.tap(label, nth);
        dom.tap(label, nth);
      };
      const spent = async (): Promise<StatPoints> => (await hot()).payload.game.run.pointsSpent;

      dom.tap('Hero');
      // One point at a time is what the screen starts on.
      tapTwice('damage', 1);
      await vi.waitFor(async () => expect((await hot()).seq).toBe(6));
      await settle(60);
      expect(allocations()).toEqual([points('damage', 1)]);
      expect(await spent()).toEqual(points('damage', 1));

      // A quarter of what is left.
      const quarter = Math.max(1, Math.floor((unspent - 1) / 4));
      dom.tap('25%');
      tapTwice('life', quarter);
      await vi.waitFor(async () => expect((await hot()).seq).toBe(7));
      await settle(60);
      expect(allocations()).toEqual([points('damage', 1), points('life', quarter)]);

      // All the rest.
      const rest = unspent - 1 - quarter;
      dom.tap('All');
      tapTwice('dexterity', rest);
      await vi.waitFor(async () => expect((await hot()).seq).toBe(8));
      await settle(60);
      expect(allocations()).toEqual([points('damage', 1), points('life', quarter), points('dexterity', rest)]);
      expect(await spent()).toEqual({ life: quarter, damage: 1, defense: 0, dexterity: rest, luck: 0 });
      expect(writes.asked).toEqual(['hot:6', 'hot:7', 'hot:8']);
      // Nothing was refused, so nothing was said about having too few points.
      expect(shows(REJECTIONS['bad-points'])).toBe(false);
    });
  });

  describe('a sheet opened over a walk', () => {
    /** A run with no energy left, so that the map itself offers the new run, with the hero standing at `position`. */
    const spentRunAt = (position: Position): GameState => {
      const base = realGame();
      return { ...base, run: { ...base.run, position, energySpent: remainingEnergy(base, WORLD) } };
    };

    /** The way from the run start to the first enemy: several steps, so that there is a walk to interrupt. */
    const wayToFirstEnemy = (): { enemy: Point; way: Point[] } => {
      const enemy = firstEnemy().at;
      const way = findPath(spentRunAt(WORLD.start), WORLD, WORLD.start, enemy, { beside: true });
      if (way === null || way.length < 2) throw new Error('the first enemy is less than two steps from the run start');
      return { enemy, way };
    };

    /** Lets the clock run for the whole walk several times over. */
    const wait = async (): Promise<void> => {
      for (let beat = 0; beat < 40; beat += 1) {
        vi.advanceTimersByTime(250);
        await turns(5);
      }
    };

    beforeEach(() => {
      // With something to draw on, and frames to draw in, each step of a walk takes its time on the clock.
      vi.spyOn(FakeCanvas.prototype, 'getContext').mockReturnValue(paintless() as never);
      vi.stubGlobal('requestAnimationFrame', () => 0);
    });

    it('is not replaced by the pre-fight sheet when the walk ends under it, and a new run confirmed on it starts on the run start', async () => {
      const { enemy, way } = wayToFirstEnemy();
      const firstStep = way[0];
      if (firstStep === undefined) throw new Error('the way has no first step');
      await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 5, spentRunAt(WORLD.start))));
      await startApp(dom.root, OPTIONS);
      const writes = watchWrites();
      expect(dom.buttons()).toContain('New run…');

      holdTheClock();
      tapTile(WORLD.start, enemy);
      await turns();
      // The hero is on its way and has not arrived: nothing asks about the fight yet.
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      expect(dom.buttons()).not.toContain('Fight');

      dom.tap('New run…');
      expect(shows('Start run 2?')).toBe(true);
      await wait();
      // The sheet the player opened is still the one on screen: the pre-fight sheet did not take its place.
      expect(shows('Start run 2?')).toBe(true);
      expect(dom.buttons()).toContain('Start the run');
      expect(dom.buttons()).not.toContain('Fight');
      // And the hero stood still under it. Hiding the page writes whatever is unsaved, which is where it stands:
      // one step from the run start, where it was when the sheet opened.
      dom.fire('pagehide');
      await until(() => writes.committed.length === 1, 'the walked step to be written');
      expect((await hot()).payload.game.run.position).toEqual({ zone: WORLD.start.zone, ...firstStep });

      dom.tap('Start the run');
      await until(async () => (await hot()).payload.game.profile.counters.runsStarted === 2, 'the new run');
      await until(() => onMap() && !shows('Start run 2?'), 'the map');
      // No step of the old walk lands in the new run, however long it is given, and nothing asks about a fight.
      await wait();
      expect(dom.buttons()).not.toContain('Fight');
      // Had the hero moved off the run start, hiding the page would store that.
      dom.fire('pagehide');
      await turns(60);
      const saved = await hot();
      expect(saved.payload.game.run.position).toEqual(WORLD.start);
      expect(saved.payload.game.profile.counters.runsStarted).toBe(2);
      // The one step of the walk; then the new run's checkpoint and hot slot; and nothing after.
      expect(writes.asked).toEqual(['hot:6', 'checkpoint-0:7', 'hot:8']);
    });

    it('does not ask about the fight a walk was for when a new run is confirmed before its last step has finished', async () => {
      // The hero stands one step short of the enemy, so the walk is that one step, and what it was for comes
      // straight after it.
      const { enemy, way } = wayToFirstEnemy();
      const near = way[way.length - 2];
      if (near === undefined) throw new Error('the way has no tile before its last');
      const from: Position = { zone: WORLD.start.zone, ...near };
      await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 5, spentRunAt(from))));
      await startApp(dom.root, OPTIONS);
      const writes = watchWrites();

      holdTheClock();
      tapTile(from, enemy);
      await turns();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      expect(dom.buttons()).not.toContain('Fight');
      // The player is quicker than the hero: the sheet is opened and the new run confirmed while the step is
      // still being walked, so the walk never sees a sheet in its way.
      dom.tap('New run…');
      dom.tap('Start the run');
      await until(async () => (await hot()).payload.game.profile.counters.runsStarted === 2, 'the new run');
      await until(() => onMap() && !shows('Start run 2?'), 'the map');

      // The step ends in a run that is no longer the one it was taken in. Nothing asks about the old fight.
      await wait();
      expect(dom.buttons()).not.toContain('Fight');
      dom.fire('pagehide');
      await turns(60);
      const saved = await hot();
      expect(saved.payload.game.run.position).toEqual(WORLD.start);
      // The new run's checkpoint and hot slot, which took the walked step with them, and nothing after.
      expect(writes.asked).toEqual(['checkpoint-0:6', 'hot:7']);
    });
  });

  describe('a notice that is already waiting', () => {
    it('is not said twice when a start that was cut short is repeated', async () => {
      await seed((backend) => putRaw(backend, 'hot', recordV1('hot', 42)));
      // This launch raises the upgrade notice and is then killed before its first write lands.
      const writes = watchWrites();
      writes.hold();
      void startApp(dom.root, OPTIONS);
      await vi.waitFor(async () => expect(await device('notices')).toHaveLength(1));
      await settle(50);
      expect(writes.asked).toEqual(['hot:43']);
      expect(writes.committed).toEqual([]);
      expect(await storage()).toMatchObject({ slots: { hot: { saveVersion: 1, seq: 42 } } });

      // The next launch finds the version 1 save still there, upgrades it again, and raises the same notice.
      vi.restoreAllMocks();
      dom = installFakeDom();
      await startApp(dom.root, OPTIONS);
      await gameShowsRun(1);
      expect(count(UPGRADE_NOTICE)).toBe(1);
      await settle(50);
      expect(await device('notices')).toHaveLength(1);
      expect(await hot()).toMatchObject({ saveVersion: 2, seq: 43 });
    });
  });

  describe('replacing the game with a save from the test build', () => {
    const openSettings = (): void => {
      dom.tap('Run');
      dom.tap('Settings');
    };

    it('is warned about when a set-aside copy of the version 1 save is restored', async () => {
      await seed((backend) => putRaw(backend, 'hot', recordV1('hot', 42)));
      await startApp(dom.root, OPTIONS);
      await gameShowsRun(1);
      openSettings();
      await vi.waitFor(() => expect(dom.buttons()).toContain('Restore…'));
      dom.tap('Restore…');
      expect(shows('Replace the current game?')).toBe(true);
      expect(showsStart(TEST_BUILD_WARNING)).toBe(true);
      // Nothing is replaced until the player confirms.
      dom.tap('Cancel');
      await settle(50);
      expect(await hot()).toMatchObject({ saveVersion: 2, seq: 43 });
    });

    it('is warned about when a version 1 save is imported, and not when a version 2 save is', async () => {
      await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 57, realGame(12))));
      await startApp(dom.root, OPTIONS);
      const before = await storage();
      openSettings();

      dom.tap('Import…');
      dom.fill(JSON.stringify(recordV1('hot', 42)));
      dom.tap('Check');
      expect(shows('Replace the current game?')).toBe(true);
      expect(showsStart(TEST_BUILD_WARNING)).toBe(true);
      dom.tap('Cancel');

      dom.tap('Import…');
      dom.fill(JSON.stringify(realRecord('hot', 99, realGame(7))));
      dom.tap('Check');
      expect(shows('Replace the current game?')).toBe(true);
      expect(showsStart(TEST_BUILD_WARNING)).toBe(false);
      dom.tap('Cancel');

      await settle(50);
      expect(await storage()).toEqual(before);
    });
  });
});

// iOS can hand the installed app a page that ends above the bottom of the screen (ARCHITECTURE A-32). The app
// reads what it is told at launch, leaves word for the style sheet on the page's root, and shows the numbers in
// Settings, since the phone has nothing else to read them with.
describe('a page that stops short of the screen', () => {
  // Michael's iPhone 16 Pro on 2026-10-12: the page is short by the 62 points of the status bar.
  const SHORT = { standalone: true, screenHeight: 874, pageHeight: 812, pageWidth: 402, insetTop: 62, insetBottom: 34 };
  const WHOLE = { ...SHORT, pageHeight: 874 };

  const screenLine = (): string | undefined => {
    dom.tap('Run');
    dom.tap('Settings');
    const all = lines();
    const value = all[all.indexOf('Screen') + 1];
    dom.tap('Back to the Run menu');
    dom.tap('Map');
    return all.includes('Screen') ? value : undefined;
  };

  it('is told to the style sheet at launch, and Settings shows the numbers', async () => {
    dom.setScreen(SHORT);
    await startApp(dom.root, OPTIONS);
    await mapShows();
    expect(dom.rootAttribute('data-band-below')).toBe('yes');
    expect(screenLine()).toBe('874 high, page 812, insets 62 and 34: the page stops short of the screen');
  });

  it('is not claimed for a page that fills the screen', async () => {
    dom.setScreen(WHOLE);
    await startApp(dom.root, OPTIONS);
    await mapShows();
    expect(dom.rootAttribute('data-band-below')).toBe('no');
    expect(screenLine()).toBe('874 high, page 874, insets 62 and 34');
  });

  it('is not claimed in a browser tab, nor where the browser reports nothing', async () => {
    dom.setScreen({ ...SHORT, standalone: false });
    await startApp(dom.root, OPTIONS);
    await mapShows();
    expect(dom.rootAttribute('data-band-below')).toBe('no');

    dom = installFakeDom();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    expect(dom.rootAttribute('data-band-below')).toBe('no');
    expect(screenLine()).toBe('0 high, page 0, insets 0 and 0');
  });

  it('is looked at again when the page is resized and when the app comes back to the front', async () => {
    dom.setScreen(WHOLE);
    await startApp(dom.root, OPTIONS);
    await mapShows();
    expect(dom.rootAttribute('data-band-below')).toBe('no');

    dom.setScreen(SHORT);
    dom.fire('resize');
    expect(dom.rootAttribute('data-band-below')).toBe('yes');
    expect(screenLine()).toBe('874 high, page 812, insets 62 and 34: the page stops short of the screen');

    dom.setScreen(WHOLE);
    dom.setVisibility('hidden');
    dom.setVisibility('visible');
    expect(dom.rootAttribute('data-band-below')).toBe('no');
    // One game, with one listener of each kind: the reading added none of its own.
    expect(dom.listenerCount('resize')).toBe(1);
    expect(dom.listenerCount('visibilitychange')).toBe(1);
  });

  it('is settled before a save is read, so the recovery screen is laid out by it too', async () => {
    dom.setScreen(SHORT);
    await seed((backend) => putRaw(backend, 'hot', { junk: true }));
    await startApp(dom.root, OPTIONS);
    expect(shows('Save recovery')).toBe(true);
    expect(dom.rootAttribute('data-band-below')).toBe('yes');
    // The recovery screen draws once more when its list of set-aside saves arrives.
    await settle(50);
  });
});

// The reminder to export (ARCHITECTURE 7.5): after 10 runs or 7 days without an export it shows on the map. It
// never blocked play, but it could not be closed. "Later" puts it off until the app is next started, and no
// longer, because the phone holds the only copy of the save (GDD D-33).
describe('the export reminder', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const ONLY_COPY = 'The only copy of this save is on this phone.';

  const reminderShowing = (): boolean => lines().some((line) => line.endsWith(ONLY_COPY));

  /**
   * A save at this run count, begun `startedDaysAgo`, whose last export, if there was one, was so many days ago
   * and at such a run. The clock in these tests stands at FIXED_NOW.
   */
  const tracked = (runsStarted: number, lastExport: { daysAgo: number; atRun: number } | null, startedDaysAgo = 0): SlotRecord =>
    sealRecord({
      slot: 'hot',
      saveVersion: SAVE_VERSION,
      buildId: BUILD.buildId,
      contentVersion: BUILD.contentVersion,
      seq: 57,
      writtenAt: FIXED_NOW + 57,
      payload: {
        game: realGame(runsStarted),
        app: {
          ...newAppState(FIXED_NOW),
          exportTracking: {
            trackingSince: FIXED_NOW - startedDaysAgo * DAY,
            lastExportAt: lastExport === null ? null : FIXED_NOW - lastExport.daysAgo * DAY,
            runsAtLastExport: lastExport === null ? 0 : lastExport.atRun,
          },
        },
      },
    });

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  it('shows on the map with both buttons after 10 runs without an export, and "Later" puts it off until the app is next started', async () => {
    await seed((backend) => putRaw(backend, 'hot', tracked(12, null)));
    await startApp(dom.root, OPTIONS);
    await mapShows();
    const writes = watchWrites();
    expect(shows(`No export for 12 runs. ${ONLY_COPY}`)).toBe(true);
    expect(dom.buttons()).toEqual(expect.arrayContaining(['Export now', 'Later']));

    dom.tap('Later');
    expect(reminderShowing()).toBe(false);
    expect(dom.buttons()).not.toContain('Later');
    expect(dom.buttons()).not.toContain('Export now');
    // It was put off, not answered: nothing was written.
    await settle(50);
    expect(writes.asked).toEqual([]);

    // It stays away on every screen, and on the map when the player comes back to it.
    for (const tab of ['Hero', 'Gear', 'Items', 'Bestiary', 'Run', 'Map']) {
      dom.tap(tab);
      expect(reminderShowing(), tab).toBe(false);
    }
    expect(onMap()).toBe(true);

    // And through a new run, which is one more run without an export.
    dom.tap('Run');
    dom.tap('New run…');
    dom.tap('Start the run');
    await gameShowsRun(13);
    expect(reminderShowing()).toBe(false);
    // The save knows nothing of the putting off: it still says that no export was ever made.
    expect((await hot()).payload.app.exportTracking).toEqual({ trackingSince: FIXED_NOW, lastExportAt: null, runsAtLastExport: 0 });

    // The app is closed and opened again. The reminder is back, counting the run that was added.
    dom = installFakeDom();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    expect(shows(`No export for 13 runs. ${ONLY_COPY}`)).toBe(true);
    expect(dom.buttons()).toEqual(expect.arrayContaining(['Export now', 'Later']));
  });

  it.each([
    { what: 'the days alone', runs: 25, last: { daysAgo: 8, atRun: 20 }, started: 30, words: 'No export for 8 days.' },
    { what: 'the days since the save began, when it has never been exported', runs: 3, last: null, started: 9, words: 'No export for 9 days.' },
    { what: 'the runs alone, counted from the last export', runs: 32, last: { daysAgo: 1, atRun: 20 }, started: 30, words: 'No export for 12 runs.' },
    { what: 'both', runs: 32, last: { daysAgo: 8, atRun: 20 }, started: 30, words: 'No export for 8 days and 12 runs.' },
  ])('names $what when that is what is overdue', async ({ runs, last, started, words }) => {
    await seed((backend) => putRaw(backend, 'hot', tracked(runs, last, started)));
    await startApp(dom.root, OPTIONS);
    await mapShows();
    expect(shows(`${words} ${ONLY_COPY}`)).toBe(true);
    expect(dom.buttons()).toEqual(expect.arrayContaining(['Export now', 'Later']));
  });

  it('does not show, and offers nothing to put off, while neither limit is reached', async () => {
    // Nine runs and six days since the last export: one short of each.
    await seed((backend) => putRaw(backend, 'hot', tracked(29, { daysAgo: 6, atRun: 20 }, 30)));
    await startApp(dom.root, OPTIONS);
    await mapShows();
    expect(reminderShowing()).toBe(false);
    expect(dom.buttons()).not.toContain('Later');
    expect(dom.buttons()).not.toContain('Export now');
  });

  it('still opens the export sheet from "Export now", and is still there when the sheet is closed with nothing exported', async () => {
    await seed((backend) => putRaw(backend, 'hot', tracked(12, null)));
    await startApp(dom.root, OPTIONS);
    await mapShows();
    dom.tap('Export now');
    await vi.waitFor(() => expect(shows('Nothing has been shared or copied yet.'), 'the export sheet is showing').toBe(true));
    dom.tap('Done');
    expect(reminderShowing()).toBe(true);
    expect(dom.buttons()).toEqual(expect.arrayContaining(['Export now', 'Later']));
  });
});

// The map's two zoom levels (GDD 8.3, D-32): nine tiles across, or fourteen to see and tap farther. The choice is
// a fact about this device and is kept in its store, not in the save.
describe('the zoom button on the map', () => {
  const heroAt = async (): Promise<Position> => (await hot()).payload.game.run.position;
  const at = (tile: Point): Position => ({ zone: WORLD.start.zone, ...tile });

  /** Closes the app and opens it again: a fresh page on the same database. */
  const relaunch = async (): Promise<void> => {
    dom = installFakeDom();
    await startApp(dom.root, OPTIONS);
    await mapShows();
  };

  /** Taps a tile as it is drawn with this many tiles across, and waits until the save has the hero standing on it. */
  const walkByTap = async (from: Position, tile: Point, columns: number): Promise<void> => {
    tapTile(from, tile, columns);
    await settle();
    dom.fire('pagehide');
    await vi.waitFor(async () => expect(await heroAt()).toEqual(at(tile)));
  };

  it('stands at the end of the loadout row, switches the map at a tap, and the choice is remembered at the next launch', async () => {
    await startApp(dom.root, OPTIONS);
    const writes = watchWrites();
    // Near is where a new install starts, so the button offers the way out. It comes after the loadouts.
    const loadouts = Array.from({ length: WORLD.balance.loadouts.free }, (_, index) => String(index + 1));
    const shown = dom.buttons();
    expect(shown.slice(shown.indexOf('1'), shown.indexOf('Map'))).toEqual([...loadouts, 'Zoom out']);
    expect(await device('mapZoom')).toBeUndefined();

    dom.tap('Zoom out');
    // At once, before anything is stored: the button now offers the way back.
    expect(dom.buttons()).toContain('Zoom in');
    expect(dom.buttons()).not.toContain('Zoom out');
    await vi.waitFor(async () => expect(await device('mapZoom')).toBe('far'));

    // The map is fourteen tiles across: a tap where a tile is drawn at that size walks the hero onto that tile.
    const target = quietTile();
    expect(pagePoint(WORLD.start, target, COLUMNS.far)).not.toEqual(pagePoint(WORLD.start, target));
    await walkByTap(WORLD.start, target, COLUMNS.far);
    // The zoom is no part of the save. The one write is the walk.
    expect(writes.asked).toEqual(['hot:2']);

    // The next launch opens far, and its map is drawn that way, not only its button.
    await relaunch();
    expect(dom.buttons()).toContain('Zoom in');
    expect(dom.buttons()).not.toContain('Zoom out');
    await walkByTap(at(target), WORLD.start, COLUMNS.far);

    // Back to near, and that is remembered too.
    dom.tap('Zoom in');
    expect(dom.buttons()).toContain('Zoom out');
    await vi.waitFor(async () => expect(await device('mapZoom')).toBe('near'));
    await walkByTap(WORLD.start, target, COLUMNS.near);
    await relaunch();
    expect(dom.buttons()).toContain('Zoom out');
  });

  it('opens near when the device store holds something no build wrote, or cannot be read', async () => {
    await seed((backend) => backend.setDevice('mapZoom', 'closer'));
    await startApp(dom.root, OPTIONS);
    await mapShows();
    expect(dom.buttons()).toContain('Zoom out');

    await seed((backend) => backend.setDevice('mapZoom', 'far'));
    vi.spyOn(LocalBackend.prototype, 'getDevice').mockRejectedValue(new Error('simulated: the device store would not read'));
    await relaunch();
    expect(dom.buttons()).toContain('Zoom out');
    // The game is not held up by it: the map takes a tap as usual.
    await walkByTap(WORLD.start, quietTile(), COLUMNS.near);
  });

  it('still switches on screen when the choice cannot be stored, and the next launch opens as the store last had it', async () => {
    await startApp(dom.root, OPTIONS);
    const refused = vi.spyOn(LocalBackend.prototype, 'setDevice').mockRejectedValue(new Error('simulated: the device store would not write'));
    dom.tap('Zoom out');
    expect(dom.buttons()).toContain('Zoom in');
    await vi.waitFor(() => expect(refused).toHaveBeenCalledWith('mapZoom', 'far'));
    await settle();
    // Still far, and drawn that way.
    expect(dom.buttons()).toContain('Zoom in');
    await walkByTap(WORLD.start, quietTile(), COLUMNS.far);

    refused.mockRestore();
    expect(await device('mapZoom')).toBeUndefined();
    await relaunch();
    expect(dom.buttons()).toContain('Zoom out');
  });
});

// Salvage from anywhere (GDD 7.4, DV-9). The engine no longer asks where the hero stands, and the sheet opens
// from the Run menu and from the spent-run notice as well as from a Salvage site on the map.
describe('Salvage away from its site', () => {
  const GOLD = 600;
  const PUT_IN = `Put in ${formatNumber(GOLD)} gold`;

  const sheetShowing = (): boolean => dom.buttons().some((label) => label.startsWith('Put in '));
  const resultOfSalvageShowing = (): boolean => showsStart('Found: ') || showsStart('Nothing turned up.');

  const sites = (): readonly Point[] => WORLD.zones[WORLD.start.zone]?.map.salvageSites ?? [];
  const reach = (a: Point, b: Point): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  /** A floor tile of the starting zone that the hero can walk to, three tiles or more from every Salvage site. */
  const awayFromSites = (): Position => {
    const state = newGame(1, WORLD);
    const { zone } = WORLD.start;
    const map = WORLD.zones[zone]?.map;
    if (map === undefined || sites().length === 0) throw new Error('the starting zone has no map, or no Salvage site to be away from');
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (WORLD.index.exitAt[tileKey(zone, x, y)] !== undefined || sites().some((site) => reach(site, { x, y }) < 3)) continue;
        if (findPath(state, WORLD, WORLD.start, { x, y }) !== null) return { zone, x, y };
      }
    }
    throw new Error('every tile the hero can reach in the starting zone is within two tiles of a Salvage site');
  };

  /**
   * A run with something to salvage and gold to put in: one enemy beaten, none of its drops owned, and nothing
   * stronger beaten this run. The hero stands at `position`.
   */
  const withSomethingToSalvage = (position: Position): GameState => {
    const base = realGame();
    const enemy = WORLD.enemyOrder.map((id) => WORLD.enemies[id]).find((candidate) => candidate !== undefined && !candidate.boss && candidate.drops.length > 0);
    if (enemy === undefined) throw new Error('the real content has no enemy with a drop');
    return {
      profile: { ...base.profile, bestiary: { [enemy.id]: { timesBeaten: 1 } }, strongestEverBeaten: enemy.level },
      run: { ...base.run, position, gold: GOLD, battleCount: 1, strongestBeaten: enemy.level, lastEnemy: enemy.id, tallies: { ...base.run.tallies, wins: 1 } },
    };
  };

  it('opens from the Run menu with the hero nowhere near a site, and saves an attempt made there before its result shows', async () => {
    const position = awayFromSites();
    expect(sites().every((site) => reach(site, position) >= 3)).toBe(true);
    await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 5, withSomethingToSalvage(position))));
    const writes = watchWrites(resultOfSalvageShowing);
    await startApp(dom.root, OPTIONS);
    await mapShows();

    dom.tap('Run');
    expect(shows('Not used yet')).toBe(true);
    dom.tap('Salvage…');
    expect(sheetShowing()).toBe(true);
    expect(dom.buttons()).toContain(PUT_IN);
    const before = await hot();
    const asked = writes.asked.length;

    const open = writes.hold();
    dom.tap(PUT_IN);
    dom.tap(PUT_IN);
    await settle();
    // The attempt is made and on its way to storage, once. Nothing shows it yet.
    expect(writes.asked.slice(asked)).toEqual([`hot:${before.seq + 1}`]);
    expect(writes.committed.length).toBe(asked);
    expect(resultOfSalvageShowing()).toBe(false);
    expect((await hot()).payload.game.run).toMatchObject({ salvageUsed: false, gold: GOLD });

    open();
    await vi.waitFor(() => expect(resultOfSalvageShowing(), 'the result of the attempt is showing').toBe(true));
    // It is in storage by the time it shows, and it was not showing at the moment it was committed.
    const saved = await hot();
    expect(saved.seq).toBe(before.seq + 1);
    expect(saved.payload.game.run).toMatchObject({ salvageUsed: true, gold: 0, position });
    expect(writes.seenAtCommit.slice(asked)).toEqual([false]);
    // The sheet says what the saved game says: an item found, or nothing.
    const found = Object.keys(saved.payload.game.profile.items).length;
    expect([0, 1]).toContain(found);
    expect(showsStart('Found: ')).toBe(found === 1);
    expect(showsStart('Nothing turned up.')).toBe(found === 0);

    // Closing the result leaves the Run menu, which now says the attempt is used and offers no second one.
    dom.tap('Done');
    expect(sheetShowing()).toBe(false);
    expect(shows('Used')).toBe(true);
    expect(shows('Not used yet')).toBe(false);
    dom.tap('Salvage…');
    expect(sheetShowing()).toBe(false);
    await settle(50);
    expect(writes.asked.slice(asked)).toEqual([`hot:${before.seq + 1}`]);
  });

  it('is offered beside "New run…" on the map when the run is spent, for as long as the attempt is unused', async () => {
    const ready = withSomethingToSalvage(awayFromSites());
    const spent: GameState = { ...ready, run: { ...ready.run, energySpent: remainingEnergy(ready, WORLD) } };
    await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 5, spent)));
    await startApp(dom.root, OPTIONS);
    await mapShows();
    expect(shows(`The run is spent. Still unused: ${formatNumber(GOLD)} gold, and the Salvage attempt.`)).toBe(true);
    const shown = dom.buttons();
    expect(shown.slice(shown.indexOf('New run…'), shown.indexOf('New run…') + 2)).toEqual(['New run…', 'Salvage…']);

    dom.tap('Salvage…');
    expect(sheetShowing()).toBe(true);
    dom.tap(PUT_IN);
    await vi.waitFor(() => expect(resultOfSalvageShowing(), 'the result of the attempt is showing').toBe(true));
    dom.tap('Done');

    // Back on the map: the notice still offers the new run, and no longer the attempt that has been used.
    expect(onMap()).toBe(true);
    expect(shows('The run is spent. Still unused: 0 gold.')).toBe(true);
    expect(dom.buttons()).toContain('New run…');
    expect(dom.buttons()).not.toContain('Salvage…');
    expect((await hot()).payload.game.run).toMatchObject({ salvageUsed: true, gold: 0 });
  });

  it('still opens when a Salvage site on the map is tapped, once the hero has walked onto it', async () => {
    const [site] = [...sites()].sort((a, b) => reach(a, WORLD.start) - reach(b, WORLD.start));
    if (site === undefined) throw new Error('the starting zone has no Salvage site');
    await startApp(dom.root, OPTIONS);
    expect(sheetShowing()).toBe(false);
    tapTile(WORLD.start, site);
    await vi.waitFor(() => expect(sheetShowing(), 'the Salvage sheet is showing').toBe(true));
    dom.fire('pagehide');
    await vi.waitFor(async () => expect((await hot()).payload.game.run.position).toEqual({ zone: WORLD.start.zone, x: site.x, y: site.y }));
  });
});
