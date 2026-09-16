import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, Users, ChevronDown } from 'lucide-react';
import { useStore, actions, TOGETHER } from '../lib/store.js';

/**
 * Who is looking. Two people share one link, so the app has to ask.
 *
 * Together is not a third person: it keeps its own list but reads both
 * people's filters, so a show either of you has hidden never appears.
 *
 * Two shapes, because 393pt is not much:
 *   collapsed — one pill naming the current person, tap to expand. Used over
 *               the feed, where three chips crowded the refresh button and
 *               shrinking them to bare icons made them unreadable.
 *   expanded  — all three, for the header and Settings.
 */
export default function ProfileBar({ collapsed = false }) {
  const v = useStore();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const ref = useRef(null);

  const ids = ['p1', 'p2', TOGETHER];
  const active = v.profiles[v.profileId];

  useEffect(() => {
    if (!open) return;
    const away = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const pick = id => { actions.switchProfile(id); setOpen(false); };

  const chip = (id) => {
    const p = v.profiles[id];
    if (!p) return null;
    const on = v.profileId === id;
    const isTog = id === TOGETHER;

    if (editing === id) {
      return (
        <form
          key={id}
          onSubmit={e => { e.preventDefault(); actions.renameProfile(id, draft || p.name); setEditing(null); }}
          className="flex items-center gap-1"
        >
          <input
            autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { actions.renameProfile(id, draft || p.name); setEditing(null); }}
            className="w-24 rounded-lg border border-white/25 bg-ink-800 px-2 text-white"
            style={{ minHeight: 44 }}
            aria-label="Profile name"
          />
          <button type="submit" className="tap text-mint" aria-label="Save name"><Check size={16} /></button>
        </form>
      );
    }

    return (
      <button
        key={id}
        type="button"
        onClick={() => pick(id)}
        onDoubleClick={() => { if (!isTog) { setDraft(p.name); setEditing(id); } }}
        aria-pressed={on}
        className={`tap shrink-0 gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px]
          transition active:scale-95
          ${on ? 'border-white/30 bg-white/15 font-medium text-white'
               : 'border-white/10 bg-white/[.04] text-haze-300'}`}
      >
        {isTog ? <Users size={14} /> : <span aria-hidden="true">{p.emoji}</span>}
        {p.name}
      </button>
    );
  };

  if (!collapsed) {
    return <div className="flex flex-wrap items-center gap-1.5">{ids.map(chip)}</div>;
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={`Watching as ${active?.name}. Change who is watching.`}
        className="tap gap-1.5 whitespace-nowrap rounded-full glass border border-white/15
                   px-3 text-[13px] font-medium text-white active:scale-95"
      >
        {v.isTogether ? <Users size={14} /> : <span aria-hidden="true">{active?.emoji}</span>}
        {active?.name}
        <ChevronDown size={13} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 flex flex-col gap-1 rounded-2xl
                        glass border border-white/15 p-1.5 shadow-xl">
          {ids.filter(id => id !== v.profileId).map(chip)}
        </div>
      )}
    </div>
  );
}

/** Rename hint, shown in Settings rather than cluttering the bar. */
export function ProfileHint() {
  return (
    <p className="mt-1.5 text-[11px] text-haze-400">
      <Pencil size={10} className="mr-1 inline" />
      Double-tap a name to change it.
    </p>
  );
}
