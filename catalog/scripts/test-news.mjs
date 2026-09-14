#!/usr/bin/env node
/**
 * News, in the app, against the live feeds.
 *
 * The matcher is proved in test-newsmatch.mjs. This is the other half: that
 * what it finds actually reaches the screen, that "Your shows" filters on a
 * real saved list, and that an empty result says why instead of looking broken.
 */
import { chromium, devices } from 'playwright';
import { installLiveApiShim } from './live-shim.mjs';

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

let fails = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`); if (!ok) fails++; };

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('.feed-card', { timeout: 30000 });
await page.waitForFunction(() => !document.body.textContent.includes('loading more'),
                           { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(1200);

console.log('with nothing saved, "Your shows" explains itself rather than looking broken');
await page.locator('nav button', { hasText: 'News' }).click();
await page.waitForSelector('a[target="_blank"]', { timeout: 40000 });
await page.waitForTimeout(600);
await page.locator('button', { hasText: 'Your shows' }).click();
await page.waitForTimeout(500);
const emptyCopy = await page.locator('p', { hasText: 'Nothing to match against yet' }).count();
check('the empty state says what to do about it', emptyCopy === 1);

console.log('switching to Your shows must not refetch thirteen feeds');
let newsRequests = 0;
page.on('request', r => { if (r.url().includes('/api/news')) newsRequests++; });
await page.locator('button', { hasText: 'Everything' }).click();
await page.waitForTimeout(1200);
check('coming back from Your shows reused what was already fetched', newsRequests === 0,
      `${newsRequests} refetches`);

console.log('stories carry the show they are about');
const chips = await page.locator('button[aria-label*="is named in the"]').count();
check('at least one story names a show', chips > 0, `${chips} show chips`);

const total = await page.locator('a[target="_blank"]').count();
check('and most stories do NOT, which is what precision looks like',
      chips < total * 0.8, `${chips} chips across ${total} stories`);

console.log('tapping the show opens it, and does not follow the article link');
const before = page.url();
await page.locator('button[aria-label*="is named in the"]').first().click();
await page.waitForTimeout(900);
check('the app stayed put', page.url() === before);
const sheet = await page.locator('[role="dialog"], .sheet').count();
check('the show detail opened', sheet >= 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

console.log('a saved show collects its own coverage');
{
  // Deterministic on purpose: real headlines change hourly, so the wiring is
  // tested against a fixed payload while test-newsmatch.mjs tests the matcher
  // against the live feeds.
  const hs = await (await fetch('https://api.tvmaze.com/singlesearch/shows?q=Heartstopper')).json();
  const key = `tvmaze:${hs.id}`;
  await page.evaluate(([k, name]) => {
    const raw = JSON.parse(localStorage.getItem('tonight:v2'));
    raw.profiles[raw.active].saved = { [k]: { addedAt: Date.now(), name } };
    localStorage.setItem('tonight:v2', JSON.stringify(raw));
  }, [key, hs.name]);

  await page.route('**/api/news**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      fetchedAt: Date.now(),
      sources: [{ name: 'Autostraddle', tag: 'queer', ok: true, count: 2 }],
      items: [
        { title: 'Heartstopper Forever Is the Ending We Deserved',
          url: 'https://example.invalid/a', summary: 'A review.',
          source: 'Autostraddle', sourceTag: 'queer', publishedAt: Date.now() - 3600e3 },
        { title: 'Streaming subscriber numbers rose this quarter',
          url: 'https://example.invalid/b', summary: 'Analysts said the market had grown.',
          source: 'Variety', sourceTag: 'tv', publishedAt: Date.now() - 7200e3 },
      ],
    }),
  }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.feed-card', { timeout: 30000 });
  await page.waitForFunction(() => !document.body.textContent.includes('loading more'),
                             { timeout: 40000 }).catch(() => {});
  await page.locator('nav button', { hasText: 'News' }).click();
  await page.waitForSelector('a[target="_blank"]', { timeout: 30000 });
  await page.waitForTimeout(700);

  const yours = page.locator('button', { hasText: 'Your shows' });
  check('the Your shows chip shows a count', (await yours.innerText()).trim().endsWith('1'),
        (await yours.innerText()).replace(/\s+/g, ' '));
  await yours.click();
  await page.waitForTimeout(500);
  const left = await page.locator('a[target="_blank"]').count();
  check('only the story about a saved show survives the filter', left === 1, `${left} stories`);
  const chip = await page.locator('button[aria-label*="on your list"]').count();
  check('and it is labelled as being on your list', chip === 1);
  await page.screenshot({ path: 'docs/shots/news.png' });
  await page.locator('button', { hasText: 'Everything' }).click();
  await page.waitForTimeout(400);
}

console.log('the source strip still names every failure');
const strip = await page.locator('p', { hasText: 'Sources:' }).count();
check('sources are listed', strip === 1);

console.log(`\n${fails ? `${fails} failure(s)` : 'news is about shows now, not just a list of headlines'}`);
await browser.close();
process.exit(fails ? 1 : 0);
