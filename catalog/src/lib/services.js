/**
 * One service, however TVmaze happens to spell it.
 *
 * "Is Apple TV included? HBO? Prime?" is a fair question and the app could not
 * answer it, for two reasons. The feed only ever handed over its top 400 rows,
 * so 11 of 206 Apple TV shows and 4 of 215 HBO Max ones were reachable at all.
 * And TVmaze records the channel as free text, so one service arrives under
 * several names and each was counted as a different thing:
 *
 *   HBO 308 · HBO Max 215 · HBO Go 8 · HBO Nordic 6 · Max 3 · HBO España 4
 *   AMC 46 · AMC+ 30 · AMC.com 8 · AMC Premiere 3
 *   STARZ 57 · Starz 1
 *   Prime Video 596 · Amazon Freevee 15
 *   BBC One 997 · BBC Two 623 · BBC iPlayer 409 · BBC Four 134 · BBC Three 132
 *
 * Every grouping below is a spelling of the same service or a channel that
 * feeds the same subscription, and the counts come from the real index. Where
 * two things are genuinely different they are left apart: Paramount Network is
 * cable and is not Paramount+, Disney Channel is not Disney+, and BBC America
 * is only here because it is what someone looking for "BBC" means.
 *
 * WHAT THIS IS NOT. TVmaze records where a show ORIGINATED, not where you can
 * stream it tonight, and those drift apart constantly. So this is labelled as
 * the home service everywhere it appears, never as availability. Real
 * availability needs TMDB watch providers, which needs a key this deployment
 * does not have, and inventing it would be exactly the lie this app is built
 * to avoid.
 */

/**
 * id, display name, the colour of the chip, and every spelling that counts.
 * Channel matching is case-insensitive, so list a name once in any casing;
 * test-services.mjs fails the build if two services claim the same channel.
 */
export const SERVICES = [
  { id: 'netflix',  name: 'Netflix',     colour: '#e50914', tier: 'streamer', provider: 'Netflix',
    channels: ['Netflix'] },
  { id: 'prime',    name: 'Prime Video', colour: '#00a8e1', tier: 'streamer', provider: 'Amazon Prime Video',
    channels: ['Prime Video', 'Amazon Freevee', 'Amazon MX Player', 'Amazon Video'] },
  { id: 'hbo',      name: 'HBO Max',     colour: '#9a4dff', tier: 'streamer', provider: 'HBO Max',
    // HBO the channel and HBO Max the service are not the same thing, but
    // every HBO show is on HBO Max, which is what the question is asking.
    channels: ['HBO Max', 'HBO', 'Max', 'HBO Go', 'HBO Nordic', 'HBO España',
               'HBO Latino', 'HBO Family'] },
  { id: 'apple',    name: 'Apple TV',    colour: '#d4d4dc', tier: 'streamer', provider: 'Apple TV Plus',
    channels: ['Apple TV', 'Apple TV+', 'Apple TV Plus'] },
  { id: 'disney',   name: 'Disney+',     colour: '#3b6ef5', tier: 'streamer', provider: 'Disney Plus',
    channels: ['Disney+', 'DisneyLife'] },
  { id: 'hulu',     name: 'Hulu',        colour: '#1ce783', tier: 'streamer', provider: 'Hulu',
    channels: ['Hulu', 'Hulu Japan'] },
  { id: 'paramount', name: 'Paramount+', colour: '#2a7cff', tier: 'streamer', provider: 'Paramount Plus',
    channels: ['Paramount+', 'Paramount+ with Showtime'] },
  { id: 'peacock',  name: 'Peacock',     colour: '#ffc107', tier: 'streamer', provider: 'Peacock Premium',
    channels: ['Peacock'] },
  { id: 'amc',      name: 'AMC+',        colour: '#e0413e', tier: 'streamer', provider: 'AMC+',
    channels: ['AMC+', 'AMC', 'AMC.com', 'AMC Premiere'] },
  { id: 'starz',    name: 'Starz',       colour: '#c0c0c8', tier: 'streamer', provider: 'Starz',
    // TVmaze has both "STARZ" (57) and "Starz" (1); the lookup lowercases, so
    // listing one covers both and listing both is a duplicate key.
    channels: ['STARZ'] },
  { id: 'showtime', name: 'Showtime',    colour: '#ff4d4d', tier: 'streamer', provider: 'Showtime',
    channels: ['Showtime', 'Showtime on Demand'] },
  { id: 'fx',       name: 'FX',          colour: '#f0a020', tier: 'broadcast',
    channels: ['FX', 'FXX', 'FXM'] },
  { id: 'adultswim', name: 'Adult Swim', colour: '#8fd14f', tier: 'broadcast',
    channels: ['Adult Swim'] },
  { id: 'bbc',      name: 'BBC',         colour: '#e05a7a', tier: 'broadcast',
    channels: ['BBC One', 'BBC Two', 'BBC iPlayer', 'BBC Four', 'BBC Three',
               'BBC Scotland', 'BBC America', 'BBC One Scotland', 'BBC One Wales',
               'BBC Alba', 'BBC One Northern Ireland', 'BBC Two Wales',
               'BBC Two Scotland', 'BBC Two Northern Ireland', 'BBC Choice',
               'BBC Earth', 'BBC Red Button 1'] },
  { id: 'itv',      name: 'ITV',         colour: '#ffd24d', tier: 'broadcast',
    channels: ['ITV1', 'ITVX', 'ITV2', 'ITV3', 'ITV4', 'ITV Encore', 'ITV',
               'ITV London', 'ITV Granada', 'ITV Wales'] },
  { id: 'channel4', name: 'Channel 4',   colour: '#22c7a9', tier: 'broadcast',
    channels: ['Channel 4', 'E4', 'Channel 4+', 'Film4', 'More4'] },
  { id: 'channel5', name: 'Channel 5',   colour: '#6ac6ff', tier: 'broadcast',
    channels: ['5', '5STAR', 'Channel 5', 'My5'] },
  { id: 'sky',      name: 'Sky',         colour: '#4d7cff', tier: 'broadcast',
    channels: ['Sky Showcase', 'Sky Atlantic', 'Sky One', 'Sky History', 'Sky Arts',
               'Sky Go', 'Sky Witness', 'Sky Crime', 'Sky Nature', 'Sky Documentaries',
               'Sky Open', 'Sky Mix', 'Sky Cinema', 'Sky 1', 'Sky Sci-Fi', 'Sky Kids',
               'Sky Travel', 'Sky Serie', 'Sky Uno', 'Sky History2', 'SkyShowtime'] },
  { id: 'crunchyroll', name: 'Crunchyroll', colour: '#f47521', tier: 'streamer',
    channels: ['Crunchyroll', 'Funimation'] },
  { id: 'abc',      name: 'ABC',         colour: '#d0d0d8', tier: 'broadcast',
    channels: ['ABC', 'ABC.com', 'ABC Family'] },
  { id: 'nbc',      name: 'NBC',         colour: '#7bb3ff', tier: 'broadcast',
    channels: ['NBC', 'NBC.com'] },
  { id: 'cbs',      name: 'CBS',         colour: '#4fb3ff', tier: 'broadcast',
    channels: ['CBS'] },
  { id: 'fox',      name: 'FOX',         colour: '#ff8a4d', tier: 'broadcast',
    channels: ['FOX', 'FOX8'] },
  { id: 'cw',       name: 'The CW',      colour: '#4ade80', tier: 'broadcast',
    channels: ['The CW', 'CW Seed', 'The CW App'] },
  { id: 'britbox',  name: 'BritBox',     colour: '#3b82f6', tier: 'streamer',
    channels: ['BritBox'] },
  { id: 'acorn',    name: 'Acorn TV',    colour: '#84cc16', tier: 'streamer',
    channels: ['Acorn TV'] },
  { id: 'shudder',  name: 'Shudder',     colour: '#ef4444', tier: 'streamer',
    channels: ['Shudder'] },
  { id: 'mgm',      name: 'MGM+',        colour: '#eab308', tier: 'streamer',
    channels: ['MGM+', 'Epix'] },
  { id: 'tubi',     name: 'Tubi',        colour: '#fb923c', tier: 'streamer',
    channels: ['Tubi'] },
  { id: 'roku',     name: 'The Roku Channel', colour: '#a855f7', tier: 'streamer',
    channels: ['The Roku Channel'] },
];

const byChannel = new Map();
for (const s of SERVICES) for (const c of s.channels) byChannel.set(c.toLowerCase(), s);

/** The service a show came from, or null when its channel is not one we group. */
export const serviceOf = show =>
  (show?.network ? byChannel.get(show.network.toLowerCase()) : null) || null;

/** The id used for filtering: a known service, else the raw channel name. */
export const bucketOf = show => serviceOf(show)?.id || (show?.network ? `ch:${show.network}` : null);

export const serviceById = id => SERVICES.find(s => s.id === id) || null;

/**
 * The subscription services, in the order the chips use. These are the ones it
 * makes sense to say you pay for; a broadcaster is not something you subscribe
 * to and a one-off channel name is not either.
 */
export const STREAMERS = SERVICES.filter(s => s.tier === 'streamer');

/** The sentinel bucket meaning "anything on a service I pay for". */
export const MINE = 'mine';

/** Which service ids a profile's service list refers to. */
export function subscribedIds(mine = []) {
  const out = new Set();
  for (const name of mine) {
    const hit = SERVICES.find(s => s.provider === name || s.name === name || s.id === name);
    if (hit) out.add(hit.id);
  }
  return out;
}

/** Display name for a bucket id, including the raw-channel form. */
export function bucketName(id) {
  if (!id) return null;
  if (id === MINE) return 'Your services';
  if (id.startsWith('ch:')) return id.slice(3);
  return serviceById(id)?.name || id;
}

export function bucketColour(id) {
  if (!id || id.startsWith('ch:')) return '#6b7280';
  return serviceById(id)?.colour || '#6b7280';
}

/**
 * Count the catalogue by service, biggest first.
 *
 * Channels that are not one of the grouped services are still counted under
 * their own name, so a long tail of 1,143 distinct channels stays browsable
 * instead of disappearing into an "other" bucket nobody can open.
 */
export function countByService(shows, { min = 12, mine = [] } = {}) {
  const counts = new Map();
  for (const show of shows) {
    const id = bucketOf(show);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  /**
   * Order, which matters more than it sounds. Sorted by count alone the row
   * opened on BBC 2,397 and Netflix 1,884 and you had to scroll past thirty
   * chips to reach Apple TV, which is the thing that prompted this. So:
   * what you pay for, then the other subscription services, then the
   * broadcasters, then the long tail of individual channels. Within each
   * group, biggest first.
   */
  const subscribed = subscribedIds(mine);
  const rank = id => {
    if (subscribed.has(id)) return 0;
    const s = serviceById(id);
    if (s?.tier === 'streamer') return 1;
    if (s?.tier === 'broadcast') return 2;
    return 3;                                   // an ungrouped channel name
  };

  return [...counts]
    .filter(([, n]) => n >= min)
    .map(([id, count]) => ({ id, count, name: bucketName(id), colour: bucketColour(id),
                             grouped: !id.startsWith('ch:'), yours: subscribed.has(id) }))
    .sort((a, b) => rank(a.id) - rank(b.id) || b.count - a.count);
}
