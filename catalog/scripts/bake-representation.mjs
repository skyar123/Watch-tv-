#!/usr/bin/env node
/**
 * Build the representation index from Wikipedia's category tree.
 *
 * WHY THIS EXISTS
 *
 * The first version of this data was six shows I had checked by hand. The
 * reasoning at the time — that no API can tell you whether a queer character
 * matters to the plot, so a short honest list beats a long padded one — was
 * right about the API and wrong about the product. A "queer stories" filter
 * that returns one show is not honest, it is broken, and it is a worse failure
 * than imprecision because it tells a user their thing is not here.
 *
 * Wikipedia's category tree is the missing source. It is not a keyword match:
 * categories are applied by editors against written inclusion criteria, and
 * "LGBTQ-related television shows" has been maintained for years with hundreds
 * of members. It is a weaker claim than a hand-check — membership means
 * "editors consider this LGBTQ-related", not "a queer storyline is central" —
 * so the two are kept as separate tiers and the app says which it is showing.
 *
 *   node scripts/bake-representation.mjs        # write src/data/representation.json
 *   node scripts/bake-representation.mjs --dry
 */
import { writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const OUT = 'src/data/representation.json';
/**
 * The crawl is slow — hundreds of categories, paced to stay under Wikipedia's
 * rate limit — and iterating on precision should not mean re-crawling it.
 * The raw page list is cached so matching and sampling re-run in a second.
 */
const CACHE = '.wiki-cache.json';
const FRESH_MS = 1000 * 60 * 60 * 12;
const UA = 'tonight-tv/1.0 (personal TV catalogue; github.com/skyar123/Watch-tv-)';

/**
 * Roots to walk, and how deep. Depth matters: one level too far and
 * "LGBTQ-related television shows by country" turns into every show ever made
 * in a country that has a queer sitcom.
 */
const ROOTS = {
  queer: [
    ['Category:LGBTQ-related television shows', 4],
    ['Category:Gay-related television shows', 3],
    ['Category:Lesbian-related television shows', 3],
    ['Category:Bisexuality-related television series', 3],
    ['Category:Transgender-related television shows', 3],
    ['Category:LGBTQ-related reality television series', 2],
    ['Category:LGBTQ telenovelas', 2],
    ['Category:Drag (entertainment) television shows', 2],
  ],
  disability: [
    ['Category:Television shows about disability', 3],
    ['Category:Autism in television', 2],
    ['Category:Deafness in television', 2],
    ['Category:Blindness in television', 2],
    ['Category:Television series about mental health', 2],
  ],
};

/**
 * Categories that would drag in things that are not this show, or not a show.
 *
 * Episodes and films are not series, and "Lists of" are list articles. The
 * by-country, by-decade and by-genre containers are NOT skipped: they are pure
 * containers whose children hold most of the shows, and excluding them was why
 * the first crawl found 173 queer pages when the tree holds many times that.
 */
const SKIP = /television episodes|\bfilms\b|\bfilm series\b|Lists of|stub|templates|Wikipedia/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Wikipedia asks for one request at a time from a script and returns 429 when
 * it means it. The first crawl lost whole categories to rate limiting and
 * reported the shortfall as a result rather than as a failure, so this paces
 * itself and backs off properly.
 */
let lastCall = 0;
const MIN_GAP_MS = 120;

const api = async params => {
  const url = 'https://en.wikipedia.org/w/api.php?' +
    new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params });
  for (let attempt = 0; ; attempt++) {
    const gap = Date.now() - lastCall;
    if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);
    lastCall = Date.now();
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429 || r.status === 503) {
        const retry = Number(r.headers.get('retry-after')) || (2 * 2 ** attempt);
        if (attempt >= 5) throw new Error(`HTTP ${r.status} after ${attempt} retries`);
        await sleep(retry * 1000);
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.error?.code === 'maxlag') { await sleep(2000); continue; }
      return j;
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(500 * 2 ** attempt);
    }
  }
};

/** Every page in a category, following continuation. */
async function members(title, type) {
  const out = [];
  let cont;
  do {
    const d = await api({
      action: 'query', list: 'categorymembers', cmtitle: title,
      cmlimit: '500', cmtype: type, ...(cont ? { cmcontinue: cont } : {}),
    });
    out.push(...(d.query?.categorymembers || []));
    cont = d.continue?.cmcontinue;
  } while (cont);
  return out;
}

/** Walk a category and its subcategories, collecting page titles. */
async function crawl(root, depth, seenCats, pages, trail) {
  if (depth < 0 || seenCats.has(root)) return;
  seenCats.add(root);

  const label = root.replace(/^Category:/, '');
  for (const p of await members(root, 'page')) {
    // Namespace 0 only: skip talk pages, templates, portals.
    if (p.ns !== 0) continue;
    const prev = pages.get(p.title);
    if (prev) prev.cats.add(label);
    else pages.set(p.title, { title: p.title, cats: new Set([label]) });
  }

  if (depth === 0) return;
  for (const sub of await members(root, 'subcat')) {
    if (SKIP.test(sub.title)) continue;
    await crawl(sub.title, depth - 1, seenCats, pages, [...trail, label]);
  }
}

const collected = {};
const failures = [];

let cached = null;
if (existsSync(CACHE) && !process.argv.includes('--recrawl')) {
  try {
    const c = JSON.parse(readFileSync(CACHE, 'utf8'));
    if (Date.now() - new Date(c.at).getTime() < FRESH_MS) cached = c;
  } catch { /* corrupt cache; crawl again */ }
}

if (cached) {
  console.log(`  using cached crawl from ${cached.at} (--recrawl to refresh)`);
  for (const [kind, rows] of Object.entries(cached.pages)) {
    collected[kind] = new Map(rows.map(r => [r.title, { title: r.title, cats: new Set(r.cats) }]));
    console.log(`  ${kind}: ${collected[kind].size} pages`);
  }
}

if (!cached) for (const [kind, roots] of Object.entries(ROOTS)) {
  const pages = new Map();
  const seenCats = new Set();
  for (const [root, depth] of roots) {
    process.stdout.write(`\r  ${kind}: ${root.slice(9, 46).padEnd(38)} ${pages.size} pages  `);
    try { await crawl(root, depth, seenCats, pages, []); }
    catch (e) { failures.push(`${root}: ${e.message}`); }
  }
  console.log(`\r  ${kind}: ${pages.size} pages from ${seenCats.size} categories${' '.repeat(34)}`);
  collected[kind] = pages;
}
if (!cached && !failures.length) {
  writeFileSync(CACHE, JSON.stringify({
    at: new Date().toISOString(),
    pages: Object.fromEntries(Object.entries(collected).map(([k, m]) =>
      [k, [...m.values()].map(p => ({ title: p.title, cats: [...p.cats] }))])),
  }));
  console.log(`  cached the crawl to ${CACHE}`);
}

if (failures.length) {
  // An incomplete crawl written as if complete is the worst outcome here: the
  // filter would silently under-report and look like a short list again.
  console.log(`\n  ${failures.length} category/categories failed:`);
  for (const f of failures) console.log('   ! ' + f);
  if (!DRY) { console.log('\n  refusing to write a partial index — rerun'); process.exit(1); }
}

/* ── resolve Wikipedia titles to TVmaze ids, against the baked catalogue ── */

const catalogue = [
  ...JSON.parse(readFileSync('public/catalogue-core.json', 'utf8')).shows,
  ...JSON.parse(readFileSync('public/catalogue.json', 'utf8')).shows,
];
const norm = s => String(s).toLowerCase()
  .replace(/\s*\((?:tv series|tv programme|tv program|series|miniseries|american|british|.*?tv series)\)\s*$/i, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const byName = new Map();
for (const s of catalogue) {
  const k = norm(s.n);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(s);
}

const index = {};
const stats = {};
for (const [kind, pages] of Object.entries(collected)) {
  let matched = 0, ambiguous = 0;
  for (const page of pages.values()) {
    // Disambiguators like "(TV series)" are stripped for matching but the
    // full title is kept so a wrong match is traceable.
    const rows = byName.get(norm(page.title));
    if (!rows?.length) continue;
    // A name collision is resolved by popularity, and flagged, because
    // "Dark (2017)" and "Dark (1990)" are different programmes.
    const pick = rows.sort((a, b) => (b.w ?? 0) - (a.w ?? 0))[0];
    if (rows.length > 1) ambiguous++;
    matched++;
    const cur = (index[pick.i] ||= { name: pick.n });
    cur[kind] = {
      source: 'wikipedia',
      cats: [...page.cats].slice(0, 3),
      wiki: page.title,
      ambiguous: rows.length > 1 || undefined,
    };
  }
  stats[kind] = { pages: pages.size, matched, ambiguous };
  console.log(`  ${kind}: ${matched} of ${pages.size} resolved to a show in the catalogue` +
              (ambiguous ? ` (${ambiguous} name collisions, resolved by popularity)` : ''));
}

const doc = {
  version: 1,
  bakedAt: new Date().toISOString(),
  source: 'en.wikipedia.org category tree',
  note: 'Category membership means Wikipedia editors consider the show related to ' +
        'this subject. It is NOT the same claim as the hand-checked notes in ' +
        'curated.js, which say why it matters to the plot. The app shows which it has.',
  roots: Object.fromEntries(Object.entries(ROOTS).map(([k, v]) => [k, v.map(r => r[0])])),
  stats,
  shows: index,
};

// Precision matters more than breadth here: a "queer stories" filter full of
// shows that are not is worse than a short one. Print a random sample so a
// human can actually look at what the crawl decided.
if (process.env.SAMPLE) {
  for (const kind of Object.keys(collected)) {
    const rows = Object.entries(index).filter(([, v]) => v[kind]);
    console.log(`\n  --- random ${kind} sample (${rows.length} tagged) ---`);
    const pick = rows.sort(() => Math.random() - 0.5).slice(0, 24);
    for (const [id, v] of pick) {
      console.log(`   ${String(id).padEnd(6)} ${v.name.slice(0, 30).padEnd(32)} ${v[kind].cats.slice(0,2).join(' | ').slice(0,58)}`);
    }
  }
}

console.log(`\n  ${Object.keys(index).length} shows tagged`);
console.log(`  queer: ${Object.values(index).filter(s => s.queer).length}` +
            `  disability: ${Object.values(index).filter(s => s.disability).length}`);

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
if (existsSync(OUT)) writeFileSync(OUT + '.prev', readFileSync(OUT));
writeFileSync(OUT + '.tmp', JSON.stringify(doc, null, 0));
renameSync(OUT + '.tmp', OUT);
console.log(`  wrote ${OUT} (${(JSON.stringify(doc).length / 1024).toFixed(0)} kB)`);
if (existsSync(OUT + '.prev')) {
  console.log(`  prove it: node scripts/prove-diff.mjs ${OUT}.prev ${OUT} --expect bakedAt,stats,shows`);
}
