/**
 * Which show is this article about?
 *
 * The news tab was a merged chronological feed: thirteen outlets, newest
 * first, no connection to anything else in the app. That is a reader, not a
 * feature. What was asked for is "Autostraddle wrote about a show we love",
 * which needs articles tied to specific shows.
 *
 * THE OBVIOUS APPROACH DOES NOT WORK, and it is worth saying why, because it
 * looked fine until it was measured. Scanning each article for any of the
 * 32,138 catalogue titles matched 76% of 197 real articles, and the matches
 * were nonsense: an Autostraddle piece headlined "My Girlfriend Thinks I'm
 * Prioritizing Exercise Over Her" was reported as being about the show
 * Girlfriend, a profile of Rebecca Ferguson as being about Rebecca, and an
 * Emmy party report as being about Hollywood. With 32,000 titles, nearly every
 * ordinary English word is a show somewhere, so a stoplist cannot save it. A
 * wrong show label is worse than none: it is the app asserting something false
 * about something you care about.
 *
 * So there are two matchers, and both work by shrinking the candidate set
 * rather than by being cleverer about the text.
 *
 *   1. QUOTED TITLES. Entertainment publications mark titles typographically:
 *      "'Adults' Defies Sophomore Slump", "'Yaga' Sets U.S. Release Date". The
 *      quotes are the publication telling us, in its own house style, that
 *      this phrase is a title. So balanced quote pairs are extracted first and
 *      only those phrases are looked up. The apostrophe in "New York's" is the
 *      same character as a closing single quote, which is why extraction
 *      requires a matching OPENING mark and not merely a closing one.
 *
 *   2. YOUR OWN SHOWS. A few dozen saved and watched titles, matched as
 *      phrases. The candidate set is small enough that "Heartstopper" or "The
 *      Bear" is safe, and this is the half the request was actually about.
 *      The weak-title rules still apply inside it.
 *
 * Anything else is left unmatched on purpose. The cost is recall, and the
 * measured alternative was a feature that lies. scripts/test-newsmatch.mjs
 * runs both matchers over the live feeds and prints every match, so the
 * precision claim is read off real articles rather than asserted.
 */

/**
 * Ordinary English words that are also show titles. A one-word title on this
 * list is never matched UNQUOTED, because the word carries no evidence. It is
 * short on purpose: it only has to cover words plausible as a one-word title,
 * and it is a backstop for the personal list rather than the main defence.
 */
const COMMON = new Set(`
adults action angels another barbara backstage below boys connection dark doc
episodes filter friends girlfriend glimpse hollywood lanterns love mother
paradise popular power rebecca romance scrubs special thriller
`.trim().split(/\s+/));

/** Case, punctuation and whitespace removed, padded so phrases can be found. */
const normalise = s => ` ${String(s || '')
  .toLowerCase()
  .replace(/[‘’ʼ']/g, '')     // possessives close up
  .replace(/&amp;/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()} `;

const bare = s => normalise(s).trim();

/**
 * Is a quoted phrase a TITLE, or is it a scare quote?
 *
 * The same publications that put titles in quotes also put reported speech and
 * emphasis in them, and the catalogue has a show for most short phrases. On the
 * live feeds that turned "LGBTQ+ book shop 'blown away' by support" into an
 * article about Blown Away, "pastor reckons ... 'steal'" into one about Steal,
 * and a JK Rowling story into one about Outrageous.
 *
 * English house style separates the two for us: a title is capitalised and a
 * scare quote is not. 'Adults', 'Yaga', 'North of North' against 'blown away',
 * 'clearly fabricated', 'uncircumcised people'. So the first letter has to be a
 * capital, and in a multi-word phrase most of the real words have to be, which
 * is what stops "Blown away" from sneaking through on its first letter alone.
 */
const looksLikeTitle = phrase => {
  const first = phrase.match(/[A-Za-z0-9]/);
  if (!first) return false;
  if (/[a-z]/.test(first[0])) return false;          // 'blown away', 'steal'
  const words = phrase.split(/\s+/).filter(w => /[A-Za-z]{4,}/.test(w));
  if (words.length < 2) return true;
  const capped = words.filter(w => /^[^A-Za-z]*[A-Z]/.test(w)).length;
  return capped * 2 >= words.length;                 // 'Blown away' fails, 'Blown Away' passes
};

/**
 * Phrases the publication itself marked as titles.
 *
 * Only balanced pairs count. Requiring an opening mark is the whole trick:
 * without it every possessive in English is a closing quote.
 */
export function quotedPhrases(text, { titlesOnly = true } = {}) {
  const out = [];
  for (const re of [/‘([^‘’]{2,60})’/g,     // ‘ … ’
                    /“([^“”]{2,60})”/g,     // “ … ”
                    /"([^"]{2,60})"/g]) {
    for (const m of String(text || '').matchAll(re)) {
      const phrase = m[1].trim();
      if (!titlesOnly || looksLikeTitle(phrase)) out.push(phrase);
    }
  }
  return out;
}

/**
 * Is this title distinctive enough to find in prose without inventing matches?
 *
 * @returns {{key:string, tier:'anywhere'|'headline'}|null}
 */
export function matchableKey(name) {
  const key = bare(name);
  if (!key) return null;
  const words = key.split(' ');
  // A leading article carries no information, so it does not count toward how
  // distinctive the title is, but it stays in the phrase that gets matched.
  const solid = ['the', 'a', 'an'].includes(words[0]) ? words.slice(1) : words;
  if (!solid.length) return null;

  if (solid.length === 1) {
    const w = solid[0];
    if (/^\d+$/.test(w)) return null;         // "1923", "24": a year is not a match
    if (COMMON.has(w)) return null;
    if (w.length >= 6) return { key, tier: 'anywhere' };
    // "The Bear", "The Pitt": weak in prose, strong in a headline, because a
    // headline is about its subject and prose wanders.
    return words.length > 1 && w.length >= 3 ? { key, tier: 'headline' } : null;
  }
  return solid.join('').length >= 8 ? { key, tier: 'anywhere' } : { key, tier: 'headline' };
}

/**
 * Build a matcher.
 *
 * @param catalogue every show, used only for QUOTED lookups
 * @param mine      the shows this person saved or watched, matched unquoted too
 */
export function buildShowMatcher(catalogue, mine = []) {
  // Exact-name index for quoted phrases. Several shows share a name (there are
  // two called Scrubs), so a name maps to a list and the newest wins: a
  // publication writing about "Scrubs" today means the one on air.
  const byName = new Map();
  const add = (k, show) => {
    const b = byName.get(k);
    if (b) b.push(show); else byName.set(k, [show]);
  };
  for (const show of catalogue) {
    const k = bare(show.name);
    if (k) add(k, show);
    // "'Walking Dead' finale" is how it gets written; the title is The Walking
    // Dead. Index the article-less form as well so both spellings resolve.
    const words = k.split(' ');
    if (['the', 'a', 'an'].includes(words[0]) && words.length > 1) add(words.slice(1).join(' '), show);
  }

  const mineKeys = [];
  for (const show of mine) {
    const m = matchableKey(show.name);
    if (m) mineKeys.push({ ...m, show });
  }

  const newest = list => list.slice().sort(
    (a, b) => (+String(b.premiered || 0).slice(0, 4) || 0) - (+String(a.premiered || 0).slice(0, 4) || 0),
  )[0];

  /**
   * @returns {Array<{show, how:'quoted'|'yours', where:'headline'|'body'}>}
   */
  function match(article) {
    const titleText = article.title || '';
    const bodyText = `${titleText} ${article.summary || ''}`;
    const title = normalise(titleText);
    const body = normalise(bodyText);
    const hits = new Map();
    const keep = (show, how, where) => {
      const prev = hits.get(show.key);
      // Quoted beats personal, and a headline beats a body mention.
      if (prev && !(prev.where === 'body' && where === 'headline') && prev.how === 'quoted') return;
      hits.set(show.key, { show, how, where });
    };

    for (const phrase of quotedPhrases(bodyText)) {
      const k = bare(phrase);
      const found = byName.get(k);
      if (!found) continue;
      keep(newest(found), 'quoted',
           quotedPhrases(titleText).some(p => bare(p) === k) ? 'headline' : 'body');
    }

    for (const { key, tier, show } of mineKeys) {
      const padded = ` ${key} `;
      const inTitle = title.includes(padded);
      if (!inTitle && (tier === 'headline' || !body.includes(padded))) continue;
      keep(show, 'yours', inTitle ? 'headline' : 'body');
    }

    return [...hits.values()].sort((a, b) =>
      (a.where === b.where ? 0 : a.where === 'headline' ? -1 : 1) ||
      (a.how === b.how ? 0 : a.how === 'yours' ? -1 : 1));
  }

  match.catalogueSize = catalogue.length;
  match.mineSize = mineKeys.length;
  match.mineDropped = mine.length - mineKeys.length;
  return match;
}
