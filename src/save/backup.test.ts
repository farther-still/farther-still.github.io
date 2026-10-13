import { beforeEach, describe, expect, it } from 'vitest';
import { FakeGitHub, ManualTimer, madeUpKey } from '../../tests/fake-github';
import { FIXED_NOW, gameAtRun, record } from '../../tests/helpers';
import { BACKUP_KEY, BACKUP_STATE, CloudBackup, cleanToken, parseRepository } from './backup';
import type { DeviceStore } from './backup';
import { serializeRecord } from './record';
import type { SlotRecord } from './schema';

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

const run = (runsStarted: number, seq: number): SlotRecord => record('hot', seq, gameAtRun(runsStarted));

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
    expect(backup.status).toEqual({ repository: null, lastOk: null, lastAttempt: null, busy: false });
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

describe('CloudBackup: a backup this install has not seen is left alone', () => {
  it('does not overwrite a file that was there before the key was entered', async () => {
    const theirs = serializeRecord(run(40, 900));
    github.seed(theirs);
    const backup = await withKey();
    backup.runEnded(run(1, 2));
    await settle();
    expect(github.writes).toEqual([]);
    expect(github.file?.text).toBe(theirs);
    expect(backup.status.lastAttempt?.outcome).toBe('unseen');
    expect(backup.needsAttention).toBe(true);
    expect(await backup.backUp(run(1, 3))).toBe('unseen');
    expect(github.file?.text).toBe(theirs);
  });

  it('does not overwrite a file another install has changed since', async () => {
    const backup = await withKey();
    backup.runEnded(run(2, 5));
    await settle();
    const theirs = serializeRecord(run(9, 300));
    github.seed(theirs);
    backup.runEnded(run(3, 9));
    await settle();
    expect(github.file?.text).toBe(theirs);
    expect(backup.status.lastAttempt?.outcome).toBe('unseen');
  });

  it('backs up again once the player has restored that file', async () => {
    const sha = github.seed(serializeRecord(run(40, 900)));
    const backup = await withKey();
    backup.runEnded(run(1, 2));
    await settle();
    expect(backup.needsAttention).toBe(true);
    await backup.adopt(sha);
    expect(backup.needsAttention).toBe(false);
    const next = run(41, 4);
    backup.runEnded(next);
    await settle();
    expect(github.file?.text).toBe(serializeRecord(next));
    expect(backup.status.lastAttempt?.outcome).toBe('ok');
  });

  it('overwrites it when the player says so, and only then', async () => {
    github.seed(serializeRecord(run(40, 900)));
    const backup = await withKey();
    const mine = run(1, 2);
    expect(await backup.backUp(mine)).toBe('unseen');
    expect(await backup.backUp(mine, { replace: true })).toBe('ok');
    expect(github.file?.text).toBe(serializeRecord(mine));
    // The replaced save is still in the repository's history.
    expect(github.commits.map((commit) => commit.text)).toContain(serializeRecord(run(40, 900)));
    backup.runEnded(run(2, 6));
    await settle();
    expect(backup.status.lastAttempt?.outcome).toBe('ok');
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

  it('knows its own write when the answer to it was lost', async () => {
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

  it('knows its own write after a restart, too', async () => {
    const backup = await withKey();
    github.loseNextAnswer = true;
    backup.runEnded(run(2, 5));
    await settle();
    const restarted = make();
    await restarted.restore();
    restarted.runEnded(run(3, 9));
    await settle();
    expect(restarted.status.lastAttempt?.outcome).toBe('ok');
    expect(github.file?.text).toBe(serializeRecord(run(3, 9)));
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

  it('treats a new repository as one it has never seen', async () => {
    const backup = await withKey();
    backup.runEnded(run(2, 5));
    await settle();
    const elsewhere = new FakeGitHub(OWNER, 'other-saves', token);
    elsewhere.seed(serializeRecord(run(40, 900)));
    const moved = new CloudBackup({ device, fetch: elsewhere.fetch, timer: timer.timer, now: () => clock, log: () => undefined });
    await moved.restore();
    await moved.setKey({ owner: OWNER, repo: 'other-saves', token });
    expect(moved.status.lastOk).toBeNull();
    expect(await moved.backUp(run(3, 9))).toBe('unseen');
    expect(elsewhere.writes).toEqual([]);
  });

  it('keeps what it knows when only the key is replaced', async () => {
    const backup = await withKey();
    backup.runEnded(run(2, 5));
    await settle();
    github.token = madeUpKey('renewed');
    backup.runEnded(run(3, 9));
    await settle();
    expect(backup.status.lastAttempt?.outcome).toBe('refused');
    await backup.setKey({ owner: OWNER, repo: REPO, token: github.token });
    expect(backup.status.lastAttempt).toBeNull();
    expect(backup.status.lastOk?.run).toBe(2);
    backup.runEnded(run(4, 13));
    await settle();
    expect(backup.status.lastAttempt?.outcome).toBe('ok');
  });
});

describe('CloudBackup: a game that is not the one the backup was made from', () => {
  it('leaves its own backup alone once the game has been replaced, until the player chooses', async () => {
    const backup = await withKey();
    const kept = run(41, 60);
    backup.runEnded(kept);
    await settle();
    expect(github.file?.text).toBe(serializeRecord(kept));

    await backup.disown();
    backup.runEnded(run(2, 4));
    await settle();
    expect(github.file?.text).toBe(serializeRecord(kept));
    expect(backup.status.lastAttempt?.outcome).toBe('unseen');
    expect(backup.needsAttention).toBe(true);
    expect(await backup.backUp(run(2, 5))).toBe('unseen');
    // What it knew of its last good backup is still shown: only its claim on the file is gone.
    expect(backup.status.lastOk).toEqual({ at: clock, seq: 60, run: 41 });

    expect(await backup.backUp(run(2, 5), { replace: true })).toBe('ok');
    expect(github.file?.text).toBe(serializeRecord(run(2, 5)));
  });

  it('remembers across a restart that the backup is no longer its own', async () => {
    const backup = await withKey();
    const kept = run(41, 60);
    backup.runEnded(kept);
    await settle();
    await backup.disown();
    const restarted = make();
    await restarted.restore();
    restarted.runEnded(run(2, 4));
    await settle();
    expect(github.file?.text).toBe(serializeRecord(kept));
    expect(restarted.status.lastAttempt?.outcome).toBe('unseen');
  });

  it('does not know the old game\'s file as its own by the record it last sent', async () => {
    const backup = await withKey();
    github.loseNextAnswer = true;
    const kept = run(41, 60);
    backup.runEnded(kept);
    await settle();
    // The write was made and never answered, so only the note of what was sent ties the file to this install.
    await backup.disown();
    backup.runEnded(run(2, 4));
    await settle();
    expect(github.file?.text).toBe(serializeRecord(kept));
    expect(backup.status.lastAttempt?.outcome).toBe('unseen');
  });

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

  it('does not send the old game when the game is replaced while the file is being read', async () => {
    const { backup, open } = gated('GET');
    await backup.setKey({ owner: OWNER, repo: REPO, token });
    backup.runEnded(run(41, 60));
    await settle();
    await backup.disown();
    open();
    await settle();
    // The read came back to a game that is no longer the one on the phone. Nothing was written.
    expect(github.writes).toEqual([]);
    expect(github.file).toBeNull();
    expect(backup.status.lastAttempt?.outcome).toBe('unseen');
  });

  it('does not take the file for its own when the game is replaced while the write is on its way', async () => {
    const { backup, open } = gated('PUT');
    await backup.setKey({ owner: OWNER, repo: REPO, token });
    const old = run(41, 60);
    backup.runEnded(old);
    await settle();
    await backup.disown();
    open();
    await settle();
    // The old game's write was already sent and it lands. It is the old game's file, not the new one's.
    expect(github.file?.text).toBe(serializeRecord(old));
    backup.runEnded(run(2, 4));
    await settle();
    expect(github.file?.text).toBe(serializeRecord(old));
    expect(backup.status.lastAttempt?.outcome).toBe('unseen');
  });

  it('drops a write that was queued for the old game', async () => {
    const backup = await withKey();
    github.mode = 'hang';
    backup.runEnded(run(41, 60));
    await settle();
    backup.runEnded(run(42, 64));
    await backup.disown();
    github.mode = 'normal';
    timer.fireAll();
    await settle();
    expect(github.writes).toEqual([]);
    expect(github.file).toBeNull();
  });

  it('counts the save that was just restored from the file as backed up, and carries on from it', async () => {
    const theirs = run(40, 900);
    const sha = github.seed(serializeRecord(theirs));
    const backup = await withKey();
    await backup.disown();
    await backup.adopt(sha);
    const next = run(41, 4);
    backup.runEnded(next);
    await settle();
    expect(github.file?.text).toBe(serializeRecord(next));
  });
});

describe('CloudBackup: reading its settings once', () => {
  it('does not read the store again once it has, so a later call cannot undo what has happened since', async () => {
    const first = await withKey();
    first.runEnded(run(2, 5));
    await settle();
    const backup = make();
    await backup.restore();
    device.failing = true;
    // The note that the file is no longer its own could not be stored: the store still says it is.
    await backup.disown();
    device.failing = false;
    // A second call, as every way into the game makes one, must not bring the stored claim back.
    await backup.restore();
    backup.runEnded(run(3, 9));
    await settle();
    expect(backup.status.lastAttempt?.outcome).toBe('unseen');
    expect(github.file?.text).toBe(serializeRecord(run(2, 5)));
  });

  it('tries again after a read that failed', async () => {
    await withKey();
    device.failing = true;
    const backup = make();
    await backup.restore();
    expect(backup.configured).toBe(false);
    device.failing = false;
    await backup.restore();
    expect(backup.configured).toBe(true);
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
    expect(backup.status).toEqual({ repository: null, lastOk: null, lastAttempt: null, busy: false });
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
    expect(logged.some((line) => line.startsWith('backup: could not read'))).toBe(true);
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
    expect(backup.status).toEqual({ repository: null, lastOk: null, lastAttempt: null, busy: false });
  });
});

describe('CloudBackup: looking', () => {
  it('reads the backup without changing it or what this install remembers', async () => {
    const text = serializeRecord(run(40, 900));
    const sha = github.seed(text);
    const backup = await withKey();
    expect(await backup.look()).toEqual({ ok: true, value: { text, sha } });
    expect(github.writes).toEqual([]);
    // Having looked is not having restored: the file is still one this install must not replace.
    expect(await backup.backUp(run(1, 2))).toBe('unseen');
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
