/**
 * Sync between the two phones sharing this link.
 *
 * Without this, Together is a lie: each phone only knows its own half, so
 * "what suits both of you" would be computed from one person's data.
 *
 * Shape: one blob per household holding each profile keyed by id, with the
 * profile's own updatedAt. Merging is last-write-wins per profile, which is
 * almost never a real conflict because each profile is edited on one phone.
 *
 * PRIVACY, stated plainly because it matters: a household code is a random
 * string, not a password. Anyone who knows the code can read and write that
 * household's lists. It is obscurity, not security. Nothing here holds a
 * name, an email or anything beyond which shows you saved — but do not treat
 * the code as a secret that protects anything else.
 */
import { getStore } from '@netlify/blobs';

/**
 * Strong consistency is not optional here. Blobs reads are eventually
 * consistent by default, and this function's whole job is read-modify-write:
 * pull the household, merge one profile in, write it back. With eventual
 * reads the pull came back empty every time, so each phone's push silently
 * replaced the other's instead of merging, and a stale write beat a fresh one.
 * It looked like it worked — every response was a 200.
 */

const CODE_RE = /^[a-z0-9]{6,24}$/;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

/** Keep only the fields we sync, so a client cannot stuff arbitrary data in. */
function cleanProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const cap = (obj, n) => Object.fromEntries(Object.entries(obj || {}).slice(0, n));
  return {
    name: String(p.name || '').slice(0, 24),
    emoji: String(p.emoji || '').slice(0, 4),
    services: Array.isArray(p.services) ? p.services.slice(0, 40).map(s => String(s).slice(0, 40)) : [],
    saved: cap(p.saved, 500),
    watched: cap(p.watched, 500),
    notForMe: cap(p.notForMe, 1000),
    seen: cap(p.seen, 500),
    providerLog: cap(p.providerLog, 300),
    moodLog: Array.isArray(p.moodLog) ? p.moodLog.slice(-100) : [],
    taste: { explicit: cap(p.taste?.explicit, 60) },
    updatedAt: Number(p.updatedAt) || 0,
  };
}

/**
 * Netlify Functions v2. v1's `export const handler` does not receive the Blobs
 * context, so getStore() threw and sync was dead on the live deploy while
 * working nowhere to reveal it — the only symptom was Together being unable to
 * see the other phone.
 */
export default async (req) => {
  let store;
  try { store = getStore({ name: 'households', consistency: 'strong' }); }
  catch (e) {
    return Response.json({
      error: 'blobs_unavailable',
      // Say what actually went wrong. The previous version swallowed this and
      // left "not available on this deploy" as the only clue.
      detail: String(e?.message || e).slice(0, 200),
      message: 'Sync needs Netlify Blobs, which is not available on this deploy. ' +
               'Each phone still works on its own; only Together needs sync.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const code = String(new URL(req.url).searchParams.get('code') || '').trim().toLowerCase();
  if (!CODE_RE.test(code)) {
    return Response.json({ error: 'bad_code', message: 'A household code is 6-24 letters and digits.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  if (req.method === 'GET') {
    const doc = await store.get(code, { type: 'json' }).catch(() => null);
    return Response.json(doc || { profiles: {}, updatedAt: 0, empty: true },
      { headers: { 'Cache-Control': 'no-store' } });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); }
    catch { return Response.json({ error: 'bad_json' }, { status: 400 }); }

    const incoming = body?.profiles || {};
    const doc = (await store.get(code, { type: 'json' }).catch(() => null)) || { profiles: {} };

    const merged = { ...doc.profiles };
    const applied = [];
    for (const [id, raw] of Object.entries(incoming).slice(0, 10)) {
      if (!/^[a-z0-9_-]{1,24}$/.test(id)) continue;
      const clean = cleanProfile(raw);
      if (!clean) continue;
      const cur = merged[id];
      // Last write wins per profile.
      if (!cur || (clean.updatedAt || 0) > (cur.updatedAt || 0)) {
        merged[id] = clean;
        applied.push(id);
      }
    }

    const next = { profiles: merged, updatedAt: Date.now() };
    await store.setJSON(code, next);
    // Hand back the merged state so the caller can adopt anything newer than
    // what it sent, in one round trip.
    return Response.json({ ...next, applied }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return Response.json({ error: 'method_not_allowed' }, { status: 405 });
};

export const config = { path: '/api/household' };
