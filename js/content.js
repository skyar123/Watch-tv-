/* content.js — the curated whitelist + persistence.
 *
 * Each item:
 *   {
 *     id:    unique string,
 *     type:  "youtube" | "local" | "link",
 *     label: friendly name (shown on the tile),
 *     emoji: one emoji shown on the tile,
 *     source: for youtube -> video ID or playlist ID
 *             for local   -> path to a bundled mp4 (e.g. "media/puffin.mp4")
 *             for link    -> a URL to deep-link out to (Netflix / PBS / Apple TV)
 *     kind:  for youtube only -> "video" | "playlist"
 *   }
 *
 * STARTER set ships with reliable deep-links (no fragile video IDs to guess)
 * plus everything you need to add curated YouTube IDs and local mp4s yourself
 * from the grown-up Settings screen. See README.md.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "calmscreens.v1";
  var DEFAULT_PIN = "1357";

  // Verified-friendly starter tiles. Deep-links open the calm corners of each
  // app; you can replace or extend them in Settings. (Netflix/Apple TV cannot
  // play *inside* this app — DRM — so these are one-way handoffs. Best paired
  // with a single show already queued + Guided Access.)
  var DEFAULTS = [
    {
      id: "pbs-kids",
      type: "link",
      label: "PBS Kids",
      emoji: "🦕",
      source: "https://pbskids.org/video/",
    },
    {
      id: "netflix-kids",
      type: "link",
      label: "Netflix Kids",
      emoji: "🐧",
      source: "https://www.netflix.com/kids",
    },
    {
      id: "appletv",
      type: "link",
      label: "Apple TV",
      emoji: "🐼",
      source: "https://tv.apple.com/",
    },
  ];

  /* ---- YouTube URL/ID parsing -------------------------------------------
   * Accepts: a bare 11-char video ID, a youtu.be/ID, watch?v=ID,
   * /embed/ID, /shorts/ID, and playlist?list=ID or &list=ID.
   * Returns { kind: "video"|"playlist", source: ID } or null. */
  function parseYouTube(input) {
    if (!input) return null;
    var raw = String(input).trim();

    // bare playlist id (starts with PL, UU, LL, FL, RD, OL...)
    if (/^(PL|UU|LL|FL|RD|OL)[A-Za-z0-9_-]{10,}$/.test(raw)) {
      return { kind: "playlist", source: raw };
    }
    // bare video id
    if (/^[A-Za-z0-9_-]{11}$/.test(raw)) {
      return { kind: "video", source: raw };
    }

    var url;
    try {
      url = new URL(raw);
    } catch (e) {
      return null;
    }

    var list = url.searchParams.get("list");
    if (list && /^[A-Za-z0-9_-]{10,}$/.test(list)) {
      return { kind: "playlist", source: list };
    }

    var v = url.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) {
      return { kind: "video", source: v };
    }

    var m = url.pathname.match(/\/(embed|shorts|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return { kind: "video", source: m[2] };

    if (/youtu\.be$/.test(url.hostname)) {
      var seg = url.pathname.replace(/^\//, "");
      if (/^[A-Za-z0-9_-]{11}$/.test(seg)) return { kind: "video", source: seg };
    }
    return null;
  }

  /* ---- persistence ------------------------------------------------------ */
  function freshState() {
    return { pin: DEFAULT_PIN, items: DEFAULTS.map(clone) };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.items)) return freshState();
      if (!data.pin) data.pin = DEFAULT_PIN;
      return data;
    } catch (e) {
      return freshState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage full / private mode — app still runs for this session */
    }
  }

  function reset() {
    var s = freshState();
    save(s);
    return s;
  }

  function makeId() {
    return "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  window.CalmContent = {
    DEFAULT_PIN: DEFAULT_PIN,
    DEFAULTS: DEFAULTS,
    parseYouTube: parseYouTube,
    load: load,
    save: save,
    reset: reset,
    makeId: makeId,
  };
})();
