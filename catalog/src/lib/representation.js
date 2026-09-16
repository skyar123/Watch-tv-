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

/**
 * @param {object} [seed] a pre-parsed index, for Node contexts. Node 22 needs
 *   an import attribute for JSON modules and Vite does not, so rather than
 *   write source that only builds in one of them, the tests hand the document
 *   in directly.
 */
export async function loadRepresentation(seed) {
  if (WIKI) return { count: Object.keys(WIKI).length, meta };
  if (seed) {
    WIKI = seed.shows || {};
    meta = { bakedAt: seed.bakedAt, source: seed.source, stats: seed.stats, note: seed.note };
    return { count: Object.keys(WIKI).length, meta };
  }
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
 * Three tiers, deliberately not collapsed.
 *
 *   checked   — a person read it and wrote down why it matters to the plot
 *   about     — Wikidata records this as the show's main subject, or Wikipedia
 *               files it under a "shows about X" category. Sense8, Pose,
 *               Orange Is the New Black, Speechless, The A Word.
 *   features  — Wikidata's genre tag. Covers a central queer storyline AND one
 *               recurring character equally: Fingersmith sits beside Scandal.
 *
 * Merging "about" into "features" would fill a queer stories filter with
 * mainstream shows that happen to have a gay best friend, which is its own
 * kind of erasure. The app defaults to the narrow reading and widening is a
 * choice the reader makes.
 *
 * @returns {{queer?:{tier,level,why,...}, disability?:{...}, checked?:string}|null}
 */
export function getRepresentation(tvmazeId, { wide = false } = {}) {
  const curated = getCurated(tvmazeId);
  const wiki = WIKI?.[tvmazeId];
  if (!curated && !wiki) return null;

  const out = curated ? { checked: curated.checked } : {};
  for (const kind of ['queer', 'disability']) {
    if (curated?.[kind]) {
      out[kind] = { ...curated[kind], tier: 'checked' };
      continue;
    }
    const w = wiki?.[kind];
    if (!w) continue;
    if (w.tier === 'features' && !wide) continue;   // narrow by default
    out[kind] = {
      tier: w.tier,
      level: w.tier === 'about' ? 'central' : 'present',
      source: w.source,
      subject: w.subject,
      link: w.wikidata
        ? `https://www.wikidata.org/wiki/${w.wikidata}`
        : w.wiki ? `https://en.wikipedia.org/wiki/${encodeURIComponent(w.wiki)}` : null,
      // A name match is a guess; an IMDb id is not. Say which.
      uncertainMatch: w.match === 'name',
      why: w.tier === 'about'
        ? `${w.source === 'wikidata' ? 'Wikidata' : 'Wikipedia'} records this show's subject as ` +
          `${w.subject || kind}. That is a claim about what the show is about, not about ` +
          `how large any one character is.`
        : `Tagged ${w.subject || kind} on Wikidata. That tag covers everything from a central ` +
          `storyline to one recurring character, so it is a weak signal on its own.`,
    };
  }
  return out.queer || out.disability ? out : null;
}

/** Used by the mood filter and the tag search. */
export const hasQueer = (id, o) => Boolean(getRepresentation(id, o)?.queer);
export const hasDisability = (id, o) => Boolean(getRepresentation(id, o)?.disability);

/** How many shows carry each tag, so the UI can say what it is drawing on. */
export function representationCounts() {
  const wiki = Object.values(WIKI || {});
  const tally = kind => ({
    about: wiki.filter(s => s[kind]?.tier === 'about').length,
    features: wiki.filter(s => s[kind]?.tier === 'features').length,
  });
  return { queer: tally('queer'), disability: tally('disability'), loaded: WIKI !== null };
}
