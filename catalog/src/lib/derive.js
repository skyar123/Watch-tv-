/**
 * Everything computed FROM the data, kept in one place so each number on screen
 * can point at the rows it came from.
 *
 * Rule for this file: if the inputs are not there, return null and say why.
 * Never fall back to a plausible-looking number.
 */

/** Specials pad the count and distort ratings. Regular episodes only, by default. */
export const regular = eps => (eps || []).filter(e => e.type === 'regular');

/** Episodes that have actually aired by now. */
export const aired = (eps, now = Date.now()) =>
  (eps || []).filter(e => e.airsAt != null && e.airsAt <= now);

/**
 * Total hours. Prefers the exact sum of per-episode runtimes, because TVmaze
 * actually carries them; falls back to count × averageRuntime and SAYS it did.
 */
export function totalTime(show) {
  const eps = regular(show.episodes);
  if (!eps.length) return null;
  const withRuntime = eps.filter(e => e.runtime > 0);
  if (withRuntime.length === eps.length) {
    const mins = withRuntime.reduce((a, e) => a + e.runtime, 0);
    return { minutes: mins, hours: mins / 60, episodes: eps.length,
             basis: 'exact', note: `${eps.length} episodes, summed runtimes` };
  }
  if (withRuntime.length >= Math.max(3, eps.length * 0.5)) {
    const avg = withRuntime.reduce((a, e) => a + e.runtime, 0) / withRuntime.length;
    const mins = Math.round(avg * eps.length);
    return { minutes: mins, hours: mins / 60, episodes: eps.length, basis: 'partial',
             note: `${eps.length} episodes × ${Math.round(avg)} min average ` +
                   `(${eps.length - withRuntime.length} episodes had no runtime)` };
  }
  if (show.averageRuntime) {
    const mins = show.averageRuntime * eps.length;
    return { minutes: mins, hours: mins / 60, episodes: eps.length, basis: 'estimate',
             note: `${eps.length} episodes × ${show.averageRuntime} min (show average)` };
  }
  return null;
}

export const fmtHours = h =>
  h == null ? null : h < 1 ? `${Math.round(h * 60)} min` : `${h < 10 ? h.toFixed(1) : Math.round(h)} hours`;

/**
 * Per-season rating stats.
 *
 * The normalisation matters: verified spread on a real show was 7.0–8.5 on a
 * 0–10 axis. Drawn against 0–10 every show is a flat line and the sparkline is
 * decoration. So the shape is drawn against the show's OWN min/max, and the
 * real numbers are printed next to it so the scale is never misleading.
 */
export function seasonStats(show) {
  const eps = regular(show.episodes).filter(e => e.rating != null);
  if (eps.length < 3) return null;

  const all = eps.map(e => e.rating);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 0.4) { const mid = (hi + lo) / 2; lo = mid - 0.2; hi = mid + 0.2; }  // avoid a divide-by-nothing flat line

  const bySeason = new Map();
  for (const e of eps) {
    if (!bySeason.has(e.season)) bySeason.set(e.season, []);
    bySeason.get(e.season).push(e);
  }

  const seasons = [...bySeason.entries()].sort((a, b) => a[0] - b[0]).map(([season, list]) => {
    list.sort((a, b) => a.number - b.number);
    const rs = list.map(e => e.rating);
    const avg = rs.reduce((a, b) => a + b, 0) / rs.length;
    return {
      season,
      episodes: list.length,
      avg,
      min: Math.min(...rs),
      max: Math.max(...rs),
      best: list.reduce((a, b) => (b.rating > a.rating ? b : a)),
      worst: list.reduce((a, b) => (b.rating < a.rating ? b : a)),
      points: list.map(e => ({
        n: e.number, rating: e.rating, name: e.name,
        y: (e.rating - lo) / (hi - lo),          // 0..1 within THIS show's range
      })),
    };
  });

  return { seasons, scaleLo: lo, scaleHi: hi, rated: eps.length, total: regular(show.episodes).length };
}

/**
 * "Does it get good, and when." Every claim here names the episodes behind it.
 * Nothing is emitted unless the data supports it.
 */
export function shapeOfShow(show) {
  const stats = seasonStats(show);
  if (!stats) return null;
  const notes = [];
  const s1 = stats.seasons.find(s => s.season === 1);

  // A slow start: several early episodes clearly below the season's own average.
  if (s1 && s1.episodes >= 6) {
    const avg = s1.avg;
    const early = s1.points.slice(0, 3);
    const rest  = s1.points.slice(3);
    if (rest.length >= 3) {
      const eAvg = early.reduce((a, p) => a + p.rating, 0) / early.length;
      const rAvg = rest.reduce((a, p) => a + p.rating, 0) / rest.length;
      if (rAvg - eAvg >= 0.25) {
        // Where it turns: the first episode at or above the season average from
        // which the REST of the season also averages at or above it. Requiring
        // every later episode to stay up instead drags the answer to the end of
        // the season, which is not what "it clicks at episode 4" means.
        const turn = s1.points.find((p, i) => {
          if (p.rating < avg) return false;
          const rest = s1.points.slice(i);
          return rest.reduce((a, q) => a + q.rating, 0) / rest.length >= avg;
        });
        notes.push({
          kind: 'slow-start',
          text: turn ? `Season 1 starts slow and clicks at episode ${turn.n}.`
                     : `Season 1 starts slow and picks up.`,
          detail: `First three episodes average ${eAvg.toFixed(1)}, the rest average ${rAvg.toFixed(1)}.`,
          confidence: rAvg - eAvg >= 0.5 ? 'clear' : 'slight',
        });
      }
    }
  }

  // A fall-off: a season materially below the show's best season.
  if (stats.seasons.length >= 3) {
    const best = stats.seasons.reduce((a, b) => (b.avg > a.avg ? b : a));
    const after = stats.seasons.filter(s => s.season > best.season);
    const drop = after.find(s => best.avg - s.avg >= 0.4);
    if (drop) {
      notes.push({
        kind: 'falls-off',
        text: `Drops off in season ${drop.season}.`,
        detail: `Season ${best.season} averages ${best.avg.toFixed(1)}; ` +
                `season ${drop.season} averages ${drop.avg.toFixed(1)}.`,
        confidence: best.avg - drop.avg >= 0.8 ? 'clear' : 'slight',
      });
    }
    const lastS = stats.seasons[stats.seasons.length - 1];
    if (lastS.avg >= best.avg - 0.1 && stats.seasons.length >= 3) {
      notes.push({
        kind: 'stays-good',
        text: `Holds up — the last season is its best stretch.`,
        detail: `Season ${lastS.season} averages ${lastS.avg.toFixed(1)} against ` +
                `a show average of ${(stats.seasons.reduce((a, s) => a + s.avg, 0) / stats.seasons.length).toFixed(1)}.`,
        confidence: 'clear',
      });
    }
  }
  return { stats, notes };
}

/** The next episode that has not aired yet. */
export function nextEpisode(show, now = Date.now()) {
  const up = (show.episodes || []).filter(e => e.airsAt != null && e.airsAt > now)
                                  .sort((a, b) => a.airsAt - b.airsAt);
  return up[0] || null;
}

/** Where the user is: next unwatched regular episode, in order. */
export function nextUnwatched(show, watchedIds) {
  const eps = regular(show.episodes).slice()
    .sort((a, b) => a.season - b.season || a.number - b.number);
  return eps.find(e => !watchedIds.has(e.id)) || null;
}

export function progress(show, watchedIds, declaredAll = false) {
  const eps = regular(show.episodes);
  if (!eps.length) return declaredAll ? { done: 0, total: 0, pct: 1, declared: true } : null;
  if (declaredAll) return { done: eps.length, total: eps.length, pct: 1, declared: true };
  const done = eps.filter(e => watchedIds.has(e.id)).length;
  return { done, total: eps.length, pct: done / eps.length };
}

/**
 * Cliffhanger risk for a show that stopped.
 *
 * IMPORTANT: no API knows whether a finale resolved. TVmaze has no "cancelled"
 * status at all and no ending-quality field. So this returns a RISK SIGNAL with
 * its reasoning, or `unknown` — it never asserts a cliffhanger it cannot see.
 * A hand-checked verdict from data/endings.js always overrides this.
 */
export function cliffhangerRisk(show, curatedEnding) {
  if (curatedEnding) {
    return { level: curatedEnding.level, confidence: 'checked',
             why: curatedEnding.note, source: `hand-checked, ${curatedEnding.checked}` };
  }
  if (show.status.key === 'running') return null;
  if (show.status.key !== 'ended') return null;

  const eps = regular(show.episodes);
  const seasons = new Set(eps.map(e => e.season)).size;
  const reasons = [];
  let level = 'unknown';

  // One short season then nothing is the classic streaming-axe shape.
  if (seasons === 1 && eps.length <= 10) {
    level = 'elevated';
    reasons.push(`only one season of ${eps.length} episodes`);
  }
  // A finale rated well above the show's average often means a real ending.
  const rated = eps.filter(e => e.rating != null)
                   .sort((a, b) => a.season - b.season || a.number - b.number);
  if (rated.length >= 6) {
    const fin = rated[rated.length - 1];
    const avg = rated.reduce((a, e) => a + e.rating, 0) / rated.length;
    if (fin.rating - avg >= 0.5) {
      level = level === 'elevated' ? 'unclear' : 'lower';
      reasons.push(`the finale rates ${fin.rating.toFixed(1)} against a ${avg.toFixed(1)} average, ` +
                   `which usually means it landed`);
    } else if (avg - fin.rating >= 0.5) {
      level = 'elevated';
      reasons.push(`the finale rates ${fin.rating.toFixed(1)} against a ${avg.toFixed(1)} average`);
    }
  }
  if (!reasons.length) return { level: 'unknown', confidence: 'none',
    why: 'Nothing in the data says how this one ends.', source: 'no signal' };

  return {
    level, confidence: 'inferred',
    why: `Inferred from ${reasons.join('; ')}. No API records whether a finale resolved.`,
    source: 'inferred from episode data',
  };
}
