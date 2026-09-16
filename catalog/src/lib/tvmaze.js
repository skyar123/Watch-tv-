/**
 * TVmaze client. No API key, generous rate limits, and — verified in
 * scripts/verify-sources.mjs — it carries the three things this app leans on
 * hardest: per-episode ratings, per-episode runtimes, and landscape backdrops.
 *
 * Verified shape notes that the code below depends on:
 *   • show.runtime is often null; averageRuntime is the reliable one.
 *   • status is one of Running | Ended | To Be Determined | In Development.
 *     There is NO "Cancelled". See normaliseStatus().
 *   • /schedule uses .show, /schedule/web uses ._embedded.show. Different shape.
 */
import { getJSON } from './api.js';

const BASE = 'https://api.tvmaze.com';

const text = html => (html || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

/**
 * TVmaze cannot tell you a show was cancelled — 1899 and GLOW both report
 * "Ended". So we return what TVmaze actually knows and let the caller layer
 * TMDB's "Canceled" (or a curated note) on top. Never guess here.
 */
export function normaliseStatus(tvmazeStatus) {
  switch (tvmazeStatus) {
    case 'Running':          return { key: 'running', label: 'Running',        tone: 'good' };
    case 'Ended':            return { key: 'ended',   label: 'Ended',          tone: 'neutral' };
    case 'To Be Determined': return { key: 'tbd',     label: 'Unclear',        tone: 'warn' };
    case 'In Development':   return { key: 'dev',     label: 'In development', tone: 'neutral' };
    default:                 return { key: 'unknown', label: tvmazeStatus || 'Unknown', tone: 'neutral' };
  }
}

function bestBackdrop(images = []) {
  const bg = images.filter(i => i.type === 'background' && i.resolutions?.original?.url);
  if (!bg.length) return null;
  // `main` is only ever set on posters in practice, so sort by pixels.
  bg.sort((a, b) => (b.resolutions.original.width || 0) - (a.resolutions.original.width || 0));
  return bg[0].resolutions.original.url;
}

function bestPoster(show, images = []) {
  const p = images.filter(i => i.type === 'poster' && i.resolutions?.original?.url);
  const main = p.find(i => i.main);
  return (main || p[0])?.resolutions.original.url || show.image?.original || show.image?.medium || null;
}

/** Map a raw TVmaze show (optionally with embeds) into the app's shape. */
export function toShow(raw) {
  const images = raw._embedded?.images || [];
  const eps = raw._embedded?.episodes || null;
  const channel = raw.webChannel || raw.network || null;
  return {
    key: `tvmaze:${raw.id}`,
    tvmazeId: raw.id,
    imdbId: raw.externals?.imdb || null,
    thetvdbId: raw.externals?.thetvdb || null,
    tmdbId: null,                       // filled in by the TMDB layer when a key exists
    name: raw.name,
    status: normaliseStatus(raw.status),
    rawStatus: raw.status,
    genres: raw.genres || [],
    type: raw.type || null,
    language: raw.language || null,
    premiered: raw.premiered || null,
    ended: raw.ended || null,
    officialSite: raw.officialSite || null,
    summary: text(raw.summary),
    rating: raw.rating?.average ?? null,
    // runtime is null on plenty of shows; averageRuntime is the dependable one.
    averageRuntime: raw.averageRuntime ?? raw.runtime ?? null,
    network: channel?.name || null,
    isWeb: Boolean(raw.webChannel),
    schedule: raw.schedule || null,
    poster: bestPoster(raw, images),
    backdrop: bestBackdrop(images),
    episodes: eps ? eps.map(toEpisode) : null,
    weight: raw.weight ?? null,
    // TVmaze still has an episode scheduled: the show is on the air right now.
    // The baked index carries the same flag, and enriching a card must not
    // quietly drop it; the ranker reads it either way.
    airing: Boolean(raw._links?.nextepisode),
    updatedAt: raw.updated ? raw.updated * 1000 : null,
  };
}

export function toEpisode(e) {
  return {
    id: e.id,
    name: e.name,
    season: e.season,
    number: e.number,
    type: e.type,                        // 'regular' | 'special' | 'insignificant special'
    airdate: e.airdate || null,
    airstamp: e.airstamp || null,
    airsAt: e.airstamp ? Date.parse(e.airstamp) : null,
    runtime: e.runtime ?? null,
    rating: e.rating?.average ?? null,
    summary: text(e.summary),
    image: e.image?.original || e.image?.medium || null,
  };
}

/** One request for show + episodes + images. Verified: ?embed[] works. */
export async function fetchShow(tvmazeId) {
  const { data, meta } = await getJSON(
    `${BASE}/shows/${tvmazeId}?embed[]=episodes&embed[]=images`);
  return { show: toShow(data), meta };
}

export async function searchShows(q) {
  const { data, meta } = await getJSON(`${BASE}/search/shows?q=${encodeURIComponent(q)}`);
  return { results: data.map(r => ({ score: r.score, show: toShow(r.show) })), meta };
}

/** Popular-ish seeds for the feed. TVmaze `weight` is its own popularity score. */
export async function fetchIndexPage(page = 0) {
  const { data, meta } = await getJSON(`${BASE}/shows?page=${page}`);
  return { shows: data.map(toShow), meta };
}

/**
 * Streaming premieres for a date. Note the shape difference verified in the
 * probe: /schedule/web nests the show under _embedded.show, /schedule does not.
 */
export async function fetchWebSchedule(dateISO, country = 'US') {
  const q = country ? `&country=${country}` : '';
  const { data, meta } = await getJSON(`${BASE}/schedule/web?date=${dateISO}${q}`);
  return {
    rows: data.map(e => ({ episode: toEpisode(e), show: toShow(e._embedded?.show || {}) }))
              .filter(r => r.show.name),
    meta,
  };
}

export async function fetchBroadcastSchedule(dateISO, country = 'US') {
  const { data, meta } = await getJSON(`${BASE}/schedule?country=${country}&date=${dateISO}`);
  return {
    rows: data.map(e => ({ episode: toEpisode(e), show: toShow(e.show || {}) }))
              .filter(r => r.show.name),
    meta,
  };
}
