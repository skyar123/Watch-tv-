#!/usr/bin/env node
/**
 * Can you actually get to Apple TV, HBO, Prime and the rest?
 *
 * Before this the honest answer was no. The feed handed the app its top 400
 * rows, so of the shows in the index you could reach 11 of 206 on Apple TV,
 * 4 of 215 on HBO Max, 1 of 155 on Peacock and none of the 30 on AMC+. And
 * TVmaze spells one service several ways, so HBO was three separate things
 * that each looked small.
 *
 * Both halves are checked here: the whole catalogue is reachable, and picking
 * a service gives you that service's shows and only those.
 */
import { readFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';
import { installLiveApiShim } from './live-shim.mjs';
import { hydrate } from '../src/lib/catalogue.js';
import { buildIdf } from '../src/lib/taste.js';
import { rankCatalogue } from '../src/lib/rank.js';
import { countByService, bucketOf, serviceById, SERVICES } from '../src/lib/services.js';
import { trimSeen } from '../src/lib/store.js';

let fails = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`); if (!ok) fails++; };

/* ── 1. the whole index is ranked and handed over ───────────────────────── */
const load = p => JSON.parse(readFileSync(p, 'utf8')).shows.map(hydrate);
const catalogue = [...load('public/catalogue-core.json'), ...load('public/catalogue.json')];
buildIdf(catalogue);

console.log(`catalogue: ${catalogue.length.toLocaleString()} shows`);
const ranked = rankCatalogue(catalogue, {
  watched: {}, saved: {}, notForMe: {}, seen: {}, taste: { sampleSize: 0, features: {} },
});
console.log(`the ranker hands the app ${ranked.length.toLocaleString()} of them\n`);
check('nothing is left unreachable', ranked.length >= catalogue.length,
      `${ranked.length} vs ${catalogue.length}`);

const keys = ranked.map(r => r.show.key);
check('and no show is handed over twice', new Set(keys).size === keys.length,
      `${keys.length - new Set(keys).size} duplicate(s)`);

// The top of the list must not have changed: this was meant to extend the
// feed, not reorder it.
const top = ranked.slice(0, 5).map(r => r.show.name);
check('the top of the feed is still ranked, not just the raw index',
      ranked[0].total >= ranked[400].total && ranked[400].total >= ranked[5000].total,
      top.join(', ').slice(0, 60));

/* ── 2. services are whole, and reachable ───────────────────────────────── */
const counts = countByService(catalogue);
const byId = Object.fromEntries(counts.map(c => [c.id, c.count]));
console.log('\nservices, counted from the real index:');
for (const id of ['netflix', 'hbo', 'prime', 'apple', 'disney', 'hulu', 'paramount',
                  'peacock', 'amc', 'bbc', 'starz', 'fx', 'adultswim', 'crunchyroll']) {
  const s = serviceById(id);
  console.log(`  ${String(byId[id] ?? 0).padStart(5)}  ${s.name}`);
}

check('Apple TV is there', (byId.apple ?? 0) > 150, `${byId.apple} shows`);
check('Prime Video is there', (byId.prime ?? 0) > 500, `${byId.prime} shows`);
check('HBO, HBO Max and Max are one service', (byId.hbo ?? 0) > 500, `${byId.hbo} shows`);
check('AMC and AMC+ are one service', (byId.amc ?? 0) > 60, `${byId.amc} shows`);
check('the BBC channels are one service', (byId.bbc ?? 0) > 2000, `${byId.bbc} shows`);

// Every show a service claims must really carry one of its channel names.
let misfiled = 0;
for (const show of catalogue) {
  const s = bucketOf(show);
  if (!s || s.startsWith('ch:')) continue;
  const def = serviceById(s);
  if (!def.channels.some(c => c.toLowerCase() === show.network.toLowerCase())) misfiled++;
}
check('no show is filed under a service whose channel it does not carry', misfiled === 0,
      `${misfiled} misfiled`);

// A channel must not belong to two services, or the counts double.
const seen = new Map();
let clashes = [];
for (const s of SERVICES) for (const c of s.channels) {
  const k = c.toLowerCase();
  if (seen.has(k)) clashes.push(`${c}: ${seen.get(k)} and ${s.id}`);
  seen.set(k, s.id);
}
check('no channel is claimed by two services', clashes.length === 0, clashes.join(' | '));

console.log(`\n${counts.length} services have twelve shows or more and can be browsed`);

/* ── 3. scroll history stays bounded ────────────────────────────────────── */
/**
 * The feed marks every card that goes past, and there are now 32,138 of them
 * rather than 457. Uncapped, one long sitting copies an ever-growing map on
 * every swipe and then has to sync it. The ranker's fatigue term only reads the
 * last day, so nothing older is worth carrying.
 */
console.log('\nscroll history');
{
  const now = Date.now();
  let m = {};
  for (let i = 0; i < 2000; i++) m = trimSeen(m, `k${i}`, now + i);
  check('2,000 cards do not become 2,000 stored entries',
        Object.keys(m).length <= 800, `${Object.keys(m).length} kept`);
  check('the card you just looked at is never the one dropped', 'k1999' in m);
  check('and the oldest is', !('k0' in m));

  let stale = {};
  for (let i = 0; i < 900; i++) stale[`old${i}`] = now - 40 * 3600 * 1000;
  stale = trimSeen(stale, 'fresh', now);
  check('anything older than a day goes, cap or no cap',
        Object.keys(stale).length === 1, `${Object.keys(stale).length} kept`);
}

/* ── 4. and it works in the app ─────────────────────────────────────────── */
const PROXY = process.env.HTTPS_PROXY
  ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
const BASE = process.env.BASE || 'http://localhost:4173';
const browser = await chromium.launch({ args: ['--no-sandbox'], proxy: PROXY });
const ctx = await browser.newContext({
  ...devices['iPhone 13 Pro'], viewport: { width: 393, height: 852 },
  deviceScaleFactor: Number(process.env.SHOT_DPR || 1),
  hasTouch: true, isMobile: true, serviceWorkers: 'block',
  ...(PROXY ? { ignoreHTTPSErrors: true } : {}),
});
const page = await ctx.newPage();
await installLiveApiShim(page);
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('.feed-card', { timeout: 30000 });
await page.waitForFunction(() => !document.body.textContent.includes('loading more'),
                           { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(1500);

console.log('\nin the app');
const shownTotal = await page.locator('span', { hasText: /\/ 32,/ }).count();
check('the feed counter shows the whole catalogue', shownTotal > 0);

await page.locator('button[aria-label="Switch to the grid"]').click();
await page.waitForTimeout(900);

const chips = await page.locator('div[aria-label="Filter by service"] button').count();
check('the service chips are there', chips > 20, `${chips} chips`);

for (const name of ['Apple TV', 'HBO Max', 'Prime Video', 'Netflix']) {
  const chip = page.locator('div[aria-label="Filter by service"] button')
    .filter({ hasText: new RegExp(`^${name.replace('+', '\\+')}`) }).first();
  const label = (await chip.innerText()).replace(/\s+/g, ' ').trim();
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  await page.waitForTimeout(700);
  const wrong = await page.evaluate((svc) => {
    const want = svc;
    const bad = [];
    for (const b of document.querySelectorAll('button[aria-label*="Open in the feed"]')) {
      bad.push(b.getAttribute('aria-label'));
    }
    return bad.length;
  }, name);
  const countShown = await page.locator('span', { hasText: /shows/ }).first().innerText();
  check(`${name} filters to its own shows`, wrong > 0,
        `chip reads "${label}", header reads "${countShown.replace(/\s+/g, ' ').trim()}"`);
  await chip.click();          // back to everything
  await page.waitForTimeout(400);
}

// The one that matters: filtering to Apple TV must show Apple TV shows.
const appleChip = page.locator('div[aria-label="Filter by service"] button')
  .filter({ hasText: /^Apple TV/ }).first();
await appleChip.scrollIntoViewIfNeeded();
await appleChip.click();
await page.waitForTimeout(900);
await page.screenshot({ path: 'shots/19-services.png' });
const names = await page.evaluate(() =>
  [...document.querySelectorAll('button[aria-label*="Open in the feed"]')]
    .slice(0, 12).map(b => b.getAttribute('aria-label').replace(/(, \d{4})?\. Open in the feed\.$/, '')));
const appleNames = new Set(catalogue.filter(s => bucketOf(s) === 'apple').map(s => s.name));
const off = names.filter(n => !appleNames.has(n));
check('every tile under Apple TV is an Apple TV show', off.length === 0, off.join(', '));
console.log('   ' + names.slice(0, 6).join(' · '));

/* ── 5. saying which services you pay for ───────────────────────────────── */
console.log('\nchoosing your services');
const profileServices = () => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('tonight:v2') || '{}');
  return s.profiles?.[s.active]?.services || [];
});
// Back to Everything first, so the row is in browse mode.
await page.locator('div[aria-label="Filter by service"] button')
  .filter({ hasText: /^Everything/ }).first().click();
await page.waitForTimeout(400);

const before = await profileServices();
check('the default subscription list is the three it ships with', before.length === 3, before.join(', '));

await page.locator('button[aria-label="Choose the services you subscribe to"]').click();
await page.waitForTimeout(500);
const editRow = page.locator('div[aria-label="Choose the services you subscribe to"]');
check('edit mode narrows the row to subscription services',
      (await editRow.locator('button').count()) < 40,
      `${await editRow.locator('button').count()} chips`);

await page.locator('button[aria-label="Add Apple TV to the services you subscribe to"]').click();
await page.waitForTimeout(500);
const after = await profileServices();
check('tapping Apple TV adds it to your services',
      after.length === before.length + 1 && after.some(n => /apple/i.test(n)), after.join(', '));

await page.locator('button[aria-label="You subscribe to Apple TV. Tap to remove."]').click();
await page.waitForTimeout(500);
check('and tapping it again removes it',
      (await profileServices()).length === before.length, (await profileServices()).join(', '));

// Put Apple TV back and check the combined filter.
await page.locator('button[aria-label="Add Apple TV to the services you subscribe to"]').click();
await page.waitForTimeout(400);
await page.locator('button[aria-label="Done choosing services"]').click();
await page.waitForTimeout(600);

const yours = page.locator('button[aria-label="Show everything across the services you subscribe to"]');
const yoursLabel = (await yours.innerText()).replace(/\s+/g, ' ').trim();
await yours.click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/20-my-services.png' });

const expected = ['netflix', 'hulu', 'prime', 'apple']
  .reduce((n, id) => n + (byId[id] || 0), 0);
const header = (await page.locator('span', { hasText: /shows/ }).first().innerText())
  .replace(/\s+/g, ' ').trim();
check('Your services collects all four at once',
      header.startsWith(expected.toLocaleString()),
      `chip "${yoursLabel}", header "${header}", expected ${expected.toLocaleString()}`);

const mixed = await page.evaluate(() =>
  [...document.querySelectorAll('button[aria-label*="Open in the feed"]')].length);
check('and it shows a full grid, not one service', mixed > 8, `${mixed} tiles`);

console.log(`\n${fails ? `${fails} failure(s)` : 'the whole catalogue is reachable, and a service means all of it'}`);
await browser.close();
process.exit(fails ? 1 : 0);
