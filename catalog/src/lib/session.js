/**
 * What you are in the mood for RIGHT NOW, as opposed to what you generally like.
 *
 * Long-term taste is the wrong tool for a Tuesday evening. If you hide three
 * horror shows in a row this minute, you do not want a fourth, even though the
 * profile says you love horror — you are not in the mood tonight. Folding that
 * into the long-term model would be worse: it would corrupt a real preference
 * with one evening's mood, and it would still be there in a month.
 *
 * So this is separate, in memory only, and forgotten when the app closes.
 */

const RUN = 3;        // hides sharing a feature before it is suppressed
const WINDOW = 12;    // how many recent swipes count as "now"

let swipes = [];      // { features:string[], liked:boolean, at:number }

export function recordSwipe(features, liked) {
  swipes.push({ features, liked, at: Date.now() });
  if (swipes.length > 40) swipes = swipes.slice(-40);
}

export function clearSession() { swipes = []; }

/**
 * Features you have been rejecting in this sitting.
 *
 * A feature counts as cooling only if it appears in several recent hides and
 * in none of the recent likes — otherwise "drama" is suppressed the moment you
 * pass on any two dramas, which is most evenings.
 */
export function coolingFeatures() {
  const recent = swipes.slice(-WINDOW);
  const hidden = new Map(), liked = new Set();
  for (const s of recent) {
    for (const f of s.features) {
      if (s.liked) liked.add(f);
      else hidden.set(f, (hidden.get(f) || 0) + 1);
    }
  }
  const out = new Map();
  for (const [f, n] of hidden) {
    if (n >= RUN && !liked.has(f)) out.set(f, n);
  }
  return out;
}

/**
 * A penalty for a candidate, with the sentence that explains it.
 * @returns {{penalty:number, why:string}|null}
 */
export function sessionPenalty(features) {
  const cooling = coolingFeatures();
  if (!cooling.size) return null;
  const hits = features.filter(f => cooling.has(f));
  if (!hits.length) return null;
  const worst = hits.sort((a, b) => cooling.get(b) - cooling.get(a))[0];
  const n = cooling.get(worst);
  return {
    penalty: -Math.min(5, 1.6 * hits.length + n * 0.6),
    feature: worst,
    count: n,
    why: `you have passed on ${n} of these in the last few minutes`,
  };
}

export const sessionSummary = () => ({
  swipes: swipes.length,
  likes: swipes.filter(s => s.liked).length,
  cooling: [...coolingFeatures().keys()],
});
