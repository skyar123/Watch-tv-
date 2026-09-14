/**
 * Whether a show has queer or disability representation, and on whose word.
 *
 * TWO TIERS, KEPT APART ON PURPOSE
 *
 *   checked    — written by hand in data/curated.js, with a sentence saying
 *                why the representation matters to the plot. The strong claim.
 *   listed     — Wikipedia's category tree says editors consider this show
 *                related to the subject. Broad, maintained against written
 *                inclusion criteria, and a genuinely weaker claim: it does not
 *                distinguish a lead from a recurring guest.
 *
 * The original version had only the first tier, six shows, and a "queer
 * stories" filter that returned one result. Refusing to say anything you
 * cannot say precisely is only honest when the alternative is making things
 * up; here the alternative was a real, attributable, human-curated source, and
 * withholding it was not caution, it was a broken feature.
 *
 * So both are used, the app always says which it is showing, and the hand-
 * checked note wins wherever there is one.
 */
import { getRepresentation as getCurated } from '../data/curated.js';

let WIKI = null;      // lazily loaded, id -> { queer?, disability? }
let meta = null;

export async function loadRepresentation() {
  if (WIKI) return { count: Object.keys(WIKI).length, meta };
  try {
    const doc = (await import('../data/representation.json')).default;
    WIKI = doc.shows || {};
    meta = { bakedAt: doc.bakedAt, source: doc.source, stats: doc.stats, note: doc.note,
             // A placeholder file has no bake date. Treat it as absent rather
             // than as an empty but authoritative index.
             unavailable: !doc.bakedAt };
  } catch {
    WIKI = {};        // the app works without it, just with the hand-checked list
    meta = { unavailable: true };
  }
  return { count: Object.keys(WIKI).length, meta };
}

export const representationMeta = () => meta;

/**
 * @returns {{queer?:{level,why,tier,cats?}, disability?:{...}, checked?:string}|null}
 */
export function getRepresentation(tvmazeId) {
  const curated = getCurated(tvmazeId);
  const wiki = WIKI?.[tvmazeId];
  if (!curated && !wiki) return null;

  const out = curated ? { checked: curated.checked } : {};
  for (const kind of ['queer', 'disability']) {
    if (curated?.[kind]) {
      out[kind] = { ...curated[kind], tier: 'checked' };
    } else if (wiki?.[kind]) {
      out[kind] = {
        tier: 'listed',
        level: 'listed',
        cats: wiki[kind].cats,
        wiki: wiki[kind].wiki,
        ambiguous: wiki[kind].ambiguous,
        why: `Wikipedia editors file this under ${listCats(wiki[kind].cats)}. ` +
             `That means the show is considered related to the subject — it does not ` +
             `say whether a character is a lead or appears in one scene.`,
      };
    }
  }
  return Object.keys(out).length && (out.queer || out.disability) ? out : null;
}

const listCats = cats => {
  const c = (cats || []).slice(0, 2);
  if (!c.length) return 'this subject';
  return c.length === 1 ? `“${c[0]}”` : `“${c[0]}” and “${c[1]}”`;
};

/** Used by the mood filter and the tag search. */
export const hasQueer = id => Boolean(getRepresentation(id)?.queer);
export const hasDisability = id => Boolean(getRepresentation(id)?.disability);

/** How many shows carry each tag, for the honesty line in the UI. */
export function representationCounts() {
  const wiki = Object.values(WIKI || {});
  return {
    queerListed: wiki.filter(s => s.queer).length,
    disabilityListed: wiki.filter(s => s.disability).length,
    loaded: WIKI !== null,
  };
}
