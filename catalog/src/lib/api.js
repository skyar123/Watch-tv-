/**
 * One fetch wrapper for everything, so that every screen can answer the
 * question "how old is what I'm looking at?".
 *
 * The service worker stamps x-sw-source / x-sw-age-ms on API responses. We read
 * those here and hand them back with the data, so a card can render
 * "from cache · 2h ago" instead of quietly pretending to be live.
 */
const MEM = new Map();          // in-tab memo, cleared by refresh()
const INFLIGHT = new Map();     // dedupe concurrent identical calls

export class ApiError extends Error {
  constructor(message, { status, code, url } = {}) {
    super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.url = url;
  }
}

/** @returns {{data:any, meta:{source:'network'|'cache'|'memory', ageMs:number|null, at:number, reason?:string}}} */
export async function getJSON(url, { memo = true, timeoutMs = 12000 } = {}) {
  if (memo && MEM.has(url)) return MEM.get(url);
  if (INFLIGHT.has(url)) return INFLIGHT.get(url);

  const p = (async () => {
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new ApiError(e.name === 'TimeoutError' ? 'Request timed out' : 'Network unreachable',
        { code: 'network', url });
    }

    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error page */ }

    if (!res.ok) {
      throw new ApiError(body?.message || `HTTP ${res.status}`,
        { status: res.status, code: body?.error || `http_${res.status}`, url });
    }

    const src = res.headers.get('x-sw-source');
    const ageHeader = res.headers.get('x-sw-age-ms');
    const ageMs = ageHeader ? Number(ageHeader) : 0;
    const out = {
      data: body,
      meta: {
        source: src === 'cache' ? 'cache' : 'network',
        ageMs: src === 'cache' ? (Number.isFinite(ageMs) ? ageMs : null) : 0,
        at: Date.now(),
        reason: res.headers.get('x-sw-reason') || undefined,
      },
    };
    if (memo) MEM.set(url, out);
    return out;
  })().finally(() => INFLIGHT.delete(url));

  INFLIGHT.set(url, p);
  return p;
}

/** Drop in-tab memo and ask the service worker to drop its API cache. */
export async function refresh() {
  MEM.clear();
  const reg = await navigator.serviceWorker?.getRegistration?.();
  reg?.active?.postMessage('purge-api');
  // Give the worker a beat to actually delete before callers refetch.
  await new Promise(r => setTimeout(r, 60));
}

/** "3 minutes ago" / "2h ago" — used wherever cached data is shown. */
export function ago(ms) {
  if (ms == null) return 'unknown age';
  const s = Math.round(ms / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
