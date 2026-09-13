/* Tonight — hand-written service worker.
 *
 * Two caches, two completely different strategies, on purpose:
 *
 *   ASSETS  cache-first. Safe ONLY because Vite content-hashes every filename,
 *           so /assets/index.a1b2c3.js can never mean two different things. A
 *           cached copy is therefore never the wrong copy.
 *
 *   API     network-first with a short timeout, falling back to cache.
 *           NOT stale-while-revalidate, NOT cache-first. A stale-first API
 *           cache with no expiry silently pins the app to hours-old data and
 *           makes every refresh button a lie. If the network answers within
 *           API_TIMEOUT_MS the user sees live data, full stop.
 *
 * Every cached API response is stamped with x-sw-cached-at so the UI can always
 * say how old the thing on screen is. Cached data is fine; cached data that
 * looks live is not.
 */
const VERSION    = 'v1';
const ASSETS     = `tonight-assets-${VERSION}`;
const API        = `tonight-api-${VERSION}`;
const API_TIMEOUT_MS = 3500;   // fall back to cache after this, not never
const API_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3;  // hard expiry; nothing is kept forever

const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(ASSETS);
    // Individually, so one 404 cannot fail the whole install.
    await Promise.all(PRECACHE.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = new Set([ASSETS, API]);
    await Promise.all((await caches.keys()).filter(k => !keep.has(k)).map(k => caches.delete(k)));
    await sweepExpiredApi();
    await self.clients.claim();
  })());
});

/** Drop API entries past their hard expiry so the cache cannot grow stale forever. */
async function sweepExpiredApi() {
  const c = await caches.open(API);
  const now = Date.now();
  for (const req of await c.keys()) {
    const res = await c.match(req);
    const at = Number(res?.headers.get('x-sw-cached-at') || 0);
    if (!at || now - at > API_MAX_AGE_MS) await c.delete(req);
  }
}

/** Re-wrap a response so we can stamp it. Response headers are immutable. */
function stamp(res, extra = {}) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

async function networkFirst(req) {
  const cache = await caches.open(API);
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const net = await fetch(req, { signal: ctrl.signal });
    clearTimeout(timer);
    if (net.ok) {
      // Stamp before storing; the copy in the cache carries its own birth date.
      const toStore = stamp(net.clone(), { 'x-sw-cached-at': String(Date.now()) });
      cache.put(req, toStore).catch(() => {});
      return stamp(net, { 'x-sw-source': 'network', 'x-sw-age-ms': '0' });
    }
    // A 5xx is worth falling back on ONLY if we actually hold something better.
    // Synthesising "offline" over a real upstream response loses the message the
    // server was trying to send: a 503 from our own TMDB function carries
    // {error:"tmdb_key_missing"}, and turning that into "offline" meant the app
    // could never tell the user their key was missing.
    if (net.status >= 500) {
      const fallback = await cache.match(req);
      if (fallback) {
        const at = Number(fallback.headers.get('x-sw-cached-at') || 0);
        return stamp(fallback, {
          'x-sw-source': 'cache',
          'x-sw-age-ms': String(at ? Date.now() - at : ''),
          'x-sw-reason': `upstream-${net.status}`,
        });
      }
      return stamp(net, { 'x-sw-source': 'network', 'x-sw-reason': `upstream-${net.status}` });
    }
    return net;
  } catch (err) {
    clearTimeout(timer);
    const hit = await cache.match(req);
    if (!hit) {
      return new Response(JSON.stringify({
        error: 'offline', message: 'No network and nothing cached for this request.',
      }), { status: 503, headers: { 'Content-Type': 'application/json', 'x-sw-source': 'none' } });
    }
    const at = Number(hit.headers.get('x-sw-cached-at') || 0);
    const age = at ? Date.now() - at : null;
    if (age != null && age > API_MAX_AGE_MS) {
      await cache.delete(req);
      return new Response(JSON.stringify({
        error: 'stale', message: 'Cached copy was too old to trust and was discarded.',
      }), { status: 503, headers: { 'Content-Type': 'application/json', 'x-sw-source': 'expired' } });
    }
    return stamp(hit, {
      'x-sw-source': 'cache',
      'x-sw-age-ms': String(age ?? ''),
      'x-sw-reason': err.name === 'AbortError' ? 'timeout' : 'network-error',
    });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const net = await fetch(req);
  if (net.ok && new URL(req.url).origin === self.location.origin) {
    cache.put(req, net.clone()).catch(() => {});
  }
  return net;
}

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Never touch the YouTube embed or any third-party media.
  if (url.origin !== self.location.origin) return;

  // The worker itself must not be served from cache.
  if (url.pathname === '/sw.js') return;

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/functions/')) {
    e.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(cacheFirst(request));
    return;
  }

  // Navigations: network-first so a deploy is picked up, index.html as fallback.
  if (request.mode === 'navigate') {
    e.respondWith((async () => {
      try { return await fetch(request); }
      catch { return (await caches.match('/index.html')) || Response.error(); }
    })());
  }
});

self.addEventListener('message', e => {
  if (e.data === 'skip-waiting') self.skipWaiting();
  // The refresh buttons use this: drop the API cache so the next call is live.
  if (e.data === 'purge-api') e.waitUntil(caches.delete(API));
});
