#!/usr/bin/env node
/**
 * The 2-up grid, on an iPhone viewport.
 *
 * What matters here is not that it renders. It is that it is actually the
 * faster way to look: more shows per screen, no trailer or provider requests
 * behind it, tap targets still 44pt, and tapping a tile landing you on THAT
 * show in the feed rather than back at the top.
 */
import { chromium, devices } from 'playwright';
import { installLiveApiShim } from './live-shim.mjs';

const PROXY = process.env.HTTPS_PROXY
  ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const BASE = process.env.BASE || 'http://localhost:4173';
const DPR = Number(process.env.SHOT_DPR || 1);

const browser = await chromium.launch({ args: ['--no-sandbox'], proxy: PROXY });
const ctx = await browser.newContext({
  ...devices['iPhone 13 Pro'], viewport: { width: 393, height: 852 },
  deviceScaleFactor: DPR, hasTouch: true, isMobile: true, serviceWorkers: 'block',
  ...(PROXY ? { ignoreHTTPSErrors: true } : {}),
});
const page = await ctx.newPage();
await installLiveApiShim(page);

let fails = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`); if (!ok) fails++; };

// Count the requests the grid causes, so "cheaper than the feed" is measured.
let apiCalls = [];
page.on('request', r => {
  const u = r.url();
  if (/\/api\/(trailer|tmdb|news)/.test(u) || /api\.tvmaze\.com\/shows\//.test(u)) {
    apiCalls.push(u.replace(/\?.*/, ''));
  }
});

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('.feed-card', { timeout: 30000 });
await page.waitForFunction(() => !document.body.textContent.includes('loading more'),
                           { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(1500);

console.log('switching to the grid');
await page.locator('button[aria-label="Switch to the grid"]').click();
await page.waitForTimeout(900);
apiCalls = [];

const tiles = page.locator('img.no-drag');
const tileCount = await page.evaluate(() =>
  document.querySelectorAll('.grid.grid-cols-2 > *').length);
check('the whole ranked list is laid out', tileCount > 100, `${tileCount} rows of grid`);

console.log('how much fits on one screen');
const onScreen = await page.evaluate(() => {
  const h = window.innerHeight;
  return [...document.querySelectorAll('button[aria-label*="Open in the feed"]')]
    .filter(el => { const r = el.getBoundingClientRect(); return r.top < h && r.bottom > 0; }).length;
});
check('more than one show visible at a time', onScreen >= 4, `${onScreen} visible (feed shows 1)`);

console.log('two columns, and no horizontal overflow');
const cols = await page.evaluate(() => {
  const xs = [...document.querySelectorAll('button[aria-label*="Open in the feed"]')]
    .slice(0, 8).map(el => Math.round(el.getBoundingClientRect().left));
  return new Set(xs).size;
});
check('exactly two columns', cols === 2, `${cols} column positions`);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('no horizontal overflow', overflow <= 0, `${overflow}px`);

console.log('tap targets');
const small = await page.evaluate(() => {
  const bad = [];
  for (const b of document.querySelectorAll('button')) {
    const r = b.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.top > window.innerHeight || r.bottom < 0) continue;
    if (r.height < 44 && r.width < 44) bad.push(`${b.getAttribute('aria-label') || b.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return bad;
});
check('every visible control is at least 44pt on one side', small.length === 0, small.slice(0, 4).join(' | '));

console.log('scrolling the grid costs nothing');
await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight * 2 && d.className.includes('overflow-y-auto'));
  el?.scrollBy({ top: 2400, behavior: 'instant' });
});
await page.waitForTimeout(1500);
check('no trailer or provider requests from scrolling the grid', apiCalls.length === 0,
      apiCalls.slice(0, 3).join(', '));

console.log('the DOM stays small while the list does not');
const live = await page.evaluate(() =>
  document.querySelectorAll('button[aria-label*="Open in the feed"]').length);
check('only the rows near the viewport are real', live > 6 && live < 60,
      `${live} live tiles of ${tileCount} shows`);

console.log('back at the top: the header must not sit on the first row');
await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find(d => d.className.includes('overflow-y-auto'));
  el?.scrollTo({ top: 0, behavior: 'instant' });
});
await page.waitForTimeout(800);
await page.screenshot({ path: 'docs/shots/grid.png' });
const header = await page.evaluate(() => {
  const tile = document.querySelector('button[aria-label*="Open in the feed"]');
  // The chip reads "457 shows of 32,138", so match the words, not the end.
  const chip = [...document.querySelectorAll('span')].find(s => s.textContent.includes(' shows'));
  return { tile: Math.round(tile.getBoundingClientRect().top),
           chipBottom: Math.round(chip.getBoundingClientRect().bottom) };
});
check('the first row of tiles clears the floating header',
      header.tile >= header.chipBottom,
      `tile top ${header.tile}px, header bottom ${header.chipBottom}px`);

console.log('quick actions work from a tile');
const profile = () => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('tonight:v2') || '{}');
  return s.profiles?.[s.active] || {};
});
const firstName = await page.locator('button[aria-label*="Open in the feed"]').first()
  .getAttribute('aria-label').then(a => a.replace(/\. Open in the feed\.$/, ''));
await page.locator(`button[aria-label="Save ${firstName}"]`).first().click();
await page.waitForTimeout(500);
check('the bookmark saves that show', Object.keys((await profile()).saved || {}).length === 1,
      Object.values((await profile()).saved || {}).map(s => s.name).join());

const second = await page.locator('button[aria-label*="Open in the feed"]').nth(1)
  .getAttribute('aria-label').then(a => a.replace(/\. Open in the feed\.$/, ''));
await page.locator(`button[aria-label="Not for me: hide ${second}"]`).first().click();
await page.waitForTimeout(600);
check('the X hides that show', Object.keys((await profile()).notForMe || {}).length === 1);

console.log('tapping a tile lands on THAT show in the feed');
await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find(d => d.className.includes('overflow-y-auto'));
  el?.scrollBy({ top: 1200, behavior: 'instant' });
});
await page.waitForTimeout(600);
const target = await page.locator('button[aria-label*="Open in the feed"]').nth(9)
  .getAttribute('aria-label').then(a => a.replace(/(, \d{4})?\. Open in the feed\.$/, ''));
await page.locator('button[aria-label*="Open in the feed"]').nth(9).click();
await page.waitForTimeout(1400);
// Cards far from the active one render as placeholders that also carry the
// .feed-card class, so `.feed-card h2` first is the card three ABOVE the one
// on screen. Read the card at the scroll position instead.
const landed = await page.evaluate(() => {
  const root = document.querySelector('.feed-scroll');
  const i = Math.round(root.scrollTop / root.clientHeight);
  return root.querySelector(`[data-idx="${i}"] h2`)?.textContent ?? '(none)';
});
check('the feed opened on the show that was tapped', landed === target, `tapped ${target}, landed on ${landed}`);
check('and it is scrolled, not reset to the top',
      await page.locator('.feed-scroll').evaluate(el => el.scrollTop) > 0);

console.log('the choice survives a reload');
await page.locator('button[aria-label="Switch to the grid"]').click();
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
check('still in the grid after a reload',
      await page.locator('button[aria-label="Switch to the full-screen feed"]').count() === 1);

console.log(`\n${fails ? `${fails} failure(s)` : 'the grid is the faster way to look, and costs nothing to scroll'}`);
await browser.close();
process.exit(fails ? 1 : 0);
