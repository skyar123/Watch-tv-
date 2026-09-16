import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { RefreshCw, Loader2, Sparkles, LayoutGrid, Rows3 } from 'lucide-react';
import FeedCard from '../components/FeedCard.jsx';
import GridView from '../components/GridView.jsx';
import { useStore, actions } from '../lib/store.js';
import ProfileBar from '../components/ProfileBar.jsx';
import { totalTime } from '../lib/derive.js';
import { availability } from '../lib/providers.js';
import { fetchShow } from '../lib/tvmaze.js';
import { recordSwipe } from '../lib/session.js';
import { featuresOf } from '../lib/taste.js';
import { Freshness } from '../components/bits.jsx';
import { bucketOf, bucketName, countByService, subscribedIds, serviceById, MINE }
  from '../lib/services.js';
import { resolveId, fetchTrailer, fetchProviders, fetchShowExtra, backdropUrl } from '../lib/tmdb.js';
import { getEnding } from '../data/curated.js';
import { cliffhangerRisk } from '../lib/derive.js';

/**
 * The feed.
 *
 * Two rules do most of the work here:
 *
 *  1. Exactly one card is "active" at a time, computed from the scroll offset.
 *     Only the active card gets a trailer, and leaving a card destroys its
 *     player — a phone will happily let you build a stack of twenty decoding
 *     video elements and then die.
 *
 *  2. Enrichment (TMDB trailer + providers) is lazy and only for cards near the
 *     one you are looking at. Enriching the whole list on load would be dozens
 *     of function calls for shows you will never scroll to.
 */
export default function FeedScreen({ shows, meta, loading, onOpen, onRefresh,
                                    pendingLessons = 0, onRerank }) {
  const containerRef = useRef(null);
  const gridRef = useRef(null);
  /**
   * Switching to the feed from a grid tile has to scroll to that show, and the
   * feed container does not exist while the grid is up. So the index is parked
   * here and an effect consumes it on the render after the mode flips.
   */
  const jumpTo = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [cardH, setCardH] = useState(0);
  const [muted, setMuted] = useState(true);
  const [enrichment, setEnrichment] = useState({});   // showKey -> { trailerKey, providers, ... }
  const claimed = useRef(new Set());                  // shows already being fetched
  const state = useStore();
  const isGrid = state.feedView === 'grid';

  /**
   * Every service in the catalogue, biggest first, counted from the real rows.
   * Derived from the unfiltered list so the counts do not shrink as you filter,
   * which would make the chips lie about how much is there.
   */
  const serviceCounts = useMemo(
    () => countByService(shows, { mine: state.services }),
    [shows, state.services],
  );

  /** The service ids behind this profile's subscription list. */
  const mineIds = useMemo(() => subscribedIds(state.services), [state.services]);

  const visible = useMemo(() => {
    const kept = shows.filter(s => !state.notForMe[s.key]);
    if (!state.serviceFilter) return kept;
    if (state.serviceFilter === MINE) return kept.filter(s => mineIds.has(bucketOf(s)));
    return kept.filter(s => bucketOf(s) === state.serviceFilter);
  }, [shows, state.notForMe, state.serviceFilter, mineIds]);

  // Counted over everything, so the chip does not shrink while you use it.
  const mineCount = useMemo(
    () => shows.reduce((n, s) => n + (mineIds.has(bucketOf(s)) ? 1 : 0), 0),
    [shows, mineIds],
  );

  /**
   * Turning a service on or off writes the profile's subscription list, which
   * is stored by the names providers.js uses, because that is what the TMDB
   * availability lookup speaks when a key exists. So the id is translated back
   * on the way out rather than a second list being kept in step by hand.
   */
  const toggleService = useCallback(id => {
    const def = serviceById(id);
    if (!def) return;
    const label = def.provider || def.name;
    const current = state.services || [];
    const has = subscribedIds(current).has(id);
    actions.setServices(has
      ? current.filter(n => !subscribedIds([n]).has(id))
      : [...current, label]);
  }, [state.services]);

  // Switching profile changes the whole order, so start from the top rather
  // than leaving you halfway down someone else's feed.
  //
  // The same applies when the catalogue's second tier lands and the ranking is
  // rebuilt: the scroll position is preserved by the browser but now points at
  // a completely different show. Keying on the first show's identity catches
  // both cases and ignores harmless re-renders.
  /**
   * Move the feed to a row.
   *
   * Never scroll a windowed snap container directly: only rendered cards carry
   * a snap point, so a scroll into the spacer region is dragged back to the
   * nearest real card. This sets the window and leaves the scrolling to the
   * effect below, which runs once the target row exists.
   */
  const goToRow = useCallback(i => { jumpTo.current = i; setActiveIdx(i); }, []);

  const topKey = visible[0]?.key;
  useEffect(() => { goToRow(0); }, [state.profileId, topKey, goToRow]);

  /**
   * Which card is centred.
   *
   * This was an IntersectionObserver, and it desynchronised: the observer is
   * set up once per list length, so when the catalogue's second tier landed and
   * the ranking was rebuilt, it went on watching nodes whose data-idx had moved
   * underneath it. The feed sat on index 296 of 457 while scrollTop was 0,
   * showing a blank placeholder.
   *
   * Scroll-snap makes an observer unnecessary. The container always comes to
   * rest on an exact multiple of the card height, so the index is arithmetic —
   * it cannot drift, it needs no bookkeeping, and it does not care how many
   * rows there are.
   */
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;                     // grid mode: there is no feed to read
    let frame = 0;
    const read = () => {
      frame = 0;
      const h = root.clientHeight || 1;
      // The same number drives the index arithmetic and the spacer heights, so
      // the windowed list and the scroll position cannot disagree about where
      // a card starts.
      setCardH(prev => (prev === h ? prev : h));
      const i = Math.round(root.scrollTop / h);
      setActiveIdx(prev => (prev === i ? prev : Math.max(0, Math.min(i, visible.length - 1))));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    root.addEventListener('scroll', onScroll, { passive: true });
    read();
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
    // isGrid is a dependency because the container this listens to is
    // unmounted while the grid is up. Without it the cleanup detached the
    // listener on the way into the grid and nothing re-attached it on the way
    // back, so the feed scrolled with a frozen index and the wrong card kept
    // its trailer.
  }, [visible.length, isGrid]);

  // Mark as seen so Tonight can avoid re-suggesting what you just scrolled past.
  //
  // Only in the feed. A tile going past in the grid is not the same as having
  // looked at a show, and counting it would let one fast scroll mark forty
  // shows as seen and then penalise every one of them.
  useEffect(() => {
    if (isGrid) return;
    const show = visible[activeIdx];
    if (show) actions.markSeen(show.key);
  }, [activeIdx, visible, isGrid]);

  /**
   * Land on the show whose tile was tapped.
   *
   * The feed container is mounted by this render, so the scroll has to wait
   * for it; a layout effect would still be a frame early on the first mount.
   */
  useEffect(() => {
    if (isGrid || jumpTo.current == null) return;
    const root = containerRef.current;
    if (!root) return;
    const i = jumpTo.current;

    // Two passes, and the order matters. Only rendered cards carry
    // `scroll-snap-align`, and the feed snaps on `mandatory`, so scrolling into
    // the spacer region lands on nothing and the browser drags the scroll back
    // to the nearest real card: a jump to row 20,000 arrived at row 3, and
    // switching profile left the scroll at row 2,800 with the window at the
    // top. So move the window first, let it render, and scroll on the next pass
    // when the target has a snap point to land on.
    if (activeIdx !== i) { setActiveIdx(i); return; }
    jumpTo.current = null;
    root.scrollTo({ top: i * root.clientHeight, behavior: 'instant' });
  }, [isGrid, activeIdx]);

  // Enrich the active card and the next two. Nothing further ahead.
  //
  // The guard is a ref, not the enrichment state. Writing a placeholder into
  // state to mark a show as claimed would change a dependency of this effect,
  // re-run it, and the cleanup would cancel the very fetch that placeholder was
  // protecting — so nothing ever finished and every card read
  // "looking for a trailer" forever.
  useEffect(() => {
    let cancelled = false;
    // The grid shows posters, which are already in the baked row. Enriching
    // from it would fire trailer and provider lookups for shows nobody has
    // opened, which is the opposite of why the grid exists.
    if (isGrid) return;
    const want = [activeIdx, activeIdx + 1, activeIdx + 2]
      .map(i => visible[i]).filter(s => s && !claimed.current.has(s.key));
    if (!want.length) return;

    (async () => {
      for (const show of want) {
        if (cancelled) return;
        claimed.current.add(show.key);

        const curated = getEnding(show.tvmazeId);
        const base = {};

        // Start the trailer FIRST and do not await it yet. It is the thing the
        // feed is for, it depends on nothing else, and behind the episode and
        // TMDB lookups it took long enough that the first card stayed a still
        // image for several seconds. /api/trailer falls back to a scored
        // YouTube search, so this works with no TMDB key at all.
        const trailerP = fetchTrailer({
          name: show.name, premiered: show.premiered, key: show.key,
        });

        // Show it the moment it lands, rather than waiting for the rest of the
        // enrichment to finish.
        trailerP.then(t => {
          if (cancelled) return;
          setEnrichment(p => ({ ...p, [show.key]: {
            ...(p[show.key] || {}),
            // trailerDone separates "still looking" from "looked and found
            // nothing". Without it a card whose lookup failed sat on
            // "Finding a trailer…" for ever, which is a lie about a finished
            // request.
            trailerDone: true,
            trailerKey: t.key || null,
            trailerReason: t.key ? null : (t.reason || 'no_trailer_found'),
            trailerSource: t.source, trailerConfidence: t.confidence,
            trailerTitle: t.title, trailerChannel: t.channel,
          } }));
        }).catch(() => {
          if (cancelled) return;
          setEnrichment(p => ({ ...p, [show.key]: {
            ...(p[show.key] || {}), trailerDone: true, trailerReason: 'trailer_unreachable',
          } }));
        });

        // The /shows index carries no episodes, so the headline number this app
        // exists for — total hours — is missing until we ask for them. Lazily,
        // for the card in view and the next two only.
        let full = null;
        try {
          ({ show: full } = await fetchShow(show.tvmazeId));
        } catch { /* the card still renders from the index record */ }
        if (cancelled) return;
        base.full = full;
        // Cliffhanger risk reads episode ratings, so it can only be worked out
        // once the episodes are here.
        base.ending = cliffhangerRisk(full || show, curated);

        const match = await resolveId(show);
        if (cancelled) return;
        if (!match || match.unavailable) {
          const reason = match?.unavailable || 'no_tmdb_match';
          const t = await trailerP;
          if (cancelled) return;
          setEnrichment(p => ({ ...p, [show.key]: {
            ...(p[show.key] || {}),
            ...base,
            trailerKey: t.key,
            trailerReason: t.key ? null : (t.reason || reason),
            trailerSource: t.source,
            trailerConfidence: t.confidence,
            trailerTitle: t.title,
            trailerChannel: t.channel,
            // Carry the reason into providers too, so the card can say WHY
            // availability is unknown rather than just that it is.
            providers: { available: false, reason },
          } }));
          continue;
        }

        const [trailer, providers, extra] = await Promise.all([
          trailerP, fetchProviders(match.id), fetchShowExtra(match.id),
        ]);
        if (cancelled) return;

        // Record the provider set so "leaving soon" has something to diff.
        if (providers.available) {
          actions.logProviders(show.key, providers.flatrate.map(p => p.name).sort());
        }

        setEnrichment(p => ({
          ...p,
          [show.key]: {
            ...(p[show.key] || {}),
            ...base,
            tmdbId: match.id,
            matchConfidence: match.confidence,
            trailerKey: trailer.key,
            trailerReason: trailer.key ? null : trailer.reason,
            trailerSource: trailer.source,
            trailerConfidence: trailer.confidence,
            trailerTitle: trailer.title,
            trailerChannel: trailer.channel,
            providers,
            extra,
            backdrop: extra.available ? extra.backdrop : backdropUrl(match.backdrop_path),
          },
        }));
      }
    })();

    return () => { cancelled = true; };
  }, [activeIdx, visible, isGrid]);

  const handleOpen = useCallback(show => onOpen(show, enrichment[show.key]), [onOpen, enrichment]);
  const handleSave = useCallback((show, opts) => {
    if (opts?.viaSwipe) { recordSwipe(featuresOf(show), true); actions.save(show, opts); }
    else actions.toggleSave(show);
  }, []);
  const handleHide = useCallback(show => {
    recordSwipe(featuresOf(show), false);
    actions.notForMe(show);
  }, []);

  if (loading && !visible.length) {
    return (
      <div className="grid h-screen-d place-items-center">
        <div className="flex flex-col items-center gap-3 text-haze-400">
          <Loader2 className="animate-spin" size={26} />
          <p className="text-sm">Loading the feed…</p>
        </div>
      </div>
    );
  }

  if (!visible.length) {
    return (
      <div className="grid h-screen-d place-items-center px-8 text-center">
        <div>
          <p className="text-lg font-medium">Nothing left in the feed.</p>
          <p className="mt-2 text-sm text-haze-400">
            You have hidden everything here. Unhide shows in Settings.
          </p>
        </div>
      </div>
    );
  }

  /**
   * The rendered window. Three cards either side is what the old placeholder
   * rule already kept alive, so nothing about how much decodes has changed.
   * Before the first measurement there is no spacer arithmetic to do, and the
   * feed is at the top anyway, so it renders the first few rows flat.
   */
  const WINDOW = 3;
  const firstRow = cardH ? Math.max(0, activeIdx - WINDOW) : 0;
  const lastRow = Math.min(visible.length - 1, (cardH ? activeIdx : 0) + WINDOW);

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start
                      justify-between px-safe pt-safe">
        <div className="pointer-events-auto flex flex-col items-start gap-1.5">
          <ProfileBar collapsed />
          <span className="rounded-full glass px-3 py-1 text-[11px] text-haze-300">
            {/* "12 / 457" is a position, and the grid has no single position.
                Showing one anyway would be a number that means nothing. */}
            {isGrid ? `${visible.length.toLocaleString()} shows`
                    : `${(activeIdx + 1).toLocaleString()} / ${visible.length.toLocaleString()}`}
            {state.serviceFilter
              ? <span className="text-mint"> · {bucketName(state.serviceFilter)}</span>
              : meta?.total > visible.length && (
                  <span className="text-haze-400"> of {meta.total.toLocaleString()}</span>
                )}
            {meta?.loaded === 'core' && <span className="text-gold"> · loading more</span>}
          </span>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => actions.setFeedView(isGrid ? 'feed' : 'grid')}
            className="tap rounded-full glass border border-white/15 text-white"
            aria-label={isGrid ? 'Switch to the full-screen feed' : 'Switch to the grid'}
            aria-pressed={isGrid}
          >
            {isGrid ? <Rows3 size={17} /> : <LayoutGrid size={17} />}
          </button>
          {/* Offered rather than done to you: the feed holds still while you
              swipe, and you decide when to let it re-read what it learned. */}
          {pendingLessons >= 4 && (
            <button
              type="button"
              onClick={onRerank}
              className="tap gap-1.5 rounded-full glass border border-mint/40 px-3
                         text-[12px] font-medium text-mint active:scale-95"
            >
              <Sparkles size={13} />Re-rank
              <span className="text-mint/70">{pendingLessons}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className="tap rounded-full glass border border-white/15 text-white"
            aria-label="Refresh the feed"
          >
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {isGrid ? (
        <GridView
          shows={visible}
          saved={state.saved}
          scrollRef={gridRef}
          onOpenShow={(show, i) => { jumpTo.current = i; actions.setFeedView('feed'); }}
          services={serviceCounts}
          activeService={state.serviceFilter}
          onService={id => actions.setServiceFilter(id)}
          subscribed={mineIds}
          onToggleService={toggleService}
          mineCount={mineCount}
          onSave={handleSave}
          onHide={handleHide}
        />
      ) : (
      <div ref={containerRef} className="feed-scroll h-screen-d overflow-y-scroll">
        {/*
          Only the cards around you exist. Everything above and below is a
          single spacer of the exact remaining height.

          This used to render one element per show and lean on cheap
          placeholders for the far ones, which was fine at 457 shows and is not
          fine at 32,138: that is 32,138 wrappers for React to reconcile on
          every swipe, before a single pixel is painted. The spacers keep the
          scroll height at exactly `count * cardH`, so the scrollbar, the index
          arithmetic and a jump straight to row 20,000 all still work.

          Windowing is safe here specifically because of `scroll-snap-stop:
          always` in index.css: one gesture can move at most one card, so the
          window can never be outrun by momentum.
        */}
        {firstRow > 0 && <div style={{ height: firstRow * cardH }} aria-hidden="true" />}
        {visible.slice(firstRow, lastRow + 1).map((show, k) => {
          const i = firstRow + k;
          const e = enrichment[show.key];
          const rich = e?.full || show;      // episodes arrive with enrichment
          const isActive = i === activeIdx;
          return (
            <div key={show.key} data-idx={i}>
              <FeedCard
                show={rich}
                index={i}
                active={isActive}
                enriched={e}
                trailerKey={isActive ? e?.trailerKey : null}
                availability={availability(e?.providers, state.services)}
                time={totalTime(rich)}
                muted={muted}
                onToggleMute={() => setMuted(m => !m)}
                onOpen={handleOpen}
                onSave={handleSave}
                onHide={handleHide}
                saved={Boolean(state.saved[show.key])}
              />
            </div>
          );
        })}
        {lastRow < visible.length - 1 && (
          <div style={{ height: (visible.length - 1 - lastRow) * cardH }} aria-hidden="true" />
        )}
      </div>
      )}
    </div>
  );
}
