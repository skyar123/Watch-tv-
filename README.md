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

- **Calm grid** of 3–6 large, muted-color tiles a toddler can tap.
- **Curated YouTube** — paste approved video or playlist links; plays via the
  official YouTube IFrame player (privacy `nocookie` host), then returns to the
  grid on end. (Needs a connection.)
- **Local videos (offline)** — drop your own `.mp4` files in `/media` and play
  them with zero connection. The most reliable choice for a flight.
- **Open another app** — optional one-way deep-link tiles to Netflix Kids, PBS
  Kids, or Apple TV (these apps are DRM-protected and can't play *inside* this
  app — it hands off, you switch back by hand).
- **Calm ending** — every show ends on a quiet "All done" 🌙 card, never an
  autoplay cliff. This is the core anti-dysregulation feature.
- **Grown-up Settings** — PIN-gated (default **1357**). Add/remove/reorder
  shows, change the PIN, restore the starter set.

### What it deliberately does *not* do
- No search, no recommendations, no comments, no Shorts, no autoplay-next.
- It **cannot** embed or stream Netflix / Apple TV+ video — those are DRM-locked
  with no public API. For those, use the deep-link tiles (older child / home) or
  pre-downloaded episodes inside their own apps.

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

Tap the dimmed **⚙️** (top-right), enter the PIN (**1357** by default), then:

- **YouTube** — paste any `youtu.be/…`, `watch?v=…`, or playlist `…list=…`
  link, or a bare ID. A curated *playlist of one calm show* works well.
- **Local video** — copy your `.mp4` into the `media/` folder, then set the
  path, e.g. `media/puffin-rock.mp4`.
- **Open another app** — paste a Netflix / PBS / Apple TV link.

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
