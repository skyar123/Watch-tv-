/**
 * News sources. Every one of these was fetched and confirmed to return real
 * <item> elements before it was added — see scripts/verify-sources.mjs.
 * Vulture (404) and IndieWire's TV feed (0 items) were tried and dropped.
 *
 * Queer publications are seven of thirteen sources, deliberately. One token
 * outlet would mean queer TV news only surfaces when a straight publication
 * decides it is newsworthy.
 *
 * Them and Polygon sit behind Cloudflare and intermittently 403 a datacentre
 * IP regardless of User-Agent (observed: 200 then 403 minutes later). They are
 * kept in the list and the news function reports per-source failure to the UI
 * rather than quietly returning a shorter list, so a missing outlet is always
 * visible as "unreachable" instead of looking like a slow news day.
 */
export const FEEDS = [
  { name: 'Them',          tag: 'queer', url: 'https://www.them.us/feed/rss' },
  { name: 'Autostraddle',  tag: 'queer', url: 'https://www.autostraddle.com/feed/' },
  { name: 'Xtra Magazine', tag: 'queer', url: 'https://xtramagazine.com/feed' },
  { name: 'LGBTQ Nation',  tag: 'queer', url: 'https://www.lgbtqnation.com/feed/' },
  { name: 'PinkNews',      tag: 'queer', url: 'https://www.thepinknews.com/feed/' },
  { name: 'The Advocate',  tag: 'queer', url: 'https://www.advocate.com/feeds/feed.rss' },
  { name: 'Out',           tag: 'queer', url: 'https://www.out.com/feeds/feed.rss' },
  { name: 'Variety',       tag: 'tv',    url: 'https://variety.com/v/tv/feed/' },
  { name: 'THR',           tag: 'tv',    url: 'https://www.hollywoodreporter.com/c/tv/feed/' },
  { name: 'TVLine',        tag: 'tv',    url: 'https://tvline.com/feed/' },
  { name: 'Deadline',      tag: 'tv',    url: 'https://deadline.com/v/tv/feed/' },
  { name: 'AV Club',       tag: 'tv',    url: 'https://www.avclub.com/rss' },
  { name: 'Polygon',       tag: 'tv',    url: 'https://www.polygon.com/rss/index.xml' },
];
