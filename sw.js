/* sw.js — offline app shell + on-demand local media caching.
 * Bump CACHE when you change app files so iPad picks up the new version. */
var CACHE = "calm-screens-v1";

var SHELL = [
  "./",
  "index.html",
  "css/styles.css",
  "js/content.js",
  "js/app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // best-effort: don't fail install if one asset is missing
      return Promise.all(
        SHELL.map(function (u) {
          return c.add(u).catch(function () {});
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) { if (k !== CACHE) return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);

  // Never touch YouTube / cross-origin streaming — let the network handle it.
  if (url.origin !== self.location.origin) return;

  // Local media (mp4 etc): cache-first so a flight works offline once loaded.
  if (/\.(mp4|m4v|webm|ogg|mov)$/i.test(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && res.ok) c.put(req, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  // App shell: cache-first, fall back to network, then cached index for nav.
  e.respondWith(
    caches.match(req).then(function (hit) {
      return (
        hit ||
        fetch(req).catch(function () {
          if (req.mode === "navigate") return caches.match("index.html");
        })
      );
    })
  );
});
