/**
 * Merge the news feeds server-side. Doing it in the browser is impossible
 * anyway (no CORS on any of these), and doing it here means one request
 * instead of thirteen from a phone on cellular.
 *
 * Every source reports its own status. A feed that fails is reported as
 * unreachable, never silently dropped — a missing outlet must not look like a
 * slow news day, and with queer publications that difference matters.
 */
import { FEEDS } from '../../src/data/feeds.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const strip = s => (s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? strip(m[1]) : '';
};

/** Atom puts the URL in an attribute, RSS in the element body. Handle both. */
const link = (xml) => {
  const rss = xml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  if (rss && rss[1].trim().startsWith('http')) return strip(rss[1]);
  const atom = xml.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return atom ? atom[1] : '';
};

const image = (xml) => {
  for (const re of [
    /<media:content[^>]+url=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i,
    /<media:thumbnail[^>]+url=["']([^"']+)["']/i,
    /<enclosure[^>]+url=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i,
    /<img[^>]+src=["']([^"']+)["']/i,
  ]) { const m = xml.match(re); if (m) return m[1]; }
  return null;
};

function parse(xml, source) {
  const chunks = xml.match(/<(?:item|entry)[ >][\s\S]*?<\/(?:item|entry)>/gi) || [];
  return chunks.map(ch => {
    const dateRaw = tag(ch, 'pubDate') || tag(ch, 'published') || tag(ch, 'updated') || tag(ch, 'dc:date');
    const ts = Date.parse(dateRaw);
    return {
      title: tag(ch, 'title'),
      url: link(ch),
      summary: strip(tag(ch, 'description') || tag(ch, 'summary') || tag(ch, 'content:encoded')).slice(0, 260),
      image: image(ch),
      publishedAt: Number.isFinite(ts) ? ts : null,
      source: source.name,
      sourceTag: source.tag,
    };
  }).filter(i => i.title && i.url);
}

export const handler = async (event) => {
  const q = (event.queryStringParameters?.q || '').toLowerCase().trim();
  const only = event.queryStringParameters?.tag;   // 'queer' | 'tv'
  const limit = Math.min(parseInt(event.queryStringParameters?.limit || '60', 10) || 60, 200);
  const list = only ? FEEDS.filter(f => f.tag === only) : FEEDS;

  const results = await Promise.all(list.map(async f => {
    try {
      const res = await fetch(f.url, {
        headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { source: f, ok: false, reason: `HTTP ${res.status}`, items: [] };
      const items = parse(await res.text(), f);
      return { source: f, ok: items.length > 0, reason: items.length ? null : 'no items parsed', items };
    } catch (e) {
      return { source: f, ok: false, reason: e.name === 'TimeoutError' ? 'timed out' : e.message, items: [] };
    }
  }));

  let items = results.flatMap(r => r.items);
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean);
    items = items.filter(i => {
      const hay = `${i.title} ${i.summary}`.toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }
  items.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=0, s-maxage=600' },
    body: JSON.stringify({
      fetchedAt: Date.now(),
      items: items.slice(0, limit),
      // The UI shows this. Silence about a dead source is the bug.
      sources: results.map(r => ({
        name: r.source.name, tag: r.source.tag, ok: r.ok,
        count: r.items.length, reason: r.reason,
      })),
    }),
  };
};
