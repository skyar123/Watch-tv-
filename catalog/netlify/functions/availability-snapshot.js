/**
 * Nightly availability snapshot — the engine behind "leaving soon".
 *
 * The app already diffs providers client-side whenever it looks a show up, but
 * that only notices a change if you happen to open the app. A show leaving
 * Netflix on a Tuesday is exactly the thing you want to hear about BEFORE you
 * lose it, so this runs on a schedule whether the app is open or not.
 *
 * Storage is Netlify Blobs. Each run writes one snapshot per show and appends
 * to a change log only when the provider set actually differs, so the log is
 * entirely real transitions with dates on them.
 *
 * Schedule it in netlify.toml:
 *   [functions."availability-snapshot"]
 *     schedule = "0 9 * * *"
 */
import { getStore } from '@netlify/blobs';

const TMDB = 'https://api.themoviedb.org/3';

const names = list => (list || []).map(p => p.provider_name).sort();

export default async (req) => {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    return json(503, { error: 'tmdb_key_missing',
      message: 'Cannot snapshot availability without TMDB_API_KEY.' });
  }

  const store = getStore({ name: 'availability', consistency: 'strong' });
  const watchRaw = await store.get('watchlist', { type: 'json' }).catch(() => null);
  const watchlist = Array.isArray(watchRaw?.shows) ? watchRaw.shows : [];

  // A POST replaces the watchlist. The phone pushes its saved shows here so the
  // job knows what to watch; without that this function has nothing to do.
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); }
    catch { return json(400, { error: 'bad_json' }); }
    const shows = (body.shows || [])
      .filter(s => Number.isFinite(s.tmdbId) && typeof s.name === 'string')
      .slice(0, 300)
      .map(s => ({ tmdbId: s.tmdbId, name: s.name, key: s.key || `tmdb:${s.tmdbId}` }));
    await store.setJSON('watchlist', { shows, updatedAt: Date.now() });
    return json(200, { ok: true, watching: shows.length });
  }

  if (!watchlist.length) {
    return json(200, { ok: true, checked: 0,
      note: 'No watchlist stored yet. POST { shows: [{ tmdbId, name, key }] } first.' });
  }

  const changes = [];
  let checked = 0, failed = 0;

  for (const show of watchlist) {
    try {
      const res = await fetch(`${TMDB}/tv/${show.tmdbId}/watch/providers?api_key=${key}`,
        { signal: AbortSignal.timeout(8000) });
      if (!res.ok) { failed++; continue; }
      const us = (await res.json()).results?.US || {};
      const now = {
        flatrate: names(us.flatrate), ads: names(us.ads), free: names(us.free),
        at: Date.now(),
      };
      checked++;

      const prevKey = `show/${show.key}`;
      const prev = await store.get(prevKey, { type: 'json' }).catch(() => null);
      await store.setJSON(prevKey, now);

      if (!prev) continue;                      // first sighting is not a change
      const lost = prev.flatrate.filter(n => !now.flatrate.includes(n));
      const gained = now.flatrate.filter(n => !prev.flatrate.includes(n));
      if (!lost.length && !gained.length) continue;

      changes.push({
        key: show.key, name: show.name, at: now.at,
        lost, gained, nowOn: now.flatrate,
        // The previous snapshot's date is how long the old state held, which is
        // the difference between "left yesterday" and "left months ago".
        heldSince: prev.at,
      });
    } catch { failed++; }
  }

  if (changes.length) {
    const logRaw = await store.get('changes', { type: 'json' }).catch(() => null);
    const log = Array.isArray(logRaw?.items) ? logRaw.items : [];
    await store.setJSON('changes', {
      items: [...changes, ...log].slice(0, 500), updatedAt: Date.now(),
    });
  }

  return json(200, { ok: true, checked, failed, changed: changes.length, changes });
};

const json = (status, body) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// v2 scheduled function. v1's handler signature does not receive the Blobs
// context this depends on.
// A scheduled function may not also declare a custom `path` — Netlify rejects
// the combination at build time. It stays reachable at its default
// /.netlify/functions/ URL for the manual POST that seeds the watchlist.
export const config = { schedule: '0 9 * * *' };
