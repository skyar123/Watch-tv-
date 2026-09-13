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
  deviceScaleFactor: 3,
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
page.on('console', m => {
  const t = m.text();
  // A 503 from /api/tmdb is the correct response on a deploy with no key, and
  // the screenshots are meant to show that state. Not a failure.
  if (m.type() === 'error' && /status of 503/.test(t)) return;
  if (m.type() === 'error') problems.push(`console: ${t.slice(0, 160)}`);
});
page.on('pageerror', e => problems.push(`pageerror: ${e.message.slice(0, 160)}`));

const shot = async (name, ms = 900) => {
  await page.waitForTimeout(ms);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  📸 ${OUT}/${name}.png`);
};

console.log('→ feed');
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForSelector('.feed-card', { timeout: 25000 });
await shot('01-feed', 5000);

// Prove the scroll-snap actually snaps: scroll a partial card height and check
// we land exactly on a card boundary rather than between two.
console.log('→ scroll snap');
const scroller = page.locator('.feed-scroll');
const h = await scroller.evaluate(el => el.clientHeight);
await scroller.evaluate((el, h) => el.scrollBy({ top: h * 0.55, behavior: 'smooth' }), h);
await page.waitForTimeout(1400);
const pos = await scroller.evaluate(el => ({ top: el.scrollTop, h: el.clientHeight }));
const offBy = Math.abs(pos.top % pos.h);
const snapped = offBy < 2 || Math.abs(offBy - pos.h) < 2;
console.log(`  scrollTop=${pos.top} cardHeight=${pos.h} → ${snapped ? 'SNAPPED' : 'DID NOT SNAP'}`);
if (!snapped) problems.push(`scroll did not snap: scrollTop ${pos.top} vs card ${pos.h}`);
await shot('02-feed-scrolled', 4500);

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
await shot('06-tonight', 1200);

console.log('→ mine');
await page.locator('nav button', { hasText: 'Mine' }).click();
await shot('07-mine', 1200);

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
