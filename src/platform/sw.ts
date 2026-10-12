// The service worker. Its logic is our own; the build only replaces `self.__WB_MANIFEST` below with the list of
// files to cache (A-11). It precaches the whole build so the game runs offline, and a new version waits until
// the page asks for it: there is no skipWaiting on install (ARCHITECTURE section 9).

type ManifestEntry = { url: string; revision: string | null };

const worker = self as unknown as ServiceWorkerGlobalScope;

const entries = (self as unknown as { __WB_MANIFEST: ManifestEntry[] }).__WB_MANIFEST;

const CACHE_PREFIX = 'farther-still-precache-';

// FNV-1a over the file list: any changed file gives this version its own cache, so the version that is still
// running keeps reading the files it was built with.
const versionOf = (text: string): string => {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, '0');
};

const CACHE_NAME = CACHE_PREFIX + versionOf(JSON.stringify(entries));
const SCOPE = worker.registration.scope;
const INDEX_URL = new URL('index.html', SCOPE).href;

const PRECACHED = new Set(entries.map((entry) => new URL(entry.url, SCOPE).href));

// Every script and stylesheet the cached page asks for must be in this version's file list. Just after a
// deploy the host can briefly serve a page from the deploy before; caching that page beside this version's
// files would leave an app that cannot start.
const pageMatchesFiles = (html: string): boolean => {
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*"([^"]+)"/gi)) {
    const url = new URL(match[1] ?? '', SCOPE);
    if (url.origin === worker.location.origin && !PRECACHED.has(url.origin + url.pathname)) return false;
  }
  return true;
};

worker.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // `reload` skips the HTTP cache, so a file the browser fetched minutes ago cannot end up in a new version.
      await cache.addAll(entries.map((entry) => new Request(new URL(entry.url, SCOPE).href, { cache: 'reload' })));
      const page = await cache.match(INDEX_URL);
      if (page === undefined || !pageMatchesFiles(await page.text())) {
        // Installing fails, the version already running stays, and the browser tries again at the next check.
        await caches.delete(CACHE_NAME);
        throw new Error('the page fetched for this version does not match its file list');
      }
    })(),
  );
  // No skipWaiting here: a new version waits until the page asks for it.
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
      }
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener('message', (event) => {
  const data: unknown = event.data;
  if (typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'SKIP_WAITING') {
    void worker.skipWaiting();
  }
});

worker.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const key = request.mode === 'navigate' ? INDEX_URL : url.origin + url.pathname;
      return (await cache.match(key)) ?? fetch(request);
    })(),
  );
});
