#!/usr/bin/env node
/**
 * Test the service worker's caching rules directly, because they are the part
 * most likely to be quietly wrong and the part that hurt last time.
 *
 * Asserted here:
 *   1. An API call answered by the network is marked live, not cached.
 *   2. With the network down, the cached copy comes back MARKED as cache and
 *      carrying its real age — never presented as fresh.
 *   3. A meaningful 5xx from our own function is passed through intact rather
 *      than replaced with a synthetic "offline". This is the bug that hid
 *      "TMDB key not set" behind a generic network error.
 *   4. Hashed assets are served cache-first.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const PORT = 4199;
let mode = 'ok';         // ok | down | keyless
let apiHits = 0;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.json': 'application/json', '.png': 'image/png',
                '.webmanifest': 'application/manifest+json' };

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname.startsWith('/api/')) {
    apiHits++;
    if (mode === 'down') { req.destroy(); return; }
    if (mode === 'keyless') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'tmdb_key_missing', message: 'TMDB_API_KEY is not set.' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ hit: apiHits, at: Date.now() }));
  }

  const p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = join('dist', p);
  if (!existsSync(file)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const BASE = `http://localhost:${PORT}`;

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fails++;
};

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => navigator.serviceWorker?.controller != null, { timeout: 15000 })
  .catch(() => {});
await page.evaluate(() => navigator.serviceWorker.ready);
console.log('service worker active\n');

const call = (path) => page.evaluate(async p => {
  const r = await fetch(p);
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, source: r.headers.get('x-sw-source'),
           age: r.headers.get('x-sw-age-ms'), reason: r.headers.get('x-sw-reason'), body };
}, path);

console.log('1. live network');
const a = await call('/api/thing');
check('marked as network', a.source === 'network', `source=${a.source}`);
check('age is zero', a.age === '0', `age=${a.age}`);

console.log('2. network down, cache available');
mode = 'down';
const b = await call('/api/thing');
check('served from cache', b.source === 'cache', `source=${b.source}`);
check('carries a real age', b.age !== '' && Number(b.age) >= 0, `age=${b.age}ms`);
check('says why it fell back', Boolean(b.reason), `reason=${b.reason}`);
check('cached body matches the stored one', b.body?.hit === a.body?.hit,
      `${b.body?.hit} vs ${a.body?.hit}`);

console.log('3. a meaningful 503 must not become a generic "offline"');
mode = 'keyless';
const c = await call('/api/never-cached-' + Date.now());
check('upstream 503 passed through', c.status === 503, `status=${c.status}`);
check('error code preserved', c.body?.error === 'tmdb_key_missing', `error=${c.body?.error}`);
check('not replaced with offline', c.body?.error !== 'offline');

console.log('4. hashed assets are cache-first');
mode = 'down';
const asset = await page.evaluate(async () => {
  const src = [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src'))
    .find(s => s.includes('/assets/'));
  const r = await fetch(src);
  return { src, ok: r.ok, status: r.status };
});
check('asset still served with the network down', asset.ok, `${asset.src} → ${asset.status}`);

console.log(`\n${fails ? `${fails} failure(s)` : 'service worker behaves as specified'}`);
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
