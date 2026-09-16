import { useCallback, useRef, useState } from 'react';

/**
 * Horizontal swipe on a card that lives inside a VERTICAL scroll-snap feed.
 *
 * The whole difficulty is co-existing with that scroll. Two rules make it work:
 *
 *   • `touch-action: pan-y` on the card. This hands vertical panning to the
 *     browser — native momentum, native snap, sixty frames a second — and
 *     reserves horizontal for us. Handling both in JavaScript would mean
 *     reimplementing iOS scrolling, badly.
 *
 *   • Direction is decided once per gesture and never revisited. Without a
 *     lock, a diagonal flick alternately scrolls and swipes and the card
 *     judders.
 *
 * WHY THE FIRST VERSION FELT FINICKY
 *
 * It decided the axis the moment either offset passed 10px, by comparing the
 * two raw magnitudes: `Math.abs(mx) > Math.abs(my) ? 'x' : 'y'`. There is no
 * margin anywhere in that expression, so the outcome at (10, 9) is a swipe and
 * at (9, 10) the swipe is dead for the rest of the gesture. Both of those are
 * the same 45-degree flick. A thumb does not travel in a straight line, and
 * the first ten pixels of a real gesture are the least straight part of it, so
 * which thing happened came down to a pixel of wobble.
 *
 * Three changes fix it, and all three are about refusing to guess:
 *
 *   • An axis must WIN, not merely lead. Horizontal takes the gesture only
 *     when it beats vertical by DOMINANCE, which is a 30-degree cone around
 *     the horizontal, and vertical takes it on the same terms.
 *   • A gesture in the ambiguous wedge between those cones stays undecided and
 *     keeps being watched, instead of being committed on its worst pixel. Most
 *     resolve within another few pixels, because a thumb that wobbles at the
 *     start still ends up going where it meant to go.
 *   • One that never resolves goes to the browser at GIVE_UP_PX. Scrolling is
 *     the safer default of the two: a scroll that was meant to be a swipe
 *     costs a second, and a swipe that was meant to be a scroll hides a show.
 *
 * The deadzone is then subtracted from the card's travel, so the card does not
 * jump to meet the finger at the instant of the lock.
 *
 * WHY THE HOOK ALSO REPORTS wasDrag()
 *
 * The card has a full-bleed transparent button over it so that a tap anywhere
 * opens the detail sheet. A button does not know the difference between a tap
 * and the end of a drag: both finish with a click. So dragging the feed
 * upwards with a finger anywhere on the card opened the detail sheet instead
 * of scrolling, every time, which is the other half of "the controls are
 * weak". The hook is the only thing that knows how far the finger travelled,
 * so it records that and the card asks before treating a click as a tap.
 */

const DECIDE_PX = 12;       // total travel before we are willing to decide at all
const DOMINANCE = 1.7;      // one axis must beat the other by this to win it
const GIVE_UP_PX = 34;      // still ambiguous at this distance: it is a scroll
const TAP_SLOP_PX = 8;      // beyond this the gesture was a drag, not a tap
const COMMIT_PX = 88;       // past this on release, the swipe counts
const FLICK_VELOCITY = 0.5; // px/ms, so a fast short flick counts too

/**
 * The card's travel, with the decision deadzone taken out.
 *
 * Without this the card leaps to wherever the finger already is at the moment
 * the axis locks, which can be 34px into the gesture, and the leap reads as a
 * glitch rather than as the card being picked up.
 */
const deadzoned = mx => {
  const a = Math.abs(mx) - DECIDE_PX;
  return a <= 0 ? 0 : Math.sign(mx) * a;
};

/**
 * Haptics, honestly.
 *
 * iOS Safari does not implement the Vibration API — navigator.vibrate is
 * simply absent, and there is no web-exposed Taptic Engine. This therefore
 * does nothing on the iPhone this app is built for, and fires on Android.
 * It is here because it costs one line and helps where it can; it is not a
 * feature to claim.
 */
const buzz = ms => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };

export function useSwipe({ onLike, onHide, enabled = true } = {}) {
  const [dx, setDx] = useState(0);
  const [flying, setFlying] = useState(null);   // 'like' | 'hide' while animating out
  const start = useRef(null);
  /** Did the gesture that produced the click about to arrive actually move? */
  const draggedLast = useRef(false);

  const reset = () => { start.current = null; setDx(0); };

  const onPointerDown = useCallback(e => {
    if (!enabled || flying) return;
    // Ignore the second finger of a pinch, and anything but a primary press.
    if (!e.isPrimary) return;
    draggedLast.current = false;
    start.current = {
      x: e.clientX, y: e.clientY, t: performance.now(),
      id: e.pointerId, axis: null, moved: false, el: e.currentTarget,
    };
  }, [enabled, flying]);

  const onPointerMove = useCallback(e => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    // Recorded before anything else, and for BOTH axes, because the click that
    // has to be suppressed arrives after a vertical drag just as readily.
    if (!s.moved && Math.hypot(mx, my) > TAP_SLOP_PX) s.moved = true;

    if (!s.axis) {
      const ax = Math.abs(mx), ay = Math.abs(my), dist = Math.hypot(mx, my);
      if (dist < DECIDE_PX) return;              // too early to tell anything

      if (ax > ay * DOMINANCE) {
        s.axis = 'x';
        // Ours now. Capture so the gesture survives the pointer leaving the
        // card, which it will: the card flies off the side of the screen.
        try { s.el.setPointerCapture(e.pointerId); } catch { /* already gone */ }
      } else if (ay > ax * DOMINANCE || dist > GIVE_UP_PX) {
        // Vertical, or never made up its mind. Hand it to the browser and stay
        // out of the way; it has been scrolling this whole time anyway. The
        // gesture is marked resolved rather than forgotten, so that the drag it
        // turned out to be is still remembered when the click lands.
        s.axis = 'y';
        return;
      } else {
        // In the wedge between the two cones. Keep watching rather than
        // committing the gesture on its least representative pixel.
        return;
      }
    }
    if (s.axis !== 'x') return;
    // Slight resistance, so the card feels attached rather than frictionless.
    const travel = deadzoned(mx);
    setDx(Math.sign(travel) * Math.pow(Math.abs(travel), 0.94));
  }, []);

  const finish = useCallback((dir) => {
    setFlying(dir);
    buzz(dir === 'like' ? 12 : [8, 30, 8]);
    // Let the fly-off animation play before the list changes underneath it.
    setTimeout(() => {
      (dir === 'like' ? onLike : onHide)?.();
      setFlying(null);
      setDx(0);
    }, 220);
  }, [onLike, onHide]);

  const onPointerUp = useCallback(e => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    try { s.el.releasePointerCapture(e.pointerId); } catch { /* fine */ }
    draggedLast.current = s.moved;
    const travelled = deadzoned(e.clientX - s.x);
    const velocity = Math.abs(travelled) / Math.max(1, performance.now() - s.t);
    reset();
    if (s.axis !== 'x') return;

    const committed = Math.abs(travelled) > COMMIT_PX ||
                      (velocity > FLICK_VELOCITY && Math.abs(travelled) > 40);
    if (committed) finish(travelled > 0 ? 'like' : 'hide');
  }, [finish]);

  // The browser taking the gesture over IS a drag, whatever distance it had
  // covered by then: a click must not follow it.
  const onPointerCancel = useCallback(() => {
    if (start.current) draggedLast.current = true;
    reset();
  }, []);

  // How close this gesture is to committing, for the stamp opacity.
  const progress = Math.min(1, Math.abs(dx) / COMMIT_PX);
  const direction = flying || (Math.abs(dx) < 6 ? null : dx > 0 ? 'like' : 'hide');
  const offset = flying ? (flying === 'like' ? 700 : -700) : dx;

  return {
    handlers: enabled
      ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel }
      : {},
    dx: offset,
    // A little rotation reads as physical. Kept to 8° and paired with a slight
    // scale-up, because a full-bleed card rotating further exposes a bare wedge
    // of background at the corner and stops reading as a card at all.
    rotation: Math.max(-8, Math.min(8, offset / 18)),
    scale: 1 + Math.min(0.05, Math.abs(offset) / 4000),
    progress: flying ? 1 : progress,
    direction,
    flying: Boolean(flying),
    /** For the buttons, so a tap does exactly what a swipe does. */
    trigger: finish,
    /**
     * Was the gesture that just ended a drag rather than a tap? Reading it
     * consumes it, so a later keyboard activation of the same button, which
     * has no pointer gesture behind it at all, is never mistaken for a drag.
     */
    wasDrag: () => { const d = draggedLast.current; draggedLast.current = false; return d; },
    COMMIT_PX,
  };
}
