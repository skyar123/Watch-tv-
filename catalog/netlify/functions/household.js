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

export const handler = async (event) => {
  let store;
  try { store = getStore('households'); }
  catch {
    return json(503, { error: 'blobs_unavailable',
      message: 'Sync needs Netlify Blobs, which is not available on this deploy. ' +
               'Each phone still works on its own; only Together needs sync.' });
  }

  const p = event.queryStringParameters || {};
  const code = String(p.code || '').trim().toLowerCase();
  if (!CODE_RE.test(code)) {
    return json(400, { error: 'bad_code', message: 'A household code is 6–24 letters and digits.' });
  }

  if (event.httpMethod === 'GET') {
    const doc = await store.get(code, { type: 'json' }).catch(() => null);
    return json(200, doc || { profiles: {}, updatedAt: 0, empty: true });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return json(400, { error: 'bad_json' }); }

    const incoming = body.profiles || {};
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
    return json(200, { ...next, applied });
  }

  return json(405, { error: 'method_not_allowed' });
};
