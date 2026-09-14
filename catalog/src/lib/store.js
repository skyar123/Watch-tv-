/**
 * State for two people sharing one link.
 *
 * Skylar and Anja each get their own space — their own services, saved shows,
 * episode progress, hidden shows and learned taste — and there is a third mode,
 * Together, for deciding what to watch as a pair.
 *
 * Together is not a third person. It keeps its own list of what you plan to
 * watch together, but for FILTERING it reads from both people: the services are
 * the union (you watch on one screen, so either subscription works), and a show
 * either of you has hidden is hidden, because "not for me" from one half of a
 * sofa is a no.
 *
 * Everything is namespaced under one key so it exports in one piece, and the
 * whole object is what syncs between the two phones.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'tonight:v2';
const LEGACY_KEY = 'tonight:v1';

export const TOGETHER = 'together';

const emptyProfile = (name, emoji) => ({
  name,
  emoji,
  services: ['Netflix', 'Hulu', 'Amazon Prime Video'],
  saved: {},        // showKey -> { addedAt, name, poster }
  watched: {},      // showKey -> { [episodeId]: watchedAt }
  notForMe: {},     // showKey -> hiddenAt
  seen: {},         // showKey -> lastSeenInFeedAt
  providerLog: {},  // showKey -> [{ at, names[] }]
  moodLog: [],
  taste: { likes: {}, dislikes: {}, explicit: {} },   // see lib/taste.js
  lastAction: null,  // the most recent swipe, so it can be undone
  updatedAt: 0,
});

const randomId = () => Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 6);

const EMPTY = {
  version: 2,
  household: null,          // shared id; both phones use the same one to sync
  active: 'p1',
  hideUnavailable: false,
  profiles: {
    p1: emptyProfile('Skylar', '🌙'),
    p2: emptyProfile('Anja', '✨'),
    [TOGETHER]: emptyProfile('Together', '🛋️'),
  },
  lastSyncAt: 0,
  updatedAt: 0,
};

/**
 * v1 stored one unnamed person's data at the top level. Fold it into the first
 * profile rather than dropping it — that data is someone's watch history.
 */
function migrate(v1) {
  const next = structuredClone(EMPTY);
  next.profiles.p1 = {
    ...next.profiles.p1,
    services: v1.services || next.profiles.p1.services,
    saved: v1.saved || {},
    watched: v1.watched || {},
    notForMe: v1.notForMe || {},
    seen: v1.seen || {},
    providerLog: v1.providerLog || {},
    moodLog: v1.moodLog || [],
  };
  next.hideUnavailable = Boolean(v1.hideUnavailable);
  next.migratedFrom = 'v1';
  return next;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge against EMPTY so a profile added in a later version appears.
      return {
        ...EMPTY, ...parsed,
        profiles: { ...EMPTY.profiles, ...(parsed.profiles || {}) },
      };
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return migrate(JSON.parse(legacy));
  } catch { /* private mode, or corrupt; start clean rather than crash */ }
  return structuredClone(EMPTY);
}

let state = load();
const listeners = new Set();

function commit(next) {
  state = { ...next, updatedAt: Date.now() };
  cachedFor = null;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* full or blocked */ }
  listeners.forEach(l => l());
}

/** Write into one profile, stamping it so sync can resolve by recency. */
function patchProfile(id, patch) {
  const cur = state.profiles[id];
  if (!cur) return;
  commit({
    ...state,
    profiles: { ...state.profiles, [id]: { ...cur, ...patch, updatedAt: Date.now() } },
  });
}

export function subscribe(l) { listeners.add(l); return () => listeners.delete(l); }
export function getRaw() { return state; }

const mergeMaps = (a = {}, b = {}) => ({ ...a, ...b });

/**
 * The shape every screen reads. Keeping the v1 field names means the screens
 * did not have to learn about profiles at all.
 */
export function view(s = state) {
  const id = s.active;
  const me = s.profiles[id] || s.profiles.p1;
  const people = Object.entries(s.profiles).filter(([k]) => k !== TOGETHER);

  if (id !== TOGETHER) {
    return {
      ...me,
      profileId: id,
      isTogether: false,
      profiles: s.profiles,
      household: s.household,
      hideUnavailable: s.hideUnavailable,
      lastSyncAt: s.lastSyncAt,
      // Who else is on this link, for the Together copy.
      others: people.filter(([k]) => k !== id).map(([k, p]) => ({ id: k, ...p })),
    };
  }

  // Together: own lists, but both people's filters.
  const tog = s.profiles[TOGETHER];
  return {
    ...tog,
    profileId: TOGETHER,
    isTogether: true,
    profiles: s.profiles,
    household: s.household,
    hideUnavailable: s.hideUnavailable,
    lastSyncAt: s.lastSyncAt,
    others: people.map(([k, p]) => ({ id: k, ...p })),
    // Union: you watch together on one screen, so either subscription works.
    services: [...new Set(people.flatMap(([, p]) => p.services))],
    // A no from either half of the sofa is a no.
    notForMe: people.reduce((a, [, p]) => mergeMaps(a, p.notForMe), { ...tog.notForMe }),
    // Anything either of you has already seen counts as seen together.
    watched: people.reduce((a, [, p]) => mergeMaps(a, p.watched), { ...tog.watched }),
    savedByEither: people.reduce((a, [, p]) => mergeMaps(a, p.saved), {}),
  };
}

/**
 * useSyncExternalStore compares snapshots by identity. view() builds a fresh
 * object every call, so returning it directly made React see a change on every
 * render and loop until it threw "maximum update depth exceeded". The snapshot
 * is therefore memoised against the state object it was derived from, and only
 * recomputed when a commit actually replaces that object.
 */
let cachedView = null;
let cachedFor = null;
function snapshot() {
  if (cachedFor !== state) { cachedFor = state; cachedView = view(state); }
  return cachedView;
}

const SERVER_VIEW = view(EMPTY);
const serverSnapshot = () => SERVER_VIEW;

export function useStore() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

// ───────────────────────────────────────────────────────────────── mutations
export const actions = {
  switchProfile(id) {
    if (!state.profiles[id]) return;
    commit({ ...state, active: id });
  },
  renameProfile(id, name, emoji) {
    patchProfile(id, { name: name.slice(0, 24), ...(emoji ? { emoji } : {}) });
  },

  save(show, { viaSwipe = false } = {}) {
    const id = state.active;
    const p = state.profiles[id];
    patchProfile(id, {
      saved: { ...p.saved,
        [show.key]: { addedAt: Date.now(), name: show.name, poster: show.poster, viaSwipe } },
      lastAction: { kind: 'save', key: show.key, name: show.name, at: Date.now() },
    });
  },
  unsave(key) {
    const id = state.active;
    const saved = { ...state.profiles[id].saved };
    delete saved[key];
    patchProfile(id, { saved });
  },
  toggleSave(show) {
    state.profiles[state.active].saved[show.key] ? actions.unsave(show.key) : actions.save(show);
  },

  /**
   * One tap, gone from every list — for the person who tapped it. In Together
   * it hides for the pair only; neither person's own feed is edited on their
   * behalf, because that is their call to make.
   */
  notForMe(show) {
    const id = state.active;
    const p = state.profiles[id];
    const saved = { ...p.saved };
    const wasSaved = saved[show.key];
    delete saved[show.key];
    patchProfile(id, {
      saved,
      notForMe: { ...p.notForMe, [show.key]: Date.now() },
      // Enough to put things back exactly as they were, including a save the
      // hide displaced. Swiping is fast and a mis-flick must not cost anything.
      lastAction: { kind: 'hide', key: show.key, name: show.name, at: Date.now(), wasSaved },
    });
  },

  /** Reverse the last swipe. */
  undoLast() {
    const id = state.active;
    const p = state.profiles[id];
    const last = p.lastAction;
    if (!last) return null;
    if (last.kind === 'save') {
      const saved = { ...p.saved };
      delete saved[last.key];
      patchProfile(id, { saved, lastAction: null });
    } else {
      const n = { ...p.notForMe };
      delete n[last.key];
      const saved = { ...p.saved };
      if (last.wasSaved) saved[last.key] = last.wasSaved;
      patchProfile(id, { notForMe: n, saved, lastAction: null });
    }
    return last;
  },
  clearLastAction() {
    if (state.profiles[state.active]?.lastAction) patchProfile(state.active, { lastAction: null });
  },
  unhide(key) {
    const id = state.active;
    const n = { ...state.profiles[id].notForMe };
    delete n[key];
    patchProfile(id, { notForMe: n });
  },

  /**
   * "I have seen all of this", without needing the episode list.
   *
   * Telling the app what you have already watched is the fastest way to teach
   * it, and demanding 62 episode taps — or 62 API calls — to record one fact
   * would make that the slowest. The __all sentinel records the fact; episode
   * detail can still be filled in later and simply replaces it.
   */
  declareFinished(show, { loved = false, on = true } = {}) {
    const id = state.active;
    const p = state.profiles[id];
    const watched = { ...p.watched };
    if (on) watched[show.key] = { ...(watched[show.key] || {}), __all: Date.now() };
    else {
      const forShow = { ...(watched[show.key] || {}) };
      delete forShow.__all;
      if (Object.keys(forShow).length) watched[show.key] = forShow; else delete watched[show.key];
    }
    const saved = { ...p.saved };
    if (on && loved) {
      saved[show.key] = { addedAt: Date.now(), name: show.name, poster: show.poster, loved: true };
    }
    patchProfile(id, { watched, saved,
      lastAction: on
        ? { kind: loved ? 'loved' : 'seen', key: show.key, name: show.name, at: Date.now() }
        : p.lastAction });
  },

  /** Teach the OTHER person's profile without switching to it. */
  teachProfile(profileId, show, verdict) {
    const p = state.profiles[profileId];
    if (!p) return;
    const watched = { ...p.watched };
    const saved = { ...p.saved };
    const notForMe = { ...p.notForMe };
    delete watched[show.key]; delete saved[show.key]; delete notForMe[show.key];

    // 'clear' falls through having deleted all three, which is the toggle-off.
    if (verdict === 'loved' || verdict === 'seen') {
      watched[show.key] = { __all: Date.now() };
      if (verdict === 'loved') {
        saved[show.key] = { addedAt: Date.now(), name: show.name, poster: show.poster, loved: true };
      }
    } else if (verdict === 'nope') {
      notForMe[show.key] = Date.now();
    }
    commit({ ...state, profiles: { ...state.profiles,
      [profileId]: { ...p, watched, saved, notForMe, updatedAt: Date.now() } } });
  },

  markWatched(showKey, episodeId, on = true) {
    const id = state.active;
    const p = state.profiles[id];
    const forShow = { ...(p.watched[showKey] || {}) };
    if (on) forShow[episodeId] = Date.now(); else delete forShow[episodeId];
    patchProfile(id, { watched: { ...p.watched, [showKey]: forShow } });
  },
  markThrough(showKey, episodes, episode) {
    const id = state.active;
    const p = state.profiles[id];
    const forShow = { ...(p.watched[showKey] || {}) };
    const at = Date.now();
    for (const e of episodes) {
      const before = e.season < episode.season ||
                     (e.season === episode.season && e.number <= episode.number);
      if (before) forShow[e.id] = forShow[e.id] || at;
    }
    patchProfile(id, { watched: { ...p.watched, [showKey]: forShow } });
  },
  clearShowProgress(showKey) {
    const id = state.active;
    const w = { ...state.profiles[id].watched };
    delete w[showKey];
    patchProfile(id, { watched: w });
  },

  setServices(list) { patchProfile(state.active, { services: list }); },
  setHideUnavailable(v) { commit({ ...state, hideUnavailable: Boolean(v) }); },
  markSeen(key) {
    const id = state.active;
    const p = state.profiles[id];
    if (p.seen[key] && Date.now() - p.seen[key] < 60000) return;   // do not thrash storage
    patchProfile(id, { seen: { ...p.seen, [key]: Date.now() } });
  },
  logMood(mood, pickedKey) {
    const id = state.active;
    const p = state.profiles[id];
    patchProfile(id, { moodLog: [...p.moodLog.slice(-99), { at: Date.now(), mood, pickedKey }] });
  },

  /** Explicit taste switches, set by hand in Settings. */
  setExplicitTaste(patch) {
    const id = state.active;
    const p = state.profiles[id];
    patchProfile(id, { taste: { ...p.taste, explicit: { ...p.taste.explicit, ...patch } } });
  },

  logProviders(showKey, names) {
    const id = state.active;
    const p = state.profiles[id];
    const log = p.providerLog[showKey] || [];
    const last = log[log.length - 1];
    const same = last && last.names.length === names.length &&
                 last.names.every((n, i) => n === names[i]);
    if (same) return null;
    const entry = { at: Date.now(), names: [...names] };
    patchProfile(id, { providerLog: { ...p.providerLog, [showKey]: [...log, entry].slice(-12) } });
    return last ? { from: last.names, to: names, since: last.at } : null;
  },

  // ── household sync ───────────────────────────────────────────────────────
  ensureHousehold() {
    if (state.household) return state.household;
    const h = randomId();
    commit({ ...state, household: h });
    return h;
  },
  setHousehold(code) {
    commit({ ...state, household: String(code).trim().toLowerCase().slice(0, 24) || null });
  },
  /** Replace one profile wholesale, used when a pull brings in the other phone's copy. */
  applyRemoteProfile(id, profile) {
    const cur = state.profiles[id];
    // Last write wins per profile. Each profile is normally edited on one
    // phone, so this is almost never a real conflict.
    if (cur && (cur.updatedAt || 0) >= (profile.updatedAt || 0)) return false;
    commit({ ...state, profiles: { ...state.profiles, [id]: profile } });
    return true;
  },
  noteSync(at = Date.now()) { commit({ ...state, lastSyncAt: at }); },

  importAll(obj) {
    if (obj?.version === 2) commit({ ...EMPTY, ...obj });
    else if (obj?.version === 1) commit(migrate(obj));
  },
  reset() { commit(structuredClone(EMPTY)); },
};

/** Provider changes across saved shows: what gained a service, what lost one. */
export function providerChanges(v) {
  const out = [];
  for (const [key, log] of Object.entries(v.providerLog || {})) {
    if (log.length < 2) continue;
    const prev = log[log.length - 2], now = log[log.length - 1];
    const lost = prev.names.filter(n => !now.names.includes(n));
    const gained = now.names.filter(n => !prev.names.includes(n));
    if (!lost.length && !gained.length) continue;
    out.push({ key, name: v.saved[key]?.name || key, at: now.at, lost, gained,
               nowOn: now.names, saved: Boolean(v.saved[key]) });
  }
  return out.sort((a, b) => b.at - a.at);
}

export const watchedSet = (v, key) => new Set(Object.keys(v.watched?.[key] || {}).map(Number));
