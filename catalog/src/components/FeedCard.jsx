import { memo, useRef } from 'react';
import { Bookmark, BookmarkCheck, EyeOff, Info, Sparkles, Heart, X } from 'lucide-react';
import TrailerLayer from './TrailerLayer.jsx';
import { StatusBadge, ProviderRow, HoursChip, Unknown } from './bits.jsx';
import { useSwipe } from '../lib/useSwipe.js';

/**
 * One show, one screen.
 *
 * Layering, bottom to top:
 *   1. backdrop image  — always present, so a blocked or slow embed degrades to
 *                        a still rather than a black rectangle
 *   2. trailer         — only when this card is the centred one
 *   3. gradient        — the thing that makes white text legible over any frame
 *   4. content
 */
function FeedCard({
  show, active, enriched, trailerKey, availability, time,
  muted, onToggleMute, onOpen, onSave, onHide, saved, index,
}) {
  const backdrop = enriched?.backdrop || show.backdrop || show.poster;
  const year = show.premiered?.slice(0, 4);

  const swipe = useSwipe({
    onLike: () => onSave(show, { viaSwipe: true }),
    onHide: () => onHide(show),
    enabled: active,
  });

  // Double-tap to like, the gesture everyone already has in their thumbs.
  const lastTap = useRef(0);
  const onCardTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      swipe.trigger('like');
      return;
    }
    lastTap.current = now;
    setTimeout(() => { if (lastTap.current && Date.now() - lastTap.current >= 280) onOpen(show); }, 290);
  };

  return (
    <section
      className="feed-card relative h-screen-d w-full overflow-hidden bg-ink-950"
      aria-label={show.name}
      // pan-y hands vertical scrolling to the browser and reserves horizontal
      // for the swipe. Without it iOS claims the whole gesture.
      style={{ touchAction: 'pan-y' }}
      {...swipe.handlers}
    >
      <div
        className="absolute inset-0"
        style={{
          transform: `translateX(${swipe.dx}px) rotate(${swipe.rotation}deg) scale(${swipe.scale})`,
          transition: swipe.dx === 0 || swipe.flying
            ? 'transform .24s cubic-bezier(.2,.9,.3,1)' : 'none',
        }}
      >
      {backdrop ? (
        <img
          src={backdrop}
          alt=""
          className="absolute inset-0 h-full w-full object-cover no-drag"
          // The first two cards are what the user sees on open; everything else
          // waits, so a long scroll does not fetch fifty backdrops at once.
          loading={index < 2 ? 'eager' : 'lazy'}
          // React 18 passes this through only in lowercase; the camelCase form
          // lands in the DOM as an unknown attribute and warns.
          fetchpriority={index === 0 ? 'high' : 'auto'}
          decoding="async"
          draggable="false"
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-ink-800">
          <span className="px-8 text-center text-sm text-haze-400">
            No artwork for {show.name}
          </span>
        </div>
      )}

      <TrailerLayer
        videoKey={trailerKey}
        active={active}
        muted={muted}
        onToggleMute={onToggleMute}
      />

      {/* Legibility floor. The top scrim keeps the status bar readable. */}
      <div className="pointer-events-none absolute inset-0
                      bg-gradient-to-t from-black/95 via-black/35 to-black/45" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3
                      bg-gradient-to-t from-black via-black/70 to-transparent" />

      {/* Swipe feedback. A wash of colour plus a stamp, both keyed to how close
          the gesture is to committing, so you can feel where the line is and
          back out before you cross it. */}
      {swipe.direction && (
        <>
          <div
            className={`pointer-events-none absolute inset-0 ${
              swipe.direction === 'like' ? 'bg-mint' : 'bg-pop'}`}
            style={{ opacity: swipe.progress * 0.22 }}
            aria-hidden="true"
          />
          <div
            className={`pointer-events-none absolute top-1/3 flex items-center gap-2
              rounded-2xl border-[3px] px-4 py-2 text-2xl font-black uppercase tracking-wider
              ${swipe.direction === 'like'
                ? 'left-7 -rotate-12 border-mint text-mint'
                : 'right-7 rotate-12 border-pop text-pop'}`}
            style={{ opacity: Math.min(1, swipe.progress * 1.4) }}
            aria-hidden="true"
          >
            {swipe.direction === 'like' ? <Heart size={26} fill="currentColor" /> : <X size={26} />}
            {swipe.direction === 'like' ? 'Save' : 'Nope'}
          </div>
        </>
      )}

      {/* Whole-card tap opens the detail sheet; double-tap saves. The buttons
          stop propagation. */}
      <button
        type="button"
        onClick={onCardTap}
        className="absolute inset-0 z-10"
        aria-label={`Open details for ${show.name}`}
      />

      {/* Right-hand action rail. Down at thumb height, 44pt each, never
          stacked tightly over the face of the artwork. */}
      <div className="absolute right-3 z-30 flex flex-col items-center gap-2"
           style={{ bottom: 'calc(env(safe-area-inset-bottom) + 8.5rem)' }}>
        <RailButton
          onClick={() => (saved ? onSave(show) : swipe.trigger('like'))}
          active={saved}
          label={saved ? 'Saved to your list' : 'Save to your list'}
        >
          {saved ? <BookmarkCheck size={21} /> : <Bookmark size={21} />}
        </RailButton>
        <RailButton onClick={() => onOpen(show)} label="Details">
          <Info size={21} />
        </RailButton>
        <RailButton onClick={() => swipe.trigger('hide')} label="Not for me" danger>
          <EyeOff size={21} />
        </RailButton>
      </div>

      {/* Full-width and the same height as the text it holds, so it sits over
          the action rail's lower buttons. It must not eat their taps: nothing
          in here is interactive, so it stays transparent to the pointer. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-safe pb-safe">
        <div className="mb-[4.75rem] mr-16 animate-rise">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <StatusBadge show={show} tmdbExtra={enriched?.extra} ending={enriched?.ending} />
            {time && <HoursChip time={time} />}
          </div>

          <h2 className="text-shadow-soft text-[28px] font-bold leading-[1.1] tracking-tight">
            {show.name}
          </h2>

          <p className="text-shadow-soft mt-1 text-[12.5px] text-haze-200">
            {[year, show.network, show.genres?.slice(0, 2).join(' · ')].filter(Boolean).join('  ·  ')}
            {show.rating != null && <span className="ml-2 text-gold">★ {show.rating.toFixed(1)}</span>}
          </p>

          {show.summary && (
            <p className="text-shadow-soft mt-2 line-clamp-2 text-[13px] leading-snug text-haze-200/90">
              {show.summary}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <ProviderRow availability={availability} compact />
          </div>

          {/* Why this card, in this order. The feed is curated per person, and
              a curated order that will not say why is just an opaque ranking. */}
          {show._why && (
            <p className="text-shadow-soft mt-2 flex items-start gap-1.5 text-[12px]
                          leading-snug text-mint/90">
              <Sparkles size={12} className="mt-0.5 shrink-0" />
              <span>
                {show._why}
                {show._confidence === 'guessing' && (
                  <span className="ml-1 text-haze-400">(early guess — still learning you)</span>
                )}
              </span>
            </p>
          )}

          {!trailerKey && active && (
            <p className="mt-2">
              <Unknown>
                {!enriched?.trailerDone
                  ? 'Finding a trailer…'
                  : ({
                      no_trailer_found: 'No trailer found for this one',
                      youtube_rate_limited: 'Trailer lookups are rate limited right now — pull to refresh shortly',
                      trailer_unreachable: 'Could not reach the trailer service',
                      tmdb_key_missing: 'No trailer — TMDB key not set on this deploy',
                      no_youtube_video: 'No trailer on TMDB for this one',
                      no_tmdb_match: 'No trailer — could not match this show',
                      // An unmapped reason must still read as finished, not as
                      // work in progress.
                    }[enriched.trailerReason] ?? `No trailer (${enriched.trailerReason || 'unknown reason'})`)}
              </Unknown>
            </p>
          )}

          {/* A searched trailer is a good guess, not a fact. TMDB's is a fact.
              One short line here so a wrong video reads as a guess; the matched
              video's title and channel are on the detail sheet, where there is
              room for them. */}
          {trailerKey && active && enriched?.trailerSource === 'youtube-search' &&
           enriched.trailerConfidence !== 'high' && (
            <p className="mt-1.5">
              <Unknown>Trailer matched by search, not confirmed</Unknown>
            </p>
          )}
        </div>
      </div>

      {/* Told once, on the first card only, then never again. */}
      {index === 0 && active && !saved && (
        <p className="pointer-events-none absolute inset-x-0 z-20 text-center text-[11px]
                      text-white/45"
           style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4.4rem)' }}>
          swipe right to save · left to pass
        </p>
      )}
      </div>
    </section>
  );
}

function RailButton({ children, onClick, label, active, danger }) {
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick(); }}
      aria-label={label}
      className={`tap rounded-full glass border transition active:scale-90
        ${active ? 'border-mint/40 bg-mint/20 text-mint'
                 : danger ? 'border-white/15 text-haze-200'
                          : 'border-white/15 text-white'}`}
    >
      {children}
    </button>
  );
}

export default memo(FeedCard);
