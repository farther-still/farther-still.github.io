import { beforeEach, describe, expect, it } from 'vitest';
import { FakeGitHub, ManualTimer, madeUpKey, shaOf } from '../../tests/fake-github';
import { FIXED_NOW, gameAtRun, payload, record, unsealed } from '../../tests/helpers';
import { BACKUP_KEY, BACKUP_STATE, CloudBackup, cleanToken, parseRepository } from './backup';
import { RUN_LOG_LIMIT } from './constants';
import type { DeviceStore } from './backup';
import { checksumOf, sealRecord, serializeRecord } from './record';
import type { SavePayload, SlotRecord } from './schema';

const OWNER = 'someone';
const REPO = 'some-saves';

/** The `device` store as a plain map, which can be told to fail. */
class MemoryDevice implements DeviceStore {
  readonly values = new Map<string, unknown>();
  failing = false;

  getDevice(key: string): Promise<unknown> {
    return this.failing ? Promise.reject(new Error('device store unreadable')) : Promise.resolve(structuredClone(this.values.get(key)));
  }

  setDevice(key: string, value: unknown): Promise<void> {
    if (this.failing) return Promise.reject(new Error('device store unwritable'));
    this.values.set(key, structuredClone(value));
    return Promise.resolve();
  }
}

let github: FakeGitHub;
let device: MemoryDevice;
let timer: ManualTimer;
let logged: string[];
let token: string;
let clock: number;

const make = (): CloudBackup =>
  new CloudBackup({
    device,
    fetch: github.fetch,
    timer: timer.timer,
    now: () => clock,
    log: (kind, message) => logged.push(`${kind}: ${message}`),
  });

const withKey = async (): Promise<CloudBackup> => {
  const backup = make();
  expect(await backup.setKey({ owner: OWNER, repo: REPO, token })).toBe(true);
  return backup;
};

/** Lets every queued step of a background backup run. The stand-in service answers without real waiting. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 40; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
};

/** The first run of the one game these tests play: nothing filed in its log yet. */
const firstRun = (): SavePayload => {
  const start = payload(gameAtRun(1));
  return { ...start, app: { ...start.app, runTiming: { startedAt: FIXED_NOW - 86_400_000, activeMs: 0 }, runLog: [] } };
};

/** A save played on into its next run, as the game does it: the run is filed in the log and the next has a seed of its own. */
const playedOn = (from: SavePayload): SavePayload => {
  const finished = from.game.profile.counters.runsStarted;
  const entry = {
    run: finished,
    startedAt: from.app.runTiming.startedAt,
    endedAt: from.app.runTiming.startedAt + 600_000,
    activeMs: from.app.runTiming.activeMs + 60_000,
    wins: from.game.run.tallies.wins,
    losses: from.game.run.tallies.losses,
    level: 4,
    strongest: 4,
  };
  return {
    game: { profile: { ...from.game.profile, counters: { ...from.game.profile.counters, runsStarted: finished + 1 } }, run: { ...from.game.run, seed: from.game.run.seed + 1 } },
    app: { ...from.app, runTiming: { startedAt: entry.endedAt, activeMs: 0 }, runLog: [...from.app.runLog, entry].slice(-RUN_LOG_LIMIT) },
  };
};

const runs = new Map<number, SavePayload>();
/** Run `runsStarted` of that game. Each is the one before it played on, so a later one follows from every earlier one. */
const atRun = (runsStarted: number): SavePayload => {
  const known = runs.get(runsStarted);
  if (known !== undefined) return known;
  const made = runsStarted <= 1 ? firstRun() : playedOn(atRun(runsStarted - 1));
  runs.set(runsStarted, made);
  return made;
};

const run = (runsStarted: number, seq: number): SlotRecord => sealRecord({ ...unsealed(record('hot', seq)), payload: atRun(runsStarted) });

const changed = (base: SlotRecord, change: (payload: SavePayload) => SavePayload): SlotRecord => sealRecord({ ...unsealed(base), payload: change(base.payload) });

/** The same game with one more copy of an item: a save that keeps something `base` does not. */
const withOneMore = (base: SlotRecord, item = 'i004'): SlotRecord =>
  changed(base, (payload) => ({
    ...payload,
    game: { ...payload.game, profile: { ...payload.game.profile, items: { ...payload.game.profile.items, [item]: (payload.game.profile.items[item] ?? 0) + 1 } } },
  }));

/** Any fields at all, sealed with a checksum that matches them. */
const sealedText = (fields: Record<string, unknown>): string => JSON.stringify({ ...fields, checksum: checksumOf(fields) });

/** A game begun at another moment: another game altogether, whatever it holds. */
const anotherGame = (runsStarted: number, seq: number): SlotRecord =>
  changed(run(runsStarted, seq), (payload) => ({ ...payload, app: { ...payload.app, exportTracking: { ...payload.app.exportTracking, trackingSince: payload.app.exportTracking.trackingSince - 86_400_000 } } }));

beforeEach(() => {
  token = madeUpKey('backup');
  github = new FakeGitHub(OWNER, REPO, token);
  device = new MemoryDevice();
  timer = new ManualTimer();
  logged = [];
  clock = FIXED_NOW;
});

describe('CloudBackup: off until a key is entered', () => {
  it('sends nothing with no key, whatever is asked', async () => {
    const backup = make();
    await backup.restore();
    backup.runEnded(run(2, 5));
    await settle();
    expect(await backup.backUp(run(2, 5))).toBe('failed');
    expect((await backup.look()).ok).toBe(false);
    expect(github.calls).toEqual([]);
    expect(backup.configured).toBe(false);
    expect(backup.status).toEqual({ repository: null, lastOk: null, lastAttempt: null, standing: null, busy: false, unread: false });
    expect(backup.needsAttention).toBe(false);
  });

  it('sends nothing when a key is entered: entering it is not a backup', async () => {
    const backup = await withKey();
    expect(github.calls).toEqual([]);
    expect(backup.configured).toBe(true);
    expect(backup.status.repository).toBe(`${OWNER}/${REPO}`);
  });
});

describe('CloudBackup: after each run', () => {
  it('sends exactly one write per finished run, of the record it was handed', async () => {
    const backup = await withKey();
    const first = run(2, 5);
    backup.runEnded(first);
    await settle();
    expect(github.writes).toHaveLength(1);
    expect(github.file?.text).toBe(serializeRecord(first));
    const second = run(3, 9);
    backup.runEnded(second);
    await settle();
    expect(github.writes).toHaveLength(2);
    expect(github.file?.text).toBe(serializeRecord(second));
    expect(github.commits.map((commit) => commit.message)).toEqual(['Run 2, save 5', 'Run 3, save 9']);
    expect(backup.status.lastOk).toEqual({ at: clock, seq: 9, run: 3 });
    expect(backup.status.lastAttempt).toEqual({ at: clock, outcome: 'ok', status: null });
  });

  it('returns at once and never throws, whatever the network does', async () => {
    const backup = await withKey();
    for (const mode of ['hang', 'offline', 'throw', 401, 403, 404, 409, 422, 500] as const) {
      github.mode = mode;
      expect(() => backup.runEnded(run(2, 5))).not.toThrow();
    }
    github.mode = 'hang';
    backup.runEnded(run(2, 6));
    // Nothing was awaited: the calls above came back while the first request was still unanswered.
    expect(backup.status.lastOk).toBeNull();
  });

  it('sends only the newest when runs end faster than the network answers', async () => {
    const backup = await withKey();
    github.mode = 'hang';
    backup.runEnded(run(2, 5));
    await settle();
    backup.runEnded(run(3, 9));
    backup.runEnded(run(4, 13));
    backup.runEnded(run(5, 17));
    github.mode = 'normal';
    timer.fireAll();
    await settle();
    expect(github.commits.map((commit) => commit.message)).toEqual(['Run 5, save 17']);
  });

  it('carries on after a failed attempt: the next run backs up', async () => {
    const backup = await withKey();
    github.mode = 'offline';
    backup.runEnded(run(2, 5));
    await settle();
    expect(backup.status.lastAttempt?.outcome).toBe('unreachable');
    expect(backup.status.lastOk).toBeNull();
    github.mode = 'normal';
    backup.runEnded(run(3, 9));
    await settle();
    expect(backup.status.lastAttempt?.outcome).toBe('ok');
    expect(github.file?.text).toBe(serializeRecord(run(3, 9)));
  });
});

describe('CloudBackup: what the last attempt came to', () => {
  const outcomeOf = async (arrange: () => void): Promise<string | undefined> => {
    const backup = await withKey();
    arrange();
    backup.runEnded(run(2, 5));
    await settle();
    return backup.status.lastAttempt?.outcome;
  };

  it('tells offline, a refused key, a missing repository and other failures apart', async () => {
    expect(await outcomeOf(() => (github.mode = 'offline'))).toBe('unreachable');
    expect(await outcomeOf(() => (github.mode = 'throw'))).toBe('unreachable');
    github.mode = 'normal';
    expect(await outcomeOf(() => (github.token = madeUpKey('rotated')))).toBe('refused');
    github.token = token;
    expect(await outcomeOf(() => (github.mode = 403))).toBe('refused');
    expect(await outcomeOf(() => (github.mode = 500))).toBe('failed');
    github.mode = 'normal';
    expect(await outcomeOf(() => (github.repositoryExists = false))).toBe('not-found');
  });

  it('asks for the player only when the player can do something about it', async () => {
    const backup = await withKey();
    github.mode = 'offline';
    backup.runEnded(run(2, 5));
    await settle();
    expect(backup.needsAttention).toBe(false);
    github.mode = 500;
    backup.runEnded(run(2, 6));
    await settle();
    expect(backup.needsAttention).toBe(false);
    github.mode = 401;
    backup.runEnded(run(2, 7));
    await settle();
    expect(backup.needsAttention).toBe(true);
    github.mode = 'normal';
    backup.runEnded(run(2, 8));
    await settle();
    expect(backup.needsAttention).toBe(false);
  });

  it('logs a failure once when it starts, not once per run', async () => {
    const backup = await withKey();
    github.mode = 'offline';
    for (let seq = 5; seq < 10; seq += 1) {
      backup.runEnded(run(2, seq));
      await settle();
    }
    expect(logged).toEqual(['backup: unreachable']);
    github.mode = 401;
    backup.runEnded(run(2, 11));
    await settle();
    expect(logged).toEqual(['backup: unreachable', 'backup: refused (HTTP 401)']);
  });

  it('tells its listeners when an attempt starts and when it ends', async () => {
    const backup = await withKey();
    const seen: boolean[] = [];
    backup.subscribe(() => seen.push(backup.status.busy));
    backup.runEnded(run(2, 5));
    await settle();
    expect(seen[0]).toBe(true);
    expect(seen.at(-1)).toBe(false);
  });
});

describe('CloudBackup: what may be replaced is decided from the two saves', () => {
  it('does not replace another game, whatever this install remembers or does not', async () => {
    const theirs = serializeRecord(anotherGame(40, 900));
    github.seed(theirs);
    const backup = await withKey();
    backup.runEnded(run(1, 2));
    await settle();
    expect(github.writes).toEqual([]);
    expect(github.file?.text).toBe(theirs);
    expect(backup.status.lastAttempt?.outcome).toBe('left-alone');
    expect(backup.needsAttention).toBe(true);
    expect(await backup.backUp(run(1, 3))).toBe('left-alone');
    expect(github.file?.text).toBe(theirs);
  });

  it('does not replace the same game where the backup keeps something this save does not', async () => {
    const backup = await withKey();
    const ahead = withOneMore(run(41, 60));
    backup.runEnded(ahead);
    await settle();
    expect(github.file?.text).toBe(serializeRecord(ahead));
    // The phone's game is now a state of the same game that lacks the item: a fallback, an older save, an import.
    backup.runEnded(run(42, 70));
    await settle();
    expect(github.file?.text).toBe(serializeRecord(ahead));
    expect(backup.status.lastAttempt?.outcome).toBe('left-alone');
    expect(backup.status.lastOk).toEqual({ at: clock, seq: 60, run: 41 });
  });

  it('replaces the same game where this save keeps everything the backup does, whoever wrote the backup', async () => {
    // Left there by something this install knows nothing of: another launch, a restore, a write whose answer was lost.
    github.seed(serializeRecord(run(2, 5)));
    const backup = await withKey();
    const later = withOneMore(run(3, 9));
    backup.runEnded(later);
    await settle();
    expect(github.file?.text).toBe(serializeRecord(later));
    expect(backup.status.lastAttempt?.outcome).toBe('ok');
  });

  it('makes the same decision with its notes gone, since none rests on them', async () => {
    const backup = await withKey();
    const ahead = withOneMore(run(41, 60));
    backup.runEnded(ahead);
    await settle();
    device.values.delete(BACKUP_STATE);
    const restarted = make();
    await restarted.restore();
    restarted.runEnded(run(42, 70));
    await settle();
    expect(github.file?.text).toBe(serializeRecord(ahead));
    expect(restarted.status.lastAttempt?.outcome).toBe('left-alone');
    restarted.runEnded(withOneMore(withOneMore(run(42, 74))));
    await settle();
    expect(restarted.status.lastAttempt?.outcome).toBe('ok');
  });

  it('makes the same decision when its notes could never be stored', async () => {
    const backup = await withKey();
    const ahead = withOneMore(run(41, 60));
    backup.runEnded(ahead);
    await settle();
    device.failing = true;
    backup.runEnded(run(42, 70));
    await settle();
    device.failing = false;
    const restarted = make();
    await restarted.restore();
    restarted.runEnded(run(42, 72));
    await settle();
    expect(github.file?.text).toBe(serializeRecord(ahead));
  });

  it.each([
    ['text that is not a save', 'not json at all'],
    ['a save whose checksum does not match', JSON.stringify({ ...run(2, 5), seq: 6 })],
    ['a save from a newer version', sealedText({ ...unsealed(run(2, 5)), saveVersion: 99 })],
    ['a save in a shape this build does not know', sealedText({ ...unsealed(run(2, 5)), payload: { game: {}, app: {} } })],
    ['a save with a field this build does not know', sealedText({ ...unsealed(run(2, 5)), payload: { ...run(2, 5).payload, extra: true } })],
    ['an empty file', ''],
  ])('leaves alone a file that holds %s', async (_what, text) => {
    github.seed(text);
    const backup = await withKey();
    backup.runEnded(run(3, 9));
    await settle();
    expect(github.writes).toEqual([]);
    expect(github.file?.text).toBe(text);
    expect(backup.status.lastAttempt?.outcome).toBe('left-alone');
  });

  it('leaves alone a file the service does not hand over as text, and can still overwrite it when told to', async () => {
    const sha = github.seed('x'.repeat(50));
    github.opaque = true;
    const backup = await withKey();
    expect(await backup.look()).toEqual({ ok: true, value: { text: null, sha } });
    expect(await backup.backUp(run(3, 9))).toBe('left-alone');
    expect(github.writes).toEqual([]);
    // Not stranded: the player's answer still works.
    expect(await backup.backUp(run(3, 9), { replace: true })).toBe('ok');
    expect(github.file?.text).toBe(serializeRecord(run(3, 9)));
  });

  it('overwrites when the player says so, and only then', async () => {
    const theirs = serializeRecord(anotherGame(40, 900));
    github.seed(theirs);
    const backup = await withKey();
    const mine = run(1, 2);
    expect(await backup.backUp(mine)).toBe('left-alone');
    expect(await backup.backUp(mine, { replace: true })).toBe('ok');
    expect(github.file?.text).toBe(serializeRecord(mine));
    // The replaced save is still in the repository's history.
    expect(github.commits.map((commit) => commit.text)).toContain(theirs);
    backup.runEnded(run(2, 6));
    await settle();
    expect(backup.status.lastAttempt?.outcome).toBe('ok');
    expect(backup.needsAttention).toBe(false);
  });

  it('recreates a file that has been deleted, since there is nothing to protect', async () => {
    const backup = await withKey();
    backup.runEnded(run(2, 5));
    await settle();
    github.remove();
    backup.runEnded(run(3, 9));
    await settle();
    expect(github.file?.text).toBe(serializeRecord(run(3, 9)));
    expect(backup.status.lastAttempt?.outcome).toBe('ok');
  });

  it('carries on after a write whose answer was lost', async () => {
    const backup = await withKey();
    backup.runEnded(run(2, 5));
    await settle();
    github.loseNextAnswer = true;
    backup.runEnded(run(3, 9));
    await settle();
    // The write was made, and this install was told nothing.
    expect(github.file?.text).toBe(serializeRecord(run(3, 9)));
    expect(backup.status.lastAttempt?.outcome).toBe('unreachable');
    backup.runEnded(run(4, 13));
    await settle();
    expect(backup.status.lastAttempt?.outcome).toBe('ok');
    expect(github.file?.text).toBe(serializeRecord(run(4, 13)));
  });

  it('counts the same record already being there as backed up, without writing again', async () => {
    const backup = await withKey();
    github.loseNextAnswer = true;
    backup.runEnded(run(2, 5));
    await settle();
    const before = github.writes.length;
    expect(await backup.backUp(run(2, 5))).toBe('ok');
    expect(github.writes).toHaveLength(before);
  });

  it('writes with the version it has just read, so a file that moves in between is not overwritten', async () => {
    const backup = await withKey();
    backup.runEnded(run(2, 5));
    await settle();
    backup.runEnded(run(3, 9));
    await settle();
    const [, second] = github.writes;
    expect((second?.body as { sha?: string }).sha).toBe(github.commits.length === 2 ? shaOf(serializeRecord(run(2, 5))) : 'unexpected');
  });

  it('keeps what it knows of the last backup when only the key is replaced, and drops it for another repository', async () => {
    const backup = await withKey();
    backup.runEnded(run(2, 5));
    await settle();
    github.token = madeUpKey('renewed');
    backup.runEnded(run(3, 9));
    await settle();
    expect(backup.status.lastAttempt?.outcome).toBe('refused');
    await backup.setKey({ owner: OWNER, repo: REPO, token: github.token });
    expect(backup.status.lastAttempt).toBeNull();
    expect(backup.status.standing).toBeNull();
    expect(backup.status.lastOk?.run).toBe(2);
    backup.runEnded(run(4, 13));
    await settle();
    expect(backup.status.lastAttempt?.outcome).toBe('ok');
    await backup.setKey({ owner: OWNER, repo: 'other-saves', token: github.token });
    expect(backup.status.lastOk).toBeNull();
  });
});

describe('CloudBackup: when the game on the phone changes while something is on its way', () => {
  /** A backup whose calls of one kind wait at a gate, so that something can happen while one is on its way. */
  const gated = (method: 'GET' | 'PUT'): { backup: CloudBackup; open: () => void } => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const backup = new CloudBackup({
      device,
      fetch: async (url, init) => {
        if ((init.method ?? 'GET') === method) await gate;
        return github.fetch(url, init);
      },
      timer: timer.timer,
      now: () => clock,
      log: (kind, message) => logged.push(`${kind}: ${message}`),
    });
    return { backup, open };
  };

  // The reinstall, with a slow first look: the empty game's attempt is still reading when the player restores.
  it('does not send the game that was there before a restore, however late its look comes back', async () => {
    const theirs = anotherGame(40, 900);
    github.seed(serializeRecord(theirs));
    const { backup, open } = gated('GET');
    await backup.setKey({ owner: OWNER, repo: REPO, token });
    const empty = run(1, 2);
    backup.runEnded(empty);
    await settle();
    // The player restores: the game on the phone is now the backup's, written here under a new save number.
    const restored = changed(theirs, (payload) => payload);
    const local = sealRecord({ ...unsealed(restored), seq: 3 });
    backup.runEnded(local);
    open();
    await settle();
    // The empty game's attempt came back to a file it has no claim on, and wrote nothing. The restored game's
    // own attempt then found a file it holds everything of.
    expect(github.commits.map((commit) => commit.text)).not.toContain(serializeRecord(empty));
    expect(github.file?.text).toBe(serializeRecord(local));
    expect(backup.status.lastAttempt?.outcome).toBe('ok');
    expect(backup.needsAttention).toBe(false);
  });

  it('lets a write of the old game land, and still does not put the new game over it', async () => {
    const { backup, open } = gated('PUT');
    await backup.setKey({ owner: OWNER, repo: REPO, token });
    const old = withOneMore(run(41, 60));
    backup.runEnded(old);
    await settle();
    // The game is replaced by another while the old one's write is on its way.
    backup.runEnded(anotherGame(2, 4));
    open();
    await settle();
    expect(github.file?.text).toBe(serializeRecord(old));
    expect(backup.status.lastAttempt?.outcome).toBe('left-alone');
  });

  it('runs an attempt that was asked for before the game changed, by the same rule', async () => {
    const { backup, open } = gated('GET');
    await backup.setKey({ owner: OWNER, repo: REPO, token });
    const old = withOneMore(run(41, 60));
    const first = backup.backUp(old);
    const second = backup.backUp(old);
    const imported = backup.backUp(anotherGame(2, 4));
    open();
    expect(await first).toBe('ok');
    expect(await second).toBe('ok');
    expect(await imported).toBe('left-alone');
    expect(github.file?.text).toBe(serializeRecord(old));
    expect(github.writes).toHaveLength(1);
  });

  it('does not write with a key that was forgotten while the file was being read', async () => {
    const { backup, open } = gated('GET');
    await backup.setKey({ owner: OWNER, repo: REPO, token });
    backup.runEnded(run(2, 5));
    await settle();
    expect(await backup.forget()).toBe(true);
    open();
    await settle();
    expect(github.writes).toEqual([]);
    expect(github.file).toBeNull();
    expect(backup.status).toEqual({ repository: null, lastOk: null, lastAttempt: null, standing: null, busy: false, unread: false });
    expect(device.values.get(BACKUP_STATE)).toEqual({ lastOk: null, lastAttempt: null, standing: null });
  });

  it('does not write with a key that was replaced while the file was being read, nor note its result against the new one', async () => {
    const { backup, open } = gated('GET');
    await backup.setKey({ owner: OWNER, repo: REPO, token });
    backup.runEnded(run(2, 5));
    await settle();
    await backup.setKey({ owner: OWNER, repo: 'other-saves', token });
    open();
    await settle();
    expect(github.writes).toEqual([]);
    expect(backup.status.lastAttempt).toBeNull();
    expect(backup.status.lastOk).toBeNull();
  });
});

describe('CloudBackup: faults in its own surroundings', () => {
  it('says so when the key could not be removed, and goes on using it', async () => {
    const backup = await withKey();
    device.failing = true;
    expect(await backup.forget()).toBe(false);
    device.failing = false;
    expect(backup.configured).toBe(true);
    expect(device.values.get(BACKUP_KEY)).toEqual({ owner: OWNER, repo: REPO, token });
    backup.runEnded(run(2, 5));
    await settle();
    expect(backup.status.lastAttempt?.outcome).toBe('ok');
  });

  it('is not stopped by a listener that throws, and still tells the listeners after it', async () => {
    const backup = await withKey();
    let told = 0;
    backup.subscribe(() => {
      throw new Error('a screen failed to draw');
    });
    backup.subscribe(() => {
      told += 1;
    });
    backup.runEnded(run(2, 5));
    await settle();
    expect(github.file?.text).toBe(serializeRecord(run(2, 5)));
    expect(backup.status.lastAttempt?.outcome).toBe('ok');
    expect(told).toBeGreaterThanOrEqual(2);
  });

  it('turns anything thrown inside an attempt into a failed backup, and carries on with the next', async () => {
    const backup = await withKey();
    const poisoned = new Proxy(run(2, 5), {
      get: (target, property, receiver) => {
        if (property === 'payload') throw new Error('this record cannot be read');
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    expect(await backup.backUp(poisoned)).toBe('failed');
    expect(github.writes).toEqual([]);
    expect(logged.some((line) => line.startsWith('backup: a backup attempt threw'))).toBe(true);
    expect(await backup.backUp(run(2, 5))).toBe('ok');
  });

  it('does not put what a failing store says into the log', async () => {
    // A store whose errors repeat what it was asked to keep. No browser is known to do this; the log is in
    // every export, so nothing is left to that.
    const echoing: DeviceStore = {
      getDevice: () => Promise.reject(new Error(`could not read; last value was ${token}`)),
      setDevice: (key, value) => Promise.reject(new Error(`could not store ${key}: ${JSON.stringify(value)}`)),
    };
    const backup = new CloudBackup({ device: echoing, fetch: github.fetch, timer: timer.timer, now: () => clock, log: (kind, message) => logged.push(`${kind}: ${message}`) });
    await backup.restore();
    expect(await backup.setKey({ owner: OWNER, repo: REPO, token })).toBe(false);
    expect(await backup.forget()).toBe(false);
    expect(logged.length).toBeGreaterThanOrEqual(3);
    expect(logged.join('\n')).not.toContain(token);
  });
});

describe('CloudBackup: a problem the service reported is not forgotten by an attempt that reached nobody', () => {
  it('keeps asking for the player after a refused key and then a run finished offline', async () => {
    const backup = await withKey();
    github.mode = 401;
    backup.runEnded(run(2, 5));
    await settle();
    expect(backup.needsAttention).toBe(true);
    github.mode = 'offline';
    backup.runEnded(run(3, 9));
    await settle();
    expect(backup.status.lastAttempt?.outcome).toBe('unreachable');
    expect(backup.status.standing).toBe('refused');
    expect(backup.needsAttention).toBe(true);
    // And across a restart.
    const restarted = make();
    await restarted.restore();
    expect(restarted.needsAttention).toBe(true);
    github.mode = 'normal';
    restarted.runEnded(run(4, 13));
    await settle();
    expect(restarted.needsAttention).toBe(false);
    expect(restarted.status.standing).toBe('ok');
  });

  it('does not ask for the player over a failure that is not theirs to mend', async () => {
    const backup = await withKey();
    github.mode = 500;
    backup.runEnded(run(2, 5));
    await settle();
    expect(backup.status.lastAttempt?.outcome).toBe('failed');
    expect(backup.status.standing).toBeNull();
    expect(backup.needsAttention).toBe(false);
  });

  it('does not let the service\'s own failures, or its limit on calls, clear a problem it reported', async () => {
    const backup = await withKey();
    github.mode = 401;
    backup.runEnded(run(2, 5));
    await settle();
    for (const arrange of [() => (github.mode = 500), () => (github.mode = 'offline'), () => ((github.mode = 'normal'), (github.rateLimited = true))]) {
      arrange();
      backup.runEnded(run(3, 9));
      await settle();
      expect(backup.status.standing).toBe('refused');
      expect(backup.needsAttention).toBe(true);
    }
    // Stored notes from a build that kept other results as standing are read as nothing known.
    device.values.set(BACKUP_STATE, { lastOk: null, lastAttempt: null, standing: 'failed' });
    const restarted = make();
    await restarted.restore();
    expect(restarted.status.standing).toBeNull();
  });

  it('knows nothing of a key just entered, until the service has answered for it', async () => {
    const backup = await withKey();
    github.mode = 401;
    backup.runEnded(run(2, 5));
    await settle();
    expect(backup.needsAttention).toBe(true);
    await backup.setKey({ owner: OWNER, repo: REPO, token });
    expect(backup.status.standing).toBeNull();
    expect(backup.needsAttention).toBe(false);
  });
});

describe('cleanToken', () => {
  it('takes out what a paste can pick up and leaves the key', () => {
    const key = madeUpKey('clean');
    expect(cleanToken(`  ${key}\n`)).toBe(key);
    expect(cleanToken(`${key.slice(0, 4)} ${key.slice(4)}`)).toBe(key);
    expect(cleanToken(`\u200b${key}\ufeff`)).toBe(key);
    expect(cleanToken(`${key}\u2060\u200d\u200c`)).toBe(key);
  });

  it('refuses what is empty or could not be sent in a header', () => {
    for (const entered of ['', '   ', '\u200b', `${madeUpKey('bad')}é`, `${madeUpKey('bad')}\u2014x`, 'ключ', `a\u0000b`, `a\u007fb`]) {
      expect(cleanToken(entered), JSON.stringify(entered)).toBeNull();
    }
  });

  it('is applied when a key is stored, and a key that fails it is not stored', async () => {
    const backup = make();
    expect(await backup.setKey({ owner: OWNER, repo: REPO, token: ` ${token}\u200b ` })).toBe(true);
    expect(device.values.get(BACKUP_KEY)).toEqual({ owner: OWNER, repo: REPO, token });
    const other = make();
    expect(await other.setKey({ owner: OWNER, repo: REPO, token: `${token}é` })).toBe(false);
    expect(other.configured).toBe(false);
    expect(logged.join('\n')).not.toContain(token);
  });
});

describe('CloudBackup: the key stays in the device store', () => {
  it('keeps the key under its own entry and out of everything else it stores, reports and logs', async () => {
    const backup = await withKey();
    github.mode = 401;
    backup.runEnded(run(2, 5));
    await settle();
    github.mode = 'normal';
    backup.runEnded(run(3, 9));
    await settle();
    expect(device.values.get(BACKUP_KEY)).toEqual({ owner: OWNER, repo: REPO, token });
    expect(JSON.stringify(device.values.get(BACKUP_STATE))).not.toContain(token);
    expect(JSON.stringify(backup.status)).not.toContain(token);
    expect(logged.join('\n')).not.toContain(token);
    // Nor is it in what was sent as the backup itself.
    for (const commit of github.commits) expect(`${commit.message}\n${commit.text}`).not.toContain(token);
  });

  it('comes back after a restart with its key and what it remembered', async () => {
    const backup = await withKey();
    backup.runEnded(run(2, 5));
    await settle();
    const restarted = make();
    await restarted.restore();
    expect(restarted.status).toEqual(backup.status);
    restarted.runEnded(run(3, 9));
    await settle();
    expect(restarted.status.lastAttempt?.outcome).toBe('ok');
    expect(github.commits).toHaveLength(2);
  });

  it('forgets the key and everything about the backup, and touches nothing in the repository', async () => {
    const backup = await withKey();
    backup.runEnded(run(2, 5));
    await settle();
    const calls = github.calls.length;
    await backup.forget();
    expect(JSON.stringify([...device.values.values()])).not.toContain(token);
    expect(backup.status).toEqual({ repository: null, lastOk: null, lastAttempt: null, standing: null, busy: false, unread: false });
    backup.runEnded(run(3, 9));
    await settle();
    expect(github.calls).toHaveLength(calls);
    expect(github.file?.text).toBe(serializeRecord(run(2, 5)));
  });

  it('stays off, without throwing, when the device store cannot be read', async () => {
    await withKey();
    device.failing = true;
    const restarted = make();
    await expect(restarted.restore()).resolves.toBeUndefined();
    expect(restarted.configured).toBe(false);
    // Off, but not known to be unset: Settings must not offer to set a key up over one that is there.
    expect(restarted.status.unread).toBe(true);
    expect(logged.some((line) => line.startsWith('backup: could not read'))).toBe(true);
    device.failing = false;
    await restarted.restore();
    expect(restarted.status.unread).toBe(false);
    expect(restarted.configured).toBe(true);
  });

  it('says so when the key cannot be stored, and does not use it', async () => {
    const backup = make();
    device.failing = true;
    expect(await backup.setKey({ owner: OWNER, repo: REPO, token })).toBe(false);
    expect(backup.configured).toBe(false);
    expect(logged.join('\n')).not.toContain(token);
  });

  it('still backs up when its notes cannot be stored', async () => {
    const backup = await withKey();
    device.failing = true;
    backup.runEnded(run(2, 5));
    await settle();
    expect(github.file?.text).toBe(serializeRecord(run(2, 5)));
    expect(backup.status.lastAttempt?.outcome).toBe('ok');
  });

  it('ignores stored settings that are not in its own shape', async () => {
    device.values.set(BACKUP_KEY, { owner: OWNER, repo: REPO });
    device.values.set(BACKUP_STATE, { seenSha: 7, lastOk: 'yesterday', lastAttempt: { at: 1, outcome: 'splendid' } });
    const backup = make();
    await backup.restore();
    expect(backup.status).toEqual({ repository: null, lastOk: null, lastAttempt: null, standing: null, busy: false, unread: false });
  });
});

describe('CloudBackup: looking', () => {
  it('reads the backup without changing it, and having looked changes nothing of what may be replaced', async () => {
    const text = serializeRecord(anotherGame(40, 900));
    const sha = github.seed(text);
    const backup = await withKey();
    expect(await backup.look()).toEqual({ ok: true, value: { text, sha } });
    expect(github.writes).toEqual([]);
    // Having looked is not having restored: the file is still another game's.
    expect(await backup.backUp(run(1, 2))).toBe('left-alone');
  });

  it('reports why it could not look', async () => {
    const backup = await withKey();
    github.mode = 'offline';
    expect(await backup.look()).toEqual({ ok: false, failure: 'unreachable', status: null });
  });
});

describe('parseRepository', () => {
  it('reads owner/name and the web address of a repository', () => {
    expect(parseRepository('someone/some-saves')).toEqual({ owner: 'someone', repo: 'some-saves' });
    expect(parseRepository('  someone/some.saves_2  ')).toEqual({ owner: 'someone', repo: 'some.saves_2' });
    expect(parseRepository('https://github.com/someone/some-saves')).toEqual({ owner: 'someone', repo: 'some-saves' });
    expect(parseRepository('https://github.com/someone/some-saves.git')).toEqual({ owner: 'someone', repo: 'some-saves' });
    expect(parseRepository('https://github.com/someone/some-saves/')).toEqual({ owner: 'someone', repo: 'some-saves' });
  });

  it('refuses anything else', () => {
    for (const entered of ['', 'someone', 'someone/', '/some-saves', 'a/b/c', 'some one/saves', 'someone/sa ves', 'https://example.com/a/b', 'a/b?c']) {
      expect(parseRepository(entered), entered).toBeNull();
    }
  });
});
