// The cloud backend (ARCHITECTURE 7.5, GDD section 11): one file in a private GitHub repository, read and written
// through the contents API with a fine-grained token limited to that repository. Every write is a commit there.
// It is a backup and never the primary: nothing in this file is given a handle on local storage.

import type { SaveBackend } from './backend';
import { fromBase64, toBase64 } from './base64';
import { isObject, serializeRecord } from './record';
import type { SlotRecord } from './schema';

/** The one address the built page may call besides its own site. Pinned in `vite.config.ts` and `scripts/check-dist.ts`. */
export const BACKUP_ORIGIN = 'https://api.github.com';
/** The file a backup is kept in. Its text is a record's own serialization, so it can also be imported by hand. */
export const BACKUP_FILE = 'farther-still-save.json';
/** A call with no answer after this long counts as unreachable, so one stuck request cannot hold up the next backup. */
export const BACKUP_TIMEOUT_MS = 20000;

const API_VERSION = '2022-11-28';

/** What the player enters. `token` is the secret: it is kept in the `device` store and in no save, export or log. */
export type CloudKey = { owner: string; repo: string; token: string };

/**
 * Why a call did not do what was asked.
 * - `unreachable`: no answer at all: offline, timed out or blocked.
 * - `refused`: the service would not take the key: expired, revoked, or without the access it needs.
 * - `not-found`: the service knows no such repository for this key.
 * - `changed`: the file is not the version the caller named, so nothing was written.
 * - `failed`: anything else.
 */
export type CloudFailure = 'unreachable' | 'refused' | 'not-found' | 'changed' | 'failed';

export type CloudResult<T> = { ok: true; value: T } | { ok: false; failure: CloudFailure; status: number | null };

/** The backup file: its text, and the version name the service gives that text. */
export type CloudFile = { text: string; sha: string };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Calls `fire` after `ms` unless the returned function is called first. */
export type TimerLike = (fire: () => void, ms: number) => () => void;

export class CloudError extends Error {
  constructor(
    readonly failure: CloudFailure,
    readonly status: number | null,
  ) {
    // The message names the kind of failure and nothing else: it may end up in the diagnostics log.
    super(`cloud backup ${failure}${status === null ? '' : ` (HTTP ${status})`}`);
  }
}

type Answer = { status: number; body: unknown; limited: boolean };

const fail = (failure: CloudFailure, status: number | null): { ok: false; failure: CloudFailure; status: number | null } => ({ ok: false, failure, status });

const failureOf = (answer: Answer): CloudFailure => {
  if (answer.status === 401) return 'refused';
  // A 403 is also how the service says "too many requests", which is not the key's fault.
  if (answer.status === 403) return answer.limited ? 'failed' : 'refused';
  if (answer.status === 404) return 'not-found';
  return 'failed';
};

/** The line a backup's commit carries. Counts only: a commit message never holds anything from the game's content. */
export const backupMessage = (record: SlotRecord): string =>
  `Run ${record.payload.game.profile.counters.runsStarted}, save ${record.seq}`;

export class GitHubBackend implements SaveBackend {
  /**
   * The version of the file this install last wrote or restored. `write` names it, so a file that has changed
   * since, or one this install has never seen, is left alone.
   */
  seenSha: string | null = null;

  constructor(
    private readonly key: CloudKey,
    private readonly fetchFn: FetchLike,
    private readonly timer: TimerLike,
    private readonly timeoutMs: number = BACKUP_TIMEOUT_MS,
  ) {}

  private url(path: string): string {
    return `${BACKUP_ORIGIN}/repos/${encodeURIComponent(this.key.owner)}/${encodeURIComponent(this.key.repo)}${path}`;
  }

  /** Null when there was no answer. Never throws. */
  private async call(method: 'GET' | 'PUT', path: string, body?: unknown): Promise<Answer | null> {
    const abort = new AbortController();
    let cancel: () => void = () => undefined;
    const timedOut = new Promise<null>((resolve) => {
      cancel = this.timer(() => {
        abort.abort();
        resolve(null);
      }, this.timeoutMs);
    });
    const asked = (async (): Promise<Answer | null> => {
      try {
        const response = await this.fetchFn(this.url(path), {
          method,
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${this.key.token}`,
            'X-GitHub-Api-Version': API_VERSION,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          // The service lets a browser keep an answer for a minute. A backup must see the file as it is now.
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: abort.signal,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        let parsed: unknown = null;
        try {
          parsed = await response.json();
        } catch {
          // An answer with no JSON in it is judged by its status alone.
        }
        return { status: response.status, body: parsed, limited: response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after') };
      } catch {
        return null;
      }
    })();
    try {
      return await Promise.race([asked, timedOut]);
    } finally {
      cancel();
    }
  }

  /** The backup file as it is now, or null when the repository holds none yet. Changes nothing anywhere. */
  async read(): Promise<CloudResult<CloudFile | null>> {
    const answer = await this.call('GET', `/contents/${BACKUP_FILE}`);
    if (answer === null) return fail('unreachable', null);
    if (answer.status === 200) {
      const body = answer.body;
      if (!isObject(body) || typeof body['sha'] !== 'string' || typeof body['content'] !== 'string' || body['encoding'] !== 'base64') {
        return fail('failed', answer.status);
      }
      try {
        return { ok: true, value: { text: fromBase64(body['content'].replace(/\s+/g, '')), sha: body['sha'] } };
      } catch {
        return fail('failed', answer.status);
      }
    }
    if (answer.status === 404) {
      // "No such file" and "no such repository for this key" are answered alike, so the repository is asked for.
      const repository = await this.call('GET', '');
      if (repository === null) return fail('unreachable', null);
      if (repository.status === 200) return { ok: true, value: null };
      return fail(failureOf(repository), repository.status);
    }
    return fail(failureOf(answer), answer.status);
  }

  /**
   * Writes the file as one commit and gives back its new version name. `sha` is the version being replaced, or
   * null to create the file; if the file is not that version the service refuses and the answer is `changed`.
   */
  async put(text: string, sha: string | null, message: string): Promise<CloudResult<string>> {
    const answer = await this.call('PUT', `/contents/${BACKUP_FILE}`, { message, content: toBase64(text), ...(sha === null ? {} : { sha }) });
    if (answer === null) return fail('unreachable', null);
    if (answer.status === 200 || answer.status === 201) {
      const content = isObject(answer.body) ? answer.body['content'] : undefined;
      const written = isObject(content) ? content['sha'] : undefined;
      return typeof written === 'string' ? { ok: true, value: written } : fail('failed', answer.status);
    }
    if (answer.status === 409 || answer.status === 422) return fail('changed', answer.status);
    return fail(failureOf(answer), answer.status);
  }

  /** The backup as a list of at most one record, exactly as stored: it may be damaged, like any stored record. */
  async readAll(): Promise<unknown[]> {
    const file = await this.read();
    if (!file.ok) throw new CloudError(file.failure, file.status);
    if (file.value === null) return [];
    try {
      return [JSON.parse(file.value.text)];
    } catch {
      return [file.value.text];
    }
  }

  /** Resolves only once the commit is made. Replaces nothing but the version this install last saw. */
  async write(record: SlotRecord): Promise<void> {
    const written = await this.put(serializeRecord(record), this.seenSha, backupMessage(record));
    if (!written.ok) throw new CloudError(written.failure, written.status);
    this.seenSha = written.value;
  }
}
