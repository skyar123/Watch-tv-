/**
 * TMDB proxy. The API key lives in a Netlify env var and never reaches the
 * browser; the client only ever asks for a named operation from the allowlist
 * below, so this cannot be turned into an open proxy for arbitrary TMDB calls.
 *
 * Env: TMDB_API_KEY  (Netlify → Site configuration → Environment variables)
 */
const BASE = 'https://api.themoviedb.org/3';

// Named operations only. A caller cannot reach a path that is not in here.
const OPS = {
  search:      p => `/search/tv?query=${encodeURIComponent(p.q || '')}&include_adult=false`,
  show:        p => `/tv/${int(p.id)}?append_to_response=external_ids,content_ratings,keywords`,
  videos:      p => `/tv/${int(p.id)}/videos`,
  providers:   p => `/tv/${int(p.id)}/watch/providers`,
  season:      p => `/tv/${int(p.id)}/season/${int(p.season)}`,
  recommend:   p => `/tv/${int(p.id)}/recommendations`,
  similar:     p => `/tv/${int(p.id)}/similar`,
  trending:    () => `/trending/tv/week`,
  find:        p => `/find/${encodeURIComponent(p.external_id)}?external_source=imdb_id`,
  discover:    p => `/discover/tv?sort_by=popularity.desc` +
                    (p.with_genres ? `&with_genres=${encodeURIComponent(p.with_genres)}` : '') +
                    (p.with_providers ? `&with_watch_providers=${encodeURIComponent(p.with_providers)}&watch_region=US` : ''),
};

const int = v => { const n = parseInt(v, 10); if (!Number.isFinite(n)) throw new Error('bad id'); return n; };

const json = (status, body, extra = {}) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    // Short shared cache; the service worker is the real caching layer and it
    // is network-first, so nothing here can pin the app to old data.
    'Cache-Control': 'public, max-age=0, s-maxage=300',
    ...extra,
  },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  const key = process.env.TMDB_API_KEY;
  const params = event.queryStringParameters || {};
  const op = params.op;

  if (!key) {
    // Explicit and machine-readable. The app degrades to TVmaze-only and SAYS
    // so in the UI rather than rendering confident blanks.
    return json(503, {
      error: 'tmdb_key_missing',
      message: 'TMDB_API_KEY is not set on this deploy. Trailers, watch providers ' +
               'and the Canceled status are unavailable until it is.',
      fix: 'Netlify → Site configuration → Environment variables → TMDB_API_KEY',
    });
  }
  if (!op || !OPS[op]) {
    return json(400, { error: 'bad_op', message: `op must be one of: ${Object.keys(OPS).join(', ')}` });
  }

  let path;
  try { path = OPS[op](params); }
  catch (e) { return json(400, { error: 'bad_params', message: e.message }); }

  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${key}&language=en-US`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    const body = await res.json();
    if (!res.ok) {
      return json(res.status === 404 ? 404 : 502, {
        error: 'tmdb_error', status: res.status,
        message: body?.status_message || 'TMDB rejected the request.',
      });
    }
    // Stamp so the client can always report how fresh this is.
    return json(200, { ...body, _fetchedAt: Date.now() });
  } catch (e) {
    return json(504, { error: 'tmdb_unreachable', message: e.message });
  }
};
