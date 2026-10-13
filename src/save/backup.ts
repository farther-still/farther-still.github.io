// When a backup is made, what may be replaced by it, and what this install notes about it (ARCHITECTURE 7.5).
// The local save is the source of truth: this file is handed a record that is already committed, never waits on
// behalf of the game, and has no way to write a slot. Its key and its notes live in the `device` store, outside
// every save. The notes are for showing only: no decision about what to replace rests on them.

import { GitHubBackend, backupMessage } from './cloud';
import type { CloudFailure, CloudFile, CloudKey, CloudResult, FetchLike, TimerLike } from './cloud';
import { isObject, serializeRecord } from './record';
import type { SlotRecord } from './schema';
import { backedUpPayload, succeeds } from './succession';

/** `device` store keys. The key is kept apart from the notes, so that reading the notes never touches the secret. */
export const BACKUP_KEY = 'backupKey';
export const BACKUP_STATE = 'backupState';

/**
 * How an attempt ended. `left-alone` is the one that is not a fault: the backup holds a different game, or one
 * that keeps something the game on this phone does not, so it was not replaced. The player restores it or says
 * to overwrite it.
 */
export type BackupOutcome = 'ok' | 'unreachable' | 'refused' | 'not-found' | 'left-alone' | 'failed';

export type BackupAttempt = { at: number; outcome: BackupOutcome; status: number | null };

export type BackupStatus = {
  /** "owner/name", for display. The token is never part of the status. */
  repository: string | null;
  lastOk: { at: number; seq: number; run: number } | null;
  lastAttempt: BackupAttempt | null;
  /**
   * Where the backup stands: the newest result that says something about the key or the file, which is one of
   * `ok`, `refused`, `not-found` and `left-alone`. An attempt that reached nobody, or that the service failed
   * for reasons of its own, does not change it, so a refused key is still known to be refused after a run
   * finished offline. Entering a key clears it, since nothing is known of the new one yet.
   */
  standing: BackupOutcome | null;
  busy: boolean;
  /** True when the key could not be read from this phone's storage at this launch. It is not known to be unset. */
  unread: boolean;
};

/** The part of local storage the backup may use: the `device` store and nothing else. */
export type DeviceStore = {
  getDevice(key: string): Promise<unknown>;
  setDevice(key: string, value: unknown): Promise<void>;
};

export type BackupDeps = {
  device: DeviceStore;
  fetch: FetchLike;
  timer: TimerLike;
  now: () => number;
  /** Goes to the diagnostics log. Never handed the key, nor anything read from the `device` store. */
  log: (kind: string, message: string) => void;
};

const NAME = /^[A-Za-z0-9._-]+$/;

/** Reads "owner/name" or the repository's web address. Null if it is neither. */
export const parseRepository = (entered: string): { owner: string; repo: string } | null => {
  const parts = entered
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .split('/');
  const [owner, repo] = parts;
  if (parts.length !== 2 || owner === undefined || repo === undefined || !NAME.test(owner) || !NAME.test(repo)) return null;
  return { owner, repo };
};

/**
 * A key as it will be sent: with the spaces, line breaks and invisible characters a paste can pick up taken out.
 * Null if what is left is empty, or holds a character a browser will not put in a header, which no key has.
 */
export const cleanToken = (entered: string): string | null => {
  const cleaned = entered.replace(/(?:\s|\u200B|\u200C|\u200D|\u2060|\uFEFF)+/g, '');
  return /^[\x21-\x7E]+$/.test(cleaned) ? cleaned : null;
};

const readKey = (raw: unknown): CloudKey | null =>
  isObject(raw) && typeof raw['owner'] === 'string' && typeof raw['repo'] === 'string' && typeof raw['token'] === 'string' && raw['token'] !== ''
    ? { owner: raw['owner'], repo: raw['repo'], token: raw['token'] }
    : null;

const OUTCOMES: readonly BackupOutcome[] = ['ok', 'unreachable', 'refused', 'not-found', 'left-alone', 'failed'];

/** The results that say something about the key or the file, as against the network or the service's own state. */
const STANDS: readonly BackupOutcome[] = ['ok', 'refused', 'not-found', 'left-alone'];

const readOutcome = (raw: unknown): BackupOutcome | null => (OUTCOMES.includes(raw as BackupOutcome) ? (raw as BackupOutcome) : null);

const readAttempt = (raw: unknown): BackupAttempt | null => {
  if (!isObject(raw) || typeof raw['at'] !== 'number') return null;
  const outcome = readOutcome(raw['outcome']);
  return outcome === null ? null : { at: raw['at'], outcome, status: typeof raw['status'] === 'number' ? raw['status'] : null };
};

const readOk = (raw: unknown): BackupStatus['lastOk'] =>
  isObject(raw) && typeof raw['at'] === 'number' && typeof raw['seq'] === 'number' && typeof raw['run'] === 'number'
    ? { at: raw['at'], seq: raw['seq'], run: raw['run'] }
    : null;

/** `read` never answers `changed`; the type allows it, so it is given a home. */
const readFailure = (failure: CloudFailure): BackupOutcome => (failure === 'changed' ? 'failed' : failure);

/** What kind of error it was, and no more: an error's own text could hold whatever was being stored. */
const kindOf = (error: unknown): string => (error instanceof Error ? error.name : 'unknown error');

type Result = { outcome: BackupOutcome; status: number | null };

export class CloudBackup {
  private key: CloudKey | null = null;
  private lastOk: BackupStatus['lastOk'] = null;
  private lastAttempt: BackupAttempt | null = null;
  private standing: BackupOutcome | null = null;
  private waiting: SlotRecord | null = null;
  private unread = false;
  private inFlight = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: BackupDeps) {}

  /**
   * Reads the key and the notes. A store that cannot be read leaves the backup off for now and says so in the
   * status, so that Settings does not call a key unset when it only could not be read. It never throws, and it
   * can be called again.
   */
  async restore(): Promise<void> {
    try {
      this.key = readKey(await this.deps.device.getDevice(BACKUP_KEY));
      const state = await this.deps.device.getDevice(BACKUP_STATE);
      if (isObject(state)) {
        this.lastOk = readOk(state['lastOk']);
        this.lastAttempt = readAttempt(state['lastAttempt']);
        const standing = readOutcome(state['standing']);
        this.standing = standing !== null && STANDS.includes(standing) ? standing : null;
      }
      this.unread = false;
    } catch (error) {
      this.unread = true;
      this.deps.log('backup', `could not read the backup settings (${kindOf(error)})`);
    }
    this.notify();
  }

  get configured(): boolean {
    return this.key !== null;
  }

  get status(): BackupStatus {
    return {
      repository: this.key === null ? null : `${this.key.owner}/${this.key.repo}`,
      lastOk: this.lastOk,
      lastAttempt: this.lastAttempt,
      standing: this.standing,
      busy: this.inFlight > 0,
      unread: this.unread,
    };
  }

  /** True when the service's last answer is one only the player can put right. Being offline is not one. */
  get needsAttention(): boolean {
    return this.key !== null && (this.standing === 'refused' || this.standing === 'not-found' || this.standing === 'left-alone');
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Stores the key. Storing it sends nothing by itself. What was noted about the last attempts is dropped, and
   * for a different repository so is the last backup that worked. False if the key cannot be sent or stored.
   */
  async setKey(key: CloudKey): Promise<boolean> {
    const token = cleanToken(key.token);
    if (token === null) {
      this.deps.log('backup', 'a key that could not be sent was not stored');
      return false;
    }
    const next: CloudKey = { owner: key.owner.trim(), repo: key.repo.trim(), token };
    const sameRepository = this.key !== null && this.key.owner === next.owner && this.key.repo === next.repo;
    try {
      await this.deps.device.setDevice(BACKUP_KEY, next);
    } catch (error) {
      this.deps.log('backup', `could not store the backup key (${kindOf(error)})`);
      return false;
    }
    this.key = next;
    this.unread = false;
    if (!sameRepository) this.lastOk = null;
    this.lastAttempt = null;
    this.standing = null;
    await this.persist();
    this.notify();
    return true;
  }

  /**
   * Removes the key from this install and drops the notes. Nothing in the repository is touched, and an attempt
   * already on its way does not write. False if the key could not be removed from the store, in which case it
   * is still there and still in use.
   */
  async forget(): Promise<boolean> {
    try {
      await this.deps.device.setDevice(BACKUP_KEY, null);
    } catch (error) {
      this.deps.log('backup', `could not remove the backup key (${kindOf(error)})`);
      return false;
    }
    this.key = null;
    this.lastOk = null;
    this.lastAttempt = null;
    this.standing = null;
    this.waiting = null;
    await this.persist();
    this.notify();
    return true;
  }

  /**
   * `record` is committed locally and is the game as it now stands: a run has ended, or the game on the phone
   * was changed some other way and the backup should be looked at again. Returns at once and never throws: the
   * attempt is made in the background, one at a time, and if several pile up only the newest record is sent.
   * It replaces the backup only where `succeeds` allows.
   */
  runEnded(record: SlotRecord): void {
    try {
      if (this.key === null) return;
      const queued = this.waiting !== null;
      this.waiting = record;
      if (queued) return;
      void this.enqueue(async () => {
        const next = this.waiting;
        this.waiting = null;
        if (next !== null) await this.attempt(next, false);
      });
    } catch (error) {
      this.deps.log('backup', `could not start a backup (${kindOf(error)})`);
    }
  }

  /**
   * One attempt, asked for by the player. With `replace`, the backup is overwritten whatever it holds, which is
   * the player's answer to `left-alone`. Without it, the same rule holds as for a run that has ended.
   */
  backUp(record: SlotRecord, options: { replace: boolean } = { replace: false }): Promise<BackupOutcome> {
    return this.enqueue(() => this.attempt(record, options.replace));
  }

  /** The backup as it is now. Changes nothing, here or there. */
  async look(): Promise<CloudResult<CloudFile | null>> {
    if (this.key === null) return { ok: false, failure: 'failed', status: null };
    try {
      return await new GitHubBackend(this.key, this.deps.fetch, this.deps.timer).read();
    } catch {
      return { ok: false, failure: 'failed', status: null };
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task);
    this.chain = result.catch(() => undefined);
    return result;
  }

  private async attempt(record: SlotRecord, replace: boolean): Promise<BackupOutcome> {
    const key = this.key;
    if (key === null) return 'failed';
    this.inFlight += 1;
    this.notify();
    let result: Result;
    try {
      result = await this.send(key, record, replace);
    } catch (error) {
      // Nothing in `send` is meant to throw. If something does, it is a failed backup and no more than that.
      this.deps.log('backup', `a backup attempt threw (${kindOf(error)})`);
      result = { outcome: 'failed', status: null };
    }
    this.inFlight -= 1;
    // The key was replaced or forgotten while this was on its way. What it came to says nothing about the new one.
    if (this.key !== key) {
      this.notify();
      return result.outcome;
    }
    const before = this.lastAttempt?.outcome ?? null;
    this.lastAttempt = { at: this.deps.now(), ...result };
    if (result.outcome === 'ok') {
      this.lastOk = { at: this.lastAttempt.at, seq: record.seq, run: record.payload.game.profile.counters.runsStarted };
    }
    if (STANDS.includes(result.outcome)) this.standing = result.outcome;
    // One line when the result changes, not one per run: a week of offline play must not fill the log.
    if (result.outcome !== 'ok' && result.outcome !== before) {
      this.deps.log('backup', `${result.outcome}${result.status === null ? '' : ` (HTTP ${result.status})`}`);
    }
    await this.persist();
    this.notify();
    return result.outcome;
  }

  private async send(key: CloudKey, record: SlotRecord, replace: boolean): Promise<Result> {
    const backend = new GitHubBackend(key, this.deps.fetch, this.deps.timer);
    // Always look first. What may be replaced is decided here, from what the file holds and what the record
    // holds, and from nothing remembered.
    const there = await backend.read();
    if (!there.ok) return { outcome: readFailure(there.failure), status: there.status };
    const file = there.value;
    const text = serializeRecord(record);
    if (file !== null && !replace) {
      // This very record is already there: a write whose answer never arrived.
      if (file.text === text) return { outcome: 'ok', status: null };
      const theirs = file.text === null ? null : backedUpPayload(file.text);
      if (theirs === null || !succeeds(record.payload, theirs)) return { outcome: 'left-alone', status: null };
    }
    // The key was replaced or forgotten while the file was being read. Nothing is written with the old one.
    if (this.key !== key) return { outcome: 'failed', status: null };
    const written = await backend.put(text, file?.sha ?? null, backupMessage(record));
    // `changed` here means the file moved between the look and the write. Nothing was written; the next run tries again.
    if (!written.ok) return { outcome: written.failure === 'changed' ? 'failed' : written.failure, status: written.status };
    return { outcome: 'ok', status: null };
  }

  private async persist(): Promise<void> {
    try {
      await this.deps.device.setDevice(BACKUP_STATE, { lastOk: this.lastOk, lastAttempt: this.lastAttempt, standing: this.standing });
    } catch (error) {
      this.deps.log('backup', `could not store the backup notes (${kindOf(error)})`);
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A listener that throws must not stop a backup or the listeners after it.
      }
    }
  }
}
