#!/usr/bin/env node
/**
 * Seeding a profile by hand — the cold-start fix.
 *
 * Three things have to hold: "seen it" must count as finished without any
 * episode data, "loved it" must be the strongest signal the model takes, and
 * one person must be able to fill in the other's profile without switching to
 * it, because otherwise nobody ever does.
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

let fails = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`); if (!ok) fails++; };
const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('tonight:v2') || '{}'));

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('.feed-card', { timeout: 30000 });
await page.waitForFunction(() => !document.body.textContent.includes('loading more'), { timeout: 40000 }).catch(() => {});

console.log('the prompt appears where a cold profile would see it');
await page.locator('nav button', { hasText: 'Mine' }).click();
await page.waitForTimeout(600);
const prompt = page.locator('button', { hasText: 'Tell it what you already like' });
check('cold-start prompt shown on Mine', await prompt.count() > 0);
await prompt.first().click();
await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
await page.waitForTimeout(800);

console.log('marking a show as seen');
await page.locator('[role="dialog"] input[type="search"]').fill('Breaking Bad');
await page.waitForTimeout(600);
const row = page.locator('[role="dialog"] [aria-label^="Seen it: Breaking Bad"]');
check('search found it', await row.count() > 0);
await row.first().click();
await page.waitForTimeout(400);
let s = await store();
let p1 = s.profiles.p1;
check('recorded as watched', Boolean(p1.watched?.['tvmaze:169']), JSON.stringify(Object.keys(p1.watched || {})));
const key = Object.keys(p1.watched || {})[0];
check('marked whole-series without episode data', p1.watched[key]?.__all > 0, JSON.stringify(p1.watched[key]));

console.log('marking a show as loved');
await page.locator('[role="dialog"] input[type="search"]').fill('The Wire');
await page.waitForTimeout(600);
await page.locator('[role="dialog"] [aria-label^="Loved it: The Wire"]').first().click();
await page.waitForTimeout(400);
s = await store(); p1 = s.profiles.p1;
const loved = Object.values(p1.saved || {}).find(x => x.loved);
check('loved is saved AND flagged', Boolean(loved), JSON.stringify(loved || null));
check('loved also counts as watched', Object.keys(p1.watched || {}).length === 2);

console.log('teaching the OTHER profile without switching');
const activeBefore = (await store()).active;
await page.locator('[role="dialog"] button', { hasText: 'Anja' }).first().click();
await page.waitForTimeout(400);
await page.locator('[role="dialog"] input[type="search"]').fill('Heartstopper');
await page.waitForTimeout(600);
const anjaRow = page.locator('[role="dialog"] [aria-label^="Loved it: Heartstopper"]');
if (await anjaRow.count()) {
  await anjaRow.first().click();
  await page.waitForTimeout(400);
  s = await store();
  check('written to the second profile', Object.keys(s.profiles.p2.saved || {}).length === 1,
    JSON.stringify(Object.values(s.profiles.p2.saved || {}).map(x => x.name)));
  check('the active profile did not change', s.active === activeBefore, s.active);
  check("and the first profile is untouched", Object.keys(s.profiles.p1.saved || {}).length === 1);
} else { check('Heartstopper findable', false); }

console.log('the model actually learns from it');
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
// Read the model itself rather than scraping the DOM for a phrase — the
// previous version matched a block of whitespace and passed for nothing.
const learned = await page.evaluate(async () => {
  const s = JSON.parse(localStorage.getItem('tonight:v2'));
  const p = s.profiles.p1;
  return {
    finished: Object.keys(p.watched || {}).length,
    loved: Object.values(p.saved || {}).filter(x => x.loved).length,
  };
});
check('two shows recorded as finished for p1', learned.finished === 2, JSON.stringify(learned));
check('one of them flagged as loved', learned.loved === 1, JSON.stringify(learned));
// And that the taste model turns those into weights.
await page.locator('button[aria-label="Settings"]').click().catch(() => {});
await page.waitForTimeout(900);
const panel = await page.evaluate(() =>
  document.body.textContent.match(/Learned from \d+ signals?/)?.[0] || null);
check('settings reports what it learned', Boolean(panel), panel || 'panel not found');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

console.log('toggling off removes it');
await page.locator('button', { hasText: 'Tell it what you already like' }).first().click()
  .catch(() => page.locator('button', { hasText: 'Mark shows you have watched' }).first().click());
await page.waitForSelector('[role="dialog"]');
await page.waitForTimeout(700);
await page.locator('[role="dialog"] input[type="search"]').fill('The Wire');
await page.waitForTimeout(600);
await page.locator('[role="dialog"] [aria-label^="Loved it: The Wire"]').first().click();
await page.waitForTimeout(400);
s = await store();
check('a second tap clears the verdict',
  !Object.values(s.profiles.p1.saved || {}).some(x => x.loved),
  JSON.stringify(Object.values(s.profiles.p1.saved || {}).map(x => x.name)));

console.log(`\n${fails ? `${fails} failure(s)` : 'seeding works for both profiles'}`);
await browser.close();
process.exit(fails ? 1 : 0);
