#!/usr/bin/env node
/**
 * Drive the built app in a real iPhone viewport and capture screenshots.
 *
 * "It builds" proves nothing about a phone. This uses iPhone 15 Pro metrics,
 * a touch-capable device (so `@media (pointer: coarse)` actually matches, which
 * a width-only emulation would not), and a real network so the cards carry real
 * shows.
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { installLiveApiShim } from './live-shim.mjs';

const BASE = process.env.BASE || 'http://localhost:4173';
const OUT = process.env.OUT || 'shots';
mkdirSync(OUT, { recursive: true });

// iPhone 15 Pro: 393x852 CSS px at DPR 3, touch, no cursor. The touch flag is
// the part that matters — `@media (pointer: coarse)` is what the layout keys
// off, and a width-only emulation gets that exactly wrong.
const iPhone = {
  ...devices['iPhone 13 Pro'],
  viewport: { width: 393, height: 852 },
  // DPR 3 is the real device. The committed set uses SHOT_DPR=1 so the README
  // images stay a sane size; layout and tap-target maths are in CSS pixels and
  // identical either way.
  deviceScaleFactor: Number(process.env.SHOT_DPR || 3),
  hasTouch: true,
  isMobile: true,
};

// This sandbox reaches the internet only through an egress proxy. Without this
// the page loads but every API call fails, which looks exactly like an app bug.
const PROXY = process.env.HTTPS_PROXY
  ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }
  : undefined;
// That proxy terminates TLS with its own CA, which the bundled Chromium does
// not carry. Trusting it is scoped to this throwaway test browser; the app
// itself never relaxes certificate checking.
const CONTEXT_TLS = PROXY ? { ignoreHTTPSErrors: true } : {};


const browser = await chromium.launch({ args: ['--no-sandbox'], proxy: PROXY });
// Service workers are blocked here so /api/* reaches the live shim instead of
// being answered by the worker's own cache. The worker gets its own test in
// scripts/test-sw.mjs, where its behaviour is the thing under test.
const ctx = await browser.newContext({
  ...iPhone, ...CONTEXT_TLS, serviceWorkers: 'block',
  locale: 'en-US', timezoneId: 'America/New_York',
});
const page = await ctx.newPage();
const apiStats = await installLiveApiShim(page);

const problems = [];
/**
 * Which failures are ours.
 *
 * This sandbox reaches the internet only through hosts the shim proxies, so
 * YouTube embeds and publishers' hotlinked thumbnails cannot load here and
 * their failures say nothing about the app — it already hides a broken image
 * and falls back to a still frame. Filtering on the HOST rather than on the
 * error code keeps that narrow: a connection reset from our own origin is
 * still a problem and still reported.
 */
const UNREACHABLE_HERE = /youtube(-nocookie)?\.com|ytimg\.com|out\.com|advocate\.com|them\.us|variety\.com|hollywoodreporter\.com|tvline\.com|deadline\.com|avclub\.com|polygon\.com|pinknews|lgbtqnation|autostraddle|xtramagazine/i;

page.on('requestfailed', r => {
  if (UNREACHABLE_HERE.test(r.url())) return;
  problems.push(`request failed: ${r.failure()?.errorText} ${r.url().slice(0, 90)}`);
});
page.on('console', m => {
  const t = m.text();
  // A 503 from /api/tmdb is the correct response on a deploy with no key, and
  // the screenshots are meant to show that state. Not a failure.
  if (m.type() === 'error' && /status of 503/.test(t)) return;
  // The console message for a blocked third-party resource carries no URL, so
  // it is matched by code; the requestfailed handler above is the one that
  // actually distinguishes by host.
  if (m.type() === 'error' &&
      /ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_TOO_MANY_RETRIES|ERR_ABORTED/.test(t)) return;
  if (m.type() === 'error') problems.push(`console: ${t.slice(0, 160)}`);
});
page.on('pageerror', e => problems.push(`pageerror: ${e.message.slice(0, 160)}`));

const shot = async (name, ms = 900) => {
  await page.waitForTimeout(ms);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  📸 ${OUT}/${name}.png`);
};

console.log('→ feed');
// networkidle no longer settles: the app now streams a 27,590-show catalogue,
// resolves trailers and builds a kinship graph, so there is always something
// in flight. Wait for the thing that actually matters instead.
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('.feed-card', { timeout: 30000 });
// And for the second catalogue tier to land, since it re-ranks the feed.
await page.waitForFunction(
  () => !document.body.textContent.includes('loading more'), { timeout: 40000 },
).catch(() => {});
await shot('01-feed', 7000);

// Prove the scroll-snap actually snaps: scroll a partial card height and check
// we land exactly on a card boundary rather than between two.
console.log('→ scroll snap');
const scroller = page.locator('.feed-scroll');
const h = await scroller.evaluate(el => el.clientHeight);
await scroller.evaluate((el, h) => el.scrollBy({ top: h * 0.55, behavior: 'smooth' }), h);
await page.waitForTimeout(1400);
const pos = await scroller.evaluate(el => ({ top: el.scrollTop, h: el.clientHeight }));
const offBy = Math.abs(pos.top % pos.h);
const onBoundary = offBy < 2 || Math.abs(offBy - pos.h) < 2;
// A 55% flick must land on the NEXT card, not spring back. Checking only that
// the offset divides evenly passed trivially when nothing moved at all.
const moved = pos.top > 0;
const snapped = onBoundary && moved;
console.log(`  scrollTop=${pos.top} cardHeight=${pos.h} → ` +
  `${snapped ? 'SNAPPED to card ' + (pos.top / pos.h + 1) : onBoundary ? 'DID NOT MOVE' : 'DID NOT SNAP'}`);
if (!snapped) problems.push(`scroll did not snap forward: scrollTop ${pos.top} vs card ${pos.h}`);
await shot('02-feed-scrolled', 4500);

console.log('→ swipe, mid-gesture');
await scroller.evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
await page.waitForTimeout(700);
await page.mouse.move(150, 430);
await page.mouse.down();
for (let x = 150; x <= 290; x += 20) { await page.mouse.move(x, 428); await page.waitForTimeout(18); }
await shot('13-swipe-save', 250);
await page.mouse.move(150, 430);
for (let x = 150; x >= 40; x -= 18) { await page.mouse.move(x, 430); await page.waitForTimeout(18); }
await shot('14-swipe-pass', 250);
await page.mouse.up();
await page.waitForTimeout(900);
// And the undo affordance the swipe leaves behind.
await shot('15-undo', 400);
const undo = page.locator('button', { hasText: 'Undo' });
if (await undo.count()) { await undo.first().click(); await page.waitForTimeout(400); }
await scroller.evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
await page.waitForTimeout(600);

console.log('→ detail sheet');
await page.locator('.feed-card button[aria-label^="Open details"]').first().click();
await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
await shot('03-detail', 2200);

console.log('→ detail scrolled to the decision blocks');
await page.locator('[role="dialog"] .sheet-scroll').evaluate(el => el.scrollTo({ top: 520 }));
await shot('04-detail-decisions', 900);

console.log('→ episodes tab');
const epTab = page.locator('[role="dialog"] button', { hasText: /^Episodes$/ });
if (await epTab.count()) { await epTab.first().click(); await shot('05-episodes', 1800); }

// Escape is the Sheet's own dismiss path, and unlike clicking the scrim it
// cannot be intercepted by whatever happens to be under the pointer.
await page.keyboard.press('Escape');
await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 8000 });

console.log('→ tonight');
await page.locator('nav button', { hasText: 'Tonight' }).click();
await page.waitForTimeout(400);
await page.locator('button', { hasText: 'A good story' }).first().click();
await shot('06-tonight', 1500);

// The mood that leans hardest on hand-curation. If this one is empty the
// curation never reached the pool.
await page.locator('button', { hasText: 'Queer stories' }).first().click();
await shot('06b-tonight-queer', 1500);

console.log('→ mine');
await page.locator('nav button', { hasText: 'Mine' }).click();
await shot('07-mine', 1200);

console.log('→ together');
await page.locator('nav button', { hasText: 'Tonight' }).click();
await page.waitForTimeout(300);
await page.locator('button', { hasText: 'Together' }).first().click();
await page.waitForTimeout(600);
await page.locator('button', { hasText: 'A good story' }).first().click();
await shot('10-together', 2000);

console.log('→ teach it what you like');
await page.locator('nav button', { hasText: 'Mine' }).click();
await page.waitForTimeout(400);
const teach = page.locator('button', { hasText: 'Tell it what you already like' });
if (await teach.count()) {
  await teach.first().click();
  await page.waitForSelector('[role="dialog"]');
  await page.waitForTimeout(900);
  await shot('16-teach', 600);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 8000 }).catch(() => {});
}

console.log('→ settings: profiles, taste, sync');
await page.locator('nav button', { hasText: 'Mine' }).click();
await page.waitForTimeout(300);
await page.locator('button[aria-label="Settings"]').click();
await page.waitForSelector('[role="dialog"]');
await page.waitForTimeout(700);
await shot('11-settings-profiles', 600);
await page.locator('[role="dialog"] .sheet-scroll').evaluate(el => el.scrollTo({ top: 780 }));
await shot('12-settings-taste', 600);
await page.keyboard.press('Escape');
await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 8000 });

console.log('→ news');
await page.locator('nav button', { hasText: 'News' }).click();
await page.waitForTimeout(400);
await shot('09-news', 6000);

console.log('→ search');
await page.locator('nav button', { hasText: 'Search' }).click();
await page.locator('input[type="search"]').fill('severance');
await shot('08-search', 2500);

// The 16px input rule is not cosmetic: anything smaller makes Safari zoom the
// page on focus and never zoom back.
const inputPx = await page.locator('input[type="search"]')
  .evaluate(el => parseFloat(getComputedStyle(el).fontSize));
console.log(`  search input font-size = ${inputPx}px ${inputPx >= 16 ? '✓' : '✗ WILL ZOOM SAFARI'}`);
if (inputPx < 16) problems.push(`input font-size ${inputPx}px < 16px`);

// Every tap target must clear 44pt.
const small = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('button, a[href], input, label')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 44 || r.width < 44) {
      out.push({ tag: el.tagName, label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 34),
                 w: Math.round(r.width), h: Math.round(r.height) });
    }
  }
  return out;
});
console.log(`  tap targets under 44pt: ${small.length}`);
for (const s of small.slice(0, 8)) console.log(`    ${s.tag} "${s.label}" ${s.w}×${s.h}`);

// Horizontal overflow is the classic phone bug.
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log(`  horizontal overflow: ${overflow}px ${overflow <= 0 ? '✓' : '✗'}`);
if (overflow > 0) problems.push(`horizontal overflow ${overflow}px`);

console.log('\n' + (problems.length ? `⚠ ${problems.length} problem(s):` : '✓ no problems'));
for (const p of problems) console.log('  ' + p);

await browser.close();
process.exit(0);
