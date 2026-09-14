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
 *   • Direction is decided once, at the start of a gesture, and never revisited.
 *     Without a lock, a diagonal flick alternately scrolls and swipes and the
 *     card judders. Past ANGLE_LOCK_PX the gesture is horizontal or it is not,
 *     for its whole life.
 */

const ANGLE_LOCK_PX = 10;   // movement before deciding which axis this is
const COMMIT_PX = 88;       // past this on release, the swipe counts
const FLICK_VELOCITY = 0.5; // px/ms — a fast short flick counts too

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

  const reset = () => { start.current = null; setDx(0); };

  const onPointerDown = useCallback(e => {
    if (!enabled || flying) return;
    // Ignore the second finger of a pinch, and anything but a primary press.
    if (!e.isPrimary) return;
    start.current = {
      x: e.clientX, y: e.clientY, t: performance.now(),
      id: e.pointerId, axis: null, el: e.currentTarget,
    };
  }, [enabled, flying]);

  const onPointerMove = useCallback(e => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;

    if (!s.axis) {
      if (Math.abs(mx) < ANGLE_LOCK_PX && Math.abs(my) < ANGLE_LOCK_PX) return;
      s.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (s.axis === 'x') {
        // Ours now. Capture so the gesture survives the pointer leaving the
        // card, which it will — the card flies off the side of the screen.
        try { s.el.setPointerCapture(e.pointerId); } catch { /* already gone */ }
      } else {
        // Vertical: hand it back to the browser and stay out of the way.
        start.current = null;
        return;
      }
    }
    if (s.axis !== 'x') return;
    // Slight resistance, so the card feels attached rather than frictionless.
    setDx(Math.sign(mx) * Math.pow(Math.abs(mx), 0.94));
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
    const travelled = e.clientX - s.x;
    const velocity = Math.abs(travelled) / Math.max(1, performance.now() - s.t);
    reset();
    if (s.axis !== 'x') return;

    const committed = Math.abs(travelled) > COMMIT_PX ||
                      (velocity > FLICK_VELOCITY && Math.abs(travelled) > 40);
    if (committed) finish(travelled > 0 ? 'like' : 'hide');
  }, [finish]);

  const onPointerCancel = useCallback(() => reset(), []);

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
    COMMIT_PX,
  };
}
