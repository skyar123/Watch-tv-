/**
 * All of this user's state, in localStorage. One user, one phone, no accounts.
 *
 * Everything is namespaced under one key so it exports and re-imports in one
 * piece, and every write bumps a version stamp so a future migration can tell
 * what it is looking at.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'tonight:v1';

const EMPTY = {
  version: 1,
  services: ['Netflix', 'Hulu', 'Amazon Prime Video'],  // editable in Settings
  hideUnavailable: false,
  saved: {},        // showKey -> { addedAt, name, poster }
  watched: {},      // showKey -> { [episodeId]: watchedAt }
  notForMe: {},     // showKey -> hiddenAt        (removes it from every list)
  seen: {},         // showKey -> lastSeenInFeedAt (so the feed stops repeating)
  providerLog: {},  // showKey -> [{ at, names[] }]  the "leaving soon" diff trail
  moodLog: [],      // { at, mood, pickedKey }
  updatedAt: 0,
};

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return { ...EMPTY, ...parsed };
  } catch { return { ...EMPTY }; }
}

function commit(next) {
  state = { ...next, updatedAt: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode / full */ }
  listeners.forEach(l => l());
}

export function subscribe(l) { listeners.add(l); return () => listeners.delete(l); }
export function getState() { return state; }
export function useStore(selector = s => s) {
  return useSyncExternalStore(subscribe, () => selector(getState()), () => selector(EMPTY));
}

// ───────────────────────────────────────────────────────────────── mutations
export const actions = {
  save(show) {
    commit({ ...state, saved: { ...state.saved,
      [show.key]: { addedAt: Date.now(), name: show.name, poster: show.poster } } });
  },
  unsave(key) {
    const saved = { ...state.saved }; delete saved[key];
    commit({ ...state, saved });
  },
  toggleSave(show) {
    state.saved[show.key] ? actions.unsave(show.key) : actions.save(show);
  },

  /** One tap, gone from every list. Reversible from Settings. */
  notForMe(show) {
    const saved = { ...state.saved }; delete saved[show.key];
    commit({ ...state, saved, notForMe: { ...state.notForMe, [show.key]: Date.now() } });
  },
  unhide(key) {
    const n = { ...state.notForMe }; delete n[key];
    commit({ ...state, notForMe: n });
  },

  markWatched(showKey, episodeId, on = true) {
    const forShow = { ...(state.watched[showKey] || {}) };
    if (on) forShow[episodeId] = Date.now(); else delete forShow[episodeId];
    commit({ ...state, watched: { ...state.watched, [showKey]: forShow } });
  },
  /** Mark everything up to and including an episode — the realistic gesture. */
  markThrough(showKey, episodes, episode) {
    const forShow = { ...(state.watched[showKey] || {}) };
    const at = Date.now();
    for (const e of episodes) {
      const before = e.season < episode.season ||
                     (e.season === episode.season && e.number <= episode.number);
      if (before) forShow[e.id] = forShow[e.id] || at;
    }
    commit({ ...state, watched: { ...state.watched, [showKey]: forShow } });
  },
  clearShowProgress(showKey) {
    const w = { ...state.watched }; delete w[showKey];
    commit({ ...state, watched: w });
  },

  setServices(list) { commit({ ...state, services: list }); },
  setHideUnavailable(v) { commit({ ...state, hideUnavailable: Boolean(v) }); },
  markSeen(key) { commit({ ...state, seen: { ...state.seen, [key]: Date.now() } }); },
  logMood(mood, pickedKey) {
    commit({ ...state, moodLog: [...state.moodLog.slice(-99), { at: Date.now(), mood, pickedKey }] });
  },

  /**
   * The "leaving soon" trail. Each time we see a show's provider set we append
   * it — but only when it actually CHANGED, so the log stays small and every
   * entry is a real transition with a date on it.
   */
  logProviders(showKey, names) {
    const log = state.providerLog[showKey] || [];
    const last = log[log.length - 1];
    const same = last && last.names.length === names.length &&
                 last.names.every((n, i) => n === names[i]);
    if (same) return null;
    const entry = { at: Date.now(), names: [...names] };
    commit({ ...state, providerLog: { ...state.providerLog, [showKey]: [...log, entry].slice(-12) } });
    return last ? { from: last.names, to: names, since: last.at } : null;
  },

  importAll(obj) { commit({ ...EMPTY, ...obj }); },
  reset() { commit({ ...EMPTY }); },
};

/** Provider changes across saved shows: what gained a service, what lost one. */
export function providerChanges(s = state) {
  const out = [];
  for (const [key, log] of Object.entries(s.providerLog)) {
    if (log.length < 2) continue;
    const prev = log[log.length - 2], now = log[log.length - 1];
    const lost = prev.names.filter(n => !now.names.includes(n));
    const gained = now.names.filter(n => !prev.names.includes(n));
    if (!lost.length && !gained.length) continue;
    out.push({ key, name: s.saved[key]?.name || key, at: now.at, lost, gained,
               nowOn: now.names, saved: Boolean(s.saved[key]) });
  }
  return out.sort((a, b) => b.at - a.at);
}

export const watchedSet = (s, key) => new Set(Object.keys(s.watched[key] || {}).map(Number));
