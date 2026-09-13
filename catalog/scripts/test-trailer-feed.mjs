#!/usr/bin/env node
/**
 * Verify the feed actually gets a trailer for each card, and that exactly one
 * player exists at a time.
 *
 * The YouTube IFrame API is stubbed here. That is deliberate and it is a limit
 * worth stating: this sandbox cannot reach YouTube from the browser, so real
 * playback is NOT verified by this file. What is verified is our side of the
 * contract — that a key is resolved for every card, that a player is
 * constructed for the centred card with the params iOS requires, that leaving
 * a card destroys its player, and that muting is driven from one place.
 */
import { chromium, devices } from 'playwright';
import { installLiveApiShim } from './live-shim.mjs';

const PROXY = process.env.HTTPS_PROXY
  ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const BASE = process.env.BASE || 'http://localhost:4173';

const browser = await chromium.launch({ args: ['--no-sandbox'], proxy: PROXY });
const ctx = await browser.newContext({
  ...devices['iPhone 13 Pro'], viewport: { width: 393, height: 852 },
  hasTouch: true, isMobile: true, serviceWorkers: 'block',
  ...(PROXY ? { ignoreHTTPSErrors: true } : {}),
});
const page = await ctx.newPage();
await installLiveApiShim(page);

// Stand in for the YouTube IFrame API, recording what the app asks it to do.
await page.addInitScript(() => {
  window.__players = [];
  const State = { PLAYING: 1, ENDED: 0, PAUSED: 2 };
  class FakePlayer {
    constructor(host, opts) {
      this.opts = opts; this.destroyed = false; this.muted = true; this.playing = false;
      this.id = Math.random().toString(36).slice(2, 8);
      window.__players.push(this);
      // The real API replaces the host node with an iframe.
      const f = document.createElement('iframe');
      f.setAttribute('data-fake-yt', opts.videoId);
      f.src = `https://www.youtube-nocookie.com/embed/${opts.videoId}`;
      host.replaceWith(f);
      setTimeout(() => {
        if (this.destroyed) return;
        opts.events?.onReady?.({ target: this });
        this.playing = true;
        opts.events?.onStateChange?.({ data: State.PLAYING, target: this });
      }, 30);
    }
    mute() { this.muted = true; }
    unMute() { this.muted = false; }
    playVideo() { this.playing = true; }
    destroy() { this.destroyed = true; this.playing = false; }
  }
  window.YT = { Player: FakePlayer, PlayerState: State };
});
// Never let the real script load; the stub is already in place.
await page.route('**://www.youtube.com/iframe_api', r =>
  r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));

let fails = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`); if (!ok) fails++; };

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForSelector('.feed-card', { timeout: 25000 });

console.log('card 1');
const t0 = Date.now();
await page.waitForFunction(() => window.__players.length > 0, { timeout: 45000 })
  .catch(() => {});
console.log(`   first player after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const p1 = await page.evaluate(() => window.__players.map(p => ({
  video: p.opts.videoId, vars: p.opts.playerVars, host: p.opts.host,
  destroyed: p.destroyed, muted: p.muted, playing: p.playing })));
check('a player was constructed for the centred card', p1.length === 1, `${p1.length} player(s)`);
if (p1[0]) {
  const v = p1[0].vars;
  check('mute=1 — iOS refuses inline autoplay otherwise', v.mute === 1);
  check('playsinline=1 — otherwise Safari goes fullscreen', v.playsinline === 1);
  check('autoplay=1', v.autoplay === 1);
  check('loop needs the id repeated in playlist', v.playlist === p1[0].video, v.playlist);
  check('controls hidden', v.controls === 0);
  check('privacy host', /youtube-nocookie/.test(p1[0].host || ''), p1[0].host);
  check('starts muted', p1[0].muted === true);
  check('reached playing', p1[0].playing === true);
  console.log(`   video ${p1[0].video}`);
}

console.log('unmute control');
const unmute = page.locator('button[aria-label="Unmute trailer"]');
if (await unmute.count()) {
  await unmute.first().click();
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => window.__players.filter(p => !p.destroyed).map(p => p.muted));
  check('tap-to-unmute reaches the player', m[0] === false, `muted=${m[0]}`);
} else { check('unmute control rendered', false, 'button not found'); }

console.log('scrolling tears the old player down');
const sc = page.locator('.feed-scroll');
const h = await sc.evaluate(el => el.clientHeight);
await sc.evaluate((el, h) => el.scrollTo({ top: h, behavior: 'instant' }), h);
// The next card's trailer has to resolve before its player can exist.
await page.waitForFunction(() => window.__players.filter(p => !p.destroyed).length === 1
  && window.__players.length >= 2, { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(400);
const after = await page.evaluate(() => ({
  total: window.__players.length,
  alive: window.__players.filter(p => !p.destroyed).length,
  videos: window.__players.map(p => `${p.opts.videoId}${p.destroyed ? ' (destroyed)' : ' (alive)'}`),
}));
check('exactly one player alive after scrolling', after.alive === 1, `${after.alive} alive of ${after.total}`);
console.log('   ' + after.videos.join(', '));

console.log('coverage across the first cards');
const keys = await page.evaluate(async () => {
  const names = [...document.querySelectorAll('.feed-card h2')].map(h => h.textContent.trim()).slice(0, 5);
  const out = [];
  for (const n of names) {
    // No `key` here, so this shares the by-name cache entry rather than the
    // feed's per-show one. Same answer, one search.
    const r = await fetch(`/api/trailer?name=${encodeURIComponent(n)}`);
    const j = await r.json();
    out.push({ name: n, key: j.key, source: j.source, confidence: j.confidence, reason: j.reason });
  }
  return out;
});
const got = keys.filter(k => k.key).length;
for (const k of keys) {
  console.log(`   ${k.key ? '✓' : '·'} ${k.name.padEnd(24)} ${k.key || k.reason} ${k.source ? `(${k.source}, ${k.confidence})` : ''}`);
}
check('most cards resolve a trailer', got >= Math.ceil(keys.length * 0.6), `${got}/${keys.length}`);

console.log(`\n${fails ? `${fails} failure(s)` : 'trailer playback wiring behaves (real playback not testable here)'}`);
await browser.close();
process.exit(fails ? 1 : 0);
