/**
 * HAND-CHECKED ANNOTATIONS.
 *
 * Read this before adding to it.
 *
 * Three things this app promises cannot be derived from any API it uses:
 *
 *   1. Whether a cancelled show ends on an unresolved cliffhanger.
 *      No endpoint has an "ending resolved" field. TVmaze does not even have a
 *      Cancelled status (1899 and GLOW both report "Ended").
 *
 *   2. Kid-safety judged on CONTENT rather than the age certificate.
 *      TMDB's content_ratings returns "TV-MA" and nothing else. There is no
 *      gore / cruelty / peril descriptor anywhere in TMDB or TVmaze.
 *
 *   3. Whether queer or disabled characters MATTER to the plot, as opposed to
 *      appearing in the background. TMDB keywords carry things like
 *      "lgbt" but cannot tell you a character is a lead.
 *
 * So these are written by hand, each with a note saying WHY and a `checked`
 * date. Anything absent from this file renders as "not checked" in the UI. It
 * must never render as a confident "safe" or "no queer content" — an unchecked
 * show and a checked-and-negative show are different facts.
 *
 * Keys are TVmaze show ids. Every id below was looked up against
 * api.tvmaze.com/search/shows and the `name` field records what the id
 * actually resolves to, so a wrong id shows up as a mismatch instead of
 * silently attaching these notes to the wrong programme. Run
 * `node scripts/check-curated.mjs` to re-verify all of them.
 */

/** @typedef {'resolved'|'cliffhanger'|'partial'} EndingLevel */
export const ENDINGS = {
  39749: { name: '1899', level: 'cliffhanger', checked: '2026-09',
    note: 'Cancelled after one season on a direct sequel hook — the final scene opens a new story that was never told.' },
  17869: { name: 'GLOW', level: 'cliffhanger', checked: '2026-09',
    note: 'A fourth season was ordered and then cancelled mid-production, so the story stops before its planned ending.' },
};

/**
 * Content signals. These describe what is ON SCREEN, not what a ratings board
 * called it. `heavy` means present and sustained; `some` means present;
 * absence from the list means it was checked and not found.
 */
export const CONTENT = {
  44933: { name: 'Severance', checked: '2026-09', certificate: 'TV-MA',
    has: { peril: 'some', violence: 'some', bodyHorror: 'some' },
    absent: ['gore', 'cruelty', 'sexualViolence', 'sex'],
    note: 'Rated TV-MA for tone and unease rather than for anything graphic. Dread, ' +
          'a few bloody moments, no cruelty played for entertainment.' },
  82: { name: 'Game of Thrones', checked: '2026-09', certificate: 'TV-MA',
    has: { gore: 'heavy', cruelty: 'heavy', sexualViolence: 'heavy', sex: 'heavy', violence: 'heavy' },
    absent: [],
    note: 'Sustained graphic violence including torture and sexual violence. The certificate ' +
          'and the content agree here.' },
  555: { name: 'Avatar: The Last Airbender (2005)', checked: '2026-09', certificate: 'TV-Y7',
    has: { peril: 'some', violence: 'some' },
    absent: ['gore', 'cruelty', 'sexualViolence', 'sex'],
    note: 'Genuine stakes and grief, war as a subject, but no gore and no cruelty for its own sake.' },
};

/**
 * Representation. Only entries where the characters or storylines carry weight
 * in the plot. A one-episode guest character or a background couple does not
 * qualify — that is the whole point of the note field.
 */
export const REPRESENTATION = {
  1367: { name: 'Sense8', checked: '2026-09',
    queer: { level: 'central',
      why: 'Two of the eight leads are queer and their relationships drive main plotlines: Nomi, ' +
           'a trans lesbian woman played by a trans actress, and Lito, a closeted actor whose ' +
           'arc is about coming out.' } },
  26082: { name: 'Pose', checked: '2026-09',
    queer: { level: 'central',
      why: 'An ensemble of trans women of colour as leads, played by trans actresses, in a story ' +
           'about ballroom culture and the AIDS crisis. The subject of the show, not a subplot.' } },
  53269: { name: 'Heartstopper', checked: '2026-09',
    queer: { level: 'central',
      why: 'The central romance is between two teenage boys; the ensemble includes lesbian, ' +
           'bisexual, trans and asexual characters with their own storylines.' } },
  40869: { name: 'Special', checked: '2026-09',
    queer: { level: 'central',
      why: 'A gay man with cerebral palsy is the lead, and the show is about his sexuality.' },
    disability: { level: 'central',
      why: 'Ryan Hayes has cerebral palsy and is played by Ryan O\'Connell, who has cerebral palsy ' +
           'and wrote the show from his own life. Disability is the premise, not a trait.' } },
  362: { name: 'Switched at Birth', checked: '2026-09',
    disability: { level: 'central',
      why: 'A deaf lead and a large deaf cast, much of it played by deaf actors, with entire ' +
           'episodes in American Sign Language. Deaf culture and mainstreaming are the subject.' } },
  36693: { name: "Everything's Gonna Be Okay", checked: '2026-09',
    queer: { level: 'central',
      why: 'The lead is queer and one of the two sisters is a lesbian; both storylines are ongoing.' },
    disability: { level: 'central',
      why: 'Matilda is autistic and played by Kayla Cromer, who is autistic. Her autonomy, sex ' +
           'life and independence are main plots, written as her story rather than her family\'s.' } },
};

export const getEnding = id => ENDINGS[id] || null;
export const getContent = id => CONTENT[id] || null;
export const getRepresentation = id => REPRESENTATION[id] || null;

/** How much of the catalogue has actually been checked. Shown in Settings, honestly. */
export const coverage = () => ({
  endings: Object.keys(ENDINGS).length,
  content: Object.keys(CONTENT).length,
  representation: Object.keys(REPRESENTATION).length,
});
