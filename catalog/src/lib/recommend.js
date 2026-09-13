/**
 * Recommendations that say why, out loud, naming the shows they came from.
 *
 * Never a bare score. If the only thing this can say is "7.9", it says nothing
 * instead. Two engines, both explainable:
 *
 *   1. TMDB /recommendations, attributed to the specific show you finished.
 *      "Because you finished Severance" is a fact about your own history.
 *   2. A local overlap engine over genre + network + era, used when TMDB is
 *      unavailable, which names the overlap it found.
 *
 * Confidence is stated because both engines are guesses and should look it.
 */
import { fetchRecommendations } from './tmdb.js';
import { regular, progress } from './derive.js';

/** Shows you actually finished, most recently first. Those are the evidence. */
export function finishedShows(shows, state) {
  const out = [];
  for (const show of shows) {
    const watched = state.watched[show.key];
    if (!watched) continue;
    const p = progress(show, new Set(Object.keys(watched).map(Number)));
    if (!p || p.pct < 0.9) continue;
    const last = Math.max(...Object.values(watched));
    out.push({ show, finishedAt: last, pct: p.pct });
  }
  return out.sort((a, b) => b.finishedAt - a.finishedAt);
}

/** In-progress shows, for "pick up where you left off". */
export function inProgress(shows, state) {
  const out = [];
  for (const show of shows) {
    const watched = state.watched[show.key];
    if (!watched) continue;
    const p = progress(show, new Set(Object.keys(watched).map(Number)));
    if (!p || p.pct === 0 || p.pct >= 0.9) continue;
    out.push({ show, ...p, lastAt: Math.max(...Object.values(watched)) });
  }
  return out.sort((a, b) => b.lastAt - a.lastAt);
}

/**
 * Local, explainable similarity. Returns the overlap it used so the reason can
 * be written from it rather than from a number.
 */
export function explainOverlap(a, b) {
  const genres = (a.genres || []).filter(g => (b.genres || []).includes(g));
  const sameNetwork = a.network && a.network === b.network;
  const eraA = parseInt(a.premiered?.slice(0, 4) || '0', 10);
  const eraB = parseInt(b.premiered?.slice(0, 4) || '0', 10);
  const sameEra = eraA && eraB && Math.abs(eraA - eraB) <= 4;

  let score = genres.length * 2 + (sameNetwork ? 1.5 : 0) + (sameEra ? 0.5 : 0);
  if ((b.rating || 0) >= 7.5) score += 1;
  if (!genres.length) return null;    // no shared genre, no honest claim to make

  const parts = [];
  if (genres.length) parts.push(`both ${genres.slice(0, 2).join(' and ').toLowerCase()}`);
  if (sameNetwork) parts.push(`both on ${a.network}`);
  if (sameEra) parts.push(`from around the same years`);

  return {
    score, genres, sameNetwork, sameEra,
    phrase: parts.join(', '),
    confidence: genres.length >= 2 && (sameNetwork || sameEra) ? 'moderate' : 'low',
  };
}

/**
 * Build the recommendation list.
 * @returns {Promise<Array<{name, poster, backdrop, because, from, confidence, engine, tmdbId?}>>}
 */
export async function recommend({ shows, state, pool, limit = 12 }) {
  const done = finishedShows(shows, state).slice(0, 4);
  const seedNames = new Set(shows.map(s => s.name));
  const results = [];
  const seen = new Set();

  // 1. TMDB, attributed to the show it came from.
  for (const { show } of done) {
    if (!show.tmdbId) continue;
    const rec = await fetchRecommendations(show.tmdbId);
    if (!rec.available) break;                        // no key: fall through to local
    for (const item of rec.items.slice(0, 6)) {
      if (seen.has(item.name) || seedNames.has(item.name)) continue;
      seen.add(item.name);
      results.push({
        name: item.name, poster: item.poster, backdrop: item.backdrop, tmdbId: item.tmdbId,
        overview: item.overview,
        because: `Because you finished ${show.name}.`,
        from: [show.name],
        confidence: 'moderate',
        engine: 'TMDB viewers-also-watched',
        caveat: 'TMDB builds this from what other people watched together, not from ' +
                'anything about the show itself.',
      });
    }
  }

  // 2. Local overlap over the pool we already have loaded.
  if (results.length < limit && pool?.length) {
    const evidence = done.length ? done.map(d => d.show)
                                 : Object.keys(state.saved).map(k => shows.find(s => s.key === k)).filter(Boolean);
    for (const cand of pool) {
      if (results.length >= limit * 2) break;
      if (seen.has(cand.name) || state.notForMe[cand.key] || state.saved[cand.key]) continue;
      let best = null;
      for (const src of evidence) {
        if (src.key === cand.key) continue;
        const ov = explainOverlap(src, cand);
        if (ov && (!best || ov.score > best.ov.score)) best = { src, ov };
      }
      if (!best || best.ov.score < 4) continue;
      seen.add(cand.name);
      const verb = done.some(d => d.show.key === best.src.key) ? 'finished' : 'saved';
      results.push({
        name: cand.name, poster: cand.poster, backdrop: cand.backdrop, show: cand,
        because: `Because you ${verb} ${best.src.name} — ${best.ov.phrase}.`,
        from: [best.src.name],
        confidence: best.ov.confidence,
        engine: 'genre and network overlap',
        caveat: best.ov.confidence === 'low'
          ? 'A thin match: one shared genre and not much else.'
          : 'Matched on what the two shows have in common, not on what anyone thought of them.',
      });
    }
  }

  return results.slice(0, limit);
}
