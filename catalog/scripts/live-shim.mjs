/**
 * Transport shim for the screenshot harness.
 *
 * This sandbox's bundled Chromium cannot negotiate TLS through the egress
 * proxy, but Node can. So we intercept the app's outbound calls and fulfil them
 * with a real live fetch from Node.
 *
 * This is a transport shim, NOT a fixture. The bytes come from api.tvmaze.com
 * and the real RSS feeds on each run, and the app's own code path is untouched:
 * it still calls fetch() against the same URLs and parses the same payloads.
 * /api/news is answered by importing the actual Netlify function, so the
 * screenshots exercise the shipped parser rather than a stand-in.
 */
import { handler as newsHandler } from '../netlify/functions/news.js';

export async function installLiveApiShim(page, { tmdbKey = process.env.TMDB_API_KEY } = {}) {
  const stats = { tvmaze: 0, images: 0, news: 0, tmdb: 0, trailers: 0, failed: 0 };

  await page.route('**://api.tvmaze.com/**', async route => {
    try {
      const res = await fetch(route.request().url(), {
        headers: { 'User-Agent': 'tonight/shots' },
        signal: AbortSignal.timeout(20000),
      });
      stats.tvmaze++;
      await route.fulfill({
        status: res.status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: await res.text(),
      });
    } catch {
      stats.failed++;
      await route.abort();
    }
  });

  // Artwork lives on other hosts and needs the same treatment, or every card
  // in the screenshots is an empty rectangle.
  const IMAGE_HOSTS = ['**://static.tvmaze.com/**', '**://image.tmdb.org/**'];
  for (const pattern of IMAGE_HOSTS) {
    await page.route(pattern, async route => {
      try {
        const res = await fetch(route.request().url(), { signal: AbortSignal.timeout(25000) });
        const buf = Buffer.from(await res.arrayBuffer());
        stats.images++;
        await route.fulfill({
          status: res.status, body: buf,
          contentType: res.headers.get('content-type') || 'image/jpeg',
          headers: { 'access-control-allow-origin': '*' },
        });
      } catch { stats.failed++; await route.abort(); }
    });
  }

  await page.route('**/api/news**', async route => {
    const url = new URL(route.request().url());
    const res = await newsHandler({
      queryStringParameters: Object.fromEntries(url.searchParams),
    });
    stats.news++;
    await route.fulfill({ status: res.statusCode, contentType: 'application/json', body: res.body });
  });

  await page.route('**/api/trailer**', async route => {
    const { handler } = await import('../netlify/functions/trailer.js');
    const url = new URL(route.request().url());
    const res = await handler({ queryStringParameters: Object.fromEntries(url.searchParams) });
    stats.trailers++;
    await route.fulfill({ status: res.statusCode, contentType: 'application/json', body: res.body });
  });

  await page.route('**/api/tmdb**', async route => {
    stats.tmdb++;
    if (!tmdbKey) {
      // Exactly what the deployed function returns with no key set. The
      // screenshots then show the real degraded state rather than a fake one.
      return route.fulfill({
        status: 503, contentType: 'application/json',
        body: JSON.stringify({
          error: 'tmdb_key_missing',
          message: 'TMDB_API_KEY is not set on this deploy. Trailers, watch providers ' +
                   'and the Canceled status are unavailable until it is.',
        }),
      });
    }
    const { handler } = await import('../netlify/functions/tmdb.js');
    const url = new URL(route.request().url());
    const res = await handler({ queryStringParameters: Object.fromEntries(url.searchParams) });
    return route.fulfill({ status: res.statusCode, contentType: 'application/json', body: res.body });
  });

  return stats;
}
