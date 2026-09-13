import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * A bottom sheet with a grab handle and drag-to-dismiss.
 *
 * The two things that make this feel wrong on a phone if you get them slightly
 * off, both handled here:
 *
 *  • Scrolling INSIDE the sheet must not drag the page behind it. That is
 *    `overscroll-behavior: contain` on the scroll pane plus a body scroll lock
 *    while the sheet is open.
 *  • A downward drag should only dismiss when the content is already scrolled
 *    to the top. Otherwise every attempt to scroll up throws the sheet away.
 */
export default function Sheet({ open, onClose, children, title, peek = 0.92 }) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef(null);
  const start = useRef(null);

  // Lock the page behind the sheet without losing the scroll position.
  useEffect(() => {
    if (!open) return;
    const y = window.scrollY;
    const { style } = document.body;
    const prev = { position: style.position, top: style.top, width: style.width };
    style.position = 'fixed'; style.top = `-${y}px`; style.width = '100%';
    return () => {
      Object.assign(style, prev);
      window.scrollTo(0, y);
    };
  }, [open]);

  useEffect(() => { if (open) setDragY(0); }, [open]);

  useEffect(() => {
    if (!open) return;
    const esc = e => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);

  const onPointerDown = useCallback(e => {
    // Only start a dismiss-drag from the top of the scroll pane.
    const atTop = (scrollRef.current?.scrollTop ?? 0) <= 0;
    start.current = { y: e.clientY, atTop, id: e.pointerId };
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(e => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dy = e.clientY - s.y;
    if (dy <= 0) { setDragY(0); return; }
    const atTop = s.atTop || (scrollRef.current?.scrollTop ?? 0) <= 0;
    if (!atTop) return;
    // Resistance, so it feels attached rather than loose.
    setDragY(dy < 0 ? 0 : dy ** 0.92);
  }, []);

  const onPointerUp = useCallback(() => {
    setDragging(false);
    start.current = null;
    setDragY(y => {
      if (y > 110) { onClose?.(); return 0; }
      return 0;
    });
  }, [onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px] animate-fade-in"
        style={{ opacity: Math.max(0, 1 - dragY / 320) }}
        onClick={onClose}
        aria-label="Close"
      />
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col rounded-t-[22px]
                   border-t border-white/10 bg-ink-900 shadow-[0_-20px_60px_rgba(0,0,0,.6)]"
        style={{
          height: `calc(var(--screen) * ${peek})`,
          transform: `translateY(${dragY}px)`,
          transition: dragging ? 'none' : 'transform .28s cubic-bezier(.2,.9,.3,1)',
        }}
      >
        {/* The grab handle. touch-action:none so the browser does not claim the
            gesture as a scroll before we see it. */}
        <div
          className="shrink-0 cursor-grab select-none px-4 pb-1 pt-2.5 active:cursor-grabbing"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="mx-auto h-1 w-10 rounded-full bg-white/25" />
          {title && (
            <h2 className="mt-2 truncate text-center text-[13px] font-medium text-haze-300">
              {title}
            </h2>
          )}
        </div>

        <div ref={scrollRef} className="sheet-scroll min-h-0 flex-1 overflow-y-auto pb-safe">
          {children}
        </div>
      </div>
    </div>
  );
}
