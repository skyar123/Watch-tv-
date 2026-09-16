#!/usr/bin/env node
/**
 * Run the article-to-show matcher over the REAL feeds and print every match.
 *
 * The claim this feature makes is a precision claim, and a precision claim
 * that has not been checked against real articles is a guess. Substring
 * matching on show titles produces confident nonsense (the catalogue contains
 * shows called Dark, Below, Special and Doc), so what matters is not how many
 * matches there are but how many of them are wrong.
 *
 * Every match is printed so it can be read. The assertions below cover the
 * traps that are checkable automatically; the printed list is for the ones
 * that are not.
 */
import { readFileSync } from 'node:fs';
import { hydrate } from '../src/lib/catalogue.js';
import { buildShowMatcher, quotedPhrases } from '../src/lib/newsmatch.js';
import { FEEDS } from '../src/data/feeds.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const load = p => JSON.parse(readFileSync(p, 'utf8')).shows.map(hydrate);
const catalogue = [...load('public/catalogue-core.json'), ...load('public/catalogue.json')];

// A believable personal list: the shows these two profiles are seeded with,
// plus a few they would plausibly have saved.
const MINE = ['Heartstopper', 'The Bear', 'Westworld', 'Dark', 'Yellowjackets',
              'Severance', 'The Last of Us', 'Our Flag Means Death', 'Hacks',
              'Somebody Somewhere', 'A League of Their Own', 'Interview with the Vampire'];
const mine = MINE.map(n => catalogue.find(s => s.name.toLowerCase() === n.toLowerCase()))
                 .filter(Boolean);
console.log(`catalogue: ${catalogue.length} shows`);
console.log(`your shows: ${mine.length} of ${MINE.length} found in the index`);

const match = buildShowMatcher(catalogue, mine);
console.log(`  ${match.mineSize} of them have a name safe enough to match unquoted` +
            (match.mineDropped ? `, ${match.mineDropped} refused as too ordinary` : '') + '\n');

/* ── the same parsing the function does, kept deliberately small ─────────── */
const strip = s => (s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&').replace(/&#0?39;|&apos;|&rsquo;/g, "'")
  .replace(/\s+/g, ' ').trim();
const tag = (xml, n) => { const m = xml.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, 'i')); return m ? strip(m[1]) : ''; };

const articles = [];
const reached = [];
await Promise.all(FEEDS.map(async f => {
  try {
    const res = await fetch(f.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return;
    const xml = await res.text();
    const chunks = xml.match(/<(?:item|entry)[ >][\s\S]*?<\/(?:item|entry)>/gi) || [];
    if (chunks.length) reached.push(f.name);
    for (const ch of chunks.slice(0, 25)) {
      const title = tag(ch, 'title');
      if (title) articles.push({
        title,
        summary: strip(tag(ch, 'description') || tag(ch, 'summary')).slice(0, 260),
        source: f.name,
      });
    }
  } catch { /* an unreachable outlet is reported by count, not by throwing */ }
}));

console.log(`reached ${reached.length}/${FEEDS.length} feeds: ${reached.join(', ')}`);
if (articles.length < 40) {
  console.error(`\nonly ${articles.length} articles: not enough to say anything about precision.`);
  process.exit(2);
}
console.log(`${articles.length} articles\n`);

let matched = 0;
const rows = [];
for (const a of articles) {
  const hits = match(a);
  if (!hits.length) continue;
  matched++;
  rows.push({ a, hits });
}

console.log(`${matched} of ${articles.length} articles matched a show ` +
            `(${(100 * matched / articles.length).toFixed(0)}%)\n`);
for (const { a, hits } of rows) {
  console.log(`  [${a.source}] ${a.title.slice(0, 74)}`);
  for (const h of hits.slice(0, 3)) {
    console.log(`      -> ${h.show.name}${h.show.premiered ? ` (${String(h.show.premiered).slice(0, 4)})` : ''}` +
                `  [${h.how}, ${h.where}]`);
  }
}

/* ── the checks that can be made without a human reading them ───────────── */
let fails = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? '✓' : '✗'} ${n}${d ? '  ' + d : ''}`); if (!ok) fails++; };
console.log();

// 1. An apostrophe is the same character as a closing single quote. If
//    extraction does not require an OPENING mark, every possessive in English
//    becomes a title and the whole approach collapses.
const poss = quotedPhrases("Backstage at New York\u2019s Queerest Fashion Show");
check('a possessive is not read as a quoted title', poss.length === 0, JSON.stringify(poss));
const real = quotedPhrases('\u2018Adults\u2019 Defies Sophomore Slump With Ratings Growth');
check('a genuinely quoted title is extracted', real[0] === 'Adults', JSON.stringify(real));

// 2. The exact articles that the first, catalogue-wide version got wrong.
for (const [title, wrong] of [
  ["My Girlfriend Thinks I'm Prioritizing Exercise Over Her", 'Girlfriend'],
  ['Everything We Know About Rebecca Ferguson and Greta Lee', 'Rebecca'],
  ['Emmys 2026: Seen and Heard at Every Star-Studded Party', 'Hollywood'],
  ['Netflix and Sega Set Crazy Taxi Game-to-Film Adaptation', 'Action'],
]) {
  const got = match({ title, summary: '' }).map(h => h.show.name);
  check(`"${title.slice(0, 44)}" is not reported as ${wrong}`, !got.includes(wrong), got.join() || 'no match');
}

// 3. Your own shows are matched, which is the point of the feature.
const mineHit = match({ title: 'Heartstopper Forever is coming to Netflix', summary: '' });
check('a show on your list is matched by name', mineHit.some(h => h.how === 'yours'),
      mineHit.map(h => `${h.show.name}/${h.how}`).join() || 'nothing');
const bearHead = match({ title: 'The Bear renewed for another season', summary: '' });
check('a short two-word title on your list matches in a headline',
      bearHead.some(h => h.show.name === 'The Bear'), bearHead.map(h => h.show.name).join());
const bearBody = match({ title: 'An unrelated headline',
                         summary: 'A scene in which the bear wanders through.' });
check('and not in prose alone', !bearBody.some(h => h.show.name === 'The Bear'),
      bearBody.map(h => h.show.name).join());

// 4. Nothing at all should match an article with no show in it.
const none = match({ title: 'Streaming subscriber numbers rose this quarter',
                     summary: 'Analysts said the market had grown.' });
check('an article about nothing matches nothing', none.length === 0,
      none.map(h => h.show.name).join());

// 5. A match rate near the whole corpus means it is matching noise again. The
//    catalogue-wide version scored 76% and was wrong most of the time.
const rate = matched / articles.length;
check('the match rate is plausible rather than universal', rate > 0.03 && rate < 0.55,
      `${(rate * 100).toFixed(0)}%`);

console.log(`\n${fails ? `${fails} failure(s)` : 'read the list above: every match should name a show the article is really about'}`);
process.exit(fails ? 1 : 0);
