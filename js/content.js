/* content.js — the curated whitelist, settings + persistence.
 *
 * Item:
 *   {
 *     id, type: "youtube"|"local"|"link", label, emoji,
 *     source: youtube -> video/playlist ID
 *             local   -> "media/file.mp4"
 *             link    -> deep-link URL
 *     kind:   youtube -> "video" | "playlist"
 *     thumb:  optional image URL (poster / video thumbnail)
 *     starred: optional bool ("Today's picks")
 *   }
 *
 * State (v2):
 *   { pin, settings:{...}, items:[...] }
 */
(function () {
  "use strict";

  var STORAGE_KEY = "calmscreens.v1";
  var DEFAULT_PIN = "1357";

  var DEFAULT_SETTINGS = {
    youtubeKey: "",     // YouTube Data API key (for in-app search)
    tmdbKey: "",        // TMDB API key (for cross-service show search)
    region: "US",       // 2-letter region for "where to watch"
    muteByDefault: false,
    sessionLimitMin: 0, // 0 = no limit
    showOnlyStarred: false,
  };

  var DEFAULTS = [
    { id: "pbs-kids", type: "link", label: "PBS Kids", emoji: "🦕", source: "https://pbskids.org/video/" },
    { id: "netflix-kids", type: "link", label: "Netflix Kids", emoji: "🐧", source: "https://www.netflix.com/kids" },
    { id: "appletv", type: "link", label: "Apple TV", emoji: "🐼", source: "https://tv.apple.com/" },
  ];

  /* ---- YouTube URL/ID parsing ---- */
  function parseYouTube(input) {
    if (!input) return null;
    var raw = String(input).trim();
    if (/^(PL|UU|LL|FL|RD|OL)[A-Za-z0-9_-]{10,}$/.test(raw)) return { kind: "playlist", source: raw };
    if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return { kind: "video", source: raw };
    var url;
    try { url = new URL(raw); } catch (e) { return null; }
    var list = url.searchParams.get("list");
    if (list && /^[A-Za-z0-9_-]{10,}$/.test(list)) return { kind: "playlist", source: list };
    var v = url.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return { kind: "video", source: v };
    var m = url.pathname.match(/\/(embed|shorts|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return { kind: "video", source: m[2] };
    if (/youtu\.be$/.test(url.hostname)) {
      var seg = url.pathname.replace(/^\//, "");
      if (/^[A-Za-z0-9_-]{11}$/.test(seg)) return { kind: "video", source: seg };
    }
    return null;
  }

  function youtubeThumb(id) {
    return "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
  }

  /* ---- deep-link templates for "where to watch" ---- */
  // Each maps a provider to a search URL for a title name. Netflix etc. have no
  // public title-ID API, so we deep-link to that service's SEARCH for the exact
  // title — one tap lands on the show. (DRM means it still plays in their app.)
  var PROVIDERS = [
    { match: /netflix/i,                 label: "Netflix",   emoji: "🐧", url: function (q) { return "https://www.netflix.com/search?q=" + enc(q); } },
    { match: /apple ?tv/i,               label: "Apple TV",  emoji: "🐼", url: function (q) { return "https://tv.apple.com/search?term=" + enc(q); } },
    { match: /disney/i,                  label: "Disney+",   emoji: "🏰", url: function (q) { return "https://www.disneyplus.com/search?q=" + enc(q); } },
    { match: /prime video|amazon/i,      label: "Prime",     emoji: "📦", url: function (q) { return "https://www.primevideo.com/search/ref=atv_nb_sr?phrase=" + enc(q); } },
    { match: /\bmax\b|hbo/i,             label: "Max",       emoji: "🟣", url: function (q) { return "https://play.max.com/search?q=" + enc(q); } },
    { match: /hulu/i,                    label: "Hulu",      emoji: "🟢", url: function (q) { return "https://www.hulu.com/search?q=" + enc(q); } },
    { match: /peacock/i,                 label: "Peacock",   emoji: "🦚", url: function (q) { return "https://www.peacocktv.com/search?q=" + enc(q); } },
    { match: /pbs/i,                     label: "PBS",       emoji: "🦕", url: function (q) { return "https://www.pbs.org/search/?q=" + enc(q); } },
  ];
  function enc(s) { return encodeURIComponent(s); }

  function providerFor(name) {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i].match.test(name)) return PROVIDERS[i];
    }
    return null;
  }

  /* ---- persistence ---- */
  function freshState() {
    return { pin: DEFAULT_PIN, settings: clone(DEFAULT_SETTINGS), items: DEFAULTS.map(clone) };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function migrate(data) {
    if (!data || typeof data !== "object") return freshState();
    if (!Array.isArray(data.items)) data.items = DEFAULTS.map(clone);
    if (!data.pin) data.pin = DEFAULT_PIN;
    data.settings = Object.assign(clone(DEFAULT_SETTINGS), data.settings || {});
    return data;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();
      return migrate(JSON.parse(raw));
    } catch (e) { return freshState(); }
  }
  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function reset() { var s = freshState(); save(s); return s; }

  function makeId() {
    return "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---- export / import (twin sync) ---- */
  // We share the library + safe (non-secret, non-region-locked) settings.
  // API keys and PIN are device-private and intentionally NOT exported.
  function exportData(state) {
    return {
      app: "calm-screens",
      v: 2,
      exportedAt: new Date().toISOString(),
      items: clone(state.items),
      settings: {
        muteByDefault: !!state.settings.muteByDefault,
        sessionLimitMin: state.settings.sessionLimitMin || 0,
        showOnlyStarred: !!state.settings.showOnlyStarred,
        region: state.settings.region || "US",
      },
    };
  }

  // mode: "replace" swaps the library; "merge" appends new items by id.
  function importData(state, payload, mode) {
    var data = typeof payload === "string" ? JSON.parse(payload) : payload;
    if (!data || data.app !== "calm-screens" || !Array.isArray(data.items)) {
      throw new Error("Not a Calm Screens backup");
    }
    if (mode === "merge") {
      var have = {};
      state.items.forEach(function (it) { have[it.id] = true; });
      data.items.forEach(function (it) {
        if (!it.id) it.id = makeId();
        if (!have[it.id]) state.items.push(it);
      });
    } else {
      state.items = data.items.map(function (it) {
        if (!it.id) it.id = makeId();
        return it;
      });
    }
    if (data.settings) {
      ["muteByDefault", "sessionLimitMin", "showOnlyStarred", "region"].forEach(function (k) {
        if (data.settings[k] !== undefined) state.settings[k] = data.settings[k];
      });
    }
    save(state);
    return state;
  }

  window.CalmContent = {
    DEFAULT_PIN: DEFAULT_PIN,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    DEFAULTS: DEFAULTS,
    parseYouTube: parseYouTube,
    youtubeThumb: youtubeThumb,
    providerFor: providerFor,
    PROVIDERS: PROVIDERS,
    load: load,
    save: save,
    reset: reset,
    makeId: makeId,
    exportData: exportData,
    importData: importData,
  };
})();
