#!/usr/bin/env node
/**
 * Prove the interactions actually do something, on a touch device.
 *
 * Rendering a checkbox is not the same as the checkbox working, and a grab
 * handle that looks draggable is not the same as drag-to-dismiss. Both are
 * exercised here with real pointer gestures.
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
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fails++;
};

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForSelector('.feed-card', { timeout: 25000 });
await page.waitForTimeout(4000);

console.log('save from the feed');
const before = await page.evaluate(() =>
  Object.keys(JSON.parse(localStorage.getItem('tonight:v1') || '{}').saved || {}).length);
await page.locator('.feed-card button[aria-label*="Save to your list"]').first().click();
await page.waitForTimeout(300);
const after = await page.evaluate(() =>
  Object.keys(JSON.parse(localStorage.getItem('tonight:v1') || '{}').saved || {}).length);
check('save writes to storage', after === before + 1, `${before} → ${after}`);

console.log('episode tracker');
await page.locator('.feed-card button[aria-label^="Open details"]').first().click();
await page.waitForSelector('[role="dialog"]');
// The sheet slides up over 280ms. Clicking a tab mid-transition lands on
// whatever is passing under the pointer, so wait for it to settle.
await page.waitForTimeout(700);
await page.locator('[role="dialog"] .sheet-scroll').evaluate(el => el.scrollTo(0, 0));
await page.getByRole('dialog').getByRole('button', { name: 'Episodes', exact: true }).click();
await page.waitForTimeout(1800);

const progressText = () => page.locator('[role="dialog"]')
  .locator('text=/\\d+ of \\d+ episodes/').first().innerText();
const p0 = await progressText();
// Mark three episodes.
const boxes = page.locator('[role="dialog"] button[aria-label^="Mark S"]');
for (let i = 0; i < 3; i++) { await boxes.nth(i).click(); await page.waitForTimeout(120); }
const p1 = await progressText();
check('marking episodes moves the counter', p0 !== p1, `"${p0}" → "${p1}"`);
check('counter reads 3 watched', /^3 of /.test(p1), p1);

const upNext = await page.locator('[role="dialog"]').locator('text=/Up next:/').first().innerText();
check('up-next advanced past the watched ones', /E4\b/.test(upNext) || /E[4-9]/.test(upNext), upNext);

const stored = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('tonight:v1') || '{}');
  return Object.values(s.watched || {}).reduce((a, o) => a + Object.keys(o).length, 0);
});
check('watched episodes persisted', stored === 3, `${stored} in localStorage`);

console.log('reload keeps progress');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.feed-card', { timeout: 25000 });
const stored2 = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('tonight:v1') || '{}');
  return Object.values(s.watched || {}).reduce((a, o) => a + Object.keys(o).length, 0);
});
check('progress survives a reload', stored2 === 3, `${stored2} after reload`);

console.log('sheet drag-to-dismiss');
await page.waitForTimeout(3000);
await page.locator('.feed-card button[aria-label^="Open details"]').first().click();
await page.waitForSelector('[role="dialog"]');
await page.waitForTimeout(700);
const handle = page.locator('[role="dialog"] .cursor-grab').first();
const box = await handle.boundingBox();
// A short drag must NOT dismiss; the sheet should spring back.
await page.mouse.move(box.x + box.width / 2, box.y + 8);
await page.mouse.down();
for (let y = 8; y <= 60; y += 13) {
  await page.mouse.move(box.x + box.width / 2, box.y + y); await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(500);
check('a short drag springs back', await page.locator('[role="dialog"]').count() === 1);

// A long drag must dismiss.
const box2 = await handle.boundingBox();
await page.mouse.move(box2.x + box2.width / 2, box2.y + 8);
await page.mouse.down();
for (let y = 8; y <= 320; y += 26) {
  await page.mouse.move(box2.x + box2.width / 2, box2.y + y); await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(600);
check('a long drag dismisses', await page.locator('[role="dialog"]').count() === 0);

console.log('not-for-me removes it everywhere');
const firstName = await page.locator('.feed-card h2').first().innerText();
await page.locator('.feed-card button[aria-label="Not for me"]').first().click();
await page.waitForTimeout(500);
const nowFirst = await page.locator('.feed-card h2').first().innerText();
check('hidden show left the feed', nowFirst !== firstName, `"${firstName}" → "${nowFirst}"`);
const hidden = await page.evaluate(() =>
  Object.keys(JSON.parse(localStorage.getItem('tonight:v1') || '{}').notForMe || {}).length);
check('hide persisted', hidden === 1, `${hidden} hidden`);

console.log(`\n${fails ? `${fails} failure(s)` : 'all interactions behave'}`);
await browser.close();
process.exit(fails ? 1 : 0);
