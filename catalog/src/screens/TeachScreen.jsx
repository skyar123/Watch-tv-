import { useMemo, useState } from 'react';
import { Search, Heart, Eye, X, Check, Sparkles, Users } from 'lucide-react';
import { useStore, actions, TOGETHER } from '../lib/store.js';
import { searchLocal } from '../lib/catalogue.js';

/**
 * Tell it what you already like, instead of waiting for it to guess.
 *
 * A recommender with nothing to go on opens on whatever is popular, which is
 * the same feed for everyone and useless for two specific people. The fastest
 * fix is the obvious one: let them say what they have already watched and
 * loved. One tap here is worth a hundred scrolls — a "loved" is the strongest
 * signal the model takes, and a "seen it" counts as finished without demanding
 * sixty-two episode ticks.
 *
 * It can also teach the OTHER person's profile. Skylar knows what Anja likes,
 * and making him switch profiles, seed it, and switch back would mean nobody
 * ever does it.
 */

const VERDICTS = [
  { id: 'loved', label: 'Loved it',  Icon: Heart, tone: 'border-mint/50 bg-mint/15 text-mint' },
  { id: 'seen',  label: 'Seen it',   Icon: Eye,   tone: 'border-white/25 bg-white/10 text-white' },
  { id: 'nope',  label: 'Not for me', Icon: X,    tone: 'border-pop/40 bg-pop/15 text-pop-soft' },
];

export default function TeachScreen({ catalogue = [], onClose }) {
  const v = useStore();
  const [q, setQ] = useState('');
  // Who is being taught. Defaults to whoever is active, but never Together —
  // a shared list is not a person and has no taste of its own.
  const [target, setTarget] = useState(v.profileId === TOGETHER ? 'p1' : v.profileId);

  const people = Object.entries(v.profiles).filter(([k]) => k !== TOGETHER);
  const profile = v.profiles[target];

  /** What this person has already been told, so a tap can toggle back off. */
  const verdictOf = key => {
    if (profile.notForMe?.[key]) return 'nope';
    if (profile.saved?.[key]?.loved) return 'loved';
    if (profile.watched?.[key]) return 'seen';
    return null;
  };

  const results = useMemo(
    () => (q.trim().length >= 2 ? searchLocal(catalogue, q, 30) : []),
    [q, catalogue],
  );

  /**
   * The starting grid: broadly known shows, so there is something to tap
   * immediately. Ordered by popularity because recognising a title is the
   * whole job here — an obscure masterpiece teaches nothing if you have not
   * seen it.
   */
  const suggestions = useMemo(() => {
    const seen = new Set([
      ...Object.keys(profile.saved || {}),
      ...Object.keys(profile.watched || {}),
      ...Object.keys(profile.notForMe || {}),
    ]);
    return catalogue
      .filter(s => !seen.has(s.key) && (s.weight ?? 0) >= 92 && s.type === 'Scripted')
      .slice(0, 48);
  }, [catalogue, profile]);

  const set = (show, verdict) => {
    const current = verdictOf(show.key);
    actions.teachProfile(target, show, current === verdict ? 'clear' : verdict);
  };

  const taught = Object.keys(profile.watched || {}).length +
                 Object.keys(profile.notForMe || {}).length;

  const Row = ({ show, compact }) => {
    const verdict = verdictOf(show.key);
    return (
      <div className={`rounded-2xl border p-2 transition
        ${verdict ? 'border-white/20 bg-white/[.06]' : 'border-white/10 bg-white/[.03]'}`}>
        <div className="flex gap-2.5">
          {show.poster && (
            <img src={show.poster} alt="" loading="lazy"
                 className="h-[62px] w-[42px] shrink-0 rounded-md object-cover no-drag" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium leading-tight">{show.name}</p>
            <p className="truncate text-[11px] text-haze-400">
              {[show.premiered?.slice(0, 4), show.network, show.genres?.[0]].filter(Boolean).join(' · ')}
            </p>
            <div className="mt-1.5 flex gap-1">
              {VERDICTS.map(({ id, label, Icon, tone }) => {
                const on = verdict === id;
                return (
                  <button
                    key={id} type="button" onClick={() => set(show, id)}
                    aria-pressed={on}
                    aria-label={`${label}: ${show.name}`}
                    className={`tap flex-1 gap-1 rounded-lg border px-1 text-[11px] transition
                      active:scale-95 ${on ? tone : 'border-white/10 text-haze-400'}`}
                    style={{ minHeight: 44 }}
                  >
                    <Icon size={13} />{compact ? '' : label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="px-4 pb-8">
      <header className="pt-1">
        <h2 className="text-[19px] font-bold tracking-tight">Tell it what you like</h2>
        <p className="mt-1 text-[12.5px] leading-snug text-haze-400">
          One tap here beats an hour of scrolling. “Loved it” is the strongest thing you can
          tell it; “Seen it” counts as finished without ticking off every episode.
        </p>
      </header>

      {/* Whose taste is being taught. */}
      <div className="mt-3 flex items-center gap-1.5">
        <Users size={13} className="shrink-0 text-haze-400" />
        <span className="text-[12px] text-haze-400">Teaching</span>
        {people.map(([id, p]) => (
          <button
            key={id} type="button" onClick={() => setTarget(id)}
            aria-pressed={target === id}
            className={`tap gap-1.5 rounded-full border px-3 text-[13px] transition
              ${target === id ? 'border-white/30 bg-white/15 font-medium text-white'
                              : 'border-white/10 text-haze-300'}`}
          >
            <span aria-hidden="true">{p.emoji}</span>{p.name}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-haze-400">
        You can fill in {people.find(([id]) => id !== v.profileId)?.[1]?.name || 'the other profile'}’s
        too — you know what they like, and switching profiles to do it means nobody ever does.
      </p>

      <div className="relative mt-3">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-haze-400" />
        <input
          type="search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search any show"
          autoCorrect="off" autoCapitalize="words" spellCheck="false"
          className="w-full rounded-xl border border-white/12 bg-white/[.05] py-3 pl-9 pr-3
                     text-white placeholder:text-haze-400 focus:border-white/30 focus:outline-none"
          style={{ minHeight: 44 }}
        />
      </div>

      {q.trim().length >= 2 ? (
        <div className="mt-3 space-y-2">
          {results.length === 0 && (
            <p className="py-4 text-center text-[13px] text-haze-400">
              Nothing matching “{q}” in the offline catalogue.
            </p>
          )}
          {results.map(s => <Row key={s.key} show={s} />)}
        </div>
      ) : (
        <>
          <h3 className="mb-2 mt-5 flex items-center gap-1.5 text-[11px] font-semibold
                         uppercase tracking-wider text-haze-400">
            <Sparkles size={12} />Ones you have probably seen
          </h3>
          <div className="space-y-2">
            {suggestions.map(s => <Row key={s.key} show={s} />)}
          </div>
        </>
      )}

      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-white/10 glass px-4 py-3 pb-safe">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-haze-300">
            {taught === 0
              ? 'Nothing told yet'
              : `${taught} told about ${profile.name}`}
            {taught > 0 && taught < 5 && (
              <span className="block text-[11px] text-gold/90">
                A few more and it can start contrasting.
              </span>
            )}
          </p>
          <button type="button" onClick={onClose}
            className="tap gap-1.5 rounded-xl border border-mint/40 bg-mint/15 px-4
                       text-[13.5px] font-medium text-mint active:scale-95">
            <Check size={15} />Done
          </button>
        </div>
      </div>
    </div>
  );
}
