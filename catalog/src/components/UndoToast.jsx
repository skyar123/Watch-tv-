import { useEffect, useState } from 'react';
import { Undo2, Heart, X } from 'lucide-react';
import { useStore, actions } from '../lib/store.js';

/**
 * Undo for the last swipe.
 *
 * Not optional. A swipe is a flick of the thumb, and "not for me" removes a
 * show from every list for good — the two do not belong together without a way
 * back. It sits above the tab bar for a few seconds and then gets out of the
 * way.
 */
const WINDOW_MS = 5200;

export default function UndoToast() {
  const v = useStore();
  const last = v.lastAction;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!last) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [last]);

  useEffect(() => {
    if (!last) return;
    const t = setTimeout(() => actions.clearLastAction(), WINDOW_MS);
    return () => clearTimeout(t);
  }, [last]);

  if (!last) return null;
  const left = WINDOW_MS - (now - last.at);
  if (left <= 0) return null;

  const liked = last.kind === 'save';
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-safe"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4.6rem)' }}
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-2 overflow-hidden
                      rounded-full glass border border-white/15 py-1 pl-3 pr-1 animate-rise">
        <span className={`shrink-0 ${liked ? 'text-mint' : 'text-haze-400'}`}>
          {liked ? <Heart size={13} fill="currentColor" /> : <X size={13} />}
        </span>
        <span className="min-w-0 truncate text-[12.5px] text-haze-200">
          {liked ? 'Saved' : 'Hidden'} <span className="text-white">{last.name}</span>
        </span>
        <button
          type="button"
          onClick={() => actions.undoLast()}
          className="tap shrink-0 gap-1 rounded-full bg-white/10 px-3 text-[12.5px] font-medium
                     text-white active:scale-95"
        >
          <Undo2 size={13} />Undo
        </button>
        {/* A quiet countdown, so the window is visible rather than a surprise. */}
        <span className="absolute bottom-0 left-0 h-0.5 bg-white/25 transition-none"
              style={{ width: `${Math.max(0, (left / WINDOW_MS) * 100)}%` }} aria-hidden="true" />
      </div>
    </div>
  );
}
