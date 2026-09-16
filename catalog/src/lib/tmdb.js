/**
 * TMDB, always through /api/tmdb so the key stays on the server.
 *
 * Everything here is OPTIONAL. If TMDB_API_KEY is not set on the deploy the
 * function returns 503 tmdb_key_missing, and every call below resolves to
 * `{ available:false }` rather than throwing. The app then renders what TVmaze
 * knows and says plainly which fields are unavailable. It never renders a
 * confident blank where a trailer or a provider row would have been.
 */
import { getJSON, ApiError } from './api.js';

let keyMissing = false;   // latched after the first 503 so we stop hammering it

export const tmdbAvailable = () => !keyMissing;

async function call(op, params = {}) {
  if (keyMissing) return { available: false, reason: 'tmdb_key_missing' };
  const qs = new URLSearchParams({ op, ...params }).toString();
  try {
    const { data, meta } = await getJSON(`/api/tmdb?${qs}`);
    return { available: true, data, meta };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'tmdb_key_missing') {
      keyMissing = true;
      return { available: false, reason: 'tmdb_key_missing' };
    }
    return { available: false, reason: e.code || 'error', message: e.message };
  }
}

const IMG = 'https://image.tmdb.org/t/p';
export const backdropUrl = p => (p ? `${IMG}/w1280${p}` : null);
export const posterUrl   = p => (p ? `${IMG}/w500${p}` : null);
export const logoUrl     = p => (p ? `${IMG}/w92${p}` : null);

/** Resolve a TVmaze show to a TMDB id, preferring the IMDb id (exact) over a name search. */
export async function resolveId({ imdbId, name, premiered }) {
  // Distinguish "TMDB is not configured" from "TMDB does not have this show".
  // Collapsing the two makes the UI say "looking for a trailer" forever on a
  // deploy that is never going to find one.
  if (keyMissing) return { unavailable: 'tmdb_key_missing' };
  if (imdbId) {
    const r = await call('find', { external_id: imdbId });
    if (r.available) {
      const hit = r.data?.tv_results?.[0];
      if (hit) return { id: hit.id, how: 'imdb', confidence: 'exact', backdrop_path: hit.backdrop_path };
    }
  }
  if (!name) return null;
  const r = await call('search', { q: name });
  if (!r.available) return { unavailable: r.reason };
  const results = r.data?.results || [];
  const year = premiered?.slice(0, 4);
  // Prefer an exact title match in the right year; otherwise take TMDB's top hit
  // but mark the confidence down so the UI can say the match is a guess.
  const exact = results.find(x =>
    x.name?.toLowerCase() === name.toLowerCase() &&
    (!year || x.first_air_date?.slice(0, 4) === year));
  const pick = exact || results[0];
  if (!pick) return null;
  return {
    id: pick.id,
    how: exact ? 'title+year' : 'title',
    confidence: exact ? 'high' : 'low',
    backdrop_path: pick.backdrop_path,
  };
}

/**
 * The trailer for the feed.
 *
 * This goes to /api/trailer rather than straight to TMDB, because the feed has
 * to have trailers whether or not a TMDB key is configured. That function tries
 * TMDB first and falls back to a scored YouTube search, and it tells us which
 * one answered and how confident it is — a searched match is a good guess, not
 * a fact, and the card says so.
 */
export async function fetchTrailer({ name, premiered, tmdbId, key }) {
  const qs = new URLSearchParams({ name });
  if (premiered) qs.set('year', premiered.slice(0, 4));
  if (tmdbId) qs.set('tmdbId', String(tmdbId));
  if (key) qs.set('key', key);
  try {
    const { data, meta } = await getJSON(`/api/trailer?${qs}`);
    return {
      available: true,
      key: data.key || null,
      reason: data.reason || null,
      source: data.source || null,          // 'tmdb' | 'youtube-search'
      confidence: data.confidence || null,  // 'exact' | 'high' | 'likely' | 'low'
      title: data.title || null,
      channel: data.channel || null,
      why: data.why || [],
      cached: Boolean(data.cached),
      ageMs: data.ageMs ?? null,
      meta,
    };
  } catch (e) {
    return { available: false, key: null, reason: e.code || 'trailer_unreachable' };
  }
}

/** Per-country streaming availability. Powered by JustWatch; attribution required. */
export async function fetchProviders(tmdbId, country = 'US') {
  const r = await call('providers', { id: tmdbId });
  if (!r.available) return { available: false, reason: r.reason };
  const c = r.data?.results?.[country];
  if (!c) return { available: true, country, none: true, link: null,
                   flatrate: [], ads: [], free: [], buy: [], rent: [] };
  const map = list => (list || []).map(p => ({
    id: p.provider_id, name: p.provider_name, logo: logoUrl(p.logo_path), order: p.display_priority,
  }));
  return {
    available: true, country, link: c.link || null,
    // These are NOT interchangeable. "flatrate" is what a subscription covers;
    // buy/rent cost money on top and must never be shown as if included.
    flatrate: map(c.flatrate), ads: map(c.ads), free: map(c.free),
    buy: map(c.buy), rent: map(c.rent),
    fetchedAt: r.data?._fetchedAt || Date.now(),
  };
}

/** TMDB does distinguish Canceled, which TVmaze cannot. That is the point of this call. */
export async function fetchShowExtra(tmdbId) {
  const r = await call('show', { id: tmdbId });
  if (!r.available) return { available: false, reason: r.reason };
  const d = r.data;
  return {
    available: true,
    status: d.status || null,                    // Returning Series | Ended | Canceled | ...
    canceled: d.status === 'Canceled',
    inProduction: d.in_production ?? null,
    backdrop: backdropUrl(d.backdrop_path),
    poster: posterUrl(d.poster_path),
    tagline: d.tagline || null,
    overview: d.overview || null,
    voteAverage: d.vote_average ?? null,
    voteCount: d.vote_count ?? null,
    episodeCount: d.number_of_episodes ?? null,
    seasonCount: d.number_of_seasons ?? null,
    episodeRunTime: d.episode_run_time || [],
    genres: (d.genres || []).map(g => g.name),
    keywords: (d.keywords?.results || d.keywords?.keywords || []).map(k => k.name),
    // A certificate, NOT a content descriptor. Deliberately not used for the
    // kid-friendly judgement — see lib/kidsafe.js for why.
    usCertificate: (d.content_ratings?.results || []).find(x => x.iso_3166_1 === 'US')?.rating || null,
    networks: (d.networks || []).map(n => n.name),
    fetchedAt: d._fetchedAt || Date.now(),
  };
}

export async function fetchRecommendations(tmdbId) {
  const r = await call('recommend', { id: tmdbId });
  if (!r.available) return { available: false, reason: r.reason };
  return {
    available: true,
    items: (r.data?.results || []).map(x => ({
      tmdbId: x.id, name: x.name, backdrop: backdropUrl(x.backdrop_path),
      poster: posterUrl(x.poster_path), vote: x.vote_average, firstAir: x.first_air_date,
      overview: x.overview,
    })),
  };
}
