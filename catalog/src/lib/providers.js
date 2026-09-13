/**
 * Which services you actually pay for, and whether a show is on one of them.
 *
 * TMDB/JustWatch names are the canonical ones. The aliases exist because the
 * same service appears under several names over time ("Amazon Prime Video" vs
 * "Prime Video"), and matching on the wrong one silently hides shows you can
 * in fact watch — the worst possible failure for this app.
 */
export const CATALOGUE = [
  { id: 8,   name: 'Netflix',             short: 'Netflix', colour: '#e50914', aliases: ['Netflix', 'Netflix basic with Ads', 'Netflix Standard with Ads'] },
  { id: 15,  name: 'Hulu',                short: 'Hulu',    colour: '#1ce783', aliases: ['Hulu'] },
  { id: 9,   name: 'Amazon Prime Video',  short: 'Prime',   colour: '#00a8e1', aliases: ['Amazon Prime Video', 'Prime Video', 'Amazon Video'] },
  { id: 337, name: 'Disney Plus',         short: 'Disney+', colour: '#113ccf', aliases: ['Disney Plus', 'Disney+'] },
  { id: 350, name: 'Apple TV Plus',       short: 'Apple',   colour: '#e8e8ed', aliases: ['Apple TV Plus', 'Apple TV+'] },
  { id: 1899, name: 'HBO Max',            short: 'Max',     colour: '#8a2be2', aliases: ['HBO Max', 'Max', 'Max Amazon Channel'] },
  { id: 386, name: 'Peacock Premium',     short: 'Peacock', colour: '#ffc107', aliases: ['Peacock Premium', 'Peacock', 'Peacock Premium Plus'] },
  { id: 531, name: 'Paramount Plus',      short: 'P+',      colour: '#0064ff', aliases: ['Paramount Plus', 'Paramount+', 'Paramount Plus Apple TV Channel'] },
  { id: 526, name: 'AMC+',                short: 'AMC+',    colour: '#c8102e', aliases: ['AMC+', 'AMC Plus', 'AMC+ Amazon Channel'] },
  { id: 257, name: 'fuboTV',              short: 'Fubo',    colour: '#ff5500', aliases: ['fuboTV'] },
  { id: 43,  name: 'Starz',               short: 'Starz',   colour: '#000000', aliases: ['Starz', 'Starz Amazon Channel'] },
  { id: 37,  name: 'Showtime',            short: 'SHO',     colour: '#ff0000', aliases: ['Showtime', 'Paramount+ with Showtime'] },
  { id: 613, name: 'Freevee',             short: 'Freevee', colour: '#00c2ff', aliases: ['Freevee', 'Amazon Freevee'] },
  { id: 300, name: 'Pluto TV',            short: 'Pluto',   colour: '#ffe000', aliases: ['Pluto TV'] },
  { id: 192, name: 'YouTube',             short: 'YT',      colour: '#ff0000', aliases: ['YouTube', 'YouTube Premium'] },
];

const byAlias = new Map();
for (const s of CATALOGUE) for (const a of s.aliases) byAlias.set(a.toLowerCase(), s);

export const findService = name => byAlias.get(String(name || '').toLowerCase()) || null;

export function serviceMeta(name) {
  return findService(name) ||
    { id: null, name, short: String(name || '?').slice(0, 7), colour: '#6b7280', aliases: [name] };
}

/**
 * Does a show sit on a service the user subscribes to?
 * Only `flatrate` counts. Buy and rent are money on top of the subscription and
 * must never be presented as "you can watch this".
 */
export function availability(providers, subscribed) {
  if (!providers?.available) {
    return { known: false, reason: providers?.reason || 'unknown',
             onMine: [], otherFlatrate: [], free: [], paid: [] };
  }
  const subs = new Set(subscribed.map(s => findService(s)?.name || s));
  const norm = list => (list || []).map(p => ({ ...p, canon: findService(p.name)?.name || p.name }));

  const flat = norm(providers.flatrate);
  const free = [...norm(providers.free), ...norm(providers.ads)];
  return {
    known: true,
    onMine: flat.filter(p => subs.has(p.canon)),
    otherFlatrate: flat.filter(p => !subs.has(p.canon)),
    free,
    paid: [...norm(providers.buy), ...norm(providers.rent)],
    link: providers.link,
    fetchedAt: providers.fetchedAt,
  };
}

/**
 * The TVmaze network is a weak but real signal: a show whose webChannel is
 * Netflix is on Netflix. It is not availability (a Netflix original can leave
 * a region) so it is labelled as an origin, never as "you can watch this".
 */
export function originService(show) {
  if (!show.network) return null;
  const s = findService(show.network);
  return s ? { ...s, certain: false, basis: 'original home network per TVmaze' } : null;
}
