/**
 * Kid-friendliness judged on CONTENT, not on the certificate.
 *
 * Why this file is so cautious: TMDB's content_ratings gives one string,
 * "TV-MA" or "TV-14", and nothing about what is actually in the show. There is
 * no gore/cruelty/peril descriptor in TMDB or TVmaze. So there are exactly
 * three possible answers here and the third one is used a lot:
 *
 *   checked   — a human looked at it; data/curated.js says what is in it
 *   caution   — genre data alone shows a strong negative signal
 *   unknown   — nobody has checked and the genres say nothing either way
 *
 * "unknown" is rendered as "not checked", never as a green tick. A blank space
 * where a safety judgement should be is the failure mode this app must avoid.
 */
import { getContent } from '../data/curated.js';

const HARD_GENRES = ['Horror', 'Thriller', 'Crime', 'War', 'Adult'];
const SOFT_GENRES = ['Family', 'Children', 'Anime', 'Comedy'];

const SEVERITY = { heavy: 2, some: 1 };
const LABEL = {
  gore: 'gore', cruelty: 'cruelty', sexualViolence: 'sexual violence',
  sex: 'sex', violence: 'violence', peril: 'peril', bodyHorror: 'body horror',
  language: 'strong language', drugs: 'drug use',
};

export function kidVerdict(show) {
  const c = getContent(show.tvmazeId);

  if (c) {
    const has = Object.entries(c.has || {});
    // These are the things that actually make a show wrong for a child. A
    // TV-MA certificate on its own is not one of them.
    const blockers = has.filter(([k, v]) =>
      ['gore', 'cruelty', 'sexualViolence', 'sex'].includes(k) && SEVERITY[v] >= 1);
    const heavy = has.filter(([, v]) => v === 'heavy');

    const describe = list => list.map(([k, v]) => `${LABEL[k]}${v === 'heavy' ? ' (sustained)' : ''}`).join(', ');

    if (blockers.length) {
      return { verdict: 'no', confidence: 'checked',
        headline: `Not for a child — ${describe(blockers)}.`,
        why: c.note, certificate: c.certificate, checked: c.checked,
        contains: has.map(([k, v]) => ({ what: LABEL[k], level: v })) };
    }
    if (heavy.length) {
      return { verdict: 'older', confidence: 'checked',
        headline: `Older kids — ${describe(heavy)}.`,
        why: c.note, certificate: c.certificate, checked: c.checked,
        contains: has.map(([k, v]) => ({ what: LABEL[k], level: v })) };
    }
    return { verdict: 'ok', confidence: 'checked',
      headline: c.certificate && /MA|17|18/.test(c.certificate)
        ? `Rated ${c.certificate}, but fine on content.`
        : 'Fine on content.',
      why: c.note, certificate: c.certificate, checked: c.checked,
      contains: has.map(([k, v]) => ({ what: LABEL[k], level: v })),
      absent: c.absent };
  }

  // No human check. Genres are the only signal, and they are a weak one.
  const hard = (show.genres || []).filter(g => HARD_GENRES.includes(g));
  if (hard.length) {
    return { verdict: 'caution', confidence: 'genre-only',
      headline: `No content check — filed under ${hard.join(', ')}.`,
      why: 'This is a genre label, not a look at what is actually on screen. ' +
           'It could be bloodless or it could be brutal; nothing here knows which.',
      certificate: null, contains: null };
  }
  const soft = (show.genres || []).filter(g => SOFT_GENRES.includes(g));
  return { verdict: 'unknown', confidence: 'none',
    headline: 'Not checked.',
    why: soft.length
      ? `Filed under ${soft.join(', ')}, but no API carries content descriptors, ` +
        `so nothing here can tell you what is actually in it.`
      : 'No API carries content descriptors and nobody has checked this one by hand.',
    certificate: null, contains: null };
}

export const VERDICT_TONE = {
  ok: 'good', older: 'warn', no: 'bad', caution: 'warn', unknown: 'muted',
};
