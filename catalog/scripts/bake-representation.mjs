#!/usr/bin/env node
/**
 * Build the representation index from Wikidata.
 *
 * WHY THIS EXISTS
 *
 * The first version of this data was six shows checked by hand. The reasoning
 * — that no API can tell you whether a queer character matters to the plot, so
 * a short honest list beats a long padded one — was right about the APIs and
 * wrong about the product. A "queer stories" filter that returns one show is
 * not honest, it is broken, and it tells someone their thing is not here.
 *
 * WHY WIKIDATA AND NOT WIKIPEDIA CATEGORIES
 *
 * The first attempt crawled Wikipedia's category tree. It worked, but four
 * levels deep it reached 412 categories and thousands of paced requests, and
 * timed out after fifty minutes without finishing. Wikidata answers the same
 * question in one query in twenty seconds, and 89% of its rows carry an IMDb
 * id, so matching against TVmaze is exact rather than fuzzy.
 *
 * THE TIERS, WHICH ARE THE POINT
 *
 * Wikidata makes a distinction the category tree does not, and it is exactly
 * the distinction this feature needs:
 *
 *   P921 "main subject"  — what the show is ABOUT. 32 in our catalogue:
 *                          Sense8, Orange Is the New Black, Transparent,
 *                          Her Story, A Very English Scandal.
 *   P136 "genre"         — has queer characters or storylines. 661 more, and
 *                          a real mixture: Fingersmith and Oranges Are Not the
 *                          Only Fruit sit alongside Torchwood and Quantico.
 *
 * Collapsing those two would fill a "queer stories" filter with mainstream
 * shows that happen to have one queer character, which is its own kind of
 * erasure. They are kept apart, the app defaults to the narrow one, and
 * widening is a deliberate choice the user makes.
 *
 *   node scripts/bake-representation.mjs [--dry]
 */
import { writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const OUT = 'src/data/representation.json';
const UA = 'tonight-tv/1.0 (personal TV catalogue; github.com/skyar123/Watch-tv-)';

/**
 * Entities discovered by asking Wikidata which genres and subjects actually
 * appear on television series, rather than guessed. Guessing Q-ids produced
 * nine results the first time.
 */
const QUEER_TAGS = [
  'wd:Q85133165',   // LGBT-related television series  (973 series)
  'wd:Q20442589',   // LGBTQ-related film
  'wd:Q105320349',  // gay-related film
  'wd:Q128146088',  // gay television series
  'wd:Q17884',      // LGBTQ
  'wd:Q6649',       // lesbianism
  'wd:Q189125',     // transgender
  'wd:Q2257941',    // male homosexuality
  'wd:Q6636',       // homosexuality
  'wd:Q102141681',  // homosexuality-related film
].join(' ');

const DISABILITY_TAGS = [
  'wd:Q12131',      // disability
  'wd:Q38404',      // autism
  'wd:Q1436063',    // autism spectrum disorder
  'wd:Q1788847',    // high-functioning autism
  'wd:Q10874',      // blindness
  'wd:Q12200',      // deafness
  'wd:Q6817478',    // mental illness in fiction
  'wd:Q12135',      // mental disorder
  'wd:Q181923',     // Down syndrome
  'wd:Q12206',      // cerebral palsy
  'wd:Q7930',       // paralysis
].join(' ');

/** Q15416 is "television programme", which subsumes series, miniseries and serials. */
const query = (tags, property) => `
SELECT DISTINCT ?item ?itemLabel ?imdb ?tagLabel WHERE {
  VALUES ?tag { ${tags} }
  ?item ${property} ?tag ; wdt:P31/wdt:P279* wd:Q15416 .
  OPTIONAL { ?item wdt:P345 ?imdb }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

async function sparql(q, label) {
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), {
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
        signal: AbortSignal.timeout(120000),
      });
      if (r.status === 429) {
        const wait = Number(r.headers.get('retry-after')) || 5 * (attempt + 1);
        await new Promise(res => setTimeout(res, wait * 1000));
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = (await r.json()).results.bindings;
      console.log(`  ${label}: ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return rows;
    } catch (e) {
      if (attempt >= 2) throw new Error(`${label}: ${e.message}`);
      await new Promise(res => setTimeout(res, 3000));
    }
  }
}

/* ────────────────────────────────── resolve against the baked catalogue ── */

const catalogue = [
  ...JSON.parse(readFileSync('public/catalogue-core.json', 'utf8')).shows,
  ...JSON.parse(readFileSync('public/catalogue.json', 'utf8')).shows,
];
const byImdb = new Map(catalogue.filter(s => s.d).map(s => [s.d, s]));
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const byName = new Map();
for (const s of catalogue) if (!byName.has(norm(s.n))) byName.set(norm(s.n), s);

/** IMDb id first: it is exact. A name match is a guess and is recorded as one. */
function resolve(row) {
  const imdb = row.imdb?.value;
  if (imdb) { const hit = byImdb.get(imdb); if (hit) return { show: hit, how: 'imdb' }; }
  const hit = byName.get(norm(row.itemLabel.value));
  return hit ? { show: hit, how: 'name' } : null;
}

const index = {};
const stats = {};

for (const [kind, tags] of [['queer', QUEER_TAGS], ['disability', DISABILITY_TAGS]]) {
  // "about" is claimed first so it wins over the broader "features" tier.
  const about = await sparql(query(tags, 'wdt:P921'), `${kind}: main subject`);
  const genre = await sparql(query(tags, 'wdt:P136'), `${kind}: genre`);

  const counts = { about: 0, features: 0, byImdb: 0, byName: 0, unmatched: 0 };
  const apply = (rows, tier) => {
    for (const row of rows) {
      const m = resolve(row);
      if (!m) { counts.unmatched++; continue; }
      const cur = (index[m.show.i] ||= { name: m.show.n });
      // Never downgrade: a show that is ABOUT this does not become merely
      // "features" because it also carries the broad genre tag.
      if (cur[kind]?.tier === 'about') continue;
      cur[kind] = { tier, source: 'wikidata', match: m.how,
                    subject: row.tagLabel?.value, wikidata: row.item.value.split('/').pop() };
      counts[tier]++;
      counts[m.how === 'imdb' ? 'byImdb' : 'byName']++;
    }
  };
  apply(about, 'about');
  apply(genre, 'features');
  stats[kind] = counts;
  const tally = Object.values(index).filter(v => v[kind]);
  console.log(`  ${kind}: ${tally.filter(v => v[kind].tier === 'about').length} about, ` +
              `${tally.filter(v => v[kind].tier === 'features').length} featuring ` +
              `(${counts.byImdb} matched by IMDb id, ${counts.byName} by name)`);
}

/**
 * Wikidata barely models disability in television: four "about" rows and no
 * genre tag at all. Wikipedia does — "Television shows about disability" has
 * fifty-odd direct members — so it supplements the thin side. Kept to depth
 * one on named categories, which takes seconds; it was the FOUR-level crawl
 * that timed out, not the idea.
 */
const WIKI_DISABILITY = [
  'Category:Television shows about disability',
  'Category:Autism in television',
  'Category:Deafness in television',
  'Category:Blindness in television',
  'Category:Television series about mental health',
  'Category:Down syndrome in television',
];

async function wikipediaMembers(title) {
  const out = [];
  let cont;
  do {
    const u = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
      format: 'json', formatversion: '2', action: 'query', list: 'categorymembers',
      cmtitle: title, cmlimit: '500', cmtype: 'page', ...(cont ? { cmcontinue: cont } : {}),
    });
    const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    out.push(...(j.query?.categorymembers || []).filter(m => m.ns === 0));
    cont = j.continue?.cmcontinue;
    await new Promise(res => setTimeout(res, 150));
  } while (cont);
  return out;
}

let wikiAdded = 0, wikiFailed = 0;
for (const cat of WIKI_DISABILITY) {
  let pages;
  try { pages = await wikipediaMembers(cat); }
  catch (e) { wikiFailed++; console.log(`  ! ${cat}: ${e.message}`); continue; }
  for (const page of pages) {
    const m = resolve({ itemLabel: { value: page.title.replace(/\s*\([^)]*\)\s*$/, '') } });
    if (!m) continue;
    const cur = (index[m.show.i] ||= { name: m.show.n });
    if (cur.disability) continue;                  // Wikidata's claim stands
    cur.disability = { tier: 'about', source: 'wikipedia', match: m.how,
                       subject: cat.replace(/^Category:/, ''), wiki: page.title };
    wikiAdded++;
  }
}
console.log(`  disability: +${wikiAdded} from Wikipedia categories` +
            (wikiFailed ? ` (${wikiFailed} categories unreachable)` : ''));
stats.disability.fromWikipedia = wikiAdded;

if (process.env.SAMPLE) {
  for (const kind of ['queer', 'disability']) {
    for (const tier of ['about', 'features']) {
      const rows = Object.entries(index).filter(([, v]) => v[kind]?.tier === tier);
      if (!rows.length) continue;
      console.log(`\n  --- ${kind} / ${tier} (${rows.length}) ---`);
      console.log('   ' + rows.sort(() => Math.random() - 0.5).slice(0, 16)
        .map(([, v]) => v.name).join(' · '));
    }
  }
}

const doc = {
  version: 2,
  bakedAt: new Date().toISOString(),
  source: 'query.wikidata.org',
  note: 'Two tiers. "about" means Wikidata records this as the show\'s main subject; ' +
        '"features" means it carries the genre tag, which covers everything from a ' +
        'central queer storyline to one recurring character. Neither is the same claim ' +
        'as the hand-checked notes in curated.js, which say why it matters to the plot.',
  stats,
  shows: index,
};

const n = Object.keys(index).length;
console.log(`\n  ${n} shows tagged, ${(JSON.stringify(doc).length / 1024).toFixed(0)} kB`);
if (!n) { console.log('  refusing to write an empty index'); process.exit(1); }

if (DRY) { console.log('  --dry: nothing written'); process.exit(0); }
if (existsSync(OUT)) writeFileSync(OUT + '.prev', readFileSync(OUT));
writeFileSync(OUT + '.tmp', JSON.stringify(doc));
renameSync(OUT + '.tmp', OUT);
console.log(`  wrote ${OUT}`);
if (existsSync(OUT + '.prev')) {
  console.log(`  prove it: node scripts/prove-diff.mjs ${OUT}.prev ${OUT} --expect bakedAt,stats,shows`);
}
