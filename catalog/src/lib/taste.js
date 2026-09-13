/**
 * What each person actually likes, learned from what they do.
 *
 * The rule this file inherits from the rest of the app: a score on its own is
 * worthless. Every weight here can be traced back to specific shows, and
 * `explain()` returns the shows that produced it, so the feed can say
 * "because you saved Dark, Severance and Fringe" rather than "97% match".
 *
 * Signals, strongest to weakest:
 *   finished a show   +3   the strongest thing you can say about taste
 *   saved a show      +2
 *   started a show    +1
 *   hid a show        -3   an explicit no, and it should sting
 *
 * Features are only the ones the data actually has: genre, runtime band, era,
 * network, status, and the hand-checked representation tags.
 */
import { regular } from './derive.js';
import { getRepresentation } from '../data/curated.js';

const SIGNAL = { finished: 3, saved: 2, started: 1, hidden: -3 };

/** Runtime buckets, because "43 minutes" and "45 minutes" are the same taste. */
export function runtimeBand(mins) {
  if (mins == null) return null;
  if (mins <= 20) return 'very short';
  if (mins <= 32) return 'half hour';
  if (mins <= 50) return 'hour-ish';
  return 'long';
}

export function eraBand(premiered) {
  const y = parseInt(String(premiered || '').slice(0, 4), 10);
  if (!y) return null;
  if (y >= 2022) return 'recent';
  if (y >= 2015) return '2015–2021';
  if (y >= 2005) return '2005–2014';
  return 'older';
}

/** The features a single show contributes. */
export function featuresOf(show) {
  const f = [];
  for (const g of show.genres || []) f.push(`genre:${g}`);
  const rb = runtimeBand(show.averageRuntime);
  if (rb) f.push(`length:${rb}`);
  const eb = eraBand(show.premiered);
  if (eb) f.push(`era:${eb}`);
  if (show.network) f.push(`network:${show.network}`);
  if (show.status?.key) f.push(`status:${show.status.key}`);
  const rep = getRepresentation(show.tvmazeId);
  if (rep?.queer) f.push('rep:queer');
  if (rep?.disability) f.push('rep:disability');
  return f;
}

/**
 * Build a taste profile from what this person has done.
 * @returns {{weights:Object, evidence:Object, counts:Object, sampleSize:number}}
 */
export function buildTaste(profileView, showsByKey) {
  const weights = {};      // feature -> score
  const evidence = {};     // feature -> [show names that produced it]
  const counts = { finished: 0, saved: 0, started: 0, hidden: 0 };

  const add = (show, signal) => {
    const w = SIGNAL[signal];
    counts[signal]++;
    for (const f of featuresOf(show)) {
      weights[f] = (weights[f] || 0) + w;
      if (w > 0) {
        (evidence[f] ||= []);
        if (!evidence[f].includes(show.name)) evidence[f].push(show.name);
      }
    }
  };

  for (const [key, watchedEps] of Object.entries(profileView.watched || {})) {
    const show = showsByKey.get(key);
    if (!show) continue;
    const eps = regular(show.episodes);
    const done = Object.keys(watchedEps).length;
    if (!eps.length || !done) continue;
    add(show, done / eps.length >= 0.9 ? 'finished' : 'started');
  }
  for (const key of Object.keys(profileView.saved || {})) {
    const show = showsByKey.get(key);
    if (show) add(show, 'saved');
  }
  for (const key of Object.keys(profileView.notForMe || {})) {
    const show = showsByKey.get(key);
    if (show) add(show, 'hidden');
  }

  // Explicit switches from Settings, weighted as strongly as a finished show
  // because saying it out loud should count for at least as much as doing it.
  for (const [feature, on] of Object.entries(profileView.taste?.explicit || {})) {
    if (!on) continue;
    weights[feature] = (weights[feature] || 0) + 3;
    (evidence[feature] ||= []).push('you set this yourself');
  }

  const sampleSize = counts.finished + counts.saved + counts.started + counts.hidden;
  return { weights, evidence, counts, sampleSize };
}

/**
 * Score a candidate show against a taste profile.
 *
 * Returns the matched features and the shows behind them, never a bare number.
 * Confidence is explicit and honest: below a handful of signals this is
 * guessing, and it says so.
 */
export function scoreShow(show, taste) {
  if (!taste || taste.sampleSize === 0) {
    return { score: 0, matched: [], against: [], confidence: 'none',
             reason: null, because: [] };
  }
  const matched = [];
  const against = [];
  let score = 0;

  for (const f of featuresOf(show)) {
    const w = taste.weights[f];
    if (!w) continue;
    score += w;
    (w > 0 ? matched : against).push({ feature: f, weight: w, from: taste.evidence[f] || [] });
  }
  matched.sort((a, b) => b.weight - a.weight);
  against.sort((a, b) => a.weight - b.weight);

  const confidence = taste.sampleSize >= 12 ? 'good'
                   : taste.sampleSize >= 5  ? 'thin'
                   : 'guessing';

  // The shows that most drove this match, named.
  const because = [...new Set(matched.slice(0, 3).flatMap(m => m.from))].slice(0, 3);

  return { score, matched, against, confidence, because, reason: phrase(matched, against, because) };
}

const LABEL = {
  genre: '', length: '', era: '', network: 'on ', status: '', rep: '',
};

function pretty(feature) {
  const [kind, ...rest] = feature.split(':');
  const val = rest.join(':');
  if (kind === 'genre')   return val.toLowerCase();
  if (kind === 'length')  return `${val} episodes`;
  if (kind === 'era')     return val === 'recent' ? 'recent' : `from ${val}`;
  if (kind === 'network') return `on ${val}`;
  if (kind === 'status')  return val === 'ended' ? 'finished' : val;
  if (kind === 'rep')     return val === 'queer' ? 'queer stories' : 'disability representation';
  return val;
}

function phrase(matched, against, because) {
  if (!matched.length) return null;
  const top = matched.slice(0, 2).map(m => pretty(m.feature));
  let s = `${top.join(' and ')}`;
  if (because.length) {
    const names = because.filter(b => b !== 'you set this yourself');
    if (names.length) {
      s += ` — like ${names.slice(0, 2).join(' and ')}`;
    } else {
      s += ' — you asked for these';
    }
  }
  if (against.length) {
    s += `, though you have passed on ${pretty(against[0].feature)} before`;
  }
  return s;
}

/**
 * Rank a pool for one person. Ordering is taste first, then TVmaze's own
 * popularity as the tiebreak — a cold profile therefore still opens on
 * something worth looking at rather than on nothing.
 */
export function rankForTaste(pool, taste, { seen = {}, notForMe = {} } = {}) {
  const now = Date.now();
  return pool
    .filter(s => !notForMe[s.key])
    .map(show => {
      const t = scoreShow(show, taste);
      const popularity = (show.weight ?? 0) / 100 + (show.rating ?? 0) / 10;
      // Something scrolled past in the last day drops, so the feed moves on.
      const fatigue = seen[show.key] && now - seen[show.key] < 86400000 ? -4 : 0;
      return { show, taste: t, total: t.score * 1.5 + popularity + fatigue };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * Rank for two people at once. A pick has to work for both, and the reason
 * says why for each of them.
 */
export function rankTogether(pool, people, { seen = {}, notForMe = {}, watched = {} } = {}) {
  const now = Date.now();
  return pool
    .filter(s => !notForMe[s.key])
    .map(show => {
      const per = people.map(p => ({ person: p, t: scoreShow(show, p.taste) }));
      const scores = per.map(x => x.t.score);
      const both = per.every(x => x.t.score > 0);
      // The lower of the two matters more than the sum: a show one of you
      // actively dislikes is a bad night even if the other loves it.
      const worst = Math.min(...scores);
      const sum = scores.reduce((a, b) => a + b, 0);
      const alreadySeen = watched[show.key] ? -3 : 0;
      const fatigue = seen[show.key] && now - seen[show.key] < 86400000 ? -3 : 0;
      const popularity = (show.weight ?? 0) / 100 + (show.rating ?? 0) / 10;
      return {
        show, per, both, worst,
        total: worst * 2 + sum * 0.5 + popularity + alreadySeen + fatigue,
        reason: togetherPhrase(per, both),
      };
    })
    .sort((a, b) => b.total - a.total);
}

function togetherPhrase(per, both) {
  const named = per.filter(x => x.t.matched.length);
  if (!named.length) return 'Nothing in either of your histories points at this one yet.';
  if (both && named.length === per.length) {
    const bits = per.map(x => `${x.person.name} likes ${pretty(x.t.matched[0].feature)}`);
    return `${bits.join(', and ')}.`;
  }
  const yes = named[0];
  const quiet = per.filter(x => !x.t.matched.length).map(x => x.person.name);
  const cold = per.filter(x => x.t.against.length).map(x => x.person.name);
  let s = `${yes.person.name} likes ${pretty(yes.t.matched[0].feature)}`;
  if (quiet.length) s += `; nothing in ${quiet.join(' or ')}'s history either way`;
  if (cold.length) {
    s += `; ${cold.join(' and ')} ${cold.length > 1 ? 'have' : 'has'} passed on this kind before`;
  }
  return s + '.';
}

export { pretty as prettyFeature };
