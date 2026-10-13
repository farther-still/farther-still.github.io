// A stand-in for the one service the cloud backup talks to: a repository holding at most one file, behind the
// contents API as GitHub documents it. Tests reach no network. The key a test uses is made up at run time.

import { hash } from '../src/engine';
import { BACKUP_FILE, BACKUP_ORIGIN } from '../src/save';
import type { FetchLike } from '../src/save';

export type FakeCall = { method: string; url: string; authorization: string | null; body: unknown; init: RequestInit };

/**
 * How the service behaves for the calls to come.
 * - `normal`: as documented.
 * - `offline`: every call rejects, as a browser's does with no network.
 * - `hang`: no call is ever answered.
 * - `throw`: the call throws before it returns a promise.
 * - a number: every call is answered with that status.
 */
export type FakeMode = 'normal' | 'offline' | 'hang' | 'throw' | number;

const answer = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const encode = (text: string): string => {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  // The service breaks the base64 into lines, which a reader has to cope with.
  return (btoa(binary).match(/.{1,60}/g) ?? []).join('\n') + '\n';
};

const decode = (code: string): string => {
  const binary = atob(code);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

/** A version name that depends on the text alone, as the service's own does. */
export const shaOf = (text: string): string => hash(`blob ${text}`).slice(0, 40);

export class FakeGitHub {
  mode: FakeMode = 'normal';
  /** With `normal`: the next write is made, and its answer never arrives. */
  loseNextAnswer = false;
  /** With `normal`: answer a 403 as the service does when too many calls were made. */
  rateLimited = false;
  repositoryExists = true;
  file: { text: string; sha: string } | null = null;
  readonly commits: { message: string; text: string }[] = [];
  readonly calls: FakeCall[] = [];

  constructor(
    readonly owner: string,
    readonly repo: string,
    /** The only key the service takes. */
    public token: string,
  ) {}

  /** Puts a file in the repository as if another install had written it. */
  seed(text: string): string {
    this.file = { text, sha: shaOf(text) };
    this.commits.push({ message: 'seeded', text });
    return this.file.sha;
  }

  /** Deletes the file, as someone might by hand on the service's website. */
  remove(): void {
    this.file = null;
  }

  get writes(): FakeCall[] {
    return this.calls.filter((call) => call.method === 'PUT');
  }

  readonly fetch: FetchLike = (url, init) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    let body: unknown = null;
    if (typeof init.body === 'string') body = JSON.parse(init.body);
    this.calls.push({ method: init.method ?? 'GET', url, authorization: headers['Authorization'] ?? null, body, init });
    if (this.mode === 'throw') throw new Error('the network stack threw');
    if (this.mode === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
    if (this.mode === 'hang') return new Promise<Response>(() => undefined);
    if (typeof this.mode === 'number') return Promise.resolve(answer(this.mode, { message: 'forced' }));
    return this.handle(init.method ?? 'GET', url, headers, body);
  };

  private handle(method: string, url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
    if (!url.startsWith(`${BACKUP_ORIGIN}/`)) return Promise.reject(new TypeError('blocked: not the backup address'));
    if (this.rateLimited) return Promise.resolve(answer(403, { message: 'rate limit exceeded' }, { 'x-ratelimit-remaining': '0' }));
    if (headers['Authorization'] !== `Bearer ${this.token}`) return Promise.resolve(answer(401, { message: 'Bad credentials' }));
    const repository = `/repos/${this.owner}/${this.repo}`;
    const path = url.slice(BACKUP_ORIGIN.length);
    if (!this.repositoryExists || !(path === repository || path.startsWith(`${repository}/`))) {
      return Promise.resolve(answer(404, { message: 'Not Found' }));
    }
    if (path === repository) return Promise.resolve(method === 'GET' ? answer(200, { full_name: `${this.owner}/${this.repo}` }) : answer(405, {}));
    if (path !== `${repository}/contents/${BACKUP_FILE}`) return Promise.resolve(answer(404, { message: 'Not Found' }));
    if (method === 'GET') {
      return Promise.resolve(
        this.file === null ? answer(404, { message: 'Not Found' }) : answer(200, { type: 'file', encoding: 'base64', content: encode(this.file.text), sha: this.file.sha }),
      );
    }
    if (method !== 'PUT') return Promise.resolve(answer(405, {}));
    const sent = body as { message?: unknown; content?: unknown; sha?: unknown };
    if (typeof sent.message !== 'string' || typeof sent.content !== 'string') return Promise.resolve(answer(422, { message: 'Invalid request' }));
    if (this.file !== null && sent.sha === undefined) return Promise.resolve(answer(422, { message: 'Invalid request. "sha" wasn\'t supplied.' }));
    if (this.file !== null && sent.sha !== this.file.sha) return Promise.resolve(answer(409, { message: 'does not match' }));
    if (this.file === null && sent.sha !== undefined) return Promise.resolve(answer(404, { message: 'Not Found' }));
    const created = this.file === null;
    const text = decode(sent.content);
    this.file = { text, sha: shaOf(text) };
    this.commits.push({ message: sent.message, text });
    if (this.loseNextAnswer) {
      this.loseNextAnswer = false;
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    return Promise.resolve(answer(created ? 201 : 200, { content: { sha: this.file.sha } }));
  }
}

/** A made-up key in no real key's shape, built at run time so that no token-like text sits in the repository. */
export const madeUpKey = (label = 'key'): string => ['made', 'up', label, String(label.length * 7919)].join('-');

/** A timer a test fires by hand. */
export class ManualTimer {
  private pending: { fire: () => void; ms: number }[] = [];

  readonly timer = (fire: () => void, ms: number): (() => void) => {
    const entry = { fire, ms };
    this.pending.push(entry);
    return () => {
      this.pending = this.pending.filter((other) => other !== entry);
    };
  };

  get waiting(): number {
    return this.pending.length;
  }

  /** Fires every timer still waiting, as if its time had passed. */
  fireAll(): void {
    const due = this.pending;
    this.pending = [];
    for (const entry of due) entry.fire();
  }
}
