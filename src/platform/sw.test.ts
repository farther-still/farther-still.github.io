// The service worker, run in a stand-in for the browser's worker scope. What matters most here: a new version
// never takes over on its own, and a version never installs with a page that does not match its files.

import { afterEach, describe, expect, it, vi } from 'vitest';

type Entry = { url: string; revision: string | null };
type Handler = (event: Record<string, unknown>) => void;

const ORIGIN = 'https://game.test';
const PREFIX = 'farther-still-precache-';

const ENTRIES: Entry[] = [
  { url: 'index.html', revision: 'r1' },
  { url: 'manifest.webmanifest', revision: 'r2' },
  { url: 'icons/icon-192.png', revision: 'r3' },
  { url: 'assets/app-AAAA.js', revision: null },
  { url: 'assets/app-AAAA.css', revision: null },
];

const page = (script: string): string =>
  `<!doctype html><html><head><link rel="manifest" href="/manifest.webmanifest" /><link rel="icon" href="/icons/icon-192.png" /><script type="module" crossorigin src="${script}"></script><link rel="stylesheet" crossorigin href="/assets/app-AAAA.css"></head><body><div id="app"></div></body></html>`;

const loadWorker = async (entries: Entry[], served: Record<string, string>, existingCaches: string[] = []) => {
  vi.resetModules();
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, string>>(existingCaches.map((name) => [name, new Map<string, string>()]));
  const requested: Array<{ url: string; cache: string }> = [];
  const network: string[] = [];
  const skipWaiting = vi.fn(() => Promise.resolve());
  const claim = vi.fn(() => Promise.resolve());

  vi.stubGlobal('self', {
    __WB_MANIFEST: entries,
    registration: { scope: `${ORIGIN}/` },
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting,
    clients: { claim },
  });
  vi.stubGlobal('caches', {
    open: (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name) ?? new Map<string, string>();
      return Promise.resolve({
        addAll: (requests: Request[]) => {
          for (const request of requests) {
            requested.push({ url: request.url, cache: request.cache });
            const body = served[request.url];
            if (body === undefined) return Promise.reject(new TypeError(`404 ${request.url}`));
            store.set(request.url, body);
          }
          return Promise.resolve();
        },
        match: (key: string) => Promise.resolve(store.has(key) ? new Response(store.get(key)) : undefined),
      });
    },
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
  });
  vi.stubGlobal('fetch', (request: { url: string }) => {
    network.push(request.url);
    return Promise.resolve(new Response('from network'));
  });

  // A variable path, so the type checker does not pull the worker into the tests' project.
  const workerPath = './sw';
  await import(/* @vite-ignore */ workerPath);

  const fire = async (type: string, extra: Record<string, unknown> = {}): Promise<{ response: Response | null; handled: boolean }> => {
    const waits: Array<Promise<unknown>> = [];
    let responding: Promise<Response> | null = null;
    handlers.get(type)?.({
      ...extra,
      waitUntil: (work: Promise<unknown>) => waits.push(work),
      respondWith: (work: Promise<Response>) => {
        responding = work;
      },
    });
    await Promise.all(waits);
    const pending = responding as Promise<Response> | null;
    return { response: pending === null ? null : await pending, handled: pending !== null };
  };

  const get = (url: string, mode = 'no-cors', method = 'GET') => fire('fetch', { request: { url, mode, method } });

  return { fire, get, stores, requested, network, skipWaiting, claim, handlers };
};

const SERVED: Record<string, string> = {
  [`${ORIGIN}/index.html`]: page('/assets/app-AAAA.js'),
  [`${ORIGIN}/manifest.webmanifest`]: '{}',
  [`${ORIGIN}/icons/icon-192.png`]: 'png',
  [`${ORIGIN}/assets/app-AAAA.js`]: 'js',
  [`${ORIGIN}/assets/app-AAAA.css`]: 'css',
};

const ownCache = (stores: Map<string, unknown>): string => {
  const names = [...stores.keys()].filter((name) => name.startsWith(PREFIX));
  if (names.length !== 1) throw new Error(`expected one cache, found ${names.join(', ') || 'none'}`);
  return names[0] ?? '';
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('service worker', () => {
  it('precaches every file of the build, bypassing the HTTP cache, and does not take over', async () => {
    const worker = await loadWorker(ENTRIES, SERVED);
    await worker.fire('install');
    expect(worker.requested.map((request) => request.url).sort()).toEqual(Object.keys(SERVED).sort());
    expect(worker.requested.every((request) => request.cache === 'reload')).toBe(true);
    expect([...(worker.stores.get(ownCache(worker.stores)) ?? new Map()).keys()].sort()).toEqual(Object.keys(SERVED).sort());
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    expect(worker.claim).not.toHaveBeenCalled();
  });

  it('refuses to install when the page it fetched belongs to another deploy', async () => {
    const stale = { ...SERVED, [`${ORIGIN}/index.html`]: page('/assets/app-OLD1.js') };
    const worker = await loadWorker(ENTRIES, stale);
    await expect(worker.fire('install')).rejects.toThrow('does not match');
    // Nothing half-installed is left behind.
    expect([...worker.stores.keys()]).toEqual([]);
    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });

  it('refuses to install when a file is missing from the host', async () => {
    const missing = Object.fromEntries(Object.entries(SERVED).filter(([url]) => !url.endsWith('app-AAAA.css')));
    const worker = await loadWorker(ENTRIES, missing);
    await expect(worker.fire('install')).rejects.toThrow('404');
  });

  it('takes over only when the page sends the SKIP_WAITING message', async () => {
    const worker = await loadWorker(ENTRIES, SERVED);
    await worker.fire('install');
    for (const data of [undefined, null, 'SKIP_WAITING', { type: 'OTHER' }, { kind: 'SKIP_WAITING' }, 7]) {
      await worker.fire('message', { data });
    }
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    await worker.fire('message', { data: { type: 'SKIP_WAITING' } });
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('removes the previous version’s cache only once it is activated, and leaves other caches alone', async () => {
    const worker = await loadWorker(ENTRIES, SERVED, [`${PREFIX}00000000`, 'something-else']);
    await worker.fire('install');
    // Still installed and waiting: the running version's cache must still be there.
    expect(worker.stores.has(`${PREFIX}00000000`)).toBe(true);
    await worker.fire('activate');
    expect([...worker.stores.keys()].sort()).toEqual([ownCache(worker.stores), 'something-else'].sort());
    expect(worker.claim).toHaveBeenCalledTimes(1);
  });

  it('gives each file list its own cache name', async () => {
    const first = await loadWorker(ENTRIES, SERVED);
    await first.fire('install');
    const again = await loadWorker(ENTRIES, SERVED);
    await again.fire('install');
    expect(ownCache(again.stores)).toBe(ownCache(first.stores));

    const changed = ENTRIES.map((entry) => (entry.url === 'assets/app-AAAA.js' ? { ...entry, url: 'assets/app-BBBB.js' } : entry));
    const next = await loadWorker(changed, {
      ...SERVED,
      [`${ORIGIN}/assets/app-BBBB.js`]: 'js2',
      [`${ORIGIN}/index.html`]: page('/assets/app-BBBB.js'),
    });
    await next.fire('install');
    expect(ownCache(next.stores)).not.toBe(ownCache(first.stores));
  });

  it('answers a launch with the cached page, and files from the cache, with no network', async () => {
    const worker = await loadWorker(ENTRIES, SERVED);
    await worker.fire('install');
    const launch = await worker.get(`${ORIGIN}/`, 'navigate');
    expect(await launch.response?.text()).toBe(SERVED[`${ORIGIN}/index.html`]);
    const deep = await worker.get(`${ORIGIN}/anything?x=1`, 'navigate');
    expect(await deep.response?.text()).toBe(SERVED[`${ORIGIN}/index.html`]);
    const script = await worker.get(`${ORIGIN}/assets/app-AAAA.js?v=2`);
    expect(await script.response?.text()).toBe('js');
    expect(worker.network).toEqual([]);
  });

  it('goes to the network for a same-site file it does not hold', async () => {
    const worker = await loadWorker(ENTRIES, SERVED);
    await worker.fire('install');
    const other = await worker.get(`${ORIGIN}/not-cached.json`);
    expect(await other.response?.text()).toBe('from network');
    expect(worker.network).toEqual([`${ORIGIN}/not-cached.json`]);
  });

  it('leaves other sites and non-GET requests alone', async () => {
    const worker = await loadWorker(ENTRIES, SERVED);
    await worker.fire('install');
    expect((await worker.get('https://elsewhere.test/x.js')).handled).toBe(false);
    expect((await worker.get(`${ORIGIN}/index.html`, 'no-cors', 'POST')).handled).toBe(false);
  });

  // Phase 5a success check 8. The cloud backup calls one address off the site (ARCHITECTURE 7.5). A backup read
  // answered from a cache would show the file as it once was, and one held in a cache would be a second copy of
  // the save that nothing keeps current. The address is spelled out here because this folder may not import the
  // save module; src/ui/backup.test.ts pins the same text to the constant the app uses.
  it('neither answers nor caches a call to the cloud backup, a read or a write, and does not fetch it itself', async () => {
    const worker = await loadWorker(ENTRIES, SERVED);
    await worker.fire('install');
    await worker.fire('activate');
    const held = (): Array<[string, string[]]> => [...worker.stores].map(([name, store]) => [name, [...store.keys()].sort()]);
    const before = held();
    const repository = 'https://api.github.com/repos/someone/some-saves';
    const file = `${repository}/contents/farther-still-save.json`;

    expect((await worker.get(file, 'cors', 'GET')).handled).toBe(false);
    expect((await worker.get(file, 'cors', 'PUT')).handled).toBe(false);
    expect((await worker.get(repository, 'cors', 'GET')).handled).toBe(false);
    // However the request is made, and asked twice: a first answer must not have been kept for the second.
    expect((await worker.get(file, 'no-cors', 'GET')).handled).toBe(false);
    expect((await worker.get(file, 'cors', 'GET')).handled).toBe(false);

    expect(worker.network).toEqual([]);
    expect(held()).toEqual(before);
    expect(before.flatMap(([, keys]) => keys).some((key) => key.includes('api.github.com'))).toBe(false);
  });
});
