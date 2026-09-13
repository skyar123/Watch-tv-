/**
 * Push this phone's profiles up and pull the other phone's down.
 *
 * Deliberately dumb: there is no live connection and no conflict UI. Each
 * profile is normally edited on exactly one phone, so last-write-wins per
 * profile resolves everything real. Sync runs on load, on returning to the
 * app, and when you open Together — the moments where being out of date
 * actually costs you something.
 */
import { getRaw, actions, TOGETHER } from './store.js';

let inFlight = null;

export async function syncNow({ silent = true } = {}) {
  if (inFlight) return inFlight;
  const s = getRaw();
  if (!s.household) return { ok: false, reason: 'no_household' };

  inFlight = (async () => {
    try {
      const res = await fetch(`/api/household?code=${encodeURIComponent(s.household)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles: s.profiles }),
        signal: AbortSignal.timeout(12000),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, reason: body?.error || `http_${res.status}`, message: body?.message };

      let adopted = 0;
      for (const [id, remote] of Object.entries(body.profiles || {})) {
        if (actions.applyRemoteProfile(id, remote)) adopted++;
      }
      actions.noteSync();
      return { ok: true, adopted, at: Date.now() };
    } catch (e) {
      return { ok: false, reason: e.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Sync on load, on tab focus, and whenever Together is opened. */
export function installSync() {
  const go = () => { if (getRaw().household) syncNow(); };
  go();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) go(); });
  window.addEventListener('online', go);
  return go;
}

export const isTogether = () => getRaw().active === TOGETHER;
