/**
 * What each person likes, learned contrastively from what they keep and what
 * they throw away.
 *
 * THE MODEL, AND WHY IT CHANGED
 *
 * The first version summed weights: +3 per feature of a finished show, -3 per
 * feature of a hidden one. That breaks the moment swiping makes hiding cheap.
 * If you like four dramas and hide four dramas, an additive model lands near
 * zero by coincidence and treats "drama" as mildly irrelevant — but it cannot
 * tell that case apart from "drama has never come up". Worse, a feature on 40%
 * of television accumulates weight from sheer frequency.
 *
 * This is a Naive Bayes log-likelihood ratio instead:
 *
 *     score(f) = log( P(f | you liked it) / P(f | you hid it) )
 *
 * with Laplace smoothing. It answers the right question — does this feature
 * DISTINGUISH what you keep from what you throw away — and it has the property
 * the additive model lacked: a feature that appears equally in both scores
 * exactly zero, and says so, because it genuinely tells us nothing about you.
 *
 * Three refinements on top, all of which matter with swipe-rate data:
 *   • recency, because taste drifts and a swipe from March is not a swipe today
 *   • per-feature confidence, so one sighting cannot dominate
 *   • catalogue rarity, so a distinguishing feature that is also rare counts
 *     for more than a distinguishing feature everyone shares
 */
import { regular } from './derive.js';
import { getRepresentation } from '../data/curated.js';

/**
 * How strong a piece of evidence each action is.
 *
 * Swiping made hiding a flick of the thumb, so a hide is no longer the
 * considered act it was when it took two taps. It is still the clearest
 * negative available, but it is weighted below finishing something, which
 * takes hours.
 */
export const SIGNAL = {
  finished: 3,     // you gave it your evenings
  saved: 1.6,      // you meant to
  liked: 1.6,      // swiped right
  started: 0.8,    // you at least pressed play
  hidden: 2.2,     // swiped left, or "not for me"
};

/** Taste drifts. A signal is worth half as much after two months. */
const HALF_LIFE_DAYS = 60;
const recency = (at, now) => {
  if (!at) return 1;
  const days = (now - at) / 86400000;
  return Math.pow(0.5, Math.max(0, days) / HALF_LIFE_DAYS);
};

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
  if (show.language) f.push(`lang:${show.language}`);
  if (show.type && show.type !== 'Scripted') f.push(`kind:${show.type}`);
  const rep = getRepresentation(show.tvmazeId);
  if (rep?.queer) f.push('rep:queer');
  if (rep?.disability) f.push('rep:disability');
  return f;
}

/* ─────────────────────────────────────── catalogue-level feature rarity ── */

let IDF = null;

export function buildIdf(catalogue) {
  const df = new Map();
  for (const show of catalogue) for (const f of featuresOf(show)) df.set(f, (df.get(f) || 0) + 1);
  const N = catalogue.length || 1;
  const idf = new Map();
  for (const [f, n] of df) idf.set(f, Math.min(3.2, Math.max(0.25, Math.log(N / (1 + n)))));
  IDF = idf;
  return idf;
}
export const idfOf = f => IDF?.get(f) ?? 1;
export const idfTable = () => IDF;

/* ──────────────────────────────────────────────────────── the profile ──── */

const LAPLACE = 0.6;

/**
 * Build a taste profile from everything this person has done.
 *
 * @returns {{weights, evidence, counts, sampleSize, pos, neg, split}}
 */
export function buildTaste(profileView, showsByKey, now = Date.now()) {
  // Weighted feature counts, kept separately for liked and hidden so the ratio
  // can be taken. This separation IS the model.
  const likeF = new Map(), hideF = new Map();
  const evidence = {}, against = {};
  let likeTotal = 0, hideTotal = 0;
  const counts = { finished: 0, saved: 0, liked: 0, started: 0, hidden: 0 };

  const record = (show, signal, at) => {
    const w = SIGNAL[signal] * recency(at, now);
    if (!(w > 0)) return;
    counts[signal]++;
    const positive = signal !== 'hidden';
    const bucket = positive ? likeF : hideF;
    if (positive) likeTotal += w; else hideTotal += w;
    for (const f of featuresOf(show)) {
      bucket.set(f, (bucket.get(f) || 0) + w);
      const store = positive ? evidence : against;
      (store[f] ||= []);
      if (!store[f].includes(show.name)) store[f].push(show.name);
    }
  };

  for (const [key, watchedEps] of Object.entries(profileView.watched || {})) {
    const show = showsByKey.get(key);
    if (!show) continue;
    const eps = regular(show.episodes);
    const done = Object.keys(watchedEps).length;
    if (!done) continue;
    const at = Math.max(...Object.values(watchedEps).filter(Number.isFinite), 0) || null;
    if (!eps.length) { record(show, 'started', at); continue; }
    record(show, done / eps.length >= 0.9 ? 'finished' : 'started', at);
  }
  for (const [key, meta] of Object.entries(profileView.saved || {})) {
    const show = showsByKey.get(key);
    if (show) record(show, meta?.viaSwipe ? 'liked' : 'saved', meta?.addedAt);
  }
  for (const [key, at] of Object.entries(profileView.notForMe || {})) {
    const show = showsByKey.get(key);
    if (show) record(show, 'hidden', typeof at === 'number' ? at : null);
  }

  const weights = {};
  const seen = new Set([...likeF.keys(), ...hideF.keys()]);
  for (const f of seen) {
    const l = likeF.get(f) || 0;
    const h = hideF.get(f) || 0;

    // P(feature | liked) over P(feature | hidden), smoothed so a feature
    // absent from one side does not produce an infinity.
    const pLike = (l + LAPLACE) / (likeTotal + 2 * LAPLACE);
    const pHide = (h + LAPLACE) / (hideTotal + 2 * LAPLACE);
    const logOdds = Math.log(pLike / pHide);

    // One sighting is a hint, four is a pattern. Without this a single swipe
    // on an unusual network would outrank everything you have ever finished.
    const support = Math.min(1, (l + h) / 4);

    // A feature that both distinguishes you AND is rare across television is
    // worth more than one that distinguishes you but everyone shares.
    const rarity = 0.55 + Math.min(1, idfOf(f) / 3) * 0.45;

    weights[f] = logOdds * support * rarity * 3;
  }

  // Said out loud in Settings. Not discounted for being common, and not
  // subject to the like/hide ratio, because you asserted it directly.
  for (const [feature, on] of Object.entries(profileView.taste?.explicit || {})) {
    if (!on) continue;
    weights[feature] = (weights[feature] || 0) + 2.4;
    (evidence[feature] ||= []).push('you set this yourself');
  }

  const sampleSize = counts.finished + counts.saved + counts.liked + counts.started + counts.hidden;
  return {
    weights, evidence, against, counts, sampleSize,
    pos: likeTotal, neg: hideTotal,
    // Whether there is enough of BOTH to contrast. All likes and no hides is
    // a much weaker profile than an even split, and the UI should say so.
    split: Math.min(likeTotal, hideTotal) / Math.max(1, likeTotal + hideTotal),
  };
}

/**
 * Score a candidate. Returns matched and opposing features with the shows
 * behind them, never a bare number.
 */
export function scoreShow(show, taste) {
  if (!taste || taste.sampleSize === 0) {
    return { score: 0, matched: [], against: [], confidence: 'none', reason: null, because: [] };
  }
  const matched = [], opposed = [];
  let score = 0;

  for (const f of featuresOf(show)) {
    const w = taste.weights[f];
    if (!w || Math.abs(w) < 0.05) continue;
    score += w;
    (w > 0 ? matched : opposed).push({
      feature: f, weight: w,
      from: (w > 0 ? taste.evidence[f] : taste.against[f]) || [],
    });
  }
  matched.sort((a, b) => b.weight - a.weight);
  opposed.sort((a, b) => a.weight - b.weight);

  const confidence = taste.sampleSize >= 12 && taste.split > 0.15 ? 'good'
                   : taste.sampleSize >= 5 ? 'thin'
                   : 'guessing';

  const because = [...new Set(matched.slice(0, 3).flatMap(m => m.from))].slice(0, 3);
  return {
    score, matched, against: opposed, confidence, because,
    reason: phrase(matched, opposed, because),
  };
}

export function prettyFeature(feature) {
  const [kind, ...rest] = feature.split(':');
  const val = rest.join(':');
  if (kind === 'genre')   return val.toLowerCase();
  if (kind === 'length')  return `${val} episodes`;
  if (kind === 'era')     return val === 'recent' ? 'recent' : `from ${val}`;
  if (kind === 'network') return `on ${val}`;
  if (kind === 'status')  return val === 'ended' ? 'finished' : val;
  if (kind === 'lang')    return `in ${val}`;
  if (kind === 'kind')    return val.toLowerCase();
  if (kind === 'rep')     return val === 'queer' ? 'queer stories' : 'disability representation';
  return val;
}

function phrase(matched, opposed, because) {
  if (!matched.length) {
    if (opposed.length) {
      const names = opposed[0].from.slice(0, 2);
      return `Close to ${prettyFeature(opposed[0].feature)}, which you have passed on` +
             (names.length ? ` — ${names.join(' and ')}` : '');
    }
    return null;
  }
  const top = matched.slice(0, 2).map(m => prettyFeature(m.feature));
  let s = top.join(' and ');
  const names = because.filter(b => b !== 'you set this yourself');
  if (names.length) s += ` — like ${names.slice(0, 2).join(' and ')}`;
  else if (because.length) s += ' — you asked for these';
  if (opposed.length && opposed[0].weight < -0.4) {
    s += `, though you have passed on ${prettyFeature(opposed[0].feature)}`;
  }
  return s;
}

/**
 * What the model currently believes, for the Settings panel. Being able to
 * read your own profile — and see what it has decided it does NOT know — is
 * the difference between a recommender you can correct and one you cannot.
 */
export function explainTaste(taste, limit = 6) {
  const rows = Object.entries(taste.weights || {})
    .filter(([, w]) => Math.abs(w) >= 0.2)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return {
    likes: rows.filter(([, w]) => w > 0).slice(0, limit)
      .map(([f, w]) => ({ feature: f, label: prettyFeature(f), weight: +w.toFixed(2),
                          from: (taste.evidence[f] || []).slice(0, 3) })),
    dislikes: rows.filter(([, w]) => w < 0).slice(0, limit)
      .map(([f, w]) => ({ feature: f, label: prettyFeature(f), weight: +w.toFixed(2),
                          from: (taste.against[f] || []).slice(0, 3) })),
    // Features it has seen on both sides, which is a real finding worth saying.
    neutral: Object.keys(taste.evidence || {})
      .filter(f => (taste.against?.[f]?.length) && Math.abs(taste.weights[f] || 0) < 0.2)
      .slice(0, 4).map(f => ({ feature: f, label: prettyFeature(f) })),
  };
}
