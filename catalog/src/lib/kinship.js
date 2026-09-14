/**
 * "Because the people who made the thing you loved also made this."
 *
 * Netflix has co-watch data from 250 million accounts and I have two, so
 * collaborative filtering is off the table. But shared authorship is a signal
 * sitting in a free API that Netflix's interface almost never surfaces as a
 * reason, and it is often the true reason two shows feel alike.
 *
 * Verified: /shows/{id}/crew lists Creator and producers with person ids;
 * /people/{id}/crewcredits?embed=show gives everything else they worked on.
 * Jonathan Nolan created Westworld → Person of Interest, The Peripheral,
 * Fallout. That is a better sentence than "97% match".
 *
 * The direction matters. Fetching cast for 27,590 candidates is impossible
 * (70 kB each). Fetching it for the five shows you FINISHED, and walking
 * outward to what those people also made, is about sixty requests, once.
 */
import { getJSON } from './api.js';

const BASE = 'https://api.tvmaze.com';

/**
 * How much a role says about whether you will like the next thing.
 *
 * Creator and writer are the strong ones. Executive producer was originally
 * near the top and it flooded the results: one prolific EP with thirty credits
 * put thirty shows in front of you on the strength of a financing role. The
 * title is often about money, not voice.
 */
const ROLE_WEIGHT = {
  creator: 6, writer: 3, director: 2,
  'executive producer': 1.0, 'co-executive producer': 0.6, producer: 0.5,
};
const CAST_WEIGHT = lead => (lead ? 2.5 : 0.8);

const roleWeight = type => {
  const t = String(type || '').toLowerCase();
  for (const [k, w] of Object.entries(ROLE_WEIGHT)) if (t.includes(k)) return w;
  return 0;   // editors, casting, ADs — real jobs, no signal for taste
};

/**
 * Build the map of "shows made by people behind what you loved".
 *
 * @param {Array} seeds shows the person finished, best first
 * @returns {Promise<Map<number, {score, reasons:Set<string>}>>} keyed by tvmaze show id
 */
export async function buildKinship(seeds, { maxSeeds = 5, maxPeople = 8 } = {}) {
  const out = new Map();
  if (!seeds.length) return out;

  for (const seed of seeds.slice(0, maxSeeds)) {
    let people = [];
    try {
      const [{ data: crew }, { data: cast }] = await Promise.all([
        getJSON(`${BASE}/shows/${seed.tvmazeId}/crew`),
        getJSON(`${BASE}/shows/${seed.tvmazeId}/cast`),
      ]);
      for (const c of crew) {
        const w = roleWeight(c.type);
        if (w > 0) people.push({ id: c.person.id, name: c.person.name, w, role: c.type, kind: 'crew' });
      }
      cast.slice(0, 4).forEach((c, i) => people.push({
        id: c.person.id, name: c.person.name, w: CAST_WEIGHT(i < 2),
        role: i < 2 ? 'star' : 'cast', kind: 'cast',
      }));
    } catch { continue; }

    // Collapse duplicates (a creator who is also an EP) and take the strongest.
    const best = new Map();
    for (const p of people) {
      const cur = best.get(p.id);
      if (!cur || p.w > cur.w) best.set(p.id, p);
    }
    const top = [...best.values()].sort((a, b) => b.w - a.w).slice(0, maxPeople);

    for (const p of top) {
      let credits = [];
      try {
        const endpoint = p.kind === 'crew' ? 'crewcredits' : 'castcredits';
        const { data } = await getJSON(`${BASE}/people/${p.id}/${endpoint}?embed=show`);
        credits = data;
      } catch { continue; }

      // A prolific character actor is weak evidence; a creator with three
      // shows is strong. Divide by how much of their output this is — and for
      // anyone who is not the creator, divide harder, because a long credit
      // list means the connection says little about any one show.
      const isAuthor = /creator|writer/i.test(p.role);
      const spread = isAuthor
        ? Math.max(1, Math.sqrt(credits.length))
        : Math.max(1, credits.length * 0.75);

      for (const c of credits) {
        const show = c._embedded?.show;
        if (!show || show.id === seed.tvmazeId) continue;
        const entry = out.get(show.id) || { score: 0, reasons: new Set() };
        entry.score += p.w / spread;
        entry.reasons.add(
          p.role === 'star' || p.role === 'cast'
            ? `${p.name} is in this and in ${seed.name}`
            : `${p.name} ${p.role.toLowerCase() === 'creator' ? 'created' : `was ${p.role.toLowerCase()} on`} this and ${seed.name}`,
        );
        out.set(show.id, entry);
      }
    }
  }
  return out;
}

/** The single clearest sentence for why a show is kin to what you have watched. */
export function kinshipReason(entry) {
  if (!entry?.reasons?.size) return null;
  // Prefer a creator sentence over a cast one: it says more.
  const all = [...entry.reasons];
  return all.find(r => /created/.test(r)) || all.find(r => /was /.test(r)) || all[0];
}
