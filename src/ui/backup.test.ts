// The cloud backup's wiring (ARCHITECTURE 7.5), driven through the real `startApp` with a stand-in DOM, a fake
// IndexedDB, the content that ships and a stand-in for the one service the backup talks to. What `CloudBackup`
// and `GitHubBackend` do on their own is tested beside them in src/save/. These tests are about what the game
// and the backup can do to each other: that the game never waits on the backup, that the backup never reaches a
// slot, that a backup this install has not seen is never written over, and that the key stays where it was put.
// Each group names the Phase 5a success check in docs/STATUS.md it answers to.
//
// Four tests hold places where the code and what was written about it parted ways when these tests were
// written. Each was reported, and the code was then changed; the comment above each says what it was. Three of
// them were marked `it.fails` until then.
//
// Spoilers: as in app.test.ts, everything is found by structure and named by ID, and what is on screen is only
// ever checked as a yes or a no, so a failure cannot print a screen that holds a name. Records hold IDs only.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../tests/fake-dom';
import type { FakeCanvas, FakeDom, FakeElement, FakePoint } from '../../tests/fake-dom';
import { FakeGitHub, madeUpKey } from '../../tests/fake-github';
import type { FakeCall, FakeMode } from '../../tests/fake-github';
import { BUILD, FIXED_NOW, dump, freshIndexedDb, putRaw, unsealed } from '../../tests/helpers';
import { loadBundledContent } from '../content';
import { findPath, newGame, tileKey } from '../engine';
import type { Content, GameState, Point, Position, SlotId, SpawnId } from '../engine';
import {
  BACKUP_FILE,
  BACKUP_KEY,
  BACKUP_ORIGIN,
  BACKUP_STATE,
  BACKUP_TIMEOUT_MS,
  LocalBackend,
  SAVE_VERSION,
  STORE_DEVICE,
  TEXT_CODE_PREFIX,
  buildExport,
  checkInvariants,
  checksumMatches,
  checksumOf,
  newAppState,
  sealRecord,
  serializeRecord,
} from '../save';
import type { AppState, BackupAttempt, BackupOutcome, FetchLike, SlotName, SlotRecord } from '../save';
import { startApp } from './app';
import { COLUMNS, pointOfTile, viewportFor } from './mapview';

const OPTIONS = { ...BUILD, serviceWorker: false, baseUrl: '/' };

/** The content that ships: `startApp` loads this, so every save seeded here has to fit it. */
const WORLD: Content = loadBundledContent();

/** Where the map's canvas sits on a phone: below the status strip, 402 points wide. */
const PHONE_CANVAS = { left: 0, top: 88, width: 402, height: 560 };

const OWNER = 'someone';
const REPO = 'some-saves';
const REPOSITORY = `${OWNER}/${REPO}`;

let dom: FakeDom;
let github: FakeGitHub;
/** The key the stand-in service takes. Made up at run time: nothing shaped like a real key is written here. */
let token: string;
/** Slot writes, set-aside copies and calls to the service, in the order they happened. */
let trace: string[];
/** How many run seeds this launch has drawn. */
let draws: number;

/** A phone with nothing on it: empty storage, a new page, the seed source back at its start. */
const newPhone = (): void => {
  freshIndexedDb();
  dom = installFakeDom();
  trace = [];
  draws = 0;
};

/** The app is closed and opened again on the same phone. */
const relaunch = async (): Promise<void> => {
  dom = installFakeDom();
  await startApp(dom.root, OPTIONS);
};

beforeEach(() => {
  token = madeUpKey('wiring');
  github = new FakeGitHub(OWNER, REPO, token);
  newPhone();
  // One moment and one run of seeds for every launch, so that the same steps write the same bytes whether or
  // not a backup is configured. The fixed moment also keeps the export reminder, which has a "Later" of its
  // own, off the map.
  vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  vi.stubGlobal('crypto', {
    getRandomValues: (box: Uint32Array): Uint32Array => {
      draws += 1;
      box[0] = 20261013 + draws;
      return box;
    },
  });
  // `startApp` looks `fetch` up when it calls it, so this is the only network the app has.
  const service: FetchLike = (url, init) => {
    trace.push(`request ${init.method ?? 'GET'}`);
    return github.fetch(url, init);
  };
  vi.stubGlobal('fetch', service);
  const write = LocalBackend.prototype.write;
  vi.spyOn(LocalBackend.prototype, 'write').mockImplementation(async function (this: LocalBackend, record: SlotRecord): Promise<void> {
    trace.push(`asked ${record.slot}:${record.seq}`);
    await write.call(this, record);
    trace.push(`committed ${record.slot}:${record.seq}`);
  });
  const addQuarantine = LocalBackend.prototype.addQuarantine;
  vi.spyOn(LocalBackend.prototype, 'addQuarantine').mockImplementation(async function (this: LocalBackend, copies): Promise<string[]> {
    const added = await addQuarantine.call(this, copies);
    // A launch asks for no copies at all when there is nothing to set aside, which is not worth a line.
    if (copies.length > 0) trace.push(`set aside ${copies.length}`);
    return added;
  });
});

afterEach(async () => {
  vi.useRealTimers();
  // Whatever the app still has in hand ends against this test's service and storage. Without this, a test that
  // fails part-way would send its leftovers to the next test's stand-in, and that one would fail for no reason
  // of its own.
  await new Promise((resolve) => setTimeout(resolve, 30));
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

/** Every slot as the bytes it is stored and exported as. */
const slotBytes = async (): Promise<Record<string, string>> =>
  Object.fromEntries(Object.entries((await storage()).slots).map(([slot, raw]) => [slot, serializeRecord(raw as SlotRecord)]));

/** Every slot and every set-aside copy, as one text: two of these are equal only if nothing in either store moved. */
const saved = async (): Promise<string> => JSON.stringify(await storage());

/** The whole `device` store. It is not part of a save, so `storage()` does not show it. */
const deviceStore = async (): Promise<Record<string, unknown>> => {
  const backend = new LocalBackend();
  const db = await backend.handle();
  const held: Record<string, unknown> = {};
  for (const key of await db.getAllKeys(STORE_DEVICE)) held[key] = await db.get(STORE_DEVICE, key);
  db.close();
  return held;
};

type Notes = { seenSha: string | null; sentChecksum: string | null; lastOk: { at: number; seq: number; run: number } | null; lastAttempt: BackupAttempt | null };

/** What this install remembers about its backup, as the `device` store holds it. Empty until there is something. */
const notes = async (): Promise<Partial<Notes>> => ((await deviceStore())[BACKUP_STATE] ?? {}) as Partial<Notes>;

/** Puts a key on the phone as an earlier launch would have left it, without sending anything. */
const configureKey = (key: string = token): Promise<void> => seed((backend) => backend.setDevice(BACKUP_KEY, { owner: OWNER, repo: REPO, token: key }));

const settle = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** `vi.waitFor`, looking more often than its default: most of what these tests wait for takes a few milliseconds. */
const eventually = <T>(check: () => T | Promise<T>): Promise<T> => vi.waitFor(check, { timeout: 2000, interval: 10 });

/**
 * For the tests marked as failing: waits for the fault to show, and says whether it did. Today it shows within
 * milliseconds. Once it is fixed this waits its two seconds once, the test passes, and the mark has to come off.
 */
const comesTrue = (fault: () => boolean | Promise<boolean>): Promise<boolean> =>
  eventually(async () => expect(await fault()).toBe(true)).then(
    () => true,
    () => false,
  );

/** Waits for a backup attempt to have ended this way. Not for use where the attempt before it ended the same way. */
const attemptEnds = (outcome: BackupOutcome): Promise<void> =>
  eventually(async () => expect((await notes()).lastAttempt?.outcome, `the last attempt came to "${outcome}"`).toBe(outcome));

/** Waits for the record now in the hot slot to be the one this install last backed up, and gives it back. */
const backedUp = async (): Promise<SlotRecord> => {
  const record = await hot();
  await eventually(async () => expect((await notes()).lastOk?.seq, `save ${record.seq} is backed up`).toBe(record.seq));
  await attemptEnds('ok');
  return record;
};

// ---- a clock the test moves ----

/** From here the test owns `setTimeout`. Storage is left alone: the fake database works on `setImmediate`. `settle` and `eventually` are not for use after this. */
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

// ---- the service ----

const requests = (): string[] => trace.filter((entry) => entry.startsWith('request'));
const localWrites = (): string[] => trace.filter((entry) => !entry.startsWith('request'));

/** The file text a write to the service carried, decoded here and not by the code under test. */
const sentText = (call: FakeCall): string => {
  const content = (call.body as { content?: unknown } | null)?.content;
  if (typeof content !== 'string') throw new Error('the call carried no file');
  return Buffer.from(content, 'base64').toString('utf8');
};

const sentSha = (call: FakeCall): unknown => (call.body as { sha?: unknown } | null)?.sha;

// ---- saves that fit the real content ----

/** A new game in the real content, at the run count the Run menu shows. */
const realGame = (runsStarted = 1, runSeed = 20261012): GameState => {
  const base = newGame(runSeed, WORLD);
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
  // Begun a day before the fixed clock's "now": a game the app starts during a test is begun now, and a game is
  // known by the moment it was begun (src/save/succession.ts). With both at the same instant, a new game and an
  // old one that holds nothing yet would be one game, which they are not on any phone.
  const app = newAppState(FIXED_NOW - 86_400_000);
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

/** The game most of these tests start from: in its first run, with every battle skipped to its result. */
const seedGame = (runsStarted = 1, seq = 5): Promise<void> =>
  seed((backend) => putRaw(backend, 'hot', realRecord('hot', seq, realGame(runsStarted), { skipPlayback: true })));

/** A good record from another game, as another install would have left it in the backup: another seed, another build, far more runs. */
const otherGame = (): SlotRecord =>
  sealRecord({
    slot: 'hot',
    saveVersion: SAVE_VERSION,
    buildId: 'another-install',
    contentVersion: BUILD.contentVersion,
    seq: 900,
    writtenAt: FIXED_NOW - 5000,
    payload: { game: realGame(40, 777), app: newAppState(FIXED_NOW - 9000) },
  });

// ---- the screen ----

/** The text of each element on screen. */
const lines = (): string[] => dom.text().split(' | ');
/** True when some element on screen says exactly this. */
const shows = (words: string): boolean => lines().includes(words);
/** True when some element on screen starts with this. */
const showsStart = (words: string): boolean => lines().some((line) => line.startsWith(words));
/** The value beside a label in a row of a screen, such as "Last backup" in Settings. */
const valueOf = (label: string): string | undefined => {
  const all = lines();
  const at = all.indexOf(label);
  return at < 0 ? undefined : all[at + 1];
};

const onMap = (): boolean => dom.canvas() !== null && dom.buttons().includes('Map');
const resultShowing = (): boolean => shows('Victory') || shows('Defeat');
const mapShows = (): Promise<void> => eventually(() => expect(onMap(), 'the map screen is showing').toBe(true));

/** Waits for the game to be on the map, reads the run number off the Run menu, and comes back. */
const gameShowsRun = async (run: number): Promise<void> => {
  await mapShows();
  dom.tap('Run');
  expect(shows(`Run ${run}`), `the Run menu is headed "Run ${run}"`).toBe(true);
  dom.tap('Map');
  expect(onMap(), 'back on the map').toBe(true);
};

/** Confirms a new run from the Run menu, as the player does, and waits for it to be the game on screen. */
const startRun = async (run: number): Promise<void> => {
  dom.tap('Run');
  dom.tap('New run…');
  expect(shows(`Start run ${run}?`)).toBe(true);
  dom.tap('Start the run');
  await gameShowsRun(run);
};

const openSettings = (): void => {
  dom.tap('Run');
  dom.tap('Settings');
};

const mapCanvas = (): FakeCanvas => {
  const canvas = dom.canvas();
  if (canvas === null) throw new Error('the map is not on screen');
  canvas.box = { ...PHONE_CANVAS };
  return canvas;
};

/** Where on the page a tile is drawn while the camera follows a hero standing at `hero`, or null if it is off the canvas. */
const pagePoint = (hero: Position, tile: Point): FakePoint | null => {
  const map = WORLD.zones[hero.zone]?.map;
  if (map === undefined) throw new Error(`no map for ${hero.zone}`);
  const at = pointOfTile(viewportFor(PHONE_CANVAS.width, PHONE_CANVAS.height, map, hero, COLUMNS.near), tile.x, tile.y);
  if (at.x < 0 || at.x >= PHONE_CANVAS.width || at.y < 0 || at.y >= PHONE_CANVAS.height) return null;
  return { clientX: PHONE_CANVAS.left + at.x, clientY: PHONE_CANVAS.top + at.y };
};

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
 * One fight, as the player has it: a tap on the first enemy from the run start, the walk up to it, Fight, and
 * the result sheet, which is in storage by the time it shows. The hero has to be standing on the run start.
 */
const fightOnce = async (): Promise<void> => {
  const point = pagePoint(WORLD.start, firstEnemy().at);
  if (point === null) throw new Error('the first enemy is not on screen from the run start');
  const canvas = mapCanvas();
  canvas.fire('pointerdown', point);
  canvas.fire('pointerup', point);
  await eventually(() => expect(dom.buttons().includes('Fight'), 'the pre-fight sheet is showing').toBe(true));
  dom.tap('Fight');
  await eventually(() => expect(dom.buttons().includes('Skip') || resultShowing(), 'the battle is saved and showing').toBe(true));
  if (dom.buttons().includes('Skip')) dom.tap('Skip');
  expect(resultShowing()).toBe(true);
  dom.tap('Back to the map');
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

/** The text boxes on screen, as elements, so that a test can still look at one after its sheet has closed. */
const textBoxes = (): FakeElement[] =>
  (dom.root as unknown as FakeElement).shown().filter((element) => element.tagName === 'textarea' || (element.tagName === 'input' && element.attributes['type'] !== 'file'));

/** Opens the key sheet from Settings and types into its two boxes. Gives back the box the key went into. */
const typeKey = (repository: string, key: string): FakeElement => {
  openSettings();
  dom.tap(dom.buttons().includes('Set up…') ? 'Set up…' : 'Change or forget the key…');
  expect(shows('Cloud backup key')).toBe(true);
  dom.fill(repository, 0);
  dom.fill(key, 1);
  const box = textBoxes()[1];
  if (box === undefined) throw new Error('the key sheet has no second box');
  return box;
};

const keySheetClosed = (): Promise<void> => eventually(() => expect(shows('Cloud backup key'), 'the key sheet is still open').toBe(false));

const REMINDER_START = 'The cloud backup ';
const reminderShowing = (): boolean => showsStart(REMINDER_START);

// ---- check 3 ----

describe('check 3: the local save stays the source of truth', () => {
  type Played = { afterRun: Record<string, string>; afterFight: Record<string, string>; writes: string[] };

  /** The steps every case plays with backup off: a launch on a saved game, a new run, one fight. */
  const playWithBackupOff = async (): Promise<Played> => {
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await startRun(2);
    const afterRun = await slotBytes();
    await fightOnce();
    const afterFight = await slotBytes();
    await settle(50);
    expect(requests(), 'with no key nothing is sent').toEqual([]);
    expect(await slotBytes()).toEqual(afterFight);
    return { afterRun, afterFight, writes: localWrites() };
  };

  const CASES: ReadonlyArray<{ mode: FakeMode; ends: BackupOutcome | null }> = [
    { mode: 'hang', ends: null },
    { mode: 'offline', ends: 'unreachable' },
    { mode: 'throw', ends: 'unreachable' },
    { mode: 401, ends: 'refused' },
    { mode: 403, ends: 'refused' },
    { mode: 404, ends: 'not-found' },
    { mode: 409, ends: 'failed' },
    { mode: 422, ends: 'failed' },
    { mode: 500, ends: 'failed' },
  ];

  it.each(CASES)('a service that answers "$mode" changes nothing of what a new run and the fight after it write, and holds neither up', async ({ mode, ends }) => {
    const off = await playWithBackupOff();
    // The run's checkpoint, then its hot slot, then the fight. Nothing else was written with backup off.
    expect(off.writes).toEqual(['asked checkpoint-0:6', 'committed checkpoint-0:6', 'asked hot:7', 'committed hot:7', 'asked hot:8', 'committed hot:8']);

    // The same phone again, from the same save, the same seeds and the same clock, with a key on it.
    newPhone();
    await configureKey();
    github.mode = mode;
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    // Having a key sends nothing by itself.
    expect(requests()).toEqual([]);

    await startRun(2);
    // (a) Byte for byte what backup off wrote. No field is left out of the comparison: the key and the backup's
    // notes live in the `device` store, so no slot has any reason to differ.
    const afterRun = await slotBytes();
    expect(afterRun).toEqual(off.afterRun);
    expect(Object.keys(afterRun).sort()).toEqual(['checkpoint-0', 'hot']);

    // (b) Both were committed before the service was first asked anything.
    const firstRequest = trace.findIndex((entry) => entry.startsWith('request'));
    expect(firstRequest, 'the backup was tried').toBeGreaterThan(-1);
    expect(trace.slice(0, firstRequest)).toEqual(['asked checkpoint-0:6', 'committed checkpoint-0:6', 'asked hot:7', 'committed hot:7']);
    expect(trace[firstRequest]).toBe('request GET');

    if (ends === null) {
      // (c) The one call is still unanswered, and stays so through the next input, which is taken and saved.
      expect(requests()).toEqual(['request GET']);
      expect((await notes()).lastAttempt ?? null).toBeNull();
      await fightOnce();
      expect(await slotBytes()).toEqual(off.afterFight);
      expect((await hot()).payload.game.run.battleCount).toBe(1);
      expect(requests()).toEqual(['request GET']);
      expect((await notes()).lastAttempt ?? null).toBeNull();
      openSettings();
      expect(valueOf('Last attempt')).toBe('Sending…');
      await settle(50);
    } else {
      // (d) Once the attempt has ended, every slot is as the run left it.
      await attemptEnds(ends);
      expect(await slotBytes()).toEqual(off.afterRun);
      // (c) A backup that failed holds nothing up either.
      await fightOnce();
      expect(await slotBytes()).toEqual(off.afterFight);
      await settle(50);
    }

    // (d) The slots hold what backup off left, nothing was set aside, and nobody asked for a slot write that
    // backup off did not make. What changed is in the `device` store.
    expect(await slotBytes()).toEqual(off.afterFight);
    expect((await storage()).quarantine).toEqual([]);
    expect(localWrites()).toEqual(off.writes);
    expect(github.writes).toEqual([]);
    // An attempt that never ended has left no note yet.
    expect(Object.keys(await deviceStore())).toEqual(expect.arrayContaining(ends === null ? [BACKUP_KEY] : [BACKUP_KEY, BACKUP_STATE]));
  });

  it('gives up on a call that is never answered after its time, and the run after that backs up', async () => {
    await configureKey();
    github.mode = 'hang';
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await mapShows();

    holdTheClock();
    dom.tap('Run');
    dom.tap('New run…');
    dom.tap('Start the run');
    await until(async () => (await hot()).payload.game.profile.counters.runsStarted === 2, 'the new run');
    await until(() => requests().length === 1, 'the backup to be tried');
    vi.advanceTimersByTime(BACKUP_TIMEOUT_MS - 1);
    await turns();
    expect((await notes()).lastAttempt ?? null).toBeNull();

    vi.advanceTimersByTime(1);
    await until(async () => (await notes()).lastAttempt?.outcome === 'unreachable', 'the attempt to be given up');
    expect(requests()).toEqual(['request GET']);
    const afterRun = await slotBytes();

    // The stuck call does not stand in the way of the next backup.
    github.mode = 'normal';
    await until(() => onMap(), 'the map');
    dom.tap('Run');
    dom.tap('New run…');
    dom.tap('Start the run');
    await until(async () => (await hot()).payload.game.profile.counters.runsStarted === 3, 'the next run');
    const record = await hot();
    await until(async () => (await notes()).lastOk?.seq === record.seq, 'the next run to be backed up');
    expect(github.file?.text).toBe(serializeRecord(record));
    expect(afterRun['hot']).not.toBe(serializeRecord(record));
  });

  // The backup has no handle on a slot. Three buttons do lead to a slot write all the same: "Back up now", saving
  // a key and "Overwrite the backup" first ask the game to save a walk it has not written yet. That write is the
  // game's own, through its one writer, and it is what hiding the page would have written.
  it('sends from "Back up now" only what the game itself has saved: a walk not yet written goes out through the game first', async () => {
    await configureKey();
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    const target = quietTile();
    const point = pagePoint(WORLD.start, target);
    if (point === null) throw new Error('the quiet tile is not on screen');
    const canvas = mapCanvas();
    canvas.fire('pointerdown', point);
    canvas.fire('pointerup', point);
    await settle();
    // The hero has walked and nothing is written or sent.
    expect(trace).toEqual([]);
    expect((await hot()).seq).toBe(5);

    openSettings();
    dom.tap('Back up now');
    await eventually(async () => expect((await hot()).seq).toBe(6));
    const record = await backedUp();
    expect(record.payload.game.run.position).toEqual({ zone: WORLD.start.zone, ...target });
    // Saved first, then sent: and what was sent is the record in the hot slot, byte for byte.
    expect(trace.slice(0, 3)).toEqual(['asked hot:6', 'committed hot:6', 'request GET']);
    expect(localWrites()).toEqual(['asked hot:6', 'committed hot:6']);
    expect(github.writes).toHaveLength(1);
    const [upload] = github.writes;
    if (upload === undefined) throw new Error('nothing was uploaded');
    expect(sentText(upload)).toBe(serializeRecord(record));
    expect(await slotBytes()).toEqual({ hot: serializeRecord(record) });
    await eventually(() => expect(shows('Backed up.')).toBe(true));
  });
});

// ---- check 4 ----

describe('check 4: a backup after each run', () => {
  it('sends exactly one upload per confirmed new run: the hot record now in storage, which passes its own checksum', async () => {
    await configureKey();
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    expect(github.calls).toEqual([]);

    await startRun(2);
    const first = await backedUp();
    expect(github.writes).toHaveLength(1);
    const [upload] = github.writes;
    if (upload === undefined) throw new Error('nothing was uploaded');
    expect(upload.url).toBe(`${BACKUP_ORIGIN}/repos/${OWNER}/${REPO}/contents/${BACKUP_FILE}`);
    expect(sentText(upload)).toBe(serializeRecord(first));
    expect(checksumMatches(JSON.parse(sentText(upload)))).toBe(true);
    expect(first).toMatchObject({ slot: 'hot', seq: 7, payload: { game: { profile: { counters: { runsStarted: 2 } } } } });
    expect(github.file?.text).toBe(serializeRecord(first));
    // The commit says which run and which save, and nothing from the game.
    expect(github.commits.map((commit) => commit.message)).toEqual(['Run 2, save 7']);
    const firstVersion = github.file?.sha;

    // Nothing but a new run sends anything: a fight, a setting and the page going away are saved and not sent.
    const calls = github.calls.length;
    await fightOnce();
    openSettings();
    dom.tap(/^Skip every battle/);
    await eventually(async () => expect((await hot()).seq).toBe(9));
    dom.fire('pagehide');
    await settle(50);
    expect(github.calls).toHaveLength(calls);

    await startRun(3);
    const second = await backedUp();
    expect(github.writes).toHaveLength(2);
    const next = github.writes[1];
    if (next === undefined) throw new Error('the second run was not uploaded');
    expect(sentText(next)).toBe(serializeRecord(second));
    expect(checksumMatches(JSON.parse(sentText(next)))).toBe(true);
    expect(second.payload.game.profile.counters.runsStarted).toBe(3);
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(github.file?.text).toBe(serializeRecord(second));
    // The first created the file. The second replaced the version the first had written, and no other.
    expect(sentSha(upload)).toBeUndefined();
    expect(firstVersion).toBeDefined();
    expect(sentSha(next)).toBe(firstVersion);
    await settle(50);
    expect(github.writes).toHaveLength(2);
  });

  it('backs up a game reached through the recovery screen like any other', async () => {
    // The newest save fails a check, so the launch stops on the recovery screen, which sends nothing.
    await seed(async (backend) => {
      await putRaw(backend, 'checkpoint-0', realRecord('checkpoint-0', 7, realGame(2)));
      await putRaw(backend, 'hot', realRecord('hot', 9, suspectGame(3)));
    });
    await configureKey();
    await startApp(dom.root, OPTIONS);
    await eventually(() => expect(dom.buttons()).toContain('Use hot anyway (run 3)'));
    await settle(50);
    expect(github.calls).toEqual([]);

    dom.tap(/^Use checkpoint-0/);
    await gameShowsRun(2);
    openSettings();
    expect(valueOf('Repository')).toBe(REPOSITORY);
    // A game picked on the recovery screen is looked at against the backup as soon as it is up. There is no
    // backup yet, so it is made.
    const picked = await backedUp();
    expect(github.writes).toHaveLength(1);
    expect(picked.payload.game.profile.counters.runsStarted).toBe(2);

    await startRun(3);
    const record = await backedUp();
    expect(github.writes).toHaveLength(2);
    expect(github.file?.text).toBe(serializeRecord(record));
    expect(record.payload.game.profile.counters.runsStarted).toBe(3);
  });

  it('backs up a new game started from the recovery screen', async () => {
    await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 9, suspectGame(3))));
    await configureKey();
    await startApp(dom.root, OPTIONS);
    await eventually(() => expect(dom.buttons()).toContain('Start a new game…'));
    dom.tap('Start a new game…');
    dom.tap(/^Tap again to start a new game/);
    await gameShowsRun(1);
    // The new game is looked at against the backup at once. The repository is empty, so it becomes the backup.
    const begun = await backedUp();
    expect(begun.payload.game.profile.counters.runsStarted).toBe(1);
    expect(github.writes).toHaveLength(1);

    await startRun(2);
    const record = await backedUp();
    expect(github.writes).toHaveLength(2);
    expect(github.file?.text).toBe(serializeRecord(record));
  });

  // Was a place where two documents differed, since settled. STATUS check 4 says the upload is "of the newest
  // good record", and ARCHITECTURE 7.3 keeps "good" for a record that passes the consistency checks. The code
  // sent the hot record whatever it held, so a game that failed a check took the place of the last good backup.
  // The backup now follows the checkpoint's rule: a run whose checkpoint was skipped is not sent, and the notice
  // about the skipped checkpoint says so.
  it('sends nothing for a run whose checkpoint was skipped for failing a consistency check, and keeps the last good backup', async () => {
    await configureKey();
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await startRun(2);
    const good = await backedUp();
    expect(checkInvariants(good.payload.game, WORLD)).toEqual([]);

    // A save that is intact but fails a check is imported and used anyway, as the import sheet allows.
    openSettings();
    dom.tap('Import…');
    dom.fill(JSON.stringify(realRecord('hot', 9, suspectGame(3))));
    dom.tap('Check');
    dom.tap('Replace the current game anyway');
    await eventually(async () => expect((await hot()).payload.game.profile.counters.runsStarted).toBe(3));
    // A save that fails a check is not sent by itself, on import or at a run's end. It is sent here by hand,
    // which is allowed as an export is, so that the file is this game's and what follows tests the skipped run.
    await settle(60);
    expect(github.file?.text).toBe(serializeRecord(good));
    openSettings();
    dom.tap('Back up now');
    await eventually(async () => expect(github.file?.text).toBe(serializeRecord(await hot())));
    const overwritten = github.file?.text;
    expect(overwritten).toBe(serializeRecord(await hot()));
    const writesBefore = github.writes.length;
    const callsBefore = github.calls.length;

    // The run after it. Its checkpoint is skipped, and so is its backup.
    dom.tap('Run');
    dom.tap('New run…');
    dom.tap('Start the run');
    await eventually(async () => expect((await hot()).payload.game.profile.counters.runsStarted).toBe(4));
    await settle(80);
    expect(checkInvariants((await hot()).payload.game, WORLD)).not.toEqual([]);
    expect(showsStart('A checkpoint was skipped because the save failed a consistency check')).toBe(true);
    expect(lines().some((line) => line.endsWith('The cloud backup was not updated either: it still holds the last save that passed.'))).toBe(true);
    // Nothing was sent and nothing was asked: the file is as the player left it.
    expect(github.writes).toHaveLength(writesBefore);
    expect(github.calls).toHaveLength(callsBefore);
    expect(github.file?.text).toBe(overwritten);
  });
});

// ---- check 5 ----

describe('check 5: a failure shows and does not block', () => {
  const REFUSED_REMINDER = 'The cloud backup has stopped: GitHub refused the key. The save on this phone is unaffected.';
  const MISSING_REMINDER = 'The cloud backup has stopped: GitHub found no such repository for the key. The save on this phone is unaffected.';
  /** How each sentence in Settings begins. Only one of them is ever on screen. */
  const SENTENCES = ['GitHub refused the key.', 'GitHub found no such repository for this key.', 'GitHub could not be reached.', 'The backup did not go through', 'The backup holds a different game, or one that has something the game on this phone does not'];

  /** A launch with a key on the phone, then a new run whose backup the service answers in `mode`. */
  const failARun = async (mode: FakeMode, ends: BackupOutcome): Promise<void> => {
    await configureKey();
    await seedGame();
    github.mode = mode;
    await startApp(dom.root, OPTIONS);
    await startRun(2);
    await attemptEnds(ends);
  };

  const CASES: ReadonlyArray<{ mode: FakeMode; ends: BackupOutcome; words: string; reminder: string | null }> = [
    { mode: 401, ends: 'refused', words: 'GitHub refused the key.', reminder: REFUSED_REMINDER },
    { mode: 403, ends: 'refused', words: 'GitHub refused the key.', reminder: REFUSED_REMINDER },
    { mode: 404, ends: 'not-found', words: 'GitHub found no such repository for this key.', reminder: MISSING_REMINDER },
    { mode: 'offline', ends: 'unreachable', words: 'GitHub could not be reached.', reminder: null },
    { mode: 'throw', ends: 'unreachable', words: 'GitHub could not be reached.', reminder: null },
    { mode: 409, ends: 'failed', words: 'The backup did not go through (GitHub answered 409).', reminder: null },
    { mode: 422, ends: 'failed', words: 'The backup did not go through (GitHub answered 422).', reminder: null },
    { mode: 500, ends: 'failed', words: 'The backup did not go through (GitHub answered 500).', reminder: null },
  ];

  it.each(CASES)('says what "$mode" came to in Settings, reminds on the map only where the player has to act, and never blocks play', async ({ mode, ends, words, reminder }) => {
    await failARun(mode, ends);

    // The map: a reminder with a way to Settings and a way to put it off, or nothing at all.
    if (reminder === null) {
      await settle(50);
      expect(reminderShowing()).toBe(false);
      expect(dom.buttons()).not.toContain('Later');
      expect(dom.buttons()).not.toContain('Open Settings');
    } else {
      await eventually(() => expect(shows(reminder), 'the reminder is on the map').toBe(true));
      expect(dom.buttons()).toEqual(expect.arrayContaining(['Open Settings', 'Later']));
    }

    // Play goes on under it: a fight is fought and saved.
    await fightOnce();
    expect((await hot()).payload.game.run.battleCount).toBe(1);

    // Settings: nothing has been backed up, the attempt did not go through, and one sentence says why.
    openSettings();
    expect(valueOf('Repository')).toBe(REPOSITORY);
    expect(valueOf('Key')).toBe('Set, on this phone only');
    expect(valueOf('Last backup')).toBe('None yet');
    expect(valueOf('Last attempt')).toMatch(/^Did not go through at \d{4}-\d\d-\d\d \d\d:\d\d$/);
    expect(showsStart(words)).toBe(true);
    expect(SENTENCES.filter((start) => showsStart(start))).toHaveLength(1);
    // Every one of them says the save itself is fine.
    expect(lines().find((line) => line.startsWith(words))).toContain('The save on this phone is unaffected');
  });

  it('puts the reminder for a refused key off with "Later" until the app is next started, and no longer', async () => {
    await failARun(401, 'refused');
    await eventually(() => expect(shows(REFUSED_REMINDER)).toBe(true));
    expect(dom.buttons().filter((label) => label === 'Later')).toHaveLength(1);
    const before = await saved();

    dom.tap('Later');
    expect(reminderShowing()).toBe(false);
    expect(dom.buttons()).not.toContain('Later');
    expect(dom.buttons()).not.toContain('Open Settings');
    // It was put off, not answered: no save was written for it.
    await settle(50);
    expect(await saved()).toBe(before);

    // It stays away on every screen.
    for (const tab of ['Hero', 'Gear', 'Items', 'Bestiary', 'Run', 'Map']) {
      dom.tap(tab);
      expect(reminderShowing(), tab).toBe(false);
    }

    // The app is closed and opened again, with nothing tried in between. The reminder is back: putting it off
    // was not remembered anywhere.
    await relaunch();
    await mapShows();
    expect(shows(REFUSED_REMINDER)).toBe(true);

    // Put off again, it stays away through a run that is refused again, while Settings still says it.
    dom.tap('Later');
    const asked = requests().length;
    await startRun(3);
    await eventually(() => expect(requests().length).toBeGreaterThan(asked));
    await settle(50);
    expect(reminderShowing()).toBe(false);
    openSettings();
    expect(showsStart('GitHub refused the key.')).toBe(true);

    // And at the launch after that it is back, and leads to Settings.
    await relaunch();
    await mapShows();
    expect(shows(REFUSED_REMINDER)).toBe(true);
    dom.tap('Open Settings');
    expect(valueOf('Repository')).toBe(REPOSITORY);
    expect(showsStart('GitHub refused the key.')).toBe(true);
  });

  it('shows no reminder for being offline, at this launch or the next, and the first run back online backs up', async () => {
    await failARun('offline', 'unreachable');
    expect(reminderShowing()).toBe(false);
    await relaunch();
    await mapShows();
    expect(reminderShowing()).toBe(false);
    expect(dom.buttons()).not.toContain('Later');
    openSettings();
    expect(showsStart('GitHub could not be reached.')).toBe(true);

    github.mode = 'normal';
    await startRun(3);
    const record = await backedUp();
    expect(github.file?.text).toBe(serializeRecord(record));
    openSettings();
    // The last backup that worked, by run and time, and nothing left of the failure.
    expect(valueOf('Last backup')).toMatch(new RegExp(`^run 3, save ${record.seq} at \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d$`));
    expect(valueOf('Last attempt')).toMatch(/^Worked at \d{4}-\d\d-\d\d \d\d:\d\d$/);
    expect(SENTENCES.filter((start) => showsStart(start))).toEqual([]);
    // It is remembered: the next launch says the same.
    const told = valueOf('Last backup');
    await relaunch();
    await mapShows();
    openSettings();
    expect(valueOf('Last backup')).toBe(told);
    expect(valueOf('Last attempt')).toMatch(/^Worked at /);
  });

  // Was a disagreement, since fixed. A browser will not put a character outside Latin-1 into a header: `fetch`
  // throws before anything is sent. A key pasted with one (a zero-width space from a note, say) was stored,
  // every backup failed without a call being made, Settings said the phone might be offline, and the map showed
  // no reminder, although it was a failure only the player could put right. The key is now cleaned of what a
  // paste can pick up, and one that still holds such a character is refused in the sheet. The stand-in service
  // does not check headers, so this test puts a real `Headers` in front of it.
  it('does not call a key the browser cannot send "offline", with nothing on the map to say the backup has stopped', async () => {
    const asABrowser: FetchLike = (url, init) => {
      new Headers(init.headers as Record<string, string>);
      return github.fetch(url, init);
    };
    vi.stubGlobal('fetch', asABrowser);
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    typeKey(REPOSITORY, `${token}\u200b`);
    dom.tap('Save the key');
    const gaveUp = await comesTrue(async () => (await notes()).lastAttempt?.outcome === 'unreachable');
    if (shows('Cloud backup key')) dom.tap('Cancel');
    openSettings();
    const saysOffline = gaveUp && showsStart('GitHub could not be reached.');
    dom.tap('Map');
    expect(saysOffline && !reminderShowing(), 'Settings says the phone may be offline, and the map says nothing').toBe(false);
  });

  // Added by the code's author with the fix above. A key that still holds a character no key has, once what a
  // paste picks up is taken out, is refused where it is typed, in words that say what to do about it.
  it('refuses, in the sheet, a key that holds a character no key has: nothing is stored or sent, and the box is emptied', async () => {
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    const box = typeKey(REPOSITORY, `${token}é`);
    dom.tap('Save the key');
    await settle(40);
    expect(shows('Cloud backup key')).toBe(true);
    expect(shows('That is not a key: it holds a character no key has. Copy it again from GitHub and paste it here.')).toBe(true);
    expect(box.value).toBe('');
    expect((await deviceStore())[BACKUP_KEY]).toBeUndefined();
    expect(github.calls).toEqual([]);
  });
});

// ---- check 6 ----

describe('check 6: restore is an import', () => {
  const UNSEEN_REMINDER = 'The cloud backup holds a different game, or one that has something this one does not, so nothing is being backed up. The save on this phone is unaffected.';
  const CONFIRM = 'Replace the current game?';

  /** The run counts the confirmation sheet sets side by side, the current game's first. */
  const runsCompared = (): string[] => lines().flatMap((line, index, all) => (line === 'Runs started' ? [all[index + 1] ?? ''] : []));

  const sealed = (fields: Record<string, unknown>): string => JSON.stringify({ ...fields, checksum: checksumOf(fields) });

  /** A phone with a game in its twelfth run, an older checkpoint and a set-aside save, and a key that has backed up nothing. */
  const phoneWithAGame = async (): Promise<void> => {
    await seed(async (backend) => {
      await putRaw(backend, 'checkpoint-0', realRecord('checkpoint-0', 40, realGame(8)));
      await putRaw(backend, 'hot', realRecord('hot', 57, realGame(12)));
      await backend.addQuarantine([{ slot: 'hot', kind: 'kept', reason: 'replaced-by-import', raw: realRecord('hot', 20, realGame(5)) }]);
    });
    await configureKey();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    trace = [];
  };

  it('shows both saves, changes nothing until confirmed, sets the current game aside first, and then backs up over the file it restored', async () => {
    const theirs = otherGame();
    const text = serializeRecord(theirs);
    const sha = github.seed(text);
    await phoneWithAGame();
    const before = await saved();

    openSettings();
    dom.tap('Restore from backup…');
    await eventually(() => expect(shows(CONFIRM), 'the confirmation sheet is showing').toBe(true));
    expect(lines()).toEqual(expect.arrayContaining(['Current', 'Incoming']));
    expect(runsCompared()).toEqual(['12', '40']);
    expect(shows('The current game is first set aside, so it can be restored from Settings.')).toBe(true);
    // Nothing changes until it is confirmed: not the saves, not the backup, not what this install knows of it.
    await settle(50);
    expect(await saved()).toBe(before);
    expect(localWrites()).toEqual([]);
    expect(github.file).toEqual({ text, sha });
    expect(github.writes).toEqual([]);
    expect(await notes()).toEqual({});
    dom.tap('Cancel');
    expect(shows(CONFIRM)).toBe(false);
    await settle(50);
    expect(await saved()).toBe(before);

    // Having looked is not having restored: the next run still leaves the file alone, and the map says why.
    await startRun(13);
    await attemptEnds('left-alone');
    expect(github.file).toEqual({ text, sha });
    expect(github.writes).toEqual([]);
    await eventually(() => expect(shows(UNSEEN_REMINDER)).toBe(true));

    const current = await hot();
    trace = [];
    openSettings();
    dom.tap('Restore from backup…');
    await eventually(() => expect(shows(CONFIRM)).toBe(true));
    expect(runsCompared()).toEqual(['13', '40']);
    dom.tap('Replace the current game');
    dom.tap('Replace the current game');
    await eventually(async () => expect((await hot()).payload.game.profile.counters.runsStarted).toBe(40));
    await eventually(() => expect(shows(CONFIRM)).toBe(false));

    // The game that was replaced is kept twice over, and both copies were made before the hot slot was touched.
    const after = await storage();
    expect(after.quarantine).toHaveLength(2);
    expect(after.quarantine).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'kept', reason: 'replaced-by-import', slot: 'hot', seq: current.seq, raw: current })]));
    // The run before took the second checkpoint slot, so this copy goes into the third.
    expect(after.slots['checkpoint-2']).toMatchObject({ seq: current.seq + 1, payload: current.payload });
    expect(after.slots['hot']).toMatchObject({ seq: current.seq + 2, buildId: BUILD.buildId, payload: theirs.payload });
    expect(localWrites()).toEqual([
      'set aside 1',
      `asked checkpoint-2:${current.seq + 1}`,
      `committed checkpoint-2:${current.seq + 1}`,
      `asked hot:${current.seq + 2}`,
      `committed hot:${current.seq + 2}`,
    ]);
    expect(showsStart('Save replaced.')).toBe(true);
    // The game on the phone is now the backup's own, and the backup is looked at again at once: the phone's
    // record of it, which holds everything the file does, takes the place of exactly the version restored.
    await eventually(() => expect(github.writes).toHaveLength(1));
    const [upload] = github.writes;
    if (upload === undefined) throw new Error('nothing was uploaded');
    expect(sentSha(upload)).toBe(sha);
    await eventually(async () => expect(github.file?.text).toBe(serializeRecord(await hot())));
    await attemptEnds('ok');
    dom.tap('Map');
    await eventually(() => expect(reminderShowing()).toBe(false));

    // And the next run's backup goes through like any other.
    await startRun(41);
    const record = await backedUp();
    expect(github.writes).toHaveLength(2);
    expect(github.file?.text).toBe(serializeRecord(record));
    expect(record.payload.game.profile.counters.runsStarted).toBe(41);
    expect(reminderShowing()).toBe(false);
  });

  const REFUSED: ReadonlyArray<{ what: string; text: () => string; says: string }> = [
    { what: 'a record whose checksum does not match', text: () => serializeRecord({ ...otherGame(), seq: 901 }), says: 'This save is damaged: checksum does not match.' },
    { what: 'a record cut short', text: () => serializeRecord(otherGame()).slice(0, 400), says: 'it could not be read.' },
    { what: 'a file that is not a save', text: () => JSON.stringify({ hello: 'there' }), says: 'This save is damaged' },
    { what: 'an empty file', text: () => '', says: 'Nothing to import.' },
    {
      what: 'a record from a newer save version',
      text: () => sealed({ ...unsealed(otherGame()), saveVersion: SAVE_VERSION + 1 }),
      says: `This save was written by a newer version of the game (save version ${SAVE_VERSION + 1}).`,
    },
  ];

  it.each(REFUSED)('refuses $what with a notice, and leaves every slot and set-aside save the same bytes', async ({ text, says }) => {
    const theirs = text();
    const sha = github.seed(theirs);
    await phoneWithAGame();
    const before = await saved();

    openSettings();
    dom.tap('Restore from backup…');
    await eventually(() => expect(showsStart('The backup cannot be restored.'), 'the notice is showing').toBe(true));
    const notice = lines().find((line) => line.startsWith('The backup cannot be restored.')) ?? '';
    expect(notice).toContain(says);
    expect(notice.endsWith('Nothing on this phone was changed.')).toBe(true);
    // Nothing is offered that could put it in place.
    expect(shows(CONFIRM)).toBe(false);
    expect(dom.buttons().filter((label) => label.startsWith('Replace the current game'))).toEqual([]);
    await settle(50);
    expect(await saved()).toBe(before);
    expect(localWrites()).toEqual([]);

    // Nor is a backup that cannot be read one this install may write over: the next run leaves it as it is.
    expect(await notes()).toEqual({});
    await startRun(13);
    await attemptEnds('left-alone');
    expect(github.file).toEqual({ text: theirs, sha });
    expect(github.writes).toEqual([]);
  });

  it('offers a backup that fails a consistency check as an import does, to be used anyway or not', async () => {
    const suspect = sealRecord({ ...unsealed(otherGame()), payload: { game: suspectGame(40), app: newAppState(FIXED_NOW - 9000) } });
    expect(checkInvariants(suspect.payload.game, WORLD)).not.toEqual([]);
    github.seed(serializeRecord(suspect));
    await phoneWithAGame();
    const before = await saved();

    openSettings();
    dom.tap('Restore from backup…');
    await eventually(() => expect(shows(CONFIRM)).toBe(true));
    expect(showsStart('The incoming save is intact but fails a consistency check')).toBe(true);
    expect(dom.buttons()).toContain('Replace the current game anyway');
    expect(dom.buttons()).not.toContain('Replace the current game');
    dom.tap('Cancel');
    await settle(50);
    expect(await saved()).toBe(before);
  });

  it('says so, and changes nothing, when there is no backup to restore or it cannot be fetched', async () => {
    await phoneWithAGame();
    const before = await saved();
    openSettings();

    dom.tap('Restore from backup…');
    await eventually(() => expect(shows('There is no backup in the repository yet.')).toBe(true));
    github.mode = 'offline';
    dom.tap('Restore from backup…');
    await eventually(() => expect(showsStart('The backup could not be fetched. GitHub could not be reached.')).toBe(true));
    github.mode = 401;
    dom.tap('Restore from backup…');
    await eventually(() => expect(showsStart('The backup could not be fetched. GitHub refused the key.')).toBe(true));

    expect(shows(CONFIRM)).toBe(false);
    await settle(50);
    expect(await saved()).toBe(before);
    expect(localWrites()).toEqual([]);
    expect(github.writes).toEqual([]);
    // Looking is not an attempt at a backup, so nothing is noted and the map has nothing to remind of.
    expect(await notes()).toEqual({});
    dom.tap('Map');
    expect(reminderShowing()).toBe(false);
  });

  it('never writes over a backup this install has not seen: not when the key is entered, not after a run, not from "Back up now", not after a relaunch', async () => {
    const text = serializeRecord(otherGame());
    const sha = github.seed(text);
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    const untouched = (): void => {
      expect(github.file).toEqual({ text, sha });
      expect(github.writes).toEqual([]);
      expect(github.commits).toHaveLength(1);
      expect(requests().every((entry) => entry === 'request GET')).toBe(true);
    };
    /** Waits for the next look at the backup to have been made and answered. */
    const looked = async (times: number): Promise<void> => {
      await eventually(() => expect(requests()).toHaveLength(times));
      await attemptEnds('left-alone');
      await settle(50);
      untouched();
    };

    // Entering the key tries one backup, which looks and goes no further.
    typeKey(REPOSITORY, token);
    dom.tap('Save the key');
    await keySheetClosed();
    await looked(1);
    expect(showsStart('The backup holds a different game, or one that has something the game on this phone does not, so it was left alone.')).toBe(true);
    expect(dom.buttons()).toEqual(expect.arrayContaining(['Restore from backup…', 'Overwrite the backup…']));

    await startRun(2);
    await looked(2);
    expect(shows(UNSEEN_REMINDER)).toBe(true);
    await startRun(3);
    await looked(3);

    openSettings();
    dom.tap('Back up now');
    await looked(4);
    await eventually(() => expect(shows('The backup did not go through.')).toBe(true));

    await relaunch();
    await mapShows();
    expect(shows(UNSEEN_REMINDER)).toBe(true);
    await startRun(4);
    await looked(5);

    // The other answer is the player's to give, on a sheet of its own, and only its confirm button writes.
    openSettings();
    dom.tap('Overwrite the backup…');
    expect(shows('Overwrite the backup?')).toBe(true);
    dom.tap('Cancel');
    await settle(50);
    untouched();
    expect(requests()).toHaveLength(5);

    dom.tap('Overwrite the backup…');
    dom.tap('Overwrite the backup with this game');
    expect(shows('Overwrite the backup?')).toBe(false);
    const record = await backedUp();
    expect(github.writes).toHaveLength(1);
    const [upload] = github.writes;
    if (upload === undefined) throw new Error('nothing was uploaded');
    expect(sentSha(upload)).toBe(sha);
    expect(github.file?.text).toBe(serializeRecord(record));
    // From here on the file is this install's own, and a run backs up.
    await startRun(5);
    expect(github.file?.text).toBe(serializeRecord(await backedUp()));
    expect(github.writes).toHaveLength(2);
    dom.tap('Map');
    expect(reminderShowing()).toBe(false);
  });

  // Check 11 as far as a laptop can take it: the app is deleted, installed again, the key entered, the backup
  // restored. What comes back is the game as its last backup held it. A backup is made when a run starts, so
  // what was played in that run afterwards is not in it unless "Back up now" was tapped.
  it('brings the game back after the app is deleted and installed again: the key entered, the backup left alone, restored, and backed up again', async () => {
    await seedGame(12, 57);
    await configureKey();
    await startApp(dom.root, OPTIONS);
    await startRun(13);
    const backed = await backedUp();
    // A fight after the backup. It is saved on the phone and has not been sent.
    await fightOnce();
    expect((await hot()).payload.game.run.battleCount).toBe(1);
    const file = github.file;
    if (file === null) throw new Error('there is no backup');
    expect(file.text).toBe(serializeRecord(backed));
    const calls = github.calls.length;

    // Deleting the app takes the save, the key and the notes with it. The new install is a new game.
    newPhone();
    await startApp(dom.root, OPTIONS);
    await gameShowsRun(1);
    expect(github.calls).toHaveLength(calls);
    typeKey(REPOSITORY, token);
    dom.tap('Save the key');
    await keySheetClosed();
    await attemptEnds('left-alone');
    expect(github.file).toEqual(file);
    expect(github.writes).toHaveLength(1);

    dom.tap('Restore from backup…');
    await eventually(() => expect(shows(CONFIRM)).toBe(true));
    expect(runsCompared()).toEqual(['1', '13']);
    dom.tap('Replace the current game');
    await eventually(async () => expect((await hot()).payload.game.profile.counters.runsStarted).toBe(13));
    const restored = await hot();
    // Both halves of the save are as the backup held them: the game, and the settings and run times with it.
    expect(restored.payload).toEqual(backed.payload);
    expect(restored.payload.game.run.battleCount).toBe(0);
    expect(restored.payload.app.settings.skipPlayback).toBe(true);
    dom.tap('Map');
    await gameShowsRun(13);
    // The new install's own short game is set aside, not lost.
    expect((await storage()).quarantine).toMatchObject([{ kind: 'kept', reason: 'replaced-by-import', slot: 'hot', raw: { payload: { game: { profile: { counters: { runsStarted: 1 } } } } } }]);

    // The restored game is looked at against the backup at once and takes the place of the version it came from.
    await eventually(() => expect(github.writes).toHaveLength(2));
    const upload = github.writes[1];
    if (upload === undefined) throw new Error('the restored game was not uploaded');
    expect(sentSha(upload)).toBe(file.sha);
    await attemptEnds('ok');
    expect(reminderShowing()).toBe(false);

    await startRun(14);
    const next = await backedUp();
    expect(github.file?.text).toBe(serializeRecord(next));
    expect(github.writes).toHaveLength(3);
  });

  // Was a disagreement, since fixed. Not with the rule as first written, since the file was this install's
  // own, but with the reason GDD D-40 gives for it. The guard knew the install, not the game: when the save on
  // the phone went bad and a new game was started from the recovery screen, the first finished run of that new
  // game replaced the backup of the old one. Importing a save and using an older checkpoint went the same way.
  // Any choice on the recovery screen, and any save put in the game's place except the backup's own, now makes
  // the backup one this install has not seen.
  it('does not put a new game, started from the recovery screen, in place of the backup of the game this phone had', async () => {
    await seedGame(40, 57);
    await configureKey();
    await startApp(dom.root, OPTIONS);
    await startRun(41);
    const kept = await backedUp();

    // The save on the phone goes bad, so the next launch stops on the recovery screen. Nothing there offers the
    // backup; the way to it is a new game and then Settings.
    await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 80, suspectGame(41))));
    await relaunch();
    await eventually(() => expect(dom.buttons()).toContain('Start a new game…'));
    dom.tap('Start a new game…');
    dom.tap(/^Tap again to start a new game/);
    await gameShowsRun(1);
    // One run of the new game is played before Settings is opened.
    await startRun(2);
    const replaced = await comesTrue(() => github.file?.text !== serializeRecord(kept));
    expect(replaced, 'the new game took the place of the backup').toBe(false);
    expect(github.file?.text).toBe(serializeRecord(kept));
  });

  // The same rule for the other ways a game can stop being the one the backup was made from. Added by the
  // code's author with the fix, not by the pass that wrote the tests above.
  it('does not put an imported save in place of the backup of the game this phone had, until the player says to', async () => {
    await seedGame(40, 57);
    await configureKey();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    // A fight, so that the game on the phone keeps something an earlier save of it does not.
    await fightOnce();
    await startRun(41);
    const kept = await backedUp();

    // An earlier save of the same game is imported. The backup is looked at again at once, and left alone.
    openSettings();
    dom.tap('Import…');
    dom.fill(JSON.stringify(realRecord('hot', 9, realGame(3))));
    dom.tap('Check');
    dom.tap('Replace the current game');
    await eventually(async () => expect((await hot()).payload.game.profile.counters.runsStarted).toBe(3));
    await attemptEnds('left-alone');
    expect(github.file?.text).toBe(serializeRecord(kept));
    dom.tap('Map');
    await eventually(() => expect(reminderShowing()).toBe(true));
    await startRun(4);
    await settle(60);
    expect(github.file?.text).toBe(serializeRecord(kept));
    expect(github.writes).toHaveLength(1);
    expect(reminderShowing()).toBe(true);

    // The player's answer, and from there the imported game is backed up like any other.
    openSettings();
    dom.tap('Overwrite the backup…');
    dom.tap('Overwrite the backup with this game');
    await attemptEnds('ok');
    expect(github.file?.text).toBe(serializeRecord(await hot()));
    await startRun(5);
    await eventually(() => expect(github.file?.text).not.toBe(serializeRecord(kept)));
    expect(github.commits.map((commit) => commit.text)).toContain(serializeRecord(kept));
  });

  it('does not put an older save, picked on the recovery screen, in place of a newer backup', async () => {
    await seedGame(40, 57);
    await configureKey();
    await startApp(dom.root, OPTIONS);
    await startRun(41);
    // A fight in run 41, so that everything from here on keeps something the save made as run 41 began does not.
    await fightOnce();
    await startRun(42);
    const kept = await backedUp();
    expect(kept.payload.game.profile.counters.runsStarted).toBe(42);

    // The newest record goes bad in a way that stops on the recovery screen, where the save from before that
    // fight is used.
    const newest = (await hot()).seq;
    await seed((backend) => putRaw(backend, 'hot', realRecord('hot', newest + 20, suspectGame(42))));
    await relaunch();
    await eventually(() => expect(dom.buttons().some((label) => label.startsWith('Use')), 'the recovery screen offers an older save').toBe(true));
    const older = dom.buttons().filter((label) => label.startsWith('Use') && !label.includes('anyway') && label.includes('(run 41,'));
    expect(older).toHaveLength(1);
    dom.tap(older[0] ?? '');
    await mapShows();
    // Looked at against the backup at once, and left alone; the reminder says so before any run is finished.
    await attemptEnds('left-alone');
    await eventually(() => expect(reminderShowing()).toBe(true));
    await startRun(42);
    await settle(60);
    expect(github.file?.text).toBe(serializeRecord(kept));
    expect(github.writes).toHaveLength(2);
  });

  // Was a disagreement, since fixed. The restore waited on the network and then opened its confirmation,
  // whatever was on screen by then: a sheet the player had opened meanwhile was replaced under the finger by one
  // whose first button is "Replace the current game". The restore now has a sheet of its own while it waits, and
  // an answer that finds another sheet in its place is dropped.
  it('does not put its confirmation in place of a sheet the player has opened while the backup was being fetched', async () => {
    github.seed(serializeRecord(otherGame()));
    await phoneWithAGame();
    let answer: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const slow: FetchLike = async (url, init) => {
      await held;
      return github.fetch(url, init);
    };
    vi.stubGlobal('fetch', slow);

    openSettings();
    dom.tap('Restore from backup…');
    await settle(30);
    dom.tap('Run');
    dom.tap('New run…');
    expect(shows('Start run 13?')).toBe(true);
    answer();
    const replaced = await comesTrue(() => shows(CONFIRM));
    expect(replaced, 'the confirmation took the place of the sheet that was open').toBe(false);
    expect(shows('Start run 13?')).toBe(true);
    expect(dom.buttons()).not.toContain('Replace the current game');
  });
});

// ---- check 7 ----

describe('check 7: the key stays where it was put', () => {
  it('is in the device store under its own name and in the Authorization header, and nowhere else the game writes, shows or sends', async () => {
    // A marker no other text here can hold by accident. It is the only key the service takes.
    const marker = madeUpKey('marker');
    github.token = marker;
    const holds = (value: unknown): boolean => (typeof value === 'string' ? value : (JSON.stringify(value) ?? '')).includes(marker);
    /** Looks at whatever is on screen now, every text box included. Only ever a yes or a no. */
    let looks = 0;
    const look = (where: string): void => {
      looks += 1;
      expect(holds(dom.text()), `the key is on screen: ${where}`).toBe(false);
      expect(dom.fields().some(holds), `the key is in a box: ${where}`).toBe(false);
    };
    // The laptop's way to save the export file: the text the download would hold is kept here.
    const downloads: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      downloads.push(blob as Blob);
      return 'blob:made-up';
    });

    await seedGame();
    await startApp(dom.root, OPTIONS);
    await mapShows();

    // The key goes in through the sheet, and the service refuses it this once: a failed request to log.
    github.mode = 401;
    const box = typeKey(REPOSITORY, marker);
    expect(box.attributes['type']).toBe('password');
    expect(box.value).toBe(marker);
    dom.tap('Save the key');
    // The box is emptied as it is read, before anything is stored or sent.
    expect(box.value).toBe('');
    look('the key sheet as it saves');
    await keySheetClosed();
    await attemptEnds('refused');
    look('Settings after a refused key');
    expect(showsStart('GitHub refused the key.')).toBe(true);

    // The sheet opened again shows the repository and never the key. Cancel empties what was typed.
    dom.tap('Change or forget the key…');
    expect(dom.fields()).toEqual([REPOSITORY, '']);
    look('the key sheet opened again');
    dom.fill(marker, 1);
    const again = textBoxes()[1];
    if (again === undefined) throw new Error('the key sheet has no second box');
    expect(again.value).toBe(marker);
    dom.tap('Cancel');
    expect(again.value).toBe('');
    expect(shows('Cloud backup key')).toBe(false);
    look('Settings after the sheet was cancelled');

    // A run backs up.
    github.mode = 'normal';
    await startRun(2);
    await backedUp();
    look('the map after a backup');

    // An export: the file as it would be downloaded, and the text code.
    openSettings();
    dom.tap('Export…');
    await eventually(() => expect(shows('Nothing has been shared or copied yet.'), 'the export sheet is showing').toBe(true));
    look('the export sheet');
    const [code = ''] = dom.fields();
    dom.tap('Download the file');
    const [download] = downloads;
    if (download === undefined) throw new Error('no file was downloaded');
    const fileText = await download.text();
    dom.tap('Done');

    // An import of that code, and then a restore from the backup: each sets a copy of the game aside first.
    dom.tap('Import…');
    dom.fill(code);
    dom.tap('Check');
    expect(shows('Replace the current game?')).toBe(true);
    look('the import confirmation');
    dom.tap('Replace the current game');
    await eventually(async () => expect((await storage()).quarantine).toHaveLength(1));
    await eventually(() => expect(shows('Replace the current game?')).toBe(false));
    // A restore the service refuses, which leaves a notice, and then one that goes through.
    github.mode = 401;
    dom.tap('Restore from backup…');
    await eventually(() => expect(showsStart('The backup could not be fetched. GitHub refused the key.'), 'the notice is showing').toBe(true));
    look('Settings after a restore that was refused');
    github.mode = 'normal';
    dom.tap('Restore from backup…');
    await eventually(() => expect(shows('Replace the current game?'), 'the restore confirmation is showing').toBe(true));
    look('the restore confirmation');
    dom.tap('Replace the current game');
    await eventually(async () => expect((await storage()).quarantine).toHaveLength(2));
    await eventually(() => expect(shows('Replace the current game?')).toBe(false));
    look('Settings after two replacements');

    // One more run, backed up over the restored file, and a fight in it for the sheets a fight shows.
    await startRun(3);
    await backedUp();
    const enemy = pagePoint(WORLD.start, firstEnemy().at);
    if (enemy === null) throw new Error('the first enemy is not on screen from the run start');
    const canvas = mapCanvas();
    canvas.fire('pointerdown', enemy);
    canvas.fire('pointerup', enemy);
    await eventually(() => expect(dom.buttons().includes('Fight'), 'the pre-fight sheet is showing').toBe(true));
    look('the pre-fight sheet');
    dom.tap('Fight');
    await eventually(() => expect(resultShowing(), 'the result sheet is showing').toBe(true));
    look('the result sheet');
    dom.tap('Back to the map');

    // Every screen, the diagnostics log opened, and the sheets beside them.
    for (const tab of ['Map', 'Hero', 'Gear', 'Items', 'Bestiary', 'Run']) {
      dom.tap(tab);
      look(tab);
    }
    dom.tap('Salvage…');
    look('the Salvage sheet');
    dom.tap('Back');
    dom.tap('New run…');
    look('the new run sheet');
    dom.tap('Cancel');
    dom.tap('Settings');
    dom.tap('Import…');
    look('the import sheet');
    dom.tap('Cancel');
    dom.tap('Show the log');
    await eventually(() => expect(shows('refused (HTTP 401)'), 'the log shows the refused request').toBe(true));
    look('Settings with the diagnostics log open');
    // Another install writes the backup, so that this one is offered the sheet that would overwrite it.
    github.seed(serializeRecord(otherGame()));
    dom.tap('Back up now');
    await attemptEnds('left-alone');
    await eventually(() => expect(dom.buttons()).toContain('Overwrite the backup…'));
    look('Settings with a backup this phone has not seen');
    dom.tap('Overwrite the backup…');
    look('the overwrite sheet');
    dom.tap('Cancel');
    expect(looks).toBeGreaterThanOrEqual(22);
    await settle(50);

    // No slot record and no set-aside copy.
    const held = await storage();
    expect(Object.keys(held.slots).length).toBeGreaterThan(1);
    expect(holds(held.slots), 'a slot record').toBe(false);
    expect(held.quarantine).toHaveLength(2);
    expect(holds(held.quarantine), 'a set-aside copy').toBe(false);

    // Not the diagnostics store, which did log the refused request.
    const diagnostics = await (async () => {
      const backend = new LocalBackend();
      const entries = await backend.readDiagnostics();
      (await backend.handle()).close();
      return entries;
    })();
    expect(diagnostics.map((entry) => `${entry.kind}: ${entry.message}`)).toContain('backup: refused (HTTP 401)');
    expect(holds(diagnostics), 'the diagnostics store').toBe(false);

    // Not the export file, which carries the record, the set-aside saves and that log; and not the text code.
    const bundle = JSON.parse(fileText) as { format?: unknown; record?: unknown; diagnostics?: unknown[] };
    expect(bundle.format).toBe('farther-still-export');
    expect(checksumMatches(bundle.record)).toBe(true);
    expect(bundle.diagnostics?.length ?? 0).toBeGreaterThan(0);
    expect(holds(fileText), 'the export file').toBe(false);
    expect(code.startsWith(TEXT_CODE_PREFIX)).toBe(true);
    const decoded = Buffer.from(code.slice(TEXT_CODE_PREFIX.length), 'base64').toString('utf8');
    expect(checksumMatches(JSON.parse(decoded))).toBe(true);
    expect(holds(code) || holds(decoded), 'the text code').toBe(false);
    // Nor the other export there is: the recovery screen's copy of storage as it stands.
    const raw = await (async () => {
      const backend = new LocalBackend();
      const text = await buildExport(backend, null, BUILD, FIXED_NOW, { raw: true });
      (await backend.handle()).close();
      return text;
    })();
    expect((JSON.parse(raw) as { slots: unknown[] }).slots.length).toBeGreaterThan(1);
    expect(holds(raw), 'the raw export').toBe(false);

    // Not anything sent to the service but the one header: not an address, not a body, not a commit message.
    expect(github.writes.length).toBeGreaterThanOrEqual(2);
    for (const call of github.calls) {
      expect(call.authorization).toBe(`Bearer ${marker}`);
      expect(holds(call.url), 'an address').toBe(false);
      expect(holds(call.body), 'a body').toBe(false);
      const { headers, ...rest } = call.init;
      expect(holds(rest), 'the rest of a call').toBe(false);
      expect(Object.entries(headers as Record<string, string>).filter(([, value]) => holds(value)).map(([name]) => name)).toEqual(['Authorization']);
    }
    for (const call of github.writes) expect(holds(sentText(call)), 'a backup').toBe(false);
    expect(holds(github.commits), 'a commit').toBe(false);
    expect(holds(github.file), 'the backup file').toBe(false);

    // It is on the phone in exactly one place: the device store, under the key's own name. The notes beside it,
    // the waiting notices and everything else there are free of it.
    const device = await deviceStore();
    expect(device[BACKUP_KEY]).toEqual({ owner: OWNER, repo: REPO, token: marker });
    expect(Object.keys(device)).toEqual(expect.arrayContaining([BACKUP_STATE, 'notices']));
    for (const [name, value] of Object.entries(device)) {
      if (name !== BACKUP_KEY) expect(holds(value), `the device store under ${name}`).toBe(false);
    }

    // Forgetting the key takes it off the phone altogether.
    dom.tap('Change or forget the key…');
    dom.tap('Forget the key on this phone');
    await eventually(() => expect(dom.buttons()).toContain('Set up…'));
    look('Settings with the key forgotten');
    expect(holds(await deviceStore()), 'the device store after forgetting').toBe(false);
    const calls = github.calls.length;
    await startRun(4);
    await settle(50);
    expect(github.calls).toHaveLength(calls);
  });

  it('takes no key that is not typed: an empty box or a repository that is not one stores and sends nothing', async () => {
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    const box = typeKey('not a repository', token);
    dom.tap('Save the key');
    expect(shows('Enter the repository as owner/name.')).toBe(true);
    // Nothing was read, so the box still holds what the player is typing.
    expect(box.value).toBe(token);
    dom.fill(REPOSITORY, 0);
    dom.fill('   ', 1);
    dom.tap('Save the key');
    expect(shows('Paste the key.')).toBe(true);
    dom.tap('Cancel');
    await settle(50);
    expect(await deviceStore()).not.toHaveProperty(BACKUP_KEY);
    expect(github.calls).toEqual([]);
    expect(dom.buttons()).toContain('Set up…');
  });
});

// ---- check 9 ----

describe('check 9: with backup off nothing leaves the site', () => {
  it('makes no call at all through fights, a new run, Settings and a key sheet that is opened and closed', async () => {
    const called = vi.fn(github.fetch);
    vi.stubGlobal('fetch', called);
    // A new install, as the build before this one would start it.
    await startApp(dom.root, OPTIONS);
    await mapShows();
    await fightOnce();
    await startRun(2);
    await fightOnce();
    expect((await hot()).payload.game).toMatchObject({ profile: { counters: { runsStarted: 2 } }, run: { battleCount: 1 } });

    openSettings();
    await settle(50);
    // With no key, Settings offers the way in and nothing that would reach the service.
    expect(dom.buttons()).toContain('Set up…');
    for (const label of ['Back up now', 'Restore from backup…', 'Overwrite the backup…', 'Change or forget the key…']) expect(dom.buttons()).not.toContain(label);
    expect(showsStart('Off.')).toBe(true);
    dom.tap('Set up…');
    expect(shows('Nothing is sent anywhere until a key is saved here.')).toBe(true);
    dom.tap('Save the key');
    dom.tap('Cancel');
    dom.tap(/^Skip every battle/);
    dom.tap('Run the self-test');
    dom.tap('Map');
    expect(reminderShowing()).toBe(false);
    dom.setVisibility('hidden');
    dom.setVisibility('visible');
    dom.fire('pagehide');
    await settle(50);

    expect(called).not.toHaveBeenCalled();
    expect(github.calls).toEqual([]);
    // Nor has the backup left anything of its own on the phone.
    const device = await deviceStore();
    expect(device).not.toHaveProperty(BACKUP_KEY);
    expect(device).not.toHaveProperty(BACKUP_STATE);

    // The next launch is the same.
    await relaunch();
    await mapShows();
    await startRun(3);
    await settle(50);
    expect(called).not.toHaveBeenCalled();
  });
});

// ---- the key sheet and the network ----

describe('the key sheet does not wait for the network', () => {
  it('closes as soon as the key is stored, and the game takes input, while the service never answers', async () => {
    github.mode = 'hang';
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await mapShows();

    typeKey(REPOSITORY, token);
    dom.tap('Save the key');
    await keySheetClosed();
    // The key is stored, its first backup is on its way and unanswered, and Settings says so.
    expect(await deviceStore()).toMatchObject({ [BACKUP_KEY]: { owner: OWNER, repo: REPO, token } });
    await eventually(() => expect(requests()).toEqual(['request GET']));
    await eventually(() => expect(valueOf('Last attempt')).toBe('Sending…'));
    expect(valueOf('Repository')).toBe(REPOSITORY);

    // Every kind of input is taken and saved meanwhile.
    dom.tap(/^Skip every battle/);
    await eventually(async () => expect((await hot()).payload.app.settings.skipPlayback).toBe(false));
    dom.tap('Map');
    await fightOnce();
    expect((await hot()).payload.game.run.battleCount).toBe(1);
    await startRun(2);
    expect((await hot()).payload.game.profile.counters.runsStarted).toBe(2);
    // Still the one call, still unanswered. The run that ended meanwhile waits its turn behind it.
    await settle(50);
    expect(requests()).toEqual(['request GET']);
    expect((await notes()).lastAttempt ?? null).toBeNull();
    expect(github.writes).toEqual([]);
  });
});

// ---- check 8 ----

describe('check 8: one address and no more', () => {
  it('calls only the pinned address, for the repository and its one file, whatever the session does with the backup', async () => {
    // The service-worker test (src/platform/sw.test.ts) spells these out by hand, since that folder may not
    // import the save module. If either moves, that test has to move with it.
    expect(BACKUP_ORIGIN).toBe('https://api.github.com');
    expect(BACKUP_FILE).toBe('farther-still-save.json');

    await seedGame();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    typeKey(`https://github.com/${OWNER}/${REPO}.git`, token);
    dom.tap('Save the key');
    await keySheetClosed();
    await backedUp();
    await startRun(2);
    await backedUp();
    openSettings();
    dom.tap('Back up now');
    await eventually(() => expect(shows('Backed up.')).toBe(true));
    dom.tap('Restore from backup…');
    await eventually(() => expect(shows('Replace the current game?')).toBe(true));
    dom.tap('Cancel');

    const repository = `${BACKUP_ORIGIN}/repos/${OWNER}/${REPO}`;
    expect(github.calls.length).toBeGreaterThan(6);
    expect([...new Set(github.calls.map((call) => call.url))].sort()).toEqual([repository, `${repository}/contents/${BACKUP_FILE}`]);
    expect([...new Set(github.calls.map((call) => call.method))].sort()).toEqual(['GET', 'PUT']);
    for (const call of github.calls) {
      // No cookie goes with a call, no cached answer is taken for one, and the page it came from is not named.
      expect(call.init).toMatchObject({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    }
  });
});

// ---- the verifier pass's cases ----
//
// Written by the separate verifier of 2026-10-13 against the first build of the guard, which rested on what the
// install remembered. Each states the safe behaviour, and most of them failed then. They are kept as tests of
// the guard that replaced it, which compares the two saves. What the author changed in them, and nothing else:
// the name of the result and the wording on screen; in U1b, a fight, so that the later save keeps something the
// earlier one does not (two saves that keep exactly the same things may replace each other, and nothing is
// lost); in U3, the line that read a note the new guard does not keep, and its last check, which now looks at every commit for the empty game where it looked for any change to the file, since the restored game is itself written back; in U4, the check that a simulated write
// failure was used up, since nothing is written at that moment any more, and a relaunch added at the end; in W1
// and W6, the expectations, which recorded the fault as it was seen and now record its cure.
describe('VERIFIER U1: automatic fallback past a damaged record at load', () => {
  it('U1a hot slot damaged after a mid-run Back up now: the fallback game must not replace the more advanced backup without asking', async () => {
    await seedGame(40, 57);
    await configureKey();
    await startApp(dom.root, OPTIONS);
    await startRun(41);
    await backedUp();
    await fightOnce();
    openSettings();
    dom.tap('Back up now');
    const kept = await backedUp();
    expect(kept.payload.game.run.battleCount).toBe(1);
    expect(github.file?.text).toBe(serializeRecord(kept));
    // The hot slot goes bad: its bytes no longer match its checksum.
    await seed((backend) => putRaw(backend, 'hot', { ...kept, seq: kept.seq + 1 }));
    await relaunch();
    await gameShowsRun(41);
    expect(showsStart('A save could not be read, so an older one was loaded')).toBe(true);
    expect((await hot()).payload.game.run.battleCount).toBe(0);
    await settle(50);
    expect(github.file?.text).toBe(serializeRecord(kept));
    // Does anything on screen say the backup is ahead of the game now on the phone?
    const reminded = reminderShowing();
    await startRun(42);
    const replaced = await comesTrue(() => github.file?.text !== serializeRecord(kept));
    expect({ reminded, replaced }, 'the fallback game took the place of the backup, unasked').toEqual({ reminded: true, replaced: false });
  });

  it('U1b hot slot and newest checkpoint damaged: the game falls back a whole run and must not replace the backup of the later run', async () => {
    await seedGame(40, 57);
    await configureKey();
    await startApp(dom.root, OPTIONS);
    await startRun(41);
    await backedUp();
    await fightOnce();
    await startRun(42);
    const kept = await backedUp();
    expect(kept.payload.game.profile.counters.runsStarted).toBe(42);
    const stored = (await storage()).slots as Record<string, SlotRecord>;
    const checkpoints = Object.values(stored)
      .filter((entry) => entry.slot !== 'hot')
      .sort((a, b) => b.seq - a.seq);
    const newest = checkpoints[0];
    if (newest === undefined) throw new Error('no checkpoint');
    expect(newest.payload.game.profile.counters.runsStarted).toBe(42);
    await seed(async (backend) => {
      await putRaw(backend, 'hot', { ...kept, writtenAt: kept.writtenAt + 1 });
      await putRaw(backend, newest.slot, { ...newest, writtenAt: newest.writtenAt + 1 });
    });
    await relaunch();
    await gameShowsRun(41);
    await settle(50);
    expect(github.file?.text).toBe(serializeRecord(kept));
    await startRun(42);
    const replaced = await comesTrue(() => github.file?.text !== serializeRecord(kept));
    expect(replaced, 'the older game took the place of the backup of run 42, unasked').toBe(false);
  });
});

describe('VERIFIER U2: the note that the backup is no longer ours does not reach storage', () => {
  it('U2 import, the notes could not be stored that once (or the app was killed before they were), relaunch: the imported game must not replace the old backup', async () => {
    await seedGame(40, 57);
    await configureKey();
    await startApp(dom.root, OPTIONS);
    await startRun(41);
    const kept = await backedUp();

    const setDevice = LocalBackend.prototype.setDevice;
    let failOnce = true;
    vi.spyOn(LocalBackend.prototype, 'setDevice').mockImplementation(async function (this: LocalBackend, key: string, value: unknown): Promise<void> {
      if (key === BACKUP_STATE && failOnce) {
        failOnce = false;
        throw new Error('simulated: the notes were not stored');
      }
      await setDevice.call(this, key, value);
    });
    openSettings();
    dom.tap('Import…');
    dom.fill(JSON.stringify(realRecord('hot', 9, realGame(3))));
    dom.tap('Check');
    dom.tap('Replace the current game');
    await eventually(async () => expect((await hot()).payload.game.profile.counters.runsStarted).toBe(3));
    await settle(50);
    expect(failOnce).toBe(false);

    await relaunch();
    await gameShowsRun(3);
    await startRun(4);
    const replaced = await comesTrue(() => github.file?.text !== serializeRecord(kept));
    expect(replaced, 'the imported game took the place of the old backup, unasked').toBe(false);
  });

  it('U4 recovery screen, new game, with the device store failing once at that moment: the new game must not replace the old backup', async () => {
    await seedGame(40, 57);
    await configureKey();
    await startApp(dom.root, OPTIONS);
    await startRun(41);
    const kept = await backedUp();
    await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 80, suspectGame(41))));

    const getDevice = LocalBackend.prototype.getDevice;
    const setDevice = LocalBackend.prototype.setDevice;
    let failRead = true;
    let failWrite = true;
    vi.spyOn(LocalBackend.prototype, 'getDevice').mockImplementation(async function (this: LocalBackend, key: string): Promise<unknown> {
      if (key === BACKUP_KEY && failRead) {
        failRead = false;
        throw new Error('simulated: device store unreadable');
      }
      return getDevice.call(this, key);
    });
    vi.spyOn(LocalBackend.prototype, 'setDevice').mockImplementation(async function (this: LocalBackend, key: string, value: unknown): Promise<void> {
      if (key === BACKUP_STATE && failWrite) {
        failWrite = false;
        throw new Error('simulated: device store unwritable');
      }
      await setDevice.call(this, key, value);
    });
    await relaunch();
    await eventually(() => expect(dom.buttons()).toContain('Start a new game…'));
    dom.tap('Start a new game…');
    dom.tap(/^Tap again to start a new game/);
    await gameShowsRun(1);
    // The key could not be read, so the backup is off for this launch. Nothing is written about it.
    expect(failRead).toBe(false);
    await startRun(2);
    const replaced = await comesTrue(() => github.file?.text !== serializeRecord(kept));
    expect(replaced, 'the new game took the place of the old backup, unasked').toBe(false);
    // The next launch reads the key, and the new game still does not take the old one's place.
    failWrite = false;
    await relaunch();
    await gameShowsRun(2);
    await startRun(3);
    await attemptEnds('left-alone');
    expect(github.file?.text).toBe(serializeRecord(kept));
  });
});

describe('VERIFIER U3: restore from the backup while the first attempt of the key is still on its way', () => {
  it('U3 after a reinstall: key saved, its first look is slow, the player restores at once; the empty game must not be written over the real backup', async () => {
    const real = otherGame();
    const text = serializeRecord(real);
    github.seed(text);
    let count = 0;
    let open: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      open = resolve;
    });
    const slowFirst: FetchLike = async (url, init) => {
      count += 1;
      trace.push(`request ${init.method ?? 'GET'}`);
      if (count === 1) await held;
      return github.fetch(url, init);
    };
    vi.stubGlobal('fetch', slowFirst);
    await startApp(dom.root, OPTIONS);
    await gameShowsRun(1);
    typeKey(REPOSITORY, token);
    dom.tap('Save the key');
    await keySheetClosed();
    await eventually(() => expect(count).toBe(1));
    dom.tap('Restore from backup…');
    await eventually(() => expect(shows('Replace the current game?')).toBe(true));
    dom.tap('Replace the current game');
    await eventually(async () => expect((await hot()).payload.game.profile.counters.runsStarted).toBe(40));
    open();
    // The restored game is the backup's own, and the phone's record of it is written back once the late look has
    // come in. What must never happen is the empty game being sent, at any moment.
    await eventually(() => expect(github.writes.length).toBeGreaterThan(0));
    await settle(80);
    const runOf = (fileText: string): number => (JSON.parse(fileText) as SlotRecord).payload.game.profile.counters.runsStarted;
    const everSent = github.commits.map((commit) => runOf(commit.text));
    const now = github.file === null ? null : runOf(github.file.text);
    expect({ emptyGameEverSent: everSent.includes(1), runInBackup: now }, 'the empty game of the new install was written over the real backup').toEqual({ emptyGameEverSent: false, runInBackup: 40 });
    expect(github.file?.text).toBe(serializeRecord(await hot()));
    expect(text).not.toBe(github.file?.text);
  });
});

describe('VERIFIER set 2', () => {
  it('W1 restoring a set-aside save from Settings leaves the old backup alone (expected to hold)', async () => {
    await seedGame(40, 57);
    await seed((backend) => backend.addQuarantine([{ slot: 'hot', kind: 'kept', reason: 'replaced-by-import', raw: realRecord('hot', 20, realGame(5)) }]).then(() => undefined));
    await configureKey();
    await startApp(dom.root, OPTIONS);
    await startRun(41);
    const kept = await backedUp();
    openSettings();
    await eventually(() => expect(dom.buttons()).toContain('Restore…'));
    dom.tap('Restore…');
    expect(shows('Replace the current game?')).toBe(true);
    dom.tap('Replace the current game');
    await eventually(async () => expect((await hot()).payload.game.profile.counters.runsStarted).toBe(5));
    // The backup is looked at again as soon as the game is replaced, so the game says where things stand before
    // any run is finished. It used to say "Worked", with no reminder, until the next run ended.
    await attemptEnds('left-alone');
    dom.tap('Map');
    const reminded = reminderShowing();
    openSettings();
    const lastAttempt = valueOf('Last attempt');
    await startRun(6);
    await settle(60);
    expect(github.file?.text).toBe(serializeRecord(kept));
    expect(github.writes).toHaveLength(1);
    expect({ reminded, lastAttempt: lastAttempt?.startsWith('Did not go through') }).toEqual({ reminded: true, lastAttempt: true });
  });

  it('W2 check 3: the notes cannot be stored at all and the service answers nonsense; a new run and a fight write the same bytes as with backup off', async () => {
    // Backup off.
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await startRun(2);
    await fightOnce();
    const off = await slotBytes();
    const offWrites = localWrites();

    const setDevice = LocalBackend.prototype.setDevice;
    let refused = 0;
    vi.spyOn(LocalBackend.prototype, 'setDevice').mockImplementation(async function (this: LocalBackend, key: string, value: unknown): Promise<void> {
      if (key === BACKUP_STATE) {
        refused += 1;
        throw new Error('simulated: the notes cannot be stored');
      }
      await setDevice.call(this, key, value);
    });
    for (const nonsense of ['undefined', 'object', 'no-headers', 'json-hangs', 'html'] as const) {
      newPhone();
      await configureKey();
      await seedGame();
      const odd = ((): Promise<Response> => {
        trace.push('request GET');
        if (nonsense === 'undefined') return Promise.resolve(undefined as unknown as Response);
        if (nonsense === 'object') return Promise.resolve({} as unknown as Response);
        if (nonsense === 'no-headers') return Promise.resolve({ status: 200, json: () => Promise.resolve({}) } as unknown as Response);
        if (nonsense === 'json-hangs') return Promise.resolve({ status: 200, headers: new Headers(), json: () => new Promise(() => undefined) } as unknown as Response);
        return Promise.resolve(new Response('<html>captive portal</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
      }) as unknown as FetchLike;
      vi.stubGlobal('fetch', odd);
      await startApp(dom.root, OPTIONS);
      await startRun(2);
      await fightOnce();
      await settle(60);
      expect(await slotBytes(), nonsense).toEqual(off);
      expect(localWrites(), nonsense).toEqual(offWrites);
      expect((await storage()).quarantine, nonsense).toEqual([]);
      expect(requests().length, nonsense).toBeGreaterThan(0);
    }
    expect(refused).toBeGreaterThan(0);
  });

  it('W3 check 7: errors that echo the Authorization header, thrown and rejected, never reach the log, the screen or the notes', async () => {
    const marker = madeUpKey('leakprobe');
    github.token = marker;
    const holds = (value: unknown): boolean => (typeof value === 'string' ? value : (JSON.stringify(value) ?? '')).includes(marker);
    let mode: 'throw' | 'reject' | 'reject-object' = 'throw';
    const echo: FetchLike = (_url, init) => {
      const header = (init.headers as Record<string, string>)['Authorization'] ?? '';
      // WebKit and Node both put the offending value in the message of the error a bad header raises.
      const error = new TypeError(`Header 'Authorization' has invalid value: '${header}'`);
      if (mode === 'throw') throw error;
      if (mode === 'reject') return Promise.reject(error);
      return Promise.reject({ headers: init.headers, url: _url });
    };
    vi.stubGlobal('fetch', echo);
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    typeKey(REPOSITORY, marker);
    dom.tap('Save the key');
    await keySheetClosed();
    await attemptEnds('unreachable');
    for (const next of ['reject', 'reject-object'] as const) {
      mode = next;
      openSettings();
      dom.tap('Back up now');
      await settle(60);
      dom.tap('Restore from backup…');
      await eventually(() => expect(showsStart('The backup could not be fetched.')).toBe(true));
      dom.tap('Cancel');
    }
    await startRun(2);
    await settle(80);
    openSettings();
    dom.tap('Show the log');
    await settle(60);
    expect(holds(dom.text()), 'on screen').toBe(false);
    expect(dom.fields().some(holds), 'in a box').toBe(false);
    const backend = new LocalBackend();
    const diagnostics = await backend.readDiagnostics();
    const raw = await buildExport(backend, null, BUILD, FIXED_NOW, { raw: true });
    (await backend.handle()).close();
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(holds(diagnostics), 'the diagnostics store').toBe(false);
    expect(holds(raw), 'the raw export').toBe(false);
    const device = await deviceStore();
    for (const [name, value] of Object.entries(device)) if (name !== BACKUP_KEY) expect(holds(value), `device store under ${name}`).toBe(false);
  });

  it('W4 check 7: a device store whose error echoes the value it was handed puts the key in the diagnostics log', async () => {
    const marker = madeUpKey('echoprobe');
    const setDevice = LocalBackend.prototype.setDevice;
    vi.spyOn(LocalBackend.prototype, 'setDevice').mockImplementation(async function (this: LocalBackend, key: string, value: unknown): Promise<void> {
      if (key === BACKUP_KEY) throw new Error(`could not be stored: ${JSON.stringify(value)}`);
      await setDevice.call(this, key, value);
    });
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    typeKey(REPOSITORY, marker);
    dom.tap('Save the key');
    await eventually(() => expect(shows('The key could not be stored on this phone.')).toBe(true));
    dom.tap('Cancel');
    await settle(60);
    const backend = new LocalBackend();
    const diagnostics = await backend.readDiagnostics();
    (await backend.handle()).close();
    expect(JSON.stringify(diagnostics).includes(marker), 'the key is in the diagnostics log, which is in every export').toBe(false);
  });

  it('W5 a refused key: does the reminder stay until a new key is entered? One run finished offline afterwards', async () => {
    await configureKey();
    await seedGame();
    github.mode = 401;
    await startApp(dom.root, OPTIONS);
    await startRun(2);
    await attemptEnds('refused');
    await eventually(() => expect(reminderShowing()).toBe(true));
    github.mode = 'offline';
    await startRun(3);
    await attemptEnds('unreachable');
    dom.tap('Map');
    // GDD 11: "a reminder that does not block play stays until a new one is entered".
    expect(reminderShowing(), 'the reminder for the refused key is still on the map').toBe(true);
  });

  it('W6 a backup file the service does not hand over as text: is there a button that gets the player out?', async () => {
    await configureKey();
    await seedGame();
    github.seed('x'.repeat(50));
    github.opaque = true;
    await startApp(dom.root, OPTIONS);
    await startRun(2);
    await attemptEnds('left-alone');
    expect(github.writes).toEqual([]);
    openSettings();
    const words = lines().find((line) => line.startsWith('The backup holds a different game')) ?? '';
    const offered = dom.buttons().includes('Overwrite the backup…');
    dom.tap('Restore from backup…');
    await eventually(() => expect(showsStart('The backup cannot be restored: the file in the repository is not one this game wrote.')).toBe(true));
    dom.tap('Cancel');
    dom.tap('Map');
    expect({ words: words !== '', offered, reminder: reminderShowing(), writes: github.writes.length }).toEqual({ words: true, offered: true, reminder: true, writes: 0 });
    // And the way out works: the player's answer overwrites the file.
    openSettings();
    dom.tap('Overwrite the backup…');
    dom.tap('Overwrite the backup with this game');
    github.opaque = false;
    await attemptEnds('ok');
    expect(github.file?.text).toBe(serializeRecord(await hot()));
    dom.tap('Map');
    await eventually(() => expect(reminderShowing()).toBe(false));
  });
});

// ---- added after the author's own pass of deliberate breaks, for the four that no test had caught ----

describe('the reworked guard: what a pass of deliberate breaks found untested', () => {
  it('sends nothing by itself for a save used "anyway" from the recovery screen', async () => {
    await seed((backend) => putRaw(backend, 'hot', realRecord('hot', 9, suspectGame(3))));
    await configureKey();
    await startApp(dom.root, OPTIONS);
    await eventually(() => expect(dom.buttons()).toContain('Use hot anyway (run 3)'));
    dom.tap('Use hot anyway (run 3)');
    await gameShowsRun(3);
    await settle(80);
    // A save that fails a check is not sent unless he asks (GDD D-44): not even looked at against the backup.
    expect(github.calls).toEqual([]);
  });

  it('says so in the sheet when the key could not be removed from the phone, and leaves it set', async () => {
    await configureKey();
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await mapShows();
    const setDevice = LocalBackend.prototype.setDevice;
    vi.spyOn(LocalBackend.prototype, 'setDevice').mockImplementation(async function (this: LocalBackend, key: string, value: unknown): Promise<void> {
      if (key === BACKUP_KEY && value === null) throw new Error('simulated: the store would not let go of the key');
      await setDevice.call(this, key, value);
    });
    openSettings();
    dom.tap('Change or forget the key…');
    dom.tap('Forget the key on this phone');
    await eventually(() => expect(shows('The key could not be removed from this phone. It is still set, and still in use.')).toBe(true));
    expect(shows('Cloud backup key')).toBe(true);
    expect((await deviceStore())[BACKUP_KEY]).toMatchObject({ owner: OWNER, repo: REPO });
    dom.tap('Cancel');
    openSettings();
    expect(valueOf('Repository')).toBe(REPOSITORY);
  });

  it('offers to overwrite the backup only while the backup stands left alone', async () => {
    await configureKey();
    await seedGame();
    await startApp(dom.root, OPTIONS);
    await startRun(2);
    await backedUp();
    openSettings();
    expect(dom.buttons()).not.toContain('Overwrite the backup…');
    github.mode = 'offline';
    await startRun(3);
    await attemptEnds('unreachable');
    openSettings();
    expect(dom.buttons()).not.toContain('Overwrite the backup…');
    github.mode = 401;
    await startRun(4);
    await attemptEnds('refused');
    openSettings();
    expect(dom.buttons()).not.toContain('Overwrite the backup…');
    // Another game in the file: now it is offered, and stays offered through a run finished offline.
    github.mode = 'normal';
    github.seed(serializeRecord(otherGame()));
    await startRun(5);
    await attemptEnds('left-alone');
    openSettings();
    expect(dom.buttons()).toContain('Overwrite the backup…');
    github.mode = 'offline';
    await startRun(6);
    await attemptEnds('unreachable');
    openSettings();
    expect(dom.buttons()).toContain('Overwrite the backup…');
  });

  it('goes on saying that the key was refused, in those words, after a run finished offline', async () => {
    await configureKey();
    await seedGame();
    await startApp(dom.root, OPTIONS);
    github.mode = 401;
    await startRun(2);
    await attemptEnds('refused');
    github.mode = 'offline';
    await startRun(3);
    await attemptEnds('unreachable');
    expect(shows('The cloud backup has stopped: GitHub refused the key. The save on this phone is unaffected.')).toBe(true);
    openSettings();
    expect(showsStart('GitHub could not be reached.')).toBe(true);
    expect(showsStart('Before that: GitHub refused the key.')).toBe(true);
  });
});
