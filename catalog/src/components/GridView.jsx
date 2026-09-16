import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, X, Check, SlidersHorizontal } from 'lucide-react';
import { ageOf } from '../lib/rank.js';
import { STREAMERS, MINE } from '../lib/services.js';

/**
 * The 2-up grid.
 *
 * The full-screen feed is the good way to DECIDE and a slow way to LOOK. One
 * show per screen means a hundred shows is a hundred swipes, and when you are
 * only trying to find out whether anything here appeals, that is the wrong
 * trade. This is the same ranked list, four to six shows a screen instead of
 * one, and tapping one drops you into the feed on that show with its trailer
 * running.
 *
 * It is cheap in a way the feed cannot be. The feed needs a backdrop and a
 * trailer per card, which means a TMDB round trip and a video decoder. The
 * grid needs the poster, which is already in the baked catalogue row, so
 * scrolling it costs no requests at all and no battery beyond the images.
 *
 * Both quick actions are here because triage is the point: hiding ten things
 * you would never watch teaches the model faster than anything else in the
 * app, and doing that ten times in the feed means ten full-screen swipes.
 *
 * Only the rows near the viewport are real. The first version rendered all
 * 457 tiles, which is 457 <img> elements and several thousand nodes on a
 * phone, and a grid that stutters while it scrolls is not a faster way to
 * look at anything. Rows further away are a plain box of exactly the same
 * height, so the scrollbar, the scroll position and the row geometry are all
 * unchanged and nothing has to be measured twice.
 */
const GAP_PX = 8;          // matches gap-2
const COLUMNS = 2;
const WINDOW_ROWS = 6;     // rows kept live above and below the viewport
export default function GridView({
  shows, saved, onOpenShow, onSave, onHide, scrollRef,
  services = [], activeService = null, onService,
  subscribed, onToggleService, mineCount = 0,
}) {
  // Row height is derived from the measured width rather than assumed, because
  // it has to match the real tiles exactly or the placeholders shift the grid.
  const [geom, setGeom] = useState({ rowH: 0, top: 0, height: 0 });
  const gridRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const width = el.clientWidth - 16;                       // px-2 either side
      const tileW = (width - GAP_PX * (COLUMNS - 1)) / COLUMNS;
      // The service chips sit above the grid inside the same scroller, so row
      // zero does not start at scrollTop zero. Measuring the offset rather than
      // assuming it keeps the window centred on what is actually on screen.
      const offset = gridRef.current
        ? gridRef.current.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
        : 0;
      setGeom({ rowH: tileW * 1.5 + GAP_PX, top: Math.max(0, el.scrollTop - offset),
                height: el.clientHeight });
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    measure();
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollRef]);

  // Before the first measurement, render a screenful so there is never a blank
  // grid waiting on a layout pass.
  const [firstRow, lastRow] = geom.rowH
    ? [Math.floor(geom.top / geom.rowH) - WINDOW_ROWS,
       Math.ceil((geom.top + geom.height) / geom.rowH) + WINDOW_ROWS]
    : [0, WINDOW_ROWS * 2];

  return (
    <div
      ref={scrollRef}
      className="h-screen-d overflow-y-auto overscroll-contain px-2"
      // Clear of the header chips at the top and the bottom nav underneath.
      // The header is a profile pill with a count chip under it on one side and
      // two round buttons on the other, and at 4.25rem the first row of tiles
      // sat underneath all of them.
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 5.75rem)',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 5.5rem)',
      }}
    >
      {services.length > 0 && (
        <ServiceRow
          services={services} active={activeService} onPick={onService}
          subscribed={subscribed} onToggleService={onToggleService} mineCount={mineCount}
        />
      )}
      <div ref={gridRef} className="grid grid-cols-2 gap-2">
        {shows.map((show, i) => {
          const row = Math.floor(i / COLUMNS);
          if (row < firstRow || row > lastRow) {
            // Same height, no image, no work. aria-hidden because a screen
            // reader must not announce a placeholder as a show.
            return (
              <div key={show.key} className="aspect-[2/3] w-full rounded-xl bg-ink-900"
                   aria-hidden="true" />
            );
          }
          return (
            <Tile
              key={show.key}
              show={show}
              eager={i < 6}
              saved={Boolean(saved[show.key])}
              onOpen={() => onOpenShow(show, i)}
              onSave={() => onSave(show)}
              onHide={() => onHide(show)}
            />
          );
        })}
      </div>
    </div>
  );
}

function Tile({ show, saved, eager, onOpen, onSave, onHide }) {
  const year = show.premiered ? String(show.premiered).slice(0, 4) : null;

  // The one thing worth saying at this size. A tile has room for a badge, not
  // for the sentence the card shows, so this picks the most specific of the
  // few facts that fit rather than truncating the reason into nonsense.
  const badge = useMemo(() => {
    const age = ageOf(show);
    if (age?.unaired) return { text: 'Not out yet', tone: 'text-haze-300 border-white/15' };
    if (age && age.months < 4) return { text: 'New', tone: 'text-mint border-mint/40' };
    if (show.airing) return { text: 'On air', tone: 'text-gold border-gold/40' };
    if (show.rating != null && show.rating >= 8.3) {
      return { text: show.rating.toFixed(1), tone: 'text-gold border-gold/40' };
    }
    return null;
  }, [show]);

  return (
    <div className="relative overflow-hidden rounded-xl bg-ink-900">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left"
        aria-label={`${show.name}${year ? `, ${year}` : ''}. Open in the feed.`}
      >
        <div className="relative aspect-[2/3] w-full">
          {show.poster ? (
            <img
              src={show.poster}
              alt=""
              loading={eager ? 'eager' : 'lazy'}
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover no-drag"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center px-2 text-center
                            text-[11px] text-haze-500">
              no artwork
            </div>
          )}
          {/* Enough gradient to read two lines of white text over any poster. */}
          <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t
                          from-ink-950 via-ink-950/80 to-transparent" />
          {/* pr-11 keeps a two-line title from running under the hide button in
              the corner. */}
          <div className="absolute inset-x-0 bottom-0 p-2 pr-11">
            <p className="line-clamp-2 text-[12.5px] font-medium leading-tight text-white">
              {show.name}
            </p>
            <p className="mt-0.5 truncate text-[10.5px] text-haze-400">
              {[year, show.network].filter(Boolean).join(' · ')}
            </p>
          </div>
          {badge && (
            <span className={`absolute left-1.5 top-1.5 rounded-full border glass px-1.5
                              py-0.5 text-[9.5px] font-medium ${badge.tone}`}>
              {badge.text}
            </span>
          )}
        </div>
      </button>

      {/* Both 44pt, per the touch-target rule, with only the glyph drawn small.
          They sit over the top of the poster, which is the part that carries
          the least information, and they stop the tap from reaching the tile. */}
      <TileAction
        className="right-0 top-0"
        onClick={onSave}
        label={saved ? `Remove ${show.name}${year ? `, ${year}` : ''} from your list`
                     : `Save ${show.name}${year ? `, ${year}` : ''}`}
        active={saved}
      >
        {saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
      </TileAction>
      <TileAction
        className="right-0 bottom-0"
        onClick={onHide}
        label={`Not for me: hide ${show.name}${year ? `, ${year}` : ''}`}
      >
        <X size={15} />
      </TileAction>
    </div>
  );
}

function TileAction({ children, onClick, label, active, className }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={`absolute z-10 grid h-11 w-11 place-items-center ${className}`}
    >
      <span className={`grid h-7 w-7 place-items-center rounded-full glass
                        ${active ? 'text-gold' : 'text-white/85'}`}>
        {children}
      </span>
    </button>
  );
}

/**
 * Browse one service at a time, and say which ones you pay for.
 *
 * "Apple TV included? HBO? Prime?" deserves an answer with a number on it, so
 * every chip carries its real count from the index. The counts are the reason
 * this is worth having: HBO used to be three separate things (HBO 308, HBO Max
 * 215, Max 3) and reads 546 now, and before the feed was uncapped you could
 * reach eleven Apple TV shows out of 206.
 *
 * It is a horizontal scroller rather than a wrapped block because there are 302
 * services with a dozen shows or more, and a grid of 302 chips is a wall.
 *
 * The row does double duty. Normally a tap filters. In edit mode it narrows to
 * the subscription services and a tap toggles whether you pay for that one,
 * which is the shortest path from "is Apple TV in here" to "and I have Apple
 * TV, so put it first". The two modes are never live at once and the row says
 * which one it is in, because a chip that silently means two different things
 * is how you end up unsubscribing from Netflix by trying to browse it.
 */
function ServiceRow({ services, active, onPick, subscribed, onToggleService, mineCount }) {
  const [editing, setEditing] = useState(false);
  const mine = subscribed || new Set();

  return (
    <div className="-mx-2 mb-2 px-2">
      <div
        className="flex gap-1.5 overflow-x-auto pb-1"
        // No touch-action override: pinning this to pan-x would stop a vertical
        // swipe that happens to start on the chips from scrolling the grid, and
        // the browser already handles a nested horizontal scroller correctly.
        style={{ scrollbarWidth: 'none' }}
        role="group"
        aria-label={editing ? 'Choose the services you subscribe to' : 'Filter by service'}
      >
        <Chip
          active={editing}
          onClick={() => setEditing(e => !e)}
          label={editing ? 'Done choosing services' : 'Choose the services you subscribe to'}
        >
          {editing ? <Check size={13} /> : <SlidersHorizontal size={13} />}
          {editing ? 'Done' : 'Mine'}
        </Chip>

        {editing ? (
          STREAMERS.map(s => (
            <Chip
              key={s.id} active={mine.has(s.id)} colour={s.colour}
              onClick={() => onToggleService?.(s.id)}
              label={mine.has(s.id) ? `You subscribe to ${s.name}. Tap to remove.`
                                    : `Add ${s.name} to the services you subscribe to`}
            >
              {mine.has(s.id) && <Check size={12} />}
              {s.name}
            </Chip>
          ))
        ) : (
          <>
            <Chip active={!active} onClick={() => onPick?.(null)}>Everything</Chip>
            {mine.size > 0 && (
              <Chip active={active === MINE} yours
                    onClick={() => onPick?.(active === MINE ? null : MINE)}
                    label="Show everything across the services you subscribe to">
                Your services
                <span className={active === MINE ? 'text-white/70' : 'text-haze-500'}>
                  {mineCount.toLocaleString()}
                </span>
              </Chip>
            )}
            {services.map(s => (
              <Chip key={s.id} active={active === s.id} colour={s.colour} yours={s.yours}
                    onClick={() => onPick?.(active === s.id ? null : s.id)}>
                {s.name}
                <span className={active === s.id ? 'text-white/70' : 'text-haze-500'}>
                  {s.count.toLocaleString()}
                </span>
              </Chip>
            ))}
          </>
        )}
      </div>
      {editing && (
        <p className="pb-1 text-[11px] leading-snug text-haze-400">
          Tap the ones you pay for. They move to the front of the row, and
          &ldquo;Your services&rdquo; collects everything across all of them. This is
          where a show comes from, not proof it is streaming there tonight.
        </p>
      )}
    </div>
  );
}

function Chip({ children, active, colour, yours, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      // A service you pay for gets a visible edge as well as its place at the
      // front of the row, so the ordering is explained rather than just felt.
      className={`tap shrink-0 gap-1.5 whitespace-nowrap rounded-full border px-3
                  text-[12.5px] font-medium transition active:scale-95
        ${active ? 'border-white/30 bg-white/12 text-white'
                 : yours ? 'border-mint/35 bg-mint/[.07] text-haze-200'
                         : 'border-white/10 bg-white/[.03] text-haze-300'}`}
    >
      {colour && (
        <span className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: colour, opacity: active ? 1 : 0.75 }} />
      )}
      {children}
    </button>
  );
}
