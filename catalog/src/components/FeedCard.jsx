import { memo } from 'react';
import { Bookmark, BookmarkCheck, EyeOff, Info, Play } from 'lucide-react';
import TrailerLayer from './TrailerLayer.jsx';
import { StatusBadge, ProviderRow, HoursChip, Unknown } from './bits.jsx';

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

  return (
    <section
      className="feed-card relative h-screen-d w-full overflow-hidden bg-ink-950"
      aria-label={show.name}
    >
      {backdrop ? (
        <img
          src={backdrop}
          alt=""
          className="absolute inset-0 h-full w-full object-cover no-drag"
          // The first two cards are what the user sees on open; everything else
          // waits, so a long scroll does not fetch fifty backdrops at once.
          loading={index < 2 ? 'eager' : 'lazy'}
          fetchPriority={index === 0 ? 'high' : 'auto'}
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

      {/* Whole-card tap opens the detail sheet. The buttons stop propagation. */}
      <button
        type="button"
        onClick={() => onOpen(show)}
        className="absolute inset-0 z-10"
        aria-label={`Open details for ${show.name}`}
      />

      {/* Right-hand action rail. Down at thumb height, 44pt each, never
          stacked tightly over the face of the artwork. */}
      <div className="absolute right-3 z-30 flex flex-col items-center gap-2"
           style={{ bottom: 'calc(env(safe-area-inset-bottom) + 8.5rem)' }}>
        <RailButton
          onClick={() => onSave(show)}
          active={saved}
          label={saved ? 'Saved to your list' : 'Save to your list'}
        >
          {saved ? <BookmarkCheck size={21} /> : <Bookmark size={21} />}
        </RailButton>
        <RailButton onClick={() => onOpen(show)} label="Details">
          <Info size={21} />
        </RailButton>
        <RailButton onClick={() => onHide(show)} label="Not for me" danger>
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
              Say which, so a wrong video is recognisable as a wrong guess
              rather than looking like the show. */}
          {trailerKey && active && enriched?.trailerSource === 'youtube-search' &&
           enriched.trailerConfidence !== 'high' && (
            <p className="mt-2">
              <Unknown>
                Trailer matched by search — “{enriched.trailerTitle}”
                {enriched.trailerChannel ? ` from ${enriched.trailerChannel}` : ''}
              </Unknown>
            </p>
          )}
        </div>
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
