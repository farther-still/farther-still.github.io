import { beforeEach, describe, expect, it } from 'vitest';
import { FakeGitHub, ManualTimer, madeUpKey, shaOf } from '../../tests/fake-github';
import { record } from '../../tests/helpers';
import { BACKUP_FILE, BACKUP_ORIGIN, CloudError, GitHubBackend, backupMessage } from './cloud';
import { checksumMatches, serializeRecord } from './record';

const OWNER = 'someone';
const REPO = 'some-saves';

let github: FakeGitHub;
let timer: ManualTimer;
let token: string;

beforeEach(() => {
  token = madeUpKey('cloud');
  github = new FakeGitHub(OWNER, REPO, token);
  timer = new ManualTimer();
});

const backend = (key = token): GitHubBackend => new GitHubBackend({ owner: OWNER, repo: REPO, token: key }, github.fetch, timer.timer);

describe('GitHubBackend: what it sends', () => {
  it('calls the one backup address, for the one file, and nowhere else', async () => {
    const cloud = backend();
    await cloud.read();
    await cloud.put('{"a":1}', null, 'first');
    await cloud.read();
    expect(github.calls.length).toBeGreaterThan(0);
    for (const call of github.calls) {
      expect(new URL(call.url).origin).toBe(BACKUP_ORIGIN);
      expect([`/repos/${OWNER}/${REPO}`, `/repos/${OWNER}/${REPO}/contents/${BACKUP_FILE}`]).toContain(new URL(call.url).pathname);
    }
  });

  it('puts the key in the Authorization header and nowhere else in a call', async () => {
    const cloud = backend();
    await cloud.put(serializeRecord(record('hot', 7)), null, 'm');
    await cloud.read();
    for (const call of github.calls) {
      expect(call.authorization).toBe(`Bearer ${token}`);
      expect(call.url).not.toContain(token);
      expect(JSON.stringify(call.body)).not.toContain(token);
      const { headers, ...rest } = call.init;
      expect(JSON.stringify(rest)).not.toContain(token);
      expect(Object.entries(headers as Record<string, string>).filter(([, value]) => value.includes(token)).map(([name]) => name)).toEqual(['Authorization']);
    }
  });

  it('never lets the browser answer from its cache, and sends no cookies', async () => {
    await backend().read();
    await backend().put('x', null, 'm');
    for (const call of github.calls) {
      expect(call.init.cache).toBe('no-store');
      expect(call.init.credentials).toBe('omit');
    }
  });

  it('escapes the names it puts in the address', async () => {
    const odd = new GitHubBackend({ owner: 'a/b', repo: 'c?d', token }, github.fetch, timer.timer);
    await odd.read();
    expect(github.calls[0]?.url).toBe(`${BACKUP_ORIGIN}/repos/a%2Fb/c%3Fd/contents/${BACKUP_FILE}`);
  });
});

describe('GitHubBackend: reading', () => {
  it('says there is no backup when the repository is there and the file is not', async () => {
    expect(await backend().read()).toEqual({ ok: true, value: null });
  });

  it('gives back the text exactly, through line-broken base64 and beyond ASCII', async () => {
    const text = `{"name":"${'é—漢字 '.repeat(40)}"}`;
    const sha = github.seed(text);
    expect(await backend().read()).toEqual({ ok: true, value: { text, sha } });
  });

  it('tells a missing repository from a missing file', async () => {
    github.repositoryExists = false;
    expect(await backend().read()).toEqual({ ok: false, failure: 'not-found', status: 404 });
  });

  it('reports a key the service will not take as refused', async () => {
    expect(await backend(madeUpKey('wrong')).read()).toEqual({ ok: false, failure: 'refused', status: 401 });
    github.mode = 403;
    expect(await backend().read()).toEqual({ ok: false, failure: 'refused', status: 403 });
  });

  it('does not blame the key for "too many requests"', async () => {
    github.rateLimited = true;
    expect(await backend().read()).toEqual({ ok: false, failure: 'failed', status: 403 });
  });

  it('reports no answer as unreachable: offline, and a call that throws', async () => {
    github.mode = 'offline';
    expect(await backend().read()).toEqual({ ok: false, failure: 'unreachable', status: null });
    github.mode = 'throw';
    expect(await backend().read()).toEqual({ ok: false, failure: 'unreachable', status: null });
  });

  it('gives up on a call that is never answered once the timer fires', async () => {
    github.mode = 'hang';
    const reading = backend().read();
    let settled = false;
    void reading.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(timer.waiting).toBe(1);
    timer.fireAll();
    expect(await reading).toEqual({ ok: false, failure: 'unreachable', status: null });
    // The call was told to stop, so it does not linger.
    expect(github.calls[0]?.init.signal?.aborted).toBe(true);
  });

  it('leaves no timer behind after an answer', async () => {
    await backend().read();
    expect(timer.waiting).toBe(0);
  });

  it('fails on an answer that is not a file', async () => {
    github.mode = 500;
    expect(await backend().read()).toEqual({ ok: false, failure: 'failed', status: 500 });
    github.mode = 200;
    expect(await backend().read()).toEqual({ ok: false, failure: 'failed', status: 200 });
  });

  it('says the same of a file whose content cannot be decoded', async () => {
    const undecodable: typeof github.fetch = (url, init) =>
      (init.method ?? 'GET') === 'GET' && url.endsWith(`/contents/${BACKUP_FILE}`)
        ? Promise.resolve(new Response(JSON.stringify({ type: 'file', encoding: 'base64', content: '%%% not base64 %%%', sha: 'v1' }), { status: 200 }))
        : github.fetch(url, init);
    const cloud = new GitHubBackend({ owner: OWNER, repo: REPO, token }, undecodable, timer.timer);
    expect(await cloud.read()).toEqual({ ok: true, value: { text: null, sha: 'v1' } });
    // Bytes that are base64 but not text are no better.
    const notText: typeof github.fetch = () => Promise.resolve(new Response(JSON.stringify({ type: 'file', encoding: 'base64', content: btoa(String.fromCharCode(255, 254, 253)), sha: 'v2' }), { status: 200 }));
    expect(await new GitHubBackend({ owner: OWNER, repo: REPO, token }, notText, timer.timer).read()).toEqual({ ok: true, value: { text: null, sha: 'v2' } });
  });

  it('says a file is there, by its version, when it is not handed over as text', async () => {
    const sha = github.seed('x'.repeat(40));
    github.opaque = true;
    expect(await backend().read()).toEqual({ ok: true, value: { text: null, sha } });
  });
});

describe('GitHubBackend: writing', () => {
  it('creates the file as a commit and gives back its version', async () => {
    const written = await backend().put('{"a":1}', null, 'Run 1, save 2');
    expect(written).toEqual({ ok: true, value: shaOf('{"a":1}') });
    expect(github.file).toEqual({ text: '{"a":1}', sha: shaOf('{"a":1}') });
    expect(github.commits).toEqual([{ message: 'Run 1, save 2', text: '{"a":1}' }]);
  });

  it('replaces the version it names and no other', async () => {
    const first = github.seed('one');
    const cloud = backend();
    expect(await cloud.put('two', 'not-the-version', 'm')).toEqual({ ok: false, failure: 'changed', status: 409 });
    expect(await cloud.put('two', null, 'm')).toEqual({ ok: false, failure: 'changed', status: 422 });
    expect(github.file?.text).toBe('one');
    expect(await cloud.put('two', first, 'm')).toEqual({ ok: true, value: shaOf('two') });
    expect(github.file?.text).toBe('two');
  });

  it('classifies a refused write without writing', async () => {
    const cloud = backend(madeUpKey('wrong'));
    expect(await cloud.put('x', null, 'm')).toEqual({ ok: false, failure: 'refused', status: 401 });
    github.repositoryExists = false;
    expect(await backend().put('x', null, 'm')).toEqual({ ok: false, failure: 'not-found', status: 404 });
    github.mode = 'offline';
    expect(await backend().put('x', null, 'm')).toEqual({ ok: false, failure: 'unreachable', status: null });
    expect(github.file).toBeNull();
  });
});

describe('GitHubBackend as a SaveBackend', () => {
  it('writes a record as its own serialization, which still passes its checksum when read back', async () => {
    const cloud = backend();
    const saved = record('hot', 12);
    await cloud.write(saved);
    expect(github.file?.text).toBe(serializeRecord(saved));
    expect(github.commits.at(-1)?.message).toBe(backupMessage(saved));
    const [back] = await cloud.readAll();
    expect(back).toEqual(saved);
    expect(checksumMatches(back)).toBe(true);
  });

  it('replaces whatever the file holds, one commit a write: what may be replaced is the caller\'s to decide', async () => {
    const cloud = backend();
    await cloud.write(record('hot', 1));
    await cloud.write(record('hot', 2));
    expect(github.commits).toHaveLength(2);
    // It names the version it has just read, so each write is made against the file as it is.
    expect((github.writes[1]?.body as { sha?: string }).sha).toBe(shaOf(serializeRecord(record('hot', 1))));
    await backend().write(record('hot', 3));
    expect(github.file?.text).toBe(serializeRecord(record('hot', 3)));
    expect(github.commits).toHaveLength(3);
  });

  it('hands back a file that is not text as a record that cannot be read', async () => {
    github.seed('x');
    github.opaque = true;
    expect(await backend().readAll()).toEqual([null]);
  });

  it('reads an empty repository as no records and hands back damage as it is', async () => {
    expect(await backend().readAll()).toEqual([]);
    github.seed('not json at all');
    expect(await backend().readAll()).toEqual(['not json at all']);
  });

  it('throws an error that names the kind of failure and never the key', async () => {
    const cloud = backend(madeUpKey('wrong'));
    const failure = await cloud.write(record('hot', 1)).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(CloudError);
    expect((failure as CloudError).failure).toBe('refused');
    expect(String(failure)).not.toContain(madeUpKey('wrong'));
    expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure as object))).not.toContain(madeUpKey('wrong'));
  });

  it('writes a commit message of counts only', () => {
    expect(backupMessage(record('hot', 41))).toBe('Run 3, save 41');
  });
});
