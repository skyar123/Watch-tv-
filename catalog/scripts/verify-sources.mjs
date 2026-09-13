#!/usr/bin/env node
/**
 * Verify every data source BEFORE trusting it.
 *
 *   node scripts/verify-sources.mjs           # TVmaze + RSS (no keys needed)
 *   TMDB_API_KEY=xxx node scripts/verify-sources.mjs --tmdb
 *
 * This prints REAL sample rows. If a field we planned on is missing, it says
 * MISSING loudly rather than letting a feature get built on an assumption.
 */
const args = new Set(process.argv.slice(2));
const TMDB_KEY = process.env.TMDB_API_KEY || '';
let failures = 0;

const c = { dim: s => `\x1b[2m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m`,
            r: s => `\x1b[31m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`,
            b: s => `\x1b[1m${s}\x1b[0m` };

async function get(url, label) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': 'tv-catalog/verify' } });
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} in ${ms}ms`);
  const json = await res.json();
  console.log(c.dim(`    ← ${res.status} ${ms}ms  ${url.replace(TMDB_KEY, '***')}`));
  return json;
}

/** Assert a field exists on a real payload. Never assume. */
function want(obj, path, note = '') {
  const val = path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  const present = val !== undefined && val !== null &&
                  !(Array.isArray(val) && val.length === 0);
  const show = Array.isArray(val) ? `[${val.length}] ${JSON.stringify(val.slice(0, 3))}`
             : typeof val === 'object' ? JSON.stringify(val).slice(0, 90)
             : JSON.stringify(val);
  if (present) console.log(`    ${c.g('✓')} ${path.padEnd(26)} = ${String(show).slice(0, 88)}`);
  else { failures++; console.log(`    ${c.r('✗ MISSING')} ${path.padEnd(20)} ${c.y(note)}`); }
  return val;
}

async function section(title, fn) {
  console.log(`\n${c.b('━━ ' + title)}`);
  try { await fn(); } catch (e) { failures++; console.log(`    ${c.r('✗ ' + e.message)}`); }
}

// ─────────────────────────────────────────────────────────── TVmaze (no key)
await section('TVmaze /singlesearch/shows — the backbone, needs no key', async () => {
  const s = await get('https://api.tvmaze.com/singlesearch/shows?q=severance', 'tvmaze');
  want(s, 'id'); want(s, 'name'); want(s, 'status', 'drives Running/Ended');
  want(s, 'genres'); want(s, 'premiered'); want(s, 'rating.average');
  want(s, 'externals.imdb'); want(s, 'image.original');
  const rt = s.runtime, art = s.averageRuntime;
  console.log(`    ${rt == null ? c.y('! runtime is null for this show') : c.g('✓ runtime')} ` +
              `runtime=${rt}  averageRuntime=${art}  ` +
              c.y('→ always fall back to averageRuntime, then to episode runtimes'));
  console.log(`    ${c.y('! status vocabulary is')} Running | Ended | To Be Determined | In Development`);
  console.log(`      ${c.y('there is NO "Cancelled" — 1899 and GLOW both report "Ended"')}`);
});

await section('TVmaze /shows/{id}/episodes — per-episode ratings + runtimes', async () => {
  const eps = await get('https://api.tvmaze.com/shows/44933/episodes', 'eps');
  console.log(`    ${c.g('✓')} episodes returned      = ${eps.length}`);
  want(eps[3], 'season'); want(eps[3], 'number'); want(eps[3], 'airstamp');
  want(eps[3], 'runtime'); want(eps[3], 'rating.average', 'the sparkline depends on this');
  const rated = eps.filter(e => e.rating?.average != null).length;
  const mins = eps.reduce((a, e) => a + (e.runtime || 0), 0);
  console.log(`    ${c.g('✓')} rated episodes         = ${rated}/${eps.length}`);
  console.log(`    ${c.g('✓')} summed runtime         = ${mins} min = ${(mins / 60).toFixed(1)} h  ` +
              c.dim('(exact, not episodes×runtime)'));
  const spread = (() => { const r = eps.map(e => e.rating?.average).filter(Boolean);
    return `${Math.min(...r)}–${Math.max(...r)}`; })();
  console.log(`    ${c.y('! rating spread is only')} ${spread} ${c.y('on a 0–10 axis')}`);
  console.log(`      ${c.y('→ sparklines MUST normalise per show or every show looks flat')}`);
});

await section('TVmaze /shows/{id}/images — landscape backdrops without a TMDB key', async () => {
  const imgs = await get('https://api.tvmaze.com/shows/44933/images', 'images');
  const kinds = imgs.reduce((a, i) => (a[i.type] = (a[i.type] || 0) + 1, a), {});
  console.log(`    ${c.g('✓')} image types            = ${JSON.stringify(kinds)}`);
  const bg = imgs.filter(i => i.type === 'background')
                 .sort((a, b) => b.resolutions.original.width - a.resolutions.original.width)[0];
  if (bg) console.log(`    ${c.g('✓')} best background        = ${bg.resolutions.original.width}×` +
                      `${bg.resolutions.original.height}  ` + c.dim('the feed can be full-bleed with no key'));
  else { failures++; console.log(`    ${c.r('✗ no background image')}`); }
});

await section('TVmaze ?embed[] — batch episodes+images into one request', async () => {
  const s = await get('https://api.tvmaze.com/shows/44933?embed[]=episodes&embed[]=images', 'embed');
  want(s, '_embedded.episodes'); want(s, '_embedded.images');
  console.log(`    ${c.dim('→ 1 request instead of 3 per show')}`);
});

await section('TVmaze /schedule/web — what is actually on streaming tonight', async () => {
  const d = new Date().toISOString().slice(0, 10);
  const web = await get(`https://api.tvmaze.com/schedule/web?date=${d}&country=US`, 'web');
  console.log(`    ${c.g('✓')} streaming rows today   = ${web.length}`);
  if (web[0]) {
    const show = web[0]._embedded?.show;
    want(web[0], '_embedded.show.name', 'show is embedded here, not under .show');
    console.log(`    ${c.dim(`e.g. ${show?.name} S${web[0].season}E${web[0].number} on ` +
                `${show?.webChannel?.name || show?.network?.name}`)}`);
  }
  const bc = await get(`https://api.tvmaze.com/schedule?country=US&date=${d}`, 'bc');
  console.log(`    ${c.g('✓')} broadcast rows today   = ${bc.length} ` +
              c.dim('(uses .show, NOT ._embedded.show — different shape!)'));
});

// ─────────────────────────────────────────────────────────────── TMDB (key)
await section('TMDB — needs TMDB_API_KEY', async () => {
  if (!TMDB_KEY) {
    console.log(`    ${c.y('⚠ SKIPPED: no TMDB_API_KEY in the environment.')}`);
    console.log(`    ${c.y('  Nothing in this app claims TMDB data until this passes.')}`);
    console.log(`    ${c.dim('  Get a free key: themoviedb.org → Settings → API')}`);
    console.log(`    ${c.dim('  Then: TMDB_API_KEY=xxx npm run verify:tmdb')}`);
    return;
  }
  const k = `api_key=${TMDB_KEY}`;
  const found = await get(`https://api.themoviedb.org/3/search/tv?${k}&query=severance`, 'search');
  want(found, 'results.0.id'); want(found, 'results.0.backdrop_path', 'the feed background');
  const id = found.results[0].id;

  const tv = await get(`https://api.themoviedb.org/3/tv/${id}?${k}`, 'tv');
  want(tv, 'status', 'TMDB DOES distinguish "Canceled" — TVmaze does not');
  want(tv, 'number_of_episodes'); want(tv, 'episode_run_time'); want(tv, 'seasons');
  want(tv, 'backdrop_path'); want(tv, 'vote_average'); want(tv, 'genres');

  const vids = await get(`https://api.themoviedb.org/3/tv/${id}/videos?${k}`, 'videos');
  const yt = (vids.results || []).filter(v => v.site === 'YouTube');
  const tr = yt.filter(v => v.type === 'Trailer');
  console.log(`    ${yt.length ? c.g('✓') : c.r('✗')} YouTube videos         = ${yt.length} ` +
              `(${tr.length} trailers) ${c.y(yt.length ? '' : '→ this show would fall back to a still')}`);
  if (yt[0]) console.log(`    ${c.dim(`  key=${yt[0].key} type=${yt[0].type} official=${yt[0].official}`)}`);

  const wp = await get(`https://api.themoviedb.org/3/tv/${id}/watch/providers?${k}`, 'providers');
  const us = wp.results?.US;
  if (!us) { failures++; console.log(`    ${c.r('✗ no US providers for this title')}`); }
  else {
    console.log(`    ${c.g('✓')} US flatrate            = ` +
      JSON.stringify((us.flatrate || []).map(p => p.provider_name)));
    console.log(`    ${c.y('! keys present are')} ${Object.keys(us).join(', ')} ` +
      c.y('— "flatrate" is subscription; ads/free/buy/rent are NOT the same thing'));
    console.log(`    ${c.y('! JustWatch attribution is required when showing this')}`);
  }

  const s1 = await get(`https://api.themoviedb.org/3/tv/${id}/season/1?${k}`, 'season');
  want(s1, 'episodes.0.vote_average'); want(s1, 'episodes.0.air_date');

  const cr = await get(`https://api.themoviedb.org/3/tv/${id}/content_ratings?${k}`, 'cr');
  const usr = (cr.results || []).find(r => r.iso_3166_1 === 'US');
  console.log(`    ${usr ? c.g('✓') : c.y('!')} US certificate         = ${usr?.rating ?? 'none'}`);
  console.log(`    ${c.y('! content_ratings gives a CERTIFICATE only — no content descriptors.')}`);
  console.log(`      ${c.y('TMDB has no "contains gore/cruelty" field. Kid-friendly cannot be')}`);
  console.log(`      ${c.y('derived from this API; the app must say "unknown" or use curation.')}`);
});

// ────────────────────────────────────────────────────────────────────── RSS
await section('News RSS feeds', async () => {
  const { FEEDS } = await import('../src/data/feeds.js');
  let ok = 0;
  const rows = await Promise.all(FEEDS.map(async f => {
    try {
      const r = await fetch(f.url, { headers: { 'User-Agent': 'tv-catalog/verify',
        Accept: 'application/rss+xml,application/xml,text/xml,*/*' }, signal: AbortSignal.timeout(20000) });
      const body = await r.text();
      const n = (body.match(/<item[ >]/g) || []).length + (body.match(/<entry[ >]/g) || []).length;
      return { ...f, status: r.status, items: n };
    } catch (e) { return { ...f, status: 'ERR', items: 0, err: e.message }; }
  }));
  for (const r of rows) {
    const good = r.status === 200 && r.items > 0;
    if (good) ok++; else failures++;
    console.log(`    ${good ? c.g('✓') : c.r('✗')} ${r.name.padEnd(16)} ${String(r.status).padEnd(4)} ` +
                `${String(r.items).padStart(3)} items  ${c.dim(r.tag)}${r.err ? c.r(' ' + r.err) : ''}`);
  }
  const q = rows.filter(r => r.tag === 'queer' && r.items > 0).length;
  console.log(`    ${ok}/${rows.length} feeds usable — ${q} of them queer publications`);
});

console.log(`\n${failures ? c.r(`${failures} problem(s) found`) : c.g('all verified')}\n`);
process.exit(failures && args.has('--strict') ? 1 : 0);
