import { useMemo, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { MOODS, pickForMood } from '../lib/moods.js';
import { useStore, actions, watchedSet } from '../lib/store.js';
import { totalTime } from '../lib/derive.js';
import { availability } from '../lib/providers.js';
import { HoursChip, StatusBadge, Reason, Unknown } from '../components/bits.jsx';

/**
 * Tonight. Pick a mood, get three picks, each with the reason it was picked.
 *
 * The reasons are not decoration. Every one is generated from the predicate
 * that actually matched in lib/moods.js, so if the reason reads oddly the fix
 * is the predicate, not the copy.
 */
export default function TonightScreen({ pool, ranked, taste, onOpen, household }) {
  const state = useStore();
  const [mood, setMood] = useState(null);
  const [nonce, setNonce] = useState(0);

  const ctx = useMemo(() => ({
    saved: state.saved,
    notForMe: state.notForMe,
    seen: state.seen,
    hideUnavailable: state.hideUnavailable,
    watchedByShow: key => watchedSet(state, key),
    // Providers are only known for shows the feed has already enriched, so this
    // is a bonus when we have it rather than a filter we pretend to apply.
    availabilityFor: () => ({ known: false, onMine: [] }),
  }), [state]);

  /**
   * Rank position from the taste model, so a mood's picks come out in the
   * order that suits whoever is looking rather than in catalogue order.
   */
  const tasteRank = useMemo(() => {
    const m = new Map();
    (ranked || []).forEach((s, i) => m.set(s.key, { i, why: s._why, both: s._both }));
    return m;
  }, [ranked]);

  const picks = useMemo(() => {
    if (!mood) return [];
    const source = ranked?.length ? ranked : pool;
    const all = pickForMood(mood, source, ctx)
      .map(p => {
        const r = tasteRank.get(p.show.key);
        // A mood is a hard filter; taste decides the order within it.
        return { ...p, tasteWhy: r?.why, score: p.score + (r ? Math.max(0, 6 - r.i / 12) : 0) };
      })
      .sort((a, b) => b.score - a.score);
    // A little rotation so pressing the mood again gives you something else,
    // without ever showing a worse pick above a better one.
    const top = all.slice(0, 12);
    const start = (nonce * 3) % Math.max(1, top.length);
    return [...top.slice(start), ...top.slice(0, start)].slice(0, 3);
  }, [mood, pool, ctx, nonce]);

  const moodDef = MOODS.find(m => m.id === mood);

  return (
    <div className="px-safe pt-safe">
      <header className="pb-3 pt-2">
        <h1 className="text-[26px] font-bold tracking-tight">
          {state.isTogether ? 'Tonight, together' : `Tonight, ${state.name}`}
        </h1>
        <p className="mt-0.5 text-[13px] text-haze-400">
          {state.isTogether
            ? `Picks that suit ${(state.others || []).map(o => o.name).join(' and ')}. ` +
              'Anything either of you has hidden is out.'
            : 'What are you in the mood for? Every pick says why it was picked.'}
        </p>
      </header>

      {household && (household.agreed.length > 0 || household.contested.length > 0) && (
        <div className="mb-3 rounded-2xl border border-white/10 bg-white/[.03] p-3">
          {household.agreed.length > 0 && (
            <p className="text-[12.5px] leading-snug text-haze-200">
              <span className="text-mint">You both go for</span>{' '}
              {household.agreed.join(', ')}.
            </p>
          )}
          {household.contested.length > 0 && (
            <p className="mt-1 text-[12.5px] leading-snug text-haze-200">
              <span className="text-gold">You disagree about</span>{' '}
              {household.contested.join(', ')} — picks leaning that way score lower here.
            </p>
          )}
          {!household.enough && (
            <p className="mt-1 text-[11px] text-haze-400">
              Both of you need a few more swipes before this is worth much.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {MOODS.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => { setMood(m.id); setNonce(0); }}
            className={`rounded-2xl border p-3 text-left transition active:scale-[.98]
              ${mood === m.id ? 'border-pop/50 bg-pop/10' : 'border-white/10 bg-white/[.03]'}`}
            style={{ minHeight: 76 }}
          >
            <span className="text-xl">{m.emoji}</span>
            <p className="mt-1 text-[13.5px] font-semibold leading-tight">{m.label}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-haze-400">{m.blurb}</p>
          </button>
        ))}
      </div>

      {mood && (
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-haze-300">
              <Sparkles size={14} />{moodDef.label}
            </h2>
            {picks.length > 0 && (
              <button type="button" onClick={() => setNonce(n => n + 1)}
                className="tap gap-1.5 rounded-full border border-white/12 px-3 text-[12px] text-haze-300">
                <RefreshCw size={13} />Others
              </button>
            )}
          </div>

          {picks.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[.03] p-4">
              <Unknown>
                {moodDef.emptyNote ||
                 'Nothing in the loaded catalogue matches this mood on the data available.'}
              </Unknown>
            </div>
          )}

          <div className="space-y-3">
            {picks.map(p => (
              <button
                key={p.show.key}
                type="button"
                onClick={() => { actions.logMood(mood, p.show.key); onOpen(p.show); }}
                className="flex w-full gap-3 rounded-2xl border border-white/10 bg-white/[.03]
                           p-2.5 text-left transition active:scale-[.99] active:bg-white/[.06]"
              >
                {p.show.poster ? (
                  <img src={p.show.poster} alt="" loading="lazy"
                       className="h-28 w-[74px] shrink-0 rounded-lg object-cover no-drag" />
                ) : (
                  <div className="grid h-28 w-[74px] shrink-0 place-items-center rounded-lg bg-ink-800
                                  text-[10px] text-haze-400">no art</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{p.show.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <StatusBadge show={p.show} />
                    <HoursChip time={totalTime(p.show)} />
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-snug text-haze-200">{p.reason}</p>
                  {p.tasteWhy && (
                    <p className="mt-1 flex items-start gap-1 text-[11.5px] leading-snug text-mint">
                      <Sparkles size={11} className="mt-0.5 shrink-0" />
                      <span>{p.tasteWhy}</span>
                    </p>
                  )}
                  {p.bonuses.length > 0 && (
                    <p className="mt-1 text-[11px] text-haze-400">Also: {p.bonuses.join(', ')}.</p>
                  )}
                </div>
              </button>
            ))}
          </div>

          {picks.length > 0 && (
            <p className="mt-3 text-[10.5px] leading-snug text-haze-400">
              Picked from the {(ranked?.length || pool.length)} shows currently loaded, on genre,
              runtime, rating and status — the fields the data actually has. Ordered by
              {state.isTogether ? ' what suits both of you' : ` what ${state.name} saves, finishes and hides`}
              {taste?.sampleSize ? `, from ${taste.sampleSize} signal${taste.sampleSize > 1 ? 's' : ''} so far` : ' (nothing learned yet)'}.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
