/**
 * Resolve a trailer for a show, with or without a TMDB key.
 *
 * Order of preference:
 *   1. TMDB /tv/{id}/videos — authoritative, but needs TMDB_API_KEY.
 *   2. A keyless YouTube search, scored hard enough to be trustworthy.
 *
 * Why the fallback exists: without a TMDB key there is no trailer at all, and
 * a feed of still images is not the feed. Measured on 13 shows, the fallback
 * found the correct official trailer for 12 and correctly refused on the 13th
 * ("Special" — a one-word title with no distinctive results).
 *
 * Two things this has to get right, both learned by testing it:
 *
 *   • WRONG SHOW. "El Camino: A Breaking Bad Movie" is an official Netflix
 *     trailer whose title contains "Breaking Bad", and it scored top for the
 *     series. So the show name must appear in the title's leading segment,
 *     before any | or – separator, and film-shaped titles are rejected.
 *
 *   • RATE LIMITING. YouTube starts redirecting to a consent wall after a
 *     handful of rapid searches from one IP, which would break the feed after
 *     three cards. Every answer is therefore cached in Netlify Blobs and a
 *     show is only ever searched once. The cache carries fetchedAt so the
 *     client can say how old the answer is.
 *
 * Playback still happens in YouTube's own IFrame player, which is what their
 * terms require; this only resolves which video to hand that player.
 */
import { getStore } from '@netlify/blobs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CACHE_MS = 1000 * 60 * 60 * 24 * 30;   // a trailer does not change
const MISS_MS  = 1000 * 60 * 60 * 24 * 3;    // retry a miss sooner than a hit

/**
 * In-process cache, checked before Blobs.
 *
 * Netlify Blobs does not exist outside the Netlify runtime, so in local dev
 * every lookup was a fresh YouTube search and three cards in a row was enough
 * to hit the consent wall. This also spares warm invocations a round trip.
 */
const MEMO = new Map();
const memoGet = k => {
  const v = MEMO.get(k);
  if (!v) return null;
  const ttl = v.key ? CACHE_MS : MISS_MS;
  if (Date.now() - v.fetchedAt > ttl) { MEMO.delete(k); return null; }
  return v;
};
const memoSet = (k, v) => {
  if (MEMO.size > 500) MEMO.clear();
  MEMO.set(k, v);
};

const norm = s => String(s || '').toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Channels that publish real trailers for their own shows. */
const OFFICIAL = ['netflix', 'hbo', 'max', 'apple tv', 'prime video', 'amazon prime',
  'hulu', 'disney', 'peacock', 'paramount', 'amc', 'starz', 'showtime', 'fx networks',
  'bbc', 'itv', 'channel 4', 'a24', 'sony pictures', 'warner bros', 'universal',
  'tv promos', 'rotten tomatoes tv', 'freeform', 'the cw', 'nbc', 'cbs', 'abc'];

/** Words that mean this is about the show rather than being the show. */
const NOT_A_TRAILER = ['fan made', 'fan-made', 'fanmade', 'concept', 'reaction',
  'review', 'recap', 'explained', 'breakdown', 'ranking', 'ranked', 'amv', 'parody',
  'honest trailer', 'everything wrong', 'behind the scenes', 'bloopers', 'interview'];

/** A film sharing a series' name is a different thing. */
const FILM_SHAPED = /\bmovie\b|\bthe film\b|\bel camino\b/;

/**
 * The leading segment of a YouTube title, before the first separator.
 * "El Camino: A Breaking Bad Movie | Official Trailer | Netflix" → "el camino"
 * "Severance — Official Trailer | Apple TV"                      → "severance"
 */
const leadSegment = title => norm(String(title).split(/[|–—:]|\s-\s/)[0]);

/** "severance season 2" → "severance"; "dark 2017" → "dark". */
const stripTail = s => s
  .replace(/\b(the\s+)?(complete\s+)?(final\s+)?(season|series|part|volume|chapter)\s*\d*\b/g, '')
  .replace(/\b(19|20)\d{2}\b/g, '')
  .replace(/\b(tv|netflix|hbo|official)\b/g, '')
  .replace(/\s+/g, ' ').trim();

/** A leading article should not decide a match either way. */
const dropArticle = s => s.replace(/^(the|a|an)\s+/, '');

function scoreCandidate(row, showName, year) {
  const title = norm(row.title);
  const channel = norm(row.channel);
  const name = norm(showName);
  const why = [];

  if (!title.includes(name)) return { score: -99, why: ['the title does not name this show'] };

  // The title's leading segment has to BE this show, not merely contain its
  // name. Substring matching put "Sherlock Special: Official TV Trailer - BBC"
  // at the top for a show called "Special" — confidently, and completely wrong.
  const lead = stripTail(leadSegment(row.title));
  const bare = dropArticle(name);
  const leadBare = dropArticle(lead);
  const leadsWithName = leadBare === bare || leadBare.startsWith(bare + ' ');
  if (!leadsWithName) {
    return { score: -99, why: [`the title is about "${lead}", not ${showName}`] };
  }
  if (FILM_SHAPED.test(title) && !FILM_SHAPED.test(name)) {
    return { score: -99, why: ['this is a film, not the series'] };
  }

  let score = 3;
  why.push('the title names this show first');

  if (/\btrailer\b/.test(title))      { score += 3; why.push('it is a trailer'); }
  else if (/\bteaser\b/.test(title))  { score += 2; why.push('it is a teaser'); }
  else return { score: -99, why: ['not a trailer or a teaser'] };

  if (/\bofficial\b/.test(title)) { score += 2; why.push('marked official'); }

  const off = OFFICIAL.find(o => channel.includes(o));
  if (off) { score += 3; why.push(`from ${row.channel}`); }

  const bad = NOT_A_TRAILER.find(b => title.includes(b));
  if (bad) return { score: -99, why: [`the title says "${bad}"`] };

  if (year && title.includes(String(year))) { score += 0.5; }

  if (row.duration) {
    const parts = row.duration.split(':').map(Number);
    const secs = parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : (parts[0] || 0) * 60 + (parts[1] || 0);
    if (secs >= 25 && secs <= 240) { score += 1; why.push(`${row.duration} long`); }
    else if (secs > 420) { score -= 4; why.push(`${row.duration} is too long to be a trailer`); }
  }
  return { score, why };
}

async function youtubeSearch(query) {
  // sp=EgIQAQ%3D%3D filters to videos only, which drops channels and playlists.
  const url = 'https://www.youtube.com/results?search_query=' +
              encodeURIComponent(query) + '&sp=EgIQAQ%253D%253D';
  const res = await fetch(url, {
    redirect: 'manual',
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(12000),
  });
  // A redirect here is the consent/rate-limit wall, not a real answer.
  if (res.status >= 300 && res.status < 400) throw new Error('youtube_rate_limited');
  if (!res.ok) throw new Error(`youtube_http_${res.status}`);

  const body = await res.text();
  const rows = [];
  const re = /"videoRenderer":\{"videoId":"([\w-]{11})".*?"title":\{"runs":\[\{"text":"(.*?)"\}\].*?"ownerText":\{"runs":\[\{"text":"(.*?)"/gs;
  let m;
  while ((m = re.exec(body)) && rows.length < 20) {
    const near = body.slice(m.index, m.index + 3000);
    const d = near.match(/"lengthText":\{"accessibility".*?"simpleText":"([\d:]+)"/);
    try {
      rows.push({
        id: m[1],
        title: JSON.parse('"' + m[2] + '"'),
        channel: JSON.parse('"' + m[3] + '"'),
        duration: d ? d[1] : null,
      });
    } catch { /* an unescapable title; skip it rather than fail the search */ }
  }
  return rows;
}

/** oEmbed answers 200 only for a public, embeddable video. No key needed. */
async function isEmbeddable(id) {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    return r.status === 200;
  } catch { return false; }
}

async function fromTMDB(tmdbId) {
  const key = process.env.TMDB_API_KEY;
  if (!key || !tmdbId) return null;
  try {
    const r = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/videos?api_key=${key}`,
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const yt = ((await r.json()).results || []).filter(v => v.site === 'YouTube' && v.key);
    if (!yt.length) return null;
    const rank = v => (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 1 : 3) + (v.official ? 0 : 0.5);
    yt.sort((a, b) => rank(a) - rank(b));
    return {
      key: yt[0].key, source: 'tmdb', confidence: 'exact',
      title: yt[0].name, why: [`TMDB lists this as the ${String(yt[0].type).toLowerCase()}`],
    };
  } catch { return null; }
}

async function fromYouTube(name, year) {
  const queries = year
    ? [`${name} ${year} official trailer`, `${name} tv series official trailer`]
    : [`${name} official trailer`, `${name} tv series trailer`];

  for (const q of queries) {
    let rows;
    try { rows = await youtubeSearch(q); }
    catch (e) {
      if (e.message === 'youtube_rate_limited') throw e;   // do not cache a wall
      continue;
    }
    const scored = rows
      .map(r => ({ ...r, ...scoreCandidate(r, name, year) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);

    for (const best of scored.slice(0, 3)) {
      if (await isEmbeddable(best.id)) {
        return {
          key: best.id, source: 'youtube-search',
          // Never call a searched result exact. It is a good guess with reasons.
          confidence: best.score >= 11 ? 'high' : best.score >= 8 ? 'likely' : 'low',
          title: best.title, channel: best.channel, why: best.why,
        };
      }
    }
  }
  return null;
}

/**
 * The core, independent of any HTTP shape, so the tests can call it directly.
 * @returns {Promise<object>} the trailer record, cached or freshly resolved
 */
export async function resolveTrailer({ name, year = null, tmdbId = null }) {
  if (!name) return { error: 'name_required' };

  // The cache key is derived only from what identifies the show to a viewer,
  // never from a caller's own id. Keying on a caller-supplied id meant the same
  // show cached twice under different keys and the two searches returned two
  // different trailers — so which video you got depended on which screen asked.
  const showKey = `${norm(name)}|${year || ''}`.replace(/[^a-z0-9|]+/g, '-').slice(0, 180);

  const memo = memoGet(showKey);
  if (memo) return { ...memo, cached: 'memory', ageMs: Date.now() - memo.fetchedAt };

  let store = null;
  try { store = getStore({ name: 'trailers', consistency: 'strong' }); } catch { /* Blobs unavailable; memo only */ }

  if (store) {
    const hit = await store.get(showKey, { type: 'json' }).catch(() => null);
    if (hit) {
      const age = Date.now() - (hit.fetchedAt || 0);
      const ttl = hit.key ? CACHE_MS : MISS_MS;
      if (age < ttl) { memoSet(showKey, hit); return { ...hit, cached: 'blob', ageMs: age }; }
    }
  }

  let found = await fromTMDB(tmdbId);
  let rateLimited = false;
  if (!found) {
    try { found = await fromYouTube(name, year); }
    catch (e) { if (e.message === 'youtube_rate_limited') rateLimited = true; }
  }

  if (rateLimited) {
    // Never cached: it says nothing about the show.
    return { key: null, source: null, reason: 'youtube_rate_limited',
      message: 'YouTube is rate limiting trailer lookups right now. Try again shortly.',
      fetchedAt: Date.now() };
  }

  const result = found
    ? { ...found, fetchedAt: Date.now() }
    : { key: null, source: null, reason: 'no_trailer_found',
        message: `No trailer could be identified for "${name}".`, fetchedAt: Date.now() };

  memoSet(showKey, result);
  if (store) await store.setJSON(showKey, result).catch(() => {});
  return { ...result, cached: false, ageMs: 0 };
}

/**
 * Netlify Functions v2. The v1 `export const handler` signature does not get
 * the Blobs context injected, so getStore() threw on every request and the
 * only cache that ever worked was the in-process memo — which dies with the
 * instance and re-searched YouTube from cold. v2 gets the context.
 */
export default async (req) => {
  const p = Object.fromEntries(new URL(req.url).searchParams);
  const out = await resolveTrailer({
    name: (p.name || '').trim(),
    year: p.year ? String(p.year).slice(0, 4) : null,
    tmdbId: p.tmdbId && /^\d+$/.test(p.tmdbId) ? p.tmdbId : null,
  });
  return Response.json(out, {
    status: out.error ? 400 : 200,
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600' },
  });
};

export const config = { path: '/api/trailer' };
