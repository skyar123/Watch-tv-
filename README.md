# 🌙 Calm Screens

A calm, low-stimulation video app for **1–2 year olds**. It shows a small grid
of big, gentle tiles. Tap one → it plays one show → when the show ends it
**returns to the calm grid**. No autoplay-next, no recommendations, no search,
no algorithm. Designed to be locked under **iPad Guided Access** on a plane.

This is a self-contained web app (a PWA) — no build step, no backend, no
accounts. Open `index.html` and it runs. Add it to the iPad home screen and it
runs full-screen and offline.

---

## What it does

- **Calm grid** of large, muted-color tiles with **real show artwork** a
  toddler can recognise (a pre-reader knows the puffin, not the word).
- **🔎 In-app search-to-add** — type a show name and add it without leaving the
  app: a **YouTube** search (results + thumbnails) and a **cross-service** search
  (find any show, see *where to watch* it, add a tile that links straight to
  **that show** — not the whole app).
- **Curated YouTube** — plays via the official IFrame player (privacy `nocookie`
  host), then returns to the grid on end.
- **Local videos (offline)** — drop your own `.mp4` files in `/media` and play
  them with zero connection. The most reliable choice for a flight.
- **Calm ending** — every show ends on a quiet "All done" 🌙 card, never an
  autoplay cliff. This is the core anti-dysregulation feature.
- **Calm controls** — Today's-picks (⭐ star a small grid), mute-by-default, and
  a gentle "all done for now" time limit.
- **Backup & twin sync** — export your library and import it on the second iPad.
- **Grown-up Settings** — PIN-gated (default **1357**). Add via search or
  manually, reorder, star, change the PIN, restore the starter set.

### What it deliberately does *not* do
- No search, recommendations, comments, Shorts, or autoplay-next **for the
  child** (search lives only behind the grown-up PIN).
- It **cannot** embed or stream Netflix / Apple TV+ video — those are DRM-locked
  with no public API. Those tiles deep-link to the exact show; for in-app,
  calm-ending playback use YouTube or local `.mp4` files.

---

## Run it

### Try it on a computer
```bash
# any static server works; for example:
python3 -m http.server 8080
# then open http://localhost:8080
```

### Put it on the iPad (recommended)
1. Host the folder somewhere the iPad can reach it (a local server on your
   laptop, or any static host), **or** use a local-files PWA approach.
2. Open it in **Safari** on the iPad.
3. Share → **Add to Home Screen**. This makes it full-screen and makes offline
   caching persistent.
4. Open it from the home-screen icon.

### Lock it down for a toddler (Guided Access)
1. Settings → Accessibility → **Guided Access** → On; set a passcode.
2. Open Calm Screens, then **triple-click** the side/Home button → Start.
3. Optionally circle the top corners to disable touch over the YouTube logo.
4. To exit: triple-click again + passcode / Face ID.

---

## Add your own shows

Tap the dimmed **⚙️** (top-right), enter the PIN (**1357** by default).

### 🔎 Search & add (the easy way — never leave the app)

Once you've added free API keys (one-time, below), use the **Search & add**
box at the top of Settings:

- **▶️ YouTube tab** — type e.g. *"Sesame Street Brandi Carlile"*, see results
  with thumbnails, tap **Add**. The show lands on the grid with its real artwork.
- **📺 Shows tab** — type e.g. *"Puffin Rock"*, see posters, tap a show to see
  **where to watch** it in your region, then pick a service (Netflix / Apple TV /
  PBS / Disney+ / …). That adds a tile that deep-links straight to **that show**
  — not the whole app.

> Honest note: Netflix/Apple TV+ are DRM-locked with no public API, so a "Shows"
> tile still *opens their app* (to that exact title's page), it can't play inside
> Calm Screens. For fully in-app, calm-ending playback use the YouTube tab or
> local `.mp4` files.

### One-time API keys (≈2 minutes, free)

In Settings → **Search keys**:

- **YouTube Data API key** — go to [console.cloud.google.com](https://console.cloud.google.com/),
  create a project, enable **"YouTube Data API v3"**, then **Credentials → Create
  credentials → API key**. Paste the `AIza…` key. (Free quota ≈ 100 searches/day.)
- **TMDB API key** — make a free account at
  [themoviedb.org](https://www.themoviedb.org/settings/api), request an API key,
  and paste either the **v3 key** or the **v4 bearer token** (both work).
- **Region** — your 2-letter country code (e.g. `US`) for accurate "where to watch".

No keys? The app still works fully — you just add shows manually instead of
searching.

### Manual add (Advanced)

- **YouTube** — paste any `youtu.be/…`, `watch?v=…`, or playlist `…list=…`
  link, or a bare ID.
- **Local video** — copy your `.mp4` into `media/`, then set the path,
  e.g. `media/puffin-rock.mp4`.
- **Open another app** — paste a Netflix / PBS / Apple TV link.

### Calm settings

- **Today's picks only** — ⭐ star a few shows in the list; the grid shows just
  those, keeping it tiny and calm even with a big library behind it.
- **Mute by default** — every show starts silent (great on a plane; many of
  these shows carry on the visuals alone). A 🔊 toggle is on the player.
- **Gentle time limit** — after N minutes a calm "all done for now" appears;
  a grown-up taps ⚙️ (PIN) to start a fresh session.

### Backup & twin sync

**Copy library** / **Save file** exports your shows + calm settings (PIN and API
keys stay private). On the second iPad, paste it under **Import** and choose
**Replace** or **Merge** — so you set everything up once for both twins.

Change the PIN from the same screen. Forgot the PIN? Clear the app's site data
in Safari settings (this resets to the starter set + default PIN).

---

## Verified-friendly content ideas (2026)

Low-stimulation, slow-paced picks to curate (verify availability/region first):

- **Apple TV+:** Stillwater
- **Netflix:** Puffin Rock, Trash Truck, Ms. Rachel, Sesame Street
- **PBS Kids (free):** Daniel Tiger, Elinor Wonders Why, Alma's Way, Molly of Denali
- **YouTube:** Ms. Rachel, calm circle-time channels

**Avoid** fast-cut, high-arousal content (Cocomelon, Blippi, PJ Masks,
unboxing/surprise-egg videos) — rapid scene changes work against calm.

> The American Academy of Pediatrics discourages screen media under 18–24 months
> except video-chatting, and recommends slow, ad-free, co-viewed content after.
> Treat this app as **harm reduction** for an unavoidable long flight, not
> routine use. Co-view and mute where you can — many of these shows carry fine
> on calm visuals alone.

---

## Project layout

```
index.html              app shell (home / player / caregiver screens)
css/styles.css          calm muted theme, big tap targets
js/content.js           whitelist defaults, YouTube link parsing, storage
js/app.js               grid, player, calm-ending, PIN-gated settings
sw.js                   offline app shell + local-media caching
manifest.webmanifest    PWA install metadata
icons/                  generated app icons (crescent moon)
tools/make-icons.js     zero-dependency icon generator (node tools/make-icons.js)
media/                  put your own .mp4 files here
```

## Notes & honest limits
- YouTube's `rel=0`/`modestbranding` no longer fully hide its logo or related
  videos (ToS changes in 2018/2023). The transparent corner blockers reduce, but
  can't 100% remove, that chrome. Fine for private family use.
- Deep links are one-way; Netflix direct-to-play links broke around Sept 2025, so
  a Netflix tile opens to a title page. Pair with Guided Access on that app.
- iOS PWA storage can be evicted unless added to the home screen; bundle local
  `.mp4`s for guaranteed offline playback.
