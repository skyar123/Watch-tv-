#!/usr/bin/env node
/**
 * Swipe, driven with real pointer gestures on a touch context.
 *
 * The hard part is co-existence: this card lives inside a vertical scroll-snap
 * feed, so a horizontal swipe must not scroll and a vertical drag must not
 * swipe. Both directions are exercised here, along with the diagonal case that
 * makes a naive implementation judder.
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

const profile = () => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('tonight:v2') || '{}');
  return s.profiles?.[s.active] || {};
});
const topCard = () => page.locator('.feed-card h2').first().innerText();
const scrollTop = () => page.locator('.feed-scroll').evaluate(el => el.scrollTop);

/** A real drag: down, several moves, up. */
async function drag(fromX, fromY, toX, toY, steps = 14, holdMs = 12) {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(fromX + (toX - fromX) * (i / steps), fromY + (toY - fromY) * (i / steps));
    await page.waitForTimeout(holdMs);
  }
  await page.mouse.up();
}

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('.feed-card', { timeout: 30000 });
await page.waitForFunction(() => !document.body.textContent.includes('loading more'), { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(1200);

console.log('a short horizontal drag must NOT commit');
const before = await topCard();
await drag(200, 430, 240, 430);
await page.waitForTimeout(500);
check('card unchanged after a 40px nudge', (await topCard()) === before, before);
check('nothing saved', Object.keys((await profile()).saved || {}).length === 0);

console.log('swipe right saves');
const toSave = await topCard();
await drag(140, 430, 350, 430);
await page.waitForTimeout(700);
const saved = (await profile()).saved || {};
check('one show saved', Object.keys(saved).length === 1, Object.values(saved).map(s => s.name).join());
check('it is the card that was on screen', Object.values(saved)[0]?.name === toSave, toSave);
check('recorded as a swipe, not a tap', Object.values(saved)[0]?.viaSwipe === true);

console.log('undo puts it back');
await page.locator('button', { hasText: 'Undo' }).first().click();
await page.waitForTimeout(400);
check('save reversed', Object.keys((await profile()).saved || {}).length === 0);

console.log('swipe left hides, and the next card takes its place');
const toHide = await topCard();
await drag(300, 430, 60, 430);
await page.waitForTimeout(800);
const p = await profile();
check('one show hidden', Object.keys(p.notForMe || {}).length === 1);
check('the feed moved on', (await topCard()) !== toHide, `${toHide} → ${await topCard()}`);
check('and the scroll stayed put', (await scrollTop()) === 0, String(await scrollTop()));

console.log('undo a hide restores it to the feed');
await page.locator('button', { hasText: 'Undo' }).first().click();
await page.waitForTimeout(600);
check('hide reversed', Object.keys((await profile()).notForMe || {}).length === 0);
check('the show is back at the top', (await topCard()) === toHide, await topCard());

console.log('a vertical drag scrolls and does NOT swipe');
const savedBefore = Object.keys((await profile()).saved || {}).length;
const hiddenBefore = Object.keys((await profile()).notForMe || {}).length;
await page.locator('.feed-scroll').evaluate(el => el.scrollTo({ top: el.clientHeight, behavior: 'instant' }));
await page.waitForTimeout(600);
check('the feed scrolled', (await scrollTop()) > 0, String(await scrollTop()));
const pv = await profile();
check('no accidental save', Object.keys(pv.saved || {}).length === savedBefore);
check('no accidental hide', Object.keys(pv.notForMe || {}).length === hiddenBefore);

console.log('a diagonal drag picks one axis and sticks to it');
await page.locator('.feed-scroll').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
await page.waitForTimeout(400);
const diagBefore = await topCard();
// Mostly vertical with horizontal drift: must scroll, must not swipe.
await drag(200, 600, 260, 300, 16);
await page.waitForTimeout(700);
const pd = await profile();
check('a mostly-vertical diagonal did not swipe',
  Object.keys(pd.saved || {}).length === savedBefore &&
  Object.keys(pd.notForMe || {}).length === hiddenBefore,
  `saved ${Object.keys(pd.saved || {}).length}, hidden ${Object.keys(pd.notForMe || {}).length}`);

console.log('the card carries an explicit touch-action');
const ta = await page.locator('.feed-card').first().evaluate(el => getComputedStyle(el).touchAction);
check('touch-action is pan-y', ta === 'pan-y', ta);

console.log(`\n${fails ? `${fails} failure(s)` : 'swipe behaves, and does not fight the scroll'}`);
await browser.close();
process.exit(fails ? 1 : 0);
