/**
 * Tonight — the mood picker.
 *
 * The rule that shapes this whole file: every mood is a PREDICATE OVER REAL
 * FIELDS, and every pick carries the reason it was picked, built from the
 * predicate that actually matched. No vibes, no hidden scoring, no "because
 * we thought you'd like it".
 *
 * Fields available to a predicate (all verified in scripts/verify-sources.mjs):
 *   genres[], averageRuntime, rating, status.key, premiered, episodes[],
 *   totalTime(), seasonStats(), curated representation, curated content.
 */
import { totalTime, regular, nextUnwatched } from './derive.js';
import { getRepresentation } from '../data/curated.js';
import { kidVerdict } from './kidsafe.js';

const has = (show, ...gs) => gs.some(g => (show.genres || []).includes(g));
const runtime = show => show.averageRuntime ?? null;

export const MOODS = [
  {
    id: 'cozy', label: 'Cozy', emoji: '🛋️',
    blurb: 'Short, warm, nothing that will keep you up',
    // Comedy or family, short episodes, and explicitly none of the dark genres.
    test(show) {
      const rt = runtime(show);
      if (!has(show, 'Comedy', 'Family', 'Romance')) return null;
      if (has(show, 'Horror', 'Crime', 'Thriller', 'War')) return null;
      if (rt == null || rt > 40) return null;
      const bits = [`${rt}-minute episodes`, (show.genres || []).slice(0, 2).join(' and ').toLowerCase()];
      if (show.rating >= 7.5) bits.push(`rated ${show.rating.toFixed(1)}`);
      return { score: (show.rating || 6) + (rt <= 25 ? 1 : 0),
               reason: `${bits.join(', ')}, and nothing filed under crime, horror or war.` };
    },
  },
  {
    id: 'story', label: 'A good story', emoji: '📖',
    blurb: 'Finished, well rated, worth the commitment',
    test(show) {
      if (show.status.key !== 'ended') return null;         // a complete story, start to end
      if (!(show.rating >= 7.5)) return null;
      const t = totalTime(show);
      if (!t) return null;
      return { score: show.rating + (t.hours > 20 ? 0.5 : 0),
               reason: `Finished in ${t.episodes} episodes, rated ${show.rating.toFixed(1)}, ` +
                       `so the whole thing exists and it lands.` };
    },
  },
  {
    id: 'queer', label: 'Queer stories', emoji: '🏳️‍🌈',
    blurb: 'Characters and plots, not background detail',
    // Only hand-checked entries. A keyword match cannot tell you a queer
    // character matters to the plot, and this list is worthless if it can't.
    test(show) {
      const rep = getRepresentation(show.tvmazeId);
      if (!rep?.queer) return null;
      return { score: 10 + (show.rating || 0), reason: rep.queer.why };
    },
    emptyNote: 'Only hand-checked shows appear here. No API can tell you whether a queer ' +
               'character matters to the plot or just walks through a scene, so this list is ' +
               'short and honest rather than long and padded.',
  },
  {
    id: 'people', label: 'With people', emoji: '👯',
    blurb: 'Easy to talk over, nobody has to concentrate',
    test(show) {
      const rt = runtime(show);
      if (rt == null || rt > 50) return null;
      if (!has(show, 'Comedy', 'Family', 'Food', 'Travel', 'Sports')
          && show.type !== 'Reality' && show.type !== 'Game Show'
          && show.type !== 'Panel Show' && show.type !== 'Variety') return null;
      if (has(show, 'Horror', 'Thriller')) return null;
      const kind = show.type && show.type !== 'Scripted' ? show.type.toLowerCase()
                 : (show.genres || [])[0]?.toLowerCase() || 'light';
      return { score: (show.rating || 6) + (rt <= 30 ? 1 : 0),
               reason: `${rt}-minute ${kind}, no plot to lose track of if the room is talking.` };
    },
  },
  {
    id: 'beautiful', label: 'Something beautiful', emoji: '🌄',
    blurb: 'To look at, not to follow',
    test(show) {
      if (!has(show, 'Nature', 'Travel', 'Food', 'History', 'Science-Fiction', 'Fantasy')
          && show.type !== 'Documentary') return null;
      if (!show.backdrop) return null;    // it has to actually have artwork to be about looking
      const why = show.type === 'Documentary' || has(show, 'Nature', 'Travel')
        ? `A ${(show.type === 'Documentary' ? 'documentary' : (show.genres || [])[0] || 'travel').toLowerCase()} series — made to be looked at.`
        : `${(show.genres || []).filter(g => ['Science-Fiction', 'Fantasy', 'History'].includes(g)).join(' and ')}, so it is built rather than filmed.`;
      return { score: (show.rating || 6) + 0.5, reason: why };
    },
  },
  {
    id: 'laugh', label: 'Make me laugh', emoji: '😂',
    blurb: 'Comedy, well rated, short',
    test(show) {
      if (!has(show, 'Comedy')) return null;
      const rt = runtime(show);
      if (rt != null && rt > 45) return null;
      if (!(show.rating >= 7)) return null;
      return { score: show.rating + (rt && rt <= 25 ? 1 : 0),
               reason: `Comedy rated ${show.rating.toFixed(1)}${rt ? `, ${rt} minutes an episode` : ''}.` };
    },
  },
  {
    id: '45', label: 'I have 45 minutes', emoji: '⏱️',
    blurb: 'One episode, and it fits',
    // The one mood that is strictly a measurement.
    test(show, ctx) {
      const eps = regular(show.episodes);
      const rt = runtime(show);
      if (rt == null || rt > 45 || rt < 15) return null;
      const next = ctx?.watchedByShow && eps.length
        ? nextUnwatched(show, ctx.watchedByShow(show.key)) : null;
      const started = next && next !== eps[0];
      return {
        score: (show.rating || 6) + (started ? 3 : 0),
        reason: started
          ? `${rt} minutes, and you are already at season ${next.season} episode ${next.number}.`
          : `${rt}-minute episodes — one fits in the time you have.`,
      };
    },
  },
];

export const MOOD_BY_ID = Object.fromEntries(MOODS.map(m => [m.id, m]));

/**
 * Rank candidates for a mood.
 *
 * Ordering rules, applied as visible bonuses so the reason can name them:
 *   +4  already on a service you pay for
 *   +2  already saved to your list
 *   −3  seen in the feed in the last day (stop showing the same thing)
 */
export function pickForMood(moodId, candidates, ctx) {
  const mood = MOOD_BY_ID[moodId];
  if (!mood) return [];
  const out = [];

  for (const show of candidates) {
    if (ctx.notForMe[show.key]) continue;
    const hit = mood.test(show, ctx);
    if (!hit) continue;

    const bonuses = [];
    let score = hit.score;

    const avail = ctx.availabilityFor?.(show);
    if (avail?.known && avail.onMine.length) {
      score += 4;
      bonuses.push(`on ${avail.onMine.map(p => p.canon).join(' and ')}`);
    } else if (avail?.known && !avail.onMine.length && ctx.hideUnavailable) {
      continue;   // you asked not to be shown things you cannot watch
    }

    if (ctx.saved[show.key]) { score += 2; bonuses.push('already in your list'); }

    const seenAt = ctx.seen[show.key];
    if (seenAt && Date.now() - seenAt < 86400000) score -= 3;

    out.push({ show, score, reason: hit.reason, bonuses, mood: mood.id });
  }

  return out.sort((a, b) => b.score - a.score);
}

/** Moods that also want a content check surfaced next to the pick. */
export const wantsKidCheck = moodId => moodId === 'people' || moodId === 'cozy';
export { kidVerdict };
