import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import FeedCard from '../components/FeedCard.jsx';
import { useStore, actions } from '../lib/store.js';
import { totalTime } from '../lib/derive.js';
import { availability } from '../lib/providers.js';
import { fetchShow } from '../lib/tvmaze.js';
import { Freshness } from '../components/bits.jsx';
import { resolveId, fetchTrailer, fetchProviders, fetchShowExtra, backdropUrl } from '../lib/tmdb.js';
import { getEnding } from '../data/curated.js';
import { cliffhangerRisk } from '../lib/derive.js';

/**
 * The feed.
 *
 * Two rules do most of the work here:
 *
 *  1. Exactly one card is "active" at a time, decided by IntersectionObserver
 *     rather than by scroll maths. Only the active card gets a trailer, and
 *     leaving a card destroys its player. A phone will happily let you build a
 *     stack of twenty decoding video elements and then die.
 *
 *  2. Enrichment (TMDB trailer + providers) is lazy and only for cards near the
 *     one you are looking at. Enriching the whole list on load would be dozens
 *     of function calls for shows you will never scroll to.
 */
export default function FeedScreen({ shows, meta, loading, onOpen, onRefresh }) {
  const containerRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [muted, setMuted] = useState(true);
  const [enrichment, setEnrichment] = useState({});   // showKey -> { trailerKey, providers, ... }
  const claimed = useRef(new Set());                  // shows already being fetched
  const state = useStore();

  const visible = useMemo(
    () => shows.filter(s => !state.notForMe[s.key]),
    [shows, state.notForMe],
  );

  // Which card is centred. threshold 0.6 means a card must genuinely own the
  // screen before it starts playing, so a fast flick past does not fire five
  // players in a row.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.6) {
          const i = Number(e.target.dataset.idx);
          if (Number.isFinite(i)) setActiveIdx(i);
        }
      }
    }, { root, threshold: [0.6] });

    const cards = root.querySelectorAll('[data-idx]');
    cards.forEach(c => io.observe(c));
    return () => io.disconnect();
  }, [visible.length]);

  // Mark as seen so Tonight can avoid re-suggesting what you just scrolled past.
  useEffect(() => {
    const show = visible[activeIdx];
    if (show) actions.markSeen(show.key);
  }, [activeIdx, visible]);

  // Enrich the active card and the next two. Nothing further ahead.
  //
  // The guard is a ref, not the enrichment state. Writing a placeholder into
  // state to mark a show as claimed would change a dependency of this effect,
  // re-run it, and the cleanup would cancel the very fetch that placeholder was
  // protecting — so nothing ever finished and every card read
  // "looking for a trailer" forever.
  useEffect(() => {
    let cancelled = false;
    const want = [activeIdx, activeIdx + 1, activeIdx + 2]
      .map(i => visible[i]).filter(s => s && !claimed.current.has(s.key));
    if (!want.length) return;

    (async () => {
      for (const show of want) {
        if (cancelled) return;
        claimed.current.add(show.key);

        const curated = getEnding(show.tvmazeId);
        const base = {};

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
          setEnrichment(p => ({ ...p, [show.key]: {
            ...base,
            trailerReason: reason,
            // Carry the reason into providers too, so the card can say WHY
            // availability is unknown rather than just that it is.
            providers: { available: false, reason },
          } }));
          continue;
        }

        const [trailer, providers, extra] = await Promise.all([
          fetchTrailer(match.id), fetchProviders(match.id), fetchShowExtra(match.id),
        ]);
        if (cancelled) return;

        // Record the provider set so "leaving soon" has something to diff.
        if (providers.available) {
          actions.logProviders(show.key, providers.flatrate.map(p => p.name).sort());
        }

        setEnrichment(p => ({
          ...p,
          [show.key]: {
            ...base,
            tmdbId: match.id,
            matchConfidence: match.confidence,
            trailerKey: trailer.available ? trailer.key : null,
            trailerReason: trailer.available ? trailer.reason : trailer.reason,
            providers,
            extra,
            backdrop: extra.available ? extra.backdrop : backdropUrl(match.backdrop_path),
          },
        }));
      }
    })();

    return () => { cancelled = true; };
  }, [activeIdx, visible]);

  const handleOpen = useCallback(show => onOpen(show, enrichment[show.key]), [onOpen, enrichment]);
  const handleSave = useCallback(show => actions.toggleSave(show), []);
  const handleHide = useCallback(show => {
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

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start
                      justify-between px-safe pt-safe">
        <div className="pointer-events-auto mt-1 rounded-full glass px-3 py-1.5
                        text-[11px] text-haze-300">
          {activeIdx + 1} / {visible.length} · <Freshness meta={meta} label="" />
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="tap pointer-events-auto rounded-full glass border border-white/15 text-white"
          aria-label="Refresh the feed"
        >
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div ref={containerRef} className="feed-scroll h-screen-d overflow-y-scroll">
        {visible.map((show, i) => {
          const e = enrichment[show.key];
          const rich = e?.full || show;      // episodes arrive with enrichment
          const isActive = i === activeIdx;
          // Cards far from the viewport render as a cheap placeholder: the snap
          // geometry stays exact, but nothing decodes.
          const near = Math.abs(i - activeIdx) <= 3;
          return (
            <div key={show.key} data-idx={i}>
              {near ? (
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
              ) : (
                <div className="feed-card h-screen-d w-full bg-ink-950" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
