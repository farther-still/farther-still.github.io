// When a backup is made and what this install remembers about it (ARCHITECTURE 7.5). The local save is the
// source of truth: this file is handed a record that is already committed, never waits on behalf of the game,
// and has no way to write a slot. Its key and its notes live in the `device` store, outside every save.

import { GitHubBackend, backupMessage } from './cloud';
import type { CloudFailure, CloudFile, CloudKey, CloudResult, FetchLike, TimerLike } from './cloud';
import { isObject, serializeRecord } from './record';
import type { SlotRecord } from './schema';

/** `device` store keys. The key is kept apart from the notes, so that reading the notes never touches the secret. */
export const BACKUP_KEY = 'backupKey';
export const BACKUP_STATE = 'backupState';

/**
 * How the last attempt ended. `unseen` is the one that is not a fault: the backup holds a save this install
 * neither wrote nor restored, so it was left alone until the player chooses between the two.
 */
export type BackupOutcome = 'ok' | 'unreachable' | 'refused' | 'not-found' | 'unseen' | 'failed';

export type BackupAttempt = { at: number; outcome: BackupOutcome; status: number | null };

export type BackupStatus = {
  /** "owner/name", for display. The token is never part of the status. */
  repository: string | null;
  lastOk: { at: number; seq: number; run: number } | null;
  lastAttempt: BackupAttempt | null;
  busy: boolean;
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
  /** Goes to the diagnostics log. Never handed the key. */
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

const OUTCOMES: readonly BackupOutcome[] = ['ok', 'unreachable', 'refused', 'not-found', 'unseen', 'failed'];

const readAttempt = (raw: unknown): BackupAttempt | null =>
  isObject(raw) && typeof raw['at'] === 'number' && OUTCOMES.includes(raw['outcome'] as BackupOutcome)
    ? { at: raw['at'], outcome: raw['outcome'] as BackupOutcome, status: typeof raw['status'] === 'number' ? raw['status'] : null }
    : null;

const readOk = (raw: unknown): BackupStatus['lastOk'] =>
  isObject(raw) && typeof raw['at'] === 'number' && typeof raw['seq'] === 'number' && typeof raw['run'] === 'number'
    ? { at: raw['at'], seq: raw['seq'], run: raw['run'] }
    : null;

/** `read` never answers `changed`; the type allows it, so it is given a home. */
const readFailure = (failure: CloudFailure): BackupOutcome => (failure === 'changed' ? 'failed' : failure);

const checksumIn = (text: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) && typeof parsed['checksum'] === 'string' ? parsed['checksum'] : null;
  } catch {
    return null;
  }
};

export class CloudBackup {
  private key: CloudKey | null = null;
  /** The backup file as this install last wrote or restored it. A write replaces that version and no other. */
  private seenSha: string | null = null;
  /** The checksum of the last record sent. If its answer was lost, this is how the file is known to be ours. */
  private sentChecksum: string | null = null;
  private lastOk: BackupStatus['lastOk'] = null;
  private lastAttempt: BackupAttempt | null = null;
  private waiting: SlotRecord | null = null;
  private loaded = false;
  /** Raised when the game on this phone stops being the one the backup was made from. An attempt begun before that learns nothing. */
  private epoch = 0;
  private inFlight = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: BackupDeps) {}

  /**
   * Reads the key and the notes, once. A store that cannot be read leaves the backup off, and the next call
   * tries again; it never throws.
   */
  async restore(): Promise<void> {
    if (this.loaded) return;
    try {
      this.key = readKey(await this.deps.device.getDevice(BACKUP_KEY));
      const state = await this.deps.device.getDevice(BACKUP_STATE);
      if (isObject(state)) {
        this.seenSha = typeof state['seenSha'] === 'string' ? state['seenSha'] : null;
        this.sentChecksum = typeof state['sentChecksum'] === 'string' ? state['sentChecksum'] : null;
        this.lastOk = readOk(state['lastOk']);
        this.lastAttempt = readAttempt(state['lastAttempt']);
      }
      this.loaded = true;
    } catch (error) {
      this.deps.log('backup', `could not read the backup settings: ${String(error)}`);
    }
  }

  get configured(): boolean {
    return this.key !== null;
  }

  get status(): BackupStatus {
    return {
      repository: this.key === null ? null : `${this.key.owner}/${this.key.repo}`,
      lastOk: this.lastOk,
      lastAttempt: this.lastAttempt,
      busy: this.inFlight > 0,
    };
  }

  /** True when the last attempt ended in a way only the player can put right. Being offline is not one. */
  get needsAttention(): boolean {
    const outcome = this.lastAttempt?.outcome;
    return this.key !== null && (outcome === 'refused' || outcome === 'not-found' || outcome === 'unseen');
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Stores the key. Entering a key sends nothing by itself. A different repository is one this install has
   * never seen, so what was remembered about the old one is dropped. False if the key could not be stored.
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
      this.deps.log('backup', `could not store the backup key: ${String(error)}`);
      return false;
    }
    this.key = next;
    if (!sameRepository) {
      this.seenSha = null;
      this.sentChecksum = null;
      this.lastOk = null;
    }
    this.lastAttempt = null;
    await this.persist();
    this.notify();
    return true;
  }

  /** Removes the key from this install and forgets the backup. Nothing in the repository is touched. */
  async forget(): Promise<void> {
    this.key = null;
    this.seenSha = null;
    this.sentChecksum = null;
    this.lastOk = null;
    this.lastAttempt = null;
    this.waiting = null;
    try {
      await this.deps.device.setDevice(BACKUP_KEY, null);
    } catch (error) {
      this.deps.log('backup', `could not remove the backup key: ${String(error)}`);
    }
    await this.persist();
    this.notify();
  }

  /**
   * A run has ended and `record` is already committed locally. Returns at once and never throws: the backup is
   * made in the background, one at a time, and if several pile up only the newest is sent.
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
      this.deps.log('backup', `could not start a backup: ${String(error)}`);
    }
  }

  /**
   * One attempt, asked for by the player. With `replace`, the backup is overwritten whatever it holds, which is
   * the player's answer to `unseen`. Without it, the file is replaced only if it is this install's own.
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

  /**
   * The game on this phone is no longer the one the backup was made from: it was started anew, imported, or
   * picked on the recovery screen. From here the backup is a save this install has not seen, and it is left
   * alone until the player restores it or says to overwrite it.
   */
  async disown(): Promise<void> {
    this.epoch += 1;
    this.seenSha = null;
    this.sentChecksum = null;
    this.waiting = null;
    await this.persist();
    this.notify();
  }

  /** The player has restored the file with this version name, so it is now one this install has seen. */
  async adopt(sha: string): Promise<void> {
    this.seenSha = sha;
    if (this.lastAttempt?.outcome === 'unseen') this.lastAttempt = null;
    await this.persist();
    this.notify();
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
    let result: { outcome: BackupOutcome; status: number | null };
    try {
      result = await this.send(new GitHubBackend(key, this.deps.fetch, this.deps.timer), record, replace);
    } catch (error) {
      // Nothing in `send` is meant to throw. If something does, it is a failed backup and no more than that.
      this.deps.log('backup', `a backup attempt threw: ${error instanceof Error ? error.name : 'unknown error'}`);
      result = { outcome: 'failed', status: null };
    }
    const before = this.lastAttempt?.outcome ?? null;
    this.lastAttempt = { at: this.deps.now(), ...result };
    if (result.outcome === 'ok') {
      this.lastOk = { at: this.lastAttempt.at, seq: record.seq, run: record.payload.game.profile.counters.runsStarted };
    }
    this.inFlight -= 1;
    // One line when the result changes, not one per run: a week of offline play must not fill the log.
    if (result.outcome !== 'ok' && result.outcome !== before) {
      this.deps.log('backup', `${result.outcome}${result.status === null ? '' : ` (HTTP ${result.status})`}`);
    }
    await this.persist();
    this.notify();
    return result.outcome;
  }

  private async send(backend: GitHubBackend, record: SlotRecord, replace: boolean): Promise<{ outcome: BackupOutcome; status: number | null }> {
    // Always look first. What may be replaced is decided here, from what the file holds, and is not left to the
    // service to refuse.
    const epoch = this.epoch;
    const there = await backend.read();
    if (!there.ok) return { outcome: readFailure(there.failure), status: there.status };
    // The game was replaced while the file was being read. This record is no longer the game on the phone.
    if (epoch !== this.epoch) return { outcome: 'unseen', status: null };
    const file = there.value;
    let sha: string | null = null;
    if (file !== null) {
      const theirs = checksumIn(file.text);
      if (theirs !== null && theirs === record.checksum) {
        // This very record is already there: an earlier write whose answer never arrived, or the save that was
        // just restored from this file.
        this.seenSha = file.sha;
        return { outcome: 'ok', status: null };
      }
      // Ours if it is the version this install last wrote or restored, or the record it last sent.
      const ours = file.sha === this.seenSha || (theirs !== null && theirs === this.sentChecksum);
      if (!ours && !replace) return { outcome: 'unseen', status: null };
      sha = file.sha;
    }
    // Noted before sending: if the answer is lost, the file can still be recognised as this install's own.
    this.sentChecksum = record.checksum;
    await this.persist();
    const written = await backend.put(serializeRecord(record), sha, backupMessage(record));
    // `changed` here means the file moved between the look and the write. Nothing was written; the next run tries again.
    if (!written.ok) return { outcome: written.failure === 'changed' ? 'failed' : written.failure, status: written.status };
    // If the game was replaced while the write was on its way, the file is the old game's and is not adopted.
    if (epoch === this.epoch) this.seenSha = written.value;
    return { outcome: 'ok', status: null };
  }

  private async persist(): Promise<void> {
    try {
      await this.deps.device.setDevice(BACKUP_STATE, {
        seenSha: this.seenSha,
        sentChecksum: this.sentChecksum,
        lastOk: this.lastOk,
        lastAttempt: this.lastAttempt,
      });
    } catch (error) {
      this.deps.log('backup', `could not store the backup notes: ${String(error)}`);
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
