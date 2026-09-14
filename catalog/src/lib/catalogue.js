/**
 * The baked catalogue: 27,590 shows instead of the 250 the app used to rank.
 *
 * The old feed fetched /shows?page=0 at runtime — page zero of a 378-page
 * index — so every recommendation was drawn from 0.3% of TVmaze. That is the
 * single biggest reason the feed felt thin, and no amount of clever ranking
 * fixes a candidate pool that small.
 *
 * Two files, because 1.1 MB gzipped is a long stare at an empty screen:
 *   catalogue-core.json   6,000 most popular, 235 kB gzipped — the feed starts
 *   catalogue.json       21,590 more, 860 kB gzipped — arrives behind it
 *
 * Both are content-addressed by the deploy and cached by the service worker,
 * so this is a first-visit cost only.
 */
import { normaliseStatus } from './tvmaze.js';

const IMG = 'https://static.tvmaze.com/uploads/images/medium_portrait/';
const STATUS = { 1: 'Running', 2: 'Ended', 3: 'To Be Determined', 4: 'In Development' };

/** Expand one baked row into the shape the rest of the app already speaks. */
export function hydrate(r) {
  return {
    key: `tvmaze:${r.i}`,
    tvmazeId: r.i,
    name: r.n,
    genres: r.g || [],
    rating: r.r ?? null,
    averageRuntime: r.t ?? null,
    premiered: r.p ? String(r.p) : null,
    ended: r.e ? String(r.e) : null,
    status: normaliseStatus(STATUS[r.s] || 'Unknown'),
    rawStatus: STATUS[r.s] || 'Unknown',
    weight: r.w ?? 0,
    network: r.c || null,
    type: r.y || 'Scripted',            // omitted in the bake when it is Scripted
    language: r.l || 'English',         // omitted when it is English
    poster: IMG + r.m,
    backdrop: null,                     // fetched per show when a card comes into view
    imdbId: r.d || null,
    summary: '',                        // fetched with the full record on demand
    episodes: null,
    isWeb: false,
    schedule: null,
    officialSite: null,
    thetvdbId: null,
    tmdbId: null,
  };
}

async function loadTier(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const doc = await res.json();
  return { shows: doc.shows.map(hydrate), meta: doc };
}

/**
 * Load the core, hand it back immediately, then load the tail and hand back
 * the whole thing. The caller renders twice rather than waiting once.
 *
 * @param {(shows, meta) => void} onTier called with core, then with everything
 */
export async function loadCatalogue(onTier) {
  const core = await loadTier('/catalogue-core.json');
  onTier(core.shows, { ...core.meta, loaded: 'core' });

  try {
    const rest = await loadTier('/catalogue.json');
    const all = core.shows.concat(rest.shows);
    onTier(all, { ...rest.meta, loaded: 'all' });
    return { shows: all, meta: rest.meta };
  } catch (e) {
    // A failed tail is not a failed app: the core is a perfectly good catalogue.
    onTier(core.shows, { ...core.meta, loaded: 'core', tailError: e.message });
    return { shows: core.shows, meta: { ...core.meta, tailError: e.message } };
  }
}

/** Local search over the loaded catalogue — instant, offline, no request. */
export function searchLocal(shows, q, limit = 40) {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const starts = [], contains = [];
  for (const s of shows) {
    const n = s.name.toLowerCase();
    if (n.startsWith(needle)) starts.push(s);
    else if (n.includes(needle)) contains.push(s);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains]
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, limit);
}
