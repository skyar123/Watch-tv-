/**
 * The ranking algorithm.
 *
 * WHAT THIS OPTIMISES, AND WHY IT DIFFERS FROM NETFLIX
 *
 * Netflix's recommender optimises engagement: the probability you press play
 * and keep the subscription. That objective is well served by hiding things.
 * It will not tell you a show was cancelled on a cliffhanger, because that
 * suppresses starts. It will not tell you the total commitment is sixty hours.
 * It will not say season five is bad. It cannot recommend anything off its own
 * platform. And "Because you watched X" is written after the fact, not the
 * reason the model chose it.
 *
 * This optimises something else: EXPECTED SATISFACTION MINUS REGRET, for a
 * decision made once, tonight. It is allowed to talk you out of things. Every
 * term below is computed from data that was verified to exist, carries its own
 * sentence, and is visible in the app — the detail sheet shows the arithmetic
 * rather than a match percentage.
 *
 * Where it genuinely beats Netflix:
 *   • it states the real reason, and the reason is the cause, not a caption
 *   • it prices the commitment against how long a show you actually finish
 *   • it warns about unresolved endings and shows that fall off
 *   • it optimises for two people at once, not two profiles that never meet
 *   • its exploration is declared instead of hidden
 *
 * Where it does not, and cannot:
 *   • Netflix has co-watch signal from hundreds of millions of accounts. This
 *     has two. Collaborative filtering is not available here, so authorship
 *     kinship stands in for it — weaker on breadth, stronger on explanation.
 */
import { scoreShow as tasteScore } from './taste.js';
import { kinshipReason } from './kinship.js';
import { totalTime, regular, cliffhangerRisk, shapeOfShow } from './derive.js';
import { getEnding } from '../data/curated.js';
import { sessionPenalty } from './session.js';
import { featuresOf, prettyFeature } from './taste.js';

/* ─────────────────────────────────────────────────────── commitment ───── */

/**
 * How many hours a show asks for.
 *
 * Exact when the episodes are loaded; otherwise estimated from how long it ran
 * and how long an episode is. The estimate is coarse and always labelled — a
 * confident wrong number here would push you into a sixty-hour show.
 */
export function estimateHours(show, now = Date.now()) {
  const exact = totalTime(show);
  if (exact) return { hours: exact.hours, basis: exact.basis, note: exact.note };

  const rt = show.averageRuntime;
  if (!rt || !show.premiered) return null;

  const start = +String(show.premiered).slice(0, 4);
  const end = show.ended ? +String(show.ended).slice(0, 4) : new Date(now).getFullYear();
  const years = Math.max(1, end - start + 1);

  // Episode order per year, by format. A 22-minute network comedy runs 20+ a
  // season; a 60-minute prestige drama runs 8-10.
  const perYear = rt <= 30 ? 18 : rt <= 45 ? 13 : 9;
  const episodes = Math.round(years * perYear);
  return {
    hours: (episodes * rt) / 60,
    basis: 'rough',
    note: `roughly ${episodes} episodes over ${years} year${years > 1 ? 's' : ''} at ${rt} min — ` +
          `an estimate, not a count`,
  };
}

/* ──────────────────────────────────────────────────────── recency ───── */

/**
 * How old a show is, in months, and whether it has even aired yet.
 *
 * The baked index carries a full premiere date for anything recent and only a
 * year for the back catalogue, so an unknown month is read as the middle of
 * its year: that is off by at most six months on a show whose exact age has
 * stopped mattering, and it never invents precision it does not have.
 */
export function ageOf(show, now = Date.now()) {
  const p = show.premiered;
  if (!p) return null;
  const exact = /^\d{4}-\d{2}/.test(String(p));
  const t = exact ? Date.parse(p) : Date.parse(`${String(p).slice(0, 4)}-07-01`);
  if (Number.isNaN(t)) return null;
  const months = (now - t) / (1000 * 60 * 60 * 24 * 30.44);
  return { months, exact, unaired: months < 0, date: p };
}

/** Month name for a date we actually have to the day. */
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const whenItLands = iso => {
  const d = new Date(iso);
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return MONTHS[d.getUTCMonth()] + (sameYear ? '' : ` ${d.getUTCFullYear()}`);
};

/**
 * How long a show this person actually finishes.
 *
 * Netflix knows this about you and does not say. If you finish eight-hour
 * shows and abandon forty-hour ones, a forty-hour recommendation is a bad
 * recommendation no matter how well it matches your genres.
 */
export function appetiteOf(profileView, showsByKey) {
  const finished = [], abandoned = [];
  for (const [key, eps] of Object.entries(profileView.watched || {})) {
    const show = showsByKey.get(key);
    if (!show) continue;
    const all = regular(show.episodes);
    if (!all.length) continue;
    const done = Object.keys(eps).length;
    const t = estimateHours(show);
    if (!t) continue;
    (done / all.length >= 0.9 ? finished : abandoned).push(t.hours);
  }
  if (finished.length < 2) {
    return { known: false, comfortable: null, finished: finished.length,
             note: 'Not enough finished shows to know how long a series you actually see through.' };
  }
  const sorted = finished.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const longest = Math.max(...finished);
  const bailedAt = abandoned.length ? Math.min(...abandoned) : null;
  return {
    known: true,
    comfortable: longest,
    median,
    bailedAt,
    finished: finished.length,
    note: `You have finished ${finished.length} shows, the longest ${Math.round(longest)} hours` +
          (bailedAt ? `, and dropped one at ${Math.round(bailedAt)} hours` : ''),
  };
}

/* ────────────────────────────────────────────────────────── scoring ───── */

const term = (name, value, why) => (value ? { name, value: +value.toFixed(2), why } : null);

/**
 * Score one show. Returns every term so the app can show the arithmetic.
 *
 * @returns {{total:number, terms:Array, reason:string|null, warnings:Array, confidence:string}}
 */
export function scoreCandidate(show, ctx) {
  const terms = [];
  const warnings = [];

  // 0. You have already seen this.
  //
  //    Without this, the top of the feed was the shows you just finished:
  //    they match your taste perfectly, because your taste was learned FROM
  //    them. A recommender that recommends what you have watched is a mirror.
  const watchedEps = ctx.watched?.[show.key];
  if (watchedEps) {
    const done = Object.keys(watchedEps).length;
    const total = regular(show.episodes).length;
    const finished = total ? done / total >= 0.9 : done > 4;
    if (finished) {
      return { total: -Infinity, terms: [], reason: null, warnings: [], confidence: 'n/a',
               excluded: 'already finished' };
    }
    terms.push(term('in progress', 2, `you are ${done} episodes in`));
  }

  // 1. Taste — learned from saves, finishes and hides.
  //
  //    Saturated on purpose. The raw score is a sum over matching features, so
  //    a show sharing eight features with your history scored +54 while every
  //    other term in this function is worth single digits — taste drowned out
  //    availability, commitment and the ending warnings entirely. tanh keeps a
  //    strong match strong without letting it be the only thing that matters.
  const t = tasteScore(show, ctx.taste);
  if (t.score) {
    terms.push(term('taste', 6 * Math.tanh(t.score / 18), t.reason));
  }

  // 2. Kinship — the people behind what you finished made this too.
  const kin = ctx.kinship?.get(show.tvmazeId);
  if (kin) terms.push(term('made by', Math.min(kin.score, 8) * 1.2, kinshipReason(kin)));

  // 3. Quality — a rating, shrunk toward the mean by how little is known.
  //
  //    TVmaze gives no vote count, so a 9.5 from a handful of people looks
  //    identical to an 8.5 from thousands. Untreated, the top of the feed
  //    filled with obscure highly-rated oddities. `weight` is TVmaze's own
  //    popularity measure and stands in for sample size: a rating on a
  //    weight-5 show is pulled most of the way back to the 7.0 median, while a
  //    rating on a weight-95 show is left almost alone.
  if (show.rating != null) {
    const PRIOR = 7.0, K = 25;
    const w = show.weight ?? 0;
    const shrunk = (w * show.rating + K * PRIOR) / (w + K);
    const value = (shrunk - PRIOR) * 1.6;
    terms.push(term('rated', value,
      w >= 40
        ? `rated ${show.rating.toFixed(1)} on TVmaze`
        : `rated ${show.rating.toFixed(1)}, but by few enough people to be uncertain`));
  } else {
    // 3b. Nobody has rated it.
    //
    //     This was silently free, and that is how adding a recency bonus put
    //     "Nation's Dumbest" above Breaking Bad on a cold start. A rating of
    //     8.8 is worth +2.9 here and a rating of 5.5 is worth a penalty, but
    //     NO rating scored zero, so an unrated show collected the recency
    //     bonus with nothing on the other side of the ledger, and 85 of the
    //     top 100 became unrated 2026 premieres.
    //
    //     Unknown is not the same as average, and for an app whose objective
    //     is satisfaction minus REGRET it is the more expensive of the two.
    //     Only 36% of the index has a rating at all; the rest is a gamble, and
    //     the card says so instead of quietly pricing it as a sure thing.
    terms.push(term('unproven', -1.4, 'nobody has rated it yet'));
  }
  if (show.episodes) {
    const shape = shapeOfShow(show);
    const falls = shape?.notes.find(n => n.kind === 'falls-off');
    const holds = shape?.notes.find(n => n.kind === 'stays-good');
    if (falls) { terms.push(term('falls off', -2, falls.text)); warnings.push(falls.text); }
    if (holds) terms.push(term('holds up', 1.5, holds.text));
  }

  // 4. Availability — worth a lot, because a show you cannot watch is not a
  //    recommendation. Netflix only ever shows you its own catalogue; this
  //    knows about all your services and says which one.
  const avail = ctx.availabilityFor?.(show);
  if (avail?.known) {
    if (avail.onMine.length) {
      terms.push(term('on your services', 4,
        `on ${avail.onMine.map(p => p.canon).join(' and ')}`));
    } else {
      terms.push(term('not on your services', -5, 'not on anything you subscribe to'));
      warnings.push('You cannot stream this on your services.');
    }
  }

  // 5. Commitment — priced against what you actually finish.
  const hours = estimateHours(show);
  if (hours && ctx.appetite?.known) {
    const over = hours.hours / Math.max(4, ctx.appetite.comfortable);
    if (over > 1.4) {
      const penalty = -Math.min(4, (over - 1) * 2.2);
      terms.push(term('long', penalty,
        `about ${Math.round(hours.hours)} hours, and the longest you have finished is ` +
        `${Math.round(ctx.appetite.comfortable)}`));
      if (over > 2.5) warnings.push(`${Math.round(hours.hours)} hours is well past anything you have finished.`);
    } else if (hours.hours <= ctx.appetite.comfortable) {
      terms.push(term('fits', 0.8, `about ${Math.round(hours.hours)} hours, within your range`));
    }
  }

  // 6. Regret — the thing an engagement objective would never surface.
  const ending = cliffhangerRisk(show, getEnding(show.tvmazeId));
  if (ending && (ending.level === 'cliffhanger' || ending.level === 'elevated')) {
    const checked = ending.confidence === 'checked';
    terms.push(term('unresolved ending', checked ? -3.5 : -1.5,
      checked ? 'it ends unresolved — hand-checked' : 'the ending may not land'));
    warnings.push(ending.why);
  }

  // 6b. Mood, as distinct from taste. A run of hides right now outweighs a
  //     general preference, and it is deliberately not learned — see
  //     lib/session.js for why an evening's mood must not become a profile.
  const mood = sessionPenalty(featuresOf(show));
  if (mood) {
    terms.push(term('not tonight', mood.penalty,
      `${prettyFeature(mood.feature)} — ${mood.why}`));
  }

  // 7. Fatigue — you have scrolled past this recently.
  if (ctx.seen?.[show.key] && Date.now() - ctx.seen[show.key] < 86400000) {
    terms.push(term('seen recently', -3.5, 'you scrolled past this today'));
  }

  // 7b. Recency.
  //
  //     There was no term here at all, and the omission was not neutral: every
  //     other quality signal in this function is something a show ACCUMULATES.
  //     A rating needs voters, a popularity weight needs viewers, kinship needs
  //     a body of work. A show released three weeks ago has had no time to earn
  //     any of them, so a scoring function built only from those terms will
  //     rank 2008 above 2026 forever, and a cold feed came out 49% pre-2010.
  //     "What is on now" is a real reason to watch something, and it was the
  //     one reason the model could not express.
  //
  //     Two honest limits on it. It decays to nothing over three years, so it
  //     is a tilt and not a sort. And a show that has not aired yet gets the
  //     opposite of a bonus, because "premieres in eleven weeks" is not an
  //     answer to what to watch tonight. The index carries those, and without
  //     this they would have ridden the recency bonus straight to the top.
  const age = ageOf(show, ctx.now);
  if (age?.unaired) {
    terms.push(term('not out yet', -7,
      age.exact ? `it does not premiere until ${whenItLands(age.date)}`
                : `it has not aired yet`));
    warnings.push(age.exact
      ? `Not out yet: it premieres ${whenItLands(age.date)}.`
      : `This has not aired yet.`);
  } else if (age) {
    // 2.2 at release, half of that by ten months, gone by three years. It is
    // deliberately smaller than the quality terms: recency is a tilt, not a
    // sort, and at 3.5 it WAS a sort. See the unproven term above.
    const lift = 2.2 * Math.exp(-age.months / 14);
    if (lift > 0.25) {
      const m = age.months;
      terms.push(term('new', lift,
        !age.exact ? `new this year`
        : m < 1.5 ? 'out in the last few weeks'
        : m < 7   ? `new, out ${whenItLands(age.date)}`
        : `fairly new, from ${new Date(age.date).getUTCFullYear()}`));
    }
  }

  // 7c. On the air right now. TVmaze has an episode still scheduled for it,
  //     which is a fact rather than an inference. Worth saying out loud in
  //     both directions: it is current, and it is not bingeable yet.
  if (show.airing && !age?.unaired) {
    terms.push(term('on the air', 0.8, 'new episodes are airing now'));
  }

  // 8. Popularity, as a PRIOR that decays.
  //
  //    With no history there is nothing to say about you, so the best available
  //    guess is what people broadly love — and as a weak tiebreak that was not
  //    enough: a cold feed opened on an HGTV Christmas special rated 9.5 ahead
  //    of Breaking Bad, because the rating term outweighed being one of the
  //    most-watched shows on television.
  //
  //    So popularity starts strong and recedes as evidence about you arrives.
  //    By a dozen signals it is back to a tiebreak and your taste decides.
  const evidence = ctx.taste?.sampleSize ?? 0;
  const priorWeight = 6 / (1 + evidence / 3);
  terms.push(term('popular', ((show.weight ?? 0) / 100) * priorWeight,
    evidence === 0 && (show.weight ?? 0) >= 90
      ? 'one of the most watched shows on TVmaze — shown while it learns you'
      : null));

  const kept = terms.filter(Boolean);
  const total = kept.reduce((a, x) => a + x.value, 0);

  return {
    total,
    terms: kept.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    reason: headline(kept),
    warnings,
    confidence: ctx.taste?.sampleSize >= 12 ? 'good'
              : ctx.taste?.sampleSize >= 5 ? 'thin' : 'guessing',
  };
}

/** One sentence, built from the terms that actually moved the number. */
function headline(terms) {
  const positive = terms.filter(t => t.value > 0.5 && t.why);
  if (!positive.length) return null;
  const lead = positive[0].why;
  const second = positive[1]?.why;
  // Two clauses maximum. A card is not a report.
  return second && second !== lead ? `${lead}, and ${second}` : lead;
}

/* ───────────────────────────────────────────────────────── ordering ───── */

/**
 * Rank the catalogue for one person.
 *
 * Exploration is deliberate and declared. A recommender that only ever shows
 * you the argmax collapses onto a narrow band of what you already liked, and
 * you stop finding anything. One slot in seven is given to a strong show the
 * model is NOT confident about, and the card says so out loud rather than
 * pretending it was a match.
 */
/**
 * `curated` is how far down the list the careful interleaving applies, NOT how
 * much of the catalogue you get. It used to be both, and that was the bug:
 * `limit = 400` meant the app was handed 457 rows out of 32,138 and the other
 * 31,681 could not be reached by any amount of scrolling. Measured per service,
 * you could get to 11 of 206 Apple TV shows, 4 of 215 on HBO Max, 1 of 155 on
 * Peacock and none at all of AMC+.
 *
 * Everything is now returned in rank order. The top `curated` slots keep the
 * exploration interleave, because that is where the ordering is worth thinking
 * about, and the tail follows in plain descending score. Scoring already ran
 * over every candidate, so this costs a slice rather than any more work.
 */
export function rankCatalogue(candidates, ctx, { curated = 400, exploreEvery = 7 } = {}) {
  const scored = [];
  for (const show of candidates) {
    if (ctx.notForMe?.[show.key]) continue;
    if (ctx.hideUnavailable) {
      const a = ctx.availabilityFor?.(show);
      if (a?.known && !a.onMine.length) continue;
    }
    const s = scoreCandidate(show, ctx);
    // A finished show scores -Infinity rather than being filtered inside
    // scoreCandidate, so it has to be dropped here too — otherwise it fell
    // through to the exploration pool and came back as "a stretch".
    if (s.excluded) continue;
    scored.push({ show, ...s });
  }
  scored.sort((a, b) => b.total - a.total);

  const head = scored.slice(0, curated);
  const tail = scored.slice(curated);
  // Candidates that are good on their own merits but that the taste model has
  // nothing to say about — the honest definition of "a stretch".
  const unknown = tail
    .filter(s =>
      !s.terms.some(t => t.name === 'taste') &&
      (s.show.rating ?? 0) >= 7.6 &&
      // Popular enough that the rating means something — see the shrinkage
      // note above. Without this the stretch slot offered a Russian cartoon.
      (s.show.weight ?? 0) >= 60 &&
      // A stretch still has to be watchable by this person: exploration is not
      // a licence to ignore the language they speak.
      (!ctx.languages?.size || ctx.languages.has(s.show.language)) &&
      // And it is still a recommendation. Offering a 218-hour show to someone
      // whose longest finish is twelve is not adventurous, it is useless, and
      // the first version did exactly that.
      !s.warnings.length)
    .sort((a, b) => (b.show.rating ?? 0) - (a.show.rating ?? 0));

  if (!unknown.length) return head.concat(tail);

  const out = [];
  const promoted = new Set();
  let u = 0;
  for (let i = 0; i < head.length; i++) {
    out.push(head[i]);
    if ((i + 1) % exploreEvery === 0 && u < unknown.length) {
      const pick = unknown[u++];
      promoted.add(pick.show.key);
      out.push({
        ...pick,
        explore: true,
        reason: `A stretch: nothing in your history points here, but it is rated ` +
                `${pick.show.rating.toFixed(1)}`,
      });
    }
  }
  // The rest of the catalogue, in rank order, minus the ones already pulled up
  // into an exploration slot. Without that subtraction a stretch pick appeared
  // twice and React had two children with the same key.
  for (const s of tail) if (!promoted.has(s.show.key)) out.push(s);
  return out;
}

/**
 * Rank for two people at once.
 *
 * The objective is the WORST of the two scores, not the sum. A show one of you
 * actively dislikes makes for a bad evening even if the other adores it, and
 * summing hides exactly that. Netflix has profiles; it does not have this.
 */
export function rankTogetherCatalogue(candidates, people, ctx, { limit = Infinity } = {}) {
  const common = commonGround(people);
  const scored = [];
  for (const show of candidates) {
    if (ctx.notForMe?.[show.key]) continue;
    const per = people.map(p => ({
      person: p,
      s: scoreCandidate(show, { ...ctx, taste: p.taste, kinship: p.kinship, appetite: p.appetite }),
    }));
    if (per.some(x => x.s.excluded)) continue;   // one of you has finished it
    const scores = per.map(x => x.s.total);
    const worst = Math.min(...scores);
    const spread = Math.max(...scores) - worst;

    // Shared ground is worth more than the sum of two separate enthusiasms:
    // a thing you BOTH already like is the actual answer to "what do we watch".
    const feats = featuresOf(show);
    const agree = feats.filter(f => common.agreed.has(f));
    const clash = feats.filter(f => common.contested.has(f));

    scored.push({
      show, per,
      terms: [
        ...per.flatMap(x => x.s.terms.map(t => ({ ...t, person: x.person.name }))),
        ...(agree.length ? [{ name: 'you both like', value: +(agree.length * 1.8).toFixed(2),
          why: `${agree.slice(0, 2).map(prettyFeature).join(' and ')} — you both do` }] : []),
        ...(clash.length ? [{ name: 'you disagree', value: -(clash.length * 1.5).toFixed(2),
          why: `${clash.slice(0, 2).map(prettyFeature).join(' and ')} — one of you likes this, the other does not` }] : []),
      ],
      // Weighted to whoever wants it least, and penalised when you are far
      // apart, because "one of us will be bored" is the real failure mode.
      total: worst * 2 + scores.reduce((a, b) => a + b, 0) * 0.4 - spread * 0.3
             + agree.length * 1.8 - clash.length * 1.5,
      warnings: [...new Set(per.flatMap(x => x.s.warnings))],
      agree: agree.map(prettyFeature),
      clash: clash.map(prettyFeature),
      reason: togetherHeadline(per, agree, clash),
      confidence: per.every(x => x.s.confidence === 'good') ? 'good'
                : per.some(x => x.s.confidence === 'guessing') ? 'guessing' : 'thin',
    });
  }
  // Everything, in rank order. The 400-row cap that used to be here made most
  // of the catalogue unreachable for two people just as it did for one.
  scored.sort((a, b) => b.total - a.total);
  return Number.isFinite(limit) ? scored.slice(0, limit) : scored;
}

/**
 * Where two people's tastes meet, and where they collide.
 *
 * This is the thing Netflix has no concept of. It has profiles, and profiles
 * never speak to each other; there is no model of a household, so there is no
 * way to say "you disagree about horror". Knowing that is more useful than any
 * single recommendation, because it explains the evenings that go wrong.
 */
export function commonGround(people, threshold = 0.5) {
  const agreed = new Set(), contested = new Set();
  if (people.length < 2) return { agreed, contested };
  const all = new Set(people.flatMap(p => Object.keys(p.taste?.weights || {})));
  for (const f of all) {
    const ws = people.map(p => p.taste?.weights?.[f] ?? 0);
    if (ws.every(w => w >= threshold)) agreed.add(f);
    // A real clash: one of you clearly likes it and another clearly does not.
    else if (Math.max(...ws) >= threshold && Math.min(...ws) <= -threshold) contested.add(f);
  }
  return { agreed, contested };
}

/** A readable summary of the household, for the Together screen. */
export function describeCommonGround(people) {
  const { agreed, contested } = commonGround(people);
  const rank = f => Math.min(...people.map(p => Math.abs(p.taste?.weights?.[f] ?? 0)));
  const top = set => [...set].sort((a, b) => rank(b) - rank(a)).slice(0, 4).map(prettyFeature);
  return {
    agreed: top(agreed),
    contested: top(contested),
    enough: people.every(p => (p.taste?.sampleSize ?? 0) >= 4),
  };
}

function togetherHeadline(per, agree = [], clash = []) {
  if (agree.length) {
    return `You both like ${agree.slice(0, 2).map(prettyFeature).join(' and ')}.` +
           (clash.length ? ` (You differ on ${prettyFeature(clash[0])}.)` : '');
  }
  const bits = per.map(x => {
    const top = x.s.terms.find(t => t.value > 0.5 && t.why);
    return top ? `${x.person.name}: ${top.why}` : `${x.person.name}: nothing either way yet`;
  });
  return bits.join(' · ');
}
