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
 *
 * THE RECENCY EXEMPTION, and why it had to exist.
 *
 * That rule is a survivorship filter. A rating and a popularity weight are
 * both things a show ACCUMULATES, so the bar is easy for a show that aired in
 * 2008 and nearly impossible for one that aired last month. Sampling TVmaze's
 * newest 2,152 records, 1,158 premiered in the last two years and the rule
 * kept 204 of them, 79 on a service anyone here subscribes to. The feed was
 * not old because TVmaze is old. It was old because the filter quietly
 * required a show to have been around long enough to be voted on.
 *
 * So a show that premiered inside the recency window is judged on a lower
 * popularity bar instead of on a rating it has not had time to earn, or on
 * having an episode still scheduled, which is TVmaze telling us, factually,
 * that it is airing right now. On the same sample that takes recent keeps from
 * 204 to 522 and major-service keeps from 79 to 113, and it is what lets
 * Heartstopper Forever, Long Story Short and Still Water into the index at all.
 *
 * The bar is not zero, because most of what a streamer uploads in a given week
 * is two-minute vertical drama with a weight of 3 and it would bury everything.
 */
const RECENT_MONTHS = 24;
const RECENT_WEIGHT = 40;
const recentCutoff = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - RECENT_MONTHS);
  return d.toISOString().slice(0, 10);
})();

const isRecent = s => Boolean(s.premiered) && s.premiered >= recentCutoff;
const airing = s => Boolean(s._links?.nextepisode);   // an episode is still scheduled

const ADMIT = s => Boolean(s.image?.medium) && (
  s.rating?.average != null ||
  (s.weight ?? 0) >= 60 ||
  (isRecent(s) && ((s.weight ?? 0) >= RECENT_WEIGHT || airing(s)))
);

/**
 * ADMISSION IS SELECTIVE. MEMBERSHIP IS STICKY. Here is why.
 *
 * Re-baking a day after the previous index, with a filter that had only been
 * LOOSENED, dropped 3,469 shows. Rebelde, Whale Wars, Tim and Eric's Bedtime
 * Stories, all previously kept on weight alone, all gone. Checking ten of
 * them against TVmaze directly: Rebelde's weight had gone 90 → 55 overnight,
 * Whale Wars 87 → 58, Sherlock Holmes 83 → 39. 16,719 of the 24,121 shows in
 * both bakes had their weight change in a single day.
 *
 * TVmaze's `weight` is a rolling popularity measure, recomputed against what
 * everyone is looking at this week. It is not a property of the show. Hanging
 * a hard cutoff on it means membership of the catalogue flickers: a show you
 * saved on Tuesday is not in the index on Wednesday, for a reason that has
 * nothing to do with the show. Saved lists break, the ranker cannot see it,
 * and nothing anywhere explains it.
 *
 * So the threshold decides who gets IN, and a show that is already in stays
 * in as long as it still has artwork to put on a card. The index becomes
 * monotone, which is the property a catalogue should have had all along, and
 * weight goes back to being what it is good for: a soft ranking signal, where
 * a thirty-point wobble moves a score a little instead of deleting a show.
 */
const previouslyIn = (() => {
  const ids = new Set();
  for (const f of [OUT_CORE, OUT]) {
    if (!existsSync(f)) continue;
    try { for (const s of JSON.parse(readFileSync(f, 'utf8')).shows) ids.add(s.i); }
    catch { /* an unreadable previous index just means nothing is sticky yet */ }
  }
  return ids;
})();

let stuck = 0;
const KEEP = s => {
  if (ADMIT(s)) return true;
  if (previouslyIn.has(s.id) && s.image?.medium) { stuck++; return true; }
  return false;
};

/** Premiere dates are kept in full for this window; older rows keep the year. */
const dateFieldCutoff = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 3);
  return d.toISOString().slice(0, 10);
})();

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
  // Full premiere date, recent shows only. The year alone cannot tell "out
  // last month" from "out in eleven weeks", and in September of a given year
  // a good part of that year's catalogue has not aired yet. Roughly 3% of
  // rows carry it, so it costs almost nothing on the wire.
  f: s.premiered && s.premiered >= dateFieldCutoff ? s.premiered : undefined,
  // TVmaze still has an episode scheduled for this show: it is airing now.
  a: s._links?.nextepisode ? 1 : undefined,
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
//
// Sorting on popularity alone put every recent show in the tail, because
// weight is accumulated too: the core that loads first would have been a
// museum, and the app would show a back-catalogue feed for the second or two
// before the tail arrives. So the sort key is popularity plus a recency lift
// that fades over three years. It changes which FILE a show lands in and
// nothing else; the ranker still scores every row once both tiers are loaded.
const thisYear = new Date().getFullYear();
const recencyLift = s => {
  const age = thisYear - (s.p ?? 0);
  if (!s.p || age > 3) return 0;
  return [22, 16, 9, 4][Math.max(0, age)] ?? 0;
};
kept.sort((a, b) =>
  ((b.w ?? 0) + recencyLift(b)) - ((a.w ?? 0) + recencyLift(a)) || (b.r ?? 0) - (a.r ?? 0));

const bakedAt = new Date().toISOString();
const meta = {
  version: 2,
  source: 'api.tvmaze.com/shows',
  bakedAt,
  seen,
  // What was deliberately left out, so a missing show is explicable rather
  // than mysterious. Search still queries TVmaze live, so nothing is
  // unreachable — it just is not in the ranking pool.
  filter: `has a poster AND (has a rating OR popularity weight >= 60 OR ` +
          `(premiered since ${recentCutoff} AND (weight >= ${RECENT_WEIGHT} OR still airing)))` +
          `, OR it was in the previous index and still has a poster, because` +
          ` TVmaze's weight moves by 30 points overnight and membership must not`,
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

// Prove the recency exemption did what it was added to do, every time this runs.
const recentKept = kept.filter(s => s.f && s.f >= recentCutoff);
const unrated = recentKept.filter(s => s.r == null);
console.log(`  premiered since ${recentCutoff}: ${recentKept.length} ` +
            `(${unrated.length} of them with no rating yet, the ones the old filter dropped)`);
console.log(`  still airing (an episode is scheduled): ${kept.filter(s => s.a).length}`);
console.log(`  held by the stickiness rule (would fail today's bar, were in the index): ${stuck}`);
const MAJOR = /^(netflix|hbo|hbo max|max|apple tv\+?|disney\+|hulu|prime video|peacock|paramount\+|showtime|starz|fx|amc\+?|bbc (one|two|three|iplayer)|itv1|itvx|channel 4|abc|nbc|cbs|fox|the cw|adult swim|britbox|sky atlantic)$/i;
console.log(`  of those, on a major service: ${recentKept.filter(s => MAJOR.test(s.c || '')).length}`);
console.log(`  recent shows landing in the core tier: ${kept.slice(0, CORE_SIZE).filter(s => s.f && s.f >= recentCutoff).length}`);

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
