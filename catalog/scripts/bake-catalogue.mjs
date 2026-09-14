#!/usr/bin/env node
/**
 * Bake the whole TVmaze catalogue into one compact index.
 *
 * The feed was ranking 250 shows — page 0 of the index — because that is what
 * the app fetched at runtime. TVmaze has about 94,500. Ranking 250 of them and
 * calling it a recommendation is the actual reason the feed felt thin.
 *
 * Fetching 378 pages from a phone is obviously out, so this runs at build time
 * and produces a file the app can hold in memory and rank against instantly,
 * offline, with no per-show requests.
 *
 * Field names are single letters on purpose: at ~50k rows, `genres` versus `g`
 * is about a megabyte of wire.
 *
 *   node scripts/bake-catalogue.mjs              # write public/catalogue.json
 *   node scripts/bake-catalogue.mjs --dry        # measure, write nothing
 *   node scripts/bake-catalogue.mjs --pages 20   # quick partial for testing
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i === -1 ? d : (args[i + 1] ?? true); };
const DRY = args.includes('--dry');
const MAX_PAGES = Number(flag('--pages', Infinity));
const OUT = 'public/catalogue.json';
const OUT_CORE = 'public/catalogue-core.json';

/**
 * The index is split in two because 1.1 MB gzipped is a long stare at an empty
 * screen on cellular. The core is the most popular slice and loads first so the
 * feed starts immediately; the tail arrives behind it and the ranker re-runs.
 * Together they are the same 27,590 shows, with no row in both files.
 */
const CORE_SIZE = Number(flag('--core', 6000));
const UA = 'tonight/bake-catalogue';

/**
 * A show earns a place if it has artwork AND some evidence anyone watched it.
 * Without the poster the feed has nothing to show; without a rating or a
 * popularity weight there is nothing to rank on, and the index fills with
 * 1970s regional news programmes that push real shows off the list.
 */
const KEEP = s => Boolean(s.image?.medium) &&
  (s.rating?.average != null || (s.weight ?? 0) >= 60);

/** Only the fields the ranker and the card actually read. */
const trim = s => ({
  i: s.id,
  n: s.name,
  g: s.genres?.length ? s.genres : undefined,
  r: s.rating?.average ?? undefined,
  t: s.averageRuntime ?? s.runtime ?? undefined,
  p: s.premiered ? +s.premiered.slice(0, 4) : undefined,
  e: s.ended ? +s.ended.slice(0, 4) : undefined,
  s: { Running: 1, Ended: 2, 'To Be Determined': 3, 'In Development': 4 }[s.status] ?? 0,
  w: s.weight ?? undefined,
  c: (s.webChannel || s.network)?.name || undefined,
  y: s.type !== 'Scripted' ? s.type : undefined,        // Scripted is the default
  l: s.language !== 'English' ? s.language : undefined, // English is the default
  // The image path minus the constant prefix; the client puts it back.
  m: s.image.medium.replace('https://static.tvmaze.com/uploads/images/medium_portrait/', ''),
  d: s.externals?.imdb || undefined,
});

async function page(n, attempt = 0) {
  try {
    const res = await fetch(`https://api.tvmaze.com/shows?page=${n}`, {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000),
    });
    if (res.status === 404) return null;                  // past the end
    if (res.status === 429) throw new Error('rate limited');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    if (attempt >= 4) throw new Error(`page ${n}: ${e.message}`);
    await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    return page(n, attempt + 1);
  }
}

console.log('walking the TVmaze index…');
const t0 = Date.now();
const kept = [];
let seen = 0, n = 0, empty = 0;

// Small concurrency: TVmaze is generous but not infinite, and a 429 storm
// halfway through costs more than the time it saves.
const BATCH = 4;
outer: while (n <= MAX_PAGES) {
  const batch = await Promise.all(
    Array.from({ length: BATCH }, (_, k) => n + k).map(p => page(p).catch(e => ({ __err: e.message }))),
  );
  for (const rows of batch) {
    if (rows?.__err) { console.error('  ' + rows.__err); continue; }
    if (rows === null) { empty++; if (empty >= 2) break outer; continue; }
    seen += rows.length;
    for (const s of rows) if (KEEP(s)) kept.push(trim(s));
  }
  n += BATCH;
  if (n % 40 === 0) {
    process.stdout.write(`\r  page ${n}  seen ${seen}  kept ${kept.length}   `);
  }
}
console.log(`\r  done: ${seen} shows seen, ${kept.length} kept, ${((Date.now() - t0) / 1000).toFixed(0)}s          `);

// Rank order is baked in so the client can slice a good core without sorting
// 50k rows on a phone at startup.
kept.sort((a, b) => (b.w ?? 0) - (a.w ?? 0) || (b.r ?? 0) - (a.r ?? 0));

const bakedAt = new Date().toISOString();
const meta = {
  version: 1,
  source: 'api.tvmaze.com/shows',
  bakedAt,
  seen,
  // What was deliberately left out, so a missing show is explicable rather
  // than mysterious. Search still queries TVmaze live, so nothing is
  // unreachable — it just is not in the ranking pool.
  filter: 'has a poster AND (has a rating OR popularity weight >= 60)',
  dropped: seen - kept.length,
  note: 'Sorted by TVmaze popularity weight, then rating. Abbreviated fields; see src/lib/catalogue.js.',
};

const core = { ...meta, tier: 'core', count: Math.min(CORE_SIZE, kept.length),
               total: kept.length, shows: kept.slice(0, CORE_SIZE) };
const rest = { ...meta, tier: 'rest', count: Math.max(0, kept.length - CORE_SIZE),
               total: kept.length, shows: kept.slice(CORE_SIZE) };

const json = JSON.stringify(rest);
const coreJson = JSON.stringify(core);
const gz = gzipSync(Buffer.from(json), { level: 9 }).length;
const coreGz = gzipSync(Buffer.from(coreJson), { level: 9 }).length;
console.log(`\n  ${kept.length} shows kept of ${seen} seen (${seen - kept.length} filtered out)`);
console.log(`  core  ${String(core.count).padStart(6)} shows  ${(coreJson.length / 1e6).toFixed(2)} MB raw  ${(coreGz / 1e3).toFixed(0)} kB gzipped`);
console.log(`  tail  ${String(rest.count).padStart(6)} shows  ${(json.length / 1e6).toFixed(2)} MB raw  ${(gz / 1e6).toFixed(2)} MB gzipped`);
console.log(`  ${Math.round((json.length + coreJson.length) / kept.length)} bytes/show`);

const byStatus = kept.reduce((a, s) => (a[s.s] = (a[s.s] || 0) + 1, a), {});
console.log(`  running ${byStatus[1] || 0} · ended ${byStatus[2] || 0} · tbd ${byStatus[3] || 0}`);
console.log(`  rated ${kept.filter(s => s.r != null).length} · with runtime ${kept.filter(s => s.t).length}`);

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

mkdirSync('public', { recursive: true });

// Keep the previous index so the rewrite can be proved rather than trusted.
for (const [path, body] of [[OUT_CORE, coreJson], [OUT, json]]) {
  if (existsSync(path)) writeFileSync(path + '.prev', readFileSync(path));
  writeFileSync(path + '.tmp', body);
  renameSync(path + '.tmp', path);   // atomic; a half-written index is worse than an old one
  console.log(`  wrote ${path}`);
}
if (existsSync(OUT + '.prev')) {
  console.log(`\n  previous indexes kept as *.prev. Prove only the intended fields moved:`);
  console.log(`    node scripts/prove-diff.mjs ${OUT_CORE}.prev ${OUT_CORE} --expect bakedAt,count,total,seen,dropped,shows`);
  console.log(`    node scripts/prove-diff.mjs ${OUT}.prev ${OUT} --expect bakedAt,count,total,seen,dropped,shows`);
}
