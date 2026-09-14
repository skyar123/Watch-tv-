# What the data actually contains

Written after calling every endpoint, not before. Reproduce all of it with:

```bash
npm run verify            # TVmaze + RSS, no keys needed
TMDB_API_KEY=xxx npm run verify:tmdb
node scripts/check-curated.mjs
```

## Three features had to change because the data does not exist

### 1. There is no "Cancelled" status

The plan was Running / Ended / Cancelled. TVmaze's status vocabulary is
`Running`, `Ended`, `To Be Determined`, `In Development`. That is the whole
list. Checked against two famously cancelled shows:

```
1899   status='Ended'  ended='2022-11-17'
GLOW   status='Ended'  ended='2019-08-09'
```

Across 240 shows on page 0: `{Ended: 219, Running: 20, To Be Determined: 1}`.

**What the app does instead.** TVmaze supplies Running/Ended. TMDB does
distinguish `Canceled`, so the badge upgrades when a TMDB key is present, and
when it is not the detail sheet says so out loud rather than showing "Ended"
as if that settled it.

### 2. Nothing knows whether a show ends on a cliffhanger

No endpoint has a field for it. Not TVmaze, not TMDB.

**What the app does instead.** Three tiers, and the tier is always visible:

| Tier | Source | Shown as |
|---|---|---|
| `checked` | `src/data/curated.js`, written by hand with a date | "Unresolved ending" plus the note |
| `inferred` | Episode-rating shape, e.g. a finale far below the show's average | "Ending may not land" plus the arithmetic |
| `unknown` | Nothing to go on | "Nothing in the data says how this one ends" |

The inference is real but shallow, and it says so. On Game of Thrones it fires
correctly: *"the finale rates 5.3 against an 8.0 average"*. On Loki it fires the
other way: *"the finale rates 8.7 against an 8.1 average, which usually means it
landed"*.

### 3. There are no content descriptors anywhere

TMDB's `/tv/{id}/content_ratings` returns a certificate string and nothing else.
There is no gore, cruelty or peril field in TMDB or TVmaze. So kid-friendliness
judged on content — the thing actually worth knowing — cannot be derived.

**What the app does instead.** Hand-checked entries in `curated.js` carry what
is on screen and what was checked for and not found. Everything else reads
**"Not checked"**, never a green tick. A genre-only signal is labelled
`genre-only` and explicitly says a label is not a look at the show.

The same reasoning applies to representation: TMDB keywords include `lgbt`, but
a keyword cannot tell you whether a queer character is a lead or walks through
one scene. Those tags are hand-written with a note explaining why each show
qualifies, and the counts are shown honestly in Settings.

## What turned out better than planned

### Per-episode ratings and runtimes exist, free, no key

```
GET /shows/44933/episodes  →  19/19 episodes carry rating.average
                              19/19 carry runtime; summed = 927 min = 15.4 h
```

So **total hours is an exact sum**, not `episodes × average`. Verified:
Westworld 38 h, Game of Thrones 75 h, Breaking Bad 62 h. When some episodes
lack a runtime the app says `approx` and shows the arithmetic it used.

### But the rating spread is narrow, which breaks naive sparklines

Real spread on Severance is **7.0–8.5** on a 0–10 axis. Drawn against 0–10,
every show in the catalogue is a flat line and the sparkline is decoration.
Sparklines are therefore normalised against each show's own min/max, and the
real range is printed beside them so the scale cannot mislead.

### TVmaze serves landscape backdrops

`/shows/{id}/images` returns `background` entries up to 3840×2160 — 10/10 on a
sample of well-known shows. The feed is full-bleed with **no TMDB key at all**.

### One request instead of three

`?embed[]=episodes&embed[]=images` works, so a show costs one round trip.

### Two schedule endpoints with different shapes

```
/schedule?country=US&date=      → 54 rows, show under  .show
/schedule/web?date=&country=US  →  4 rows, show under  ._embedded.show
```

Confusing these silently yields undefined show names.

## Trailers without a key

TMDB is the authoritative source for trailer keys and needs one. Since the feed
is worthless without trailers, `/api/trailer` falls back to a **scored YouTube
search** when TMDB is unavailable.

Measured on 13 shows: **12 resolved the correct official trailer, 1 correctly
refused.** Two corrections were needed, both found by looking at real results:

| Problem | Real example | Rule added |
|---|---|---|
| A film sharing the series' name | `El Camino: A Breaking Bad Movie \| Official Trailer \| Netflix` won the search for *Breaking Bad* | the show name must head the title, before any separator; film-shaped titles rejected |
| A short name matching as a substring | *Special* got `Sherlock Special: Official TV Trailer - BBC` | the leading segment must equal the name or start with it on a word boundary, after stripping season/year noise and a leading article |

After both rules, *Special* finds nothing — which is the correct answer for a
one-word title with no distinctive results.

Every candidate is checked with `youtube.com/oembed`, which returns 200 only
for a public, embeddable video, so a card never mounts a player for something
that will refuse to play.

A searched match is **never** called exact. The card says "Trailer matched by
search, not confirmed" below high confidence, and the detail sheet names the
matched video and channel with a link to check it.

**Rate limiting is real.** YouTube redirects to a consent wall after a handful
of rapid searches from one IP — enough to break the feed after three cards.
Answers are cached in Netlify Blobs plus a module-scope memo, keyed on name and
year only, so a show is searched once. A rate-limit response is never cached;
it says nothing about the show.

## TMDB

Reachable, and returns `401 Invalid API key` without one, so the wiring is
proven even though the shapes are not. **No feature claims TMDB data until
`npm run verify:tmdb` passes on a real key.** Without the key:

| Feature | Without a TMDB key |
|---|---|
| Trailer | works — YouTube search fallback, labelled as a search match |
| Providers | "No provider data" |
| Cancelled status | "cancellation can only be confirmed from TMDB, which is unavailable on this deploy" |

## Netlify Blobs

Two things that cost a deploy each, recorded so they are not rediscovered:

- **Functions v1 does not receive the Blobs context.** `export const handler`
  made `getStore()` throw on every request. The trailer cache silently fell
  back to a per-instance memo and sync was dead — every response still 200.
  Both are Functions v2 now.
- **Blobs reads are eventually consistent by default.** The household function
  is read-modify-write, so an eventual read came back empty every time and each
  phone's push replaced the other's instead of merging. All stores now use
  `consistency: 'strong'`.
- A scheduled function may not also declare a custom `path`. That combination
  fails the build.

## RSS

13 feeds, each fetched and confirmed to return real `<item>` elements.
Seven are queer publications, deliberately.

| Source | Tag |
|---|---|
| Them, Autostraddle, Xtra Magazine, LGBTQ Nation, PinkNews, The Advocate, Out | queer |
| Variety, THR, TVLine, Deadline, AV Club, Polygon | tv |

Tried and dropped after failing: **Vulture** (404) and **IndieWire's TV feed**
(200 but zero items).

Them and Polygon sit behind Cloudflare and intermittently 403 a datacentre IP
regardless of User-Agent — observed returning 200, then 403 minutes later. They
stay in the list, and the news function reports per-source status so an outlet
that drops out is visible as "unreachable" rather than looking like a slow news
day.

## Recency: what TVmaze does and does not tell you

`GET /shows?page=N` returns `premiered` as a full ISO date and `_links.nextepisode`
when an episode is still scheduled. The second of those is the only factual
"is this on the air right now" signal available without fetching every show
individually, and it is present on about 3% of rows (38 of 130 Running shows in
a 1,425-row sample). Both are baked: the full premiere date for anything within
three years, since the year alone cannot tell "out last month" from "out in
eleven weeks", and an `airing` flag.

`weight` is a trap. It is presented like a property of the show and it is a
rolling measure of what everyone is looking at this week. Re-baking one day
apart, 16,719 of the 24,121 shows present in both bakes had their weight
change, and 3,469 crossed the old cutoff and vanished from the index:
Rebelde 90 to 55 overnight, Whale Wars 87 to 58, Sherlock Holmes 83 to 39, all
confirmed against `/shows/{id}` directly. So the threshold governs admission
only, and a show already in the index stays while it still has artwork.
`scripts/prove-catalogue.mjs` checks that on every re-bake and asks TVmaze
about anything that left, rather than assuming it was deleted.

## News: matching an article to a show

`scripts/test-newsmatch.mjs` runs the matcher over the live feeds and prints
every match. The numbers that matter, measured on 197 real articles:

| approach | articles matched | correct |
|---|---|---|
| any of the 32,138 catalogue titles, anywhere in the text | 76% | mostly not |
| quoted titles plus your own saved shows | 10% | 19 of 19 |

The first approach reported an Autostraddle piece headlined "My Girlfriend
Thinks I'm Prioritizing Exercise Over Her" as being about the show *Girlfriend*.
With 32,000 titles, nearly every ordinary English word is a show somewhere.

Two things about quote extraction that are not obvious. A closing single quote
and an apostrophe are the same character, so extraction has to require a
matching opening mark or every possessive becomes a title. And publications use
quotes for reported speech as well as for titles, which turned "LGBTQ+ book shop
'blown away' by support" into coverage of *Blown Away*; house style separates
them, because a title is capitalised and a scare quote is not.
