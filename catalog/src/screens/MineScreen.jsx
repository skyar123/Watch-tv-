import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings, AlertTriangle, TrendingUp, Bookmark, PlayCircle } from 'lucide-react';
import { useStore, actions, watchedSet } from '../lib/store.js';
import { fetchShow } from '../lib/tvmaze.js';
import { progress, nextUnwatched, nextEpisode, totalTime } from '../lib/derive.js';
import { recommend, inProgress, finishedShows } from '../lib/recommend.js';
import { StatusBadge, HoursChip, Unknown, Reason } from '../components/bits.jsx';
import { ago } from '../lib/api.js';

/**
 * Your list: what you are in the middle of, what you saved, what changed
 * service, and what to try next with the reason named.
 */
export default function MineScreen({ pool, onOpen, changes, onSettings }) {
  const state = useStore();
  const [full, setFull] = useState({});      // showKey -> show with episodes
  const [recs, setRecs] = useState(null);

  // These memos are load-bearing. Recomputing savedKeys on every render makes
  // trackedKeys new every render, which makes `shows` new, which re-runs the
  // effects below, which set state and render again — an infinite loop that
  // pegs the phone. Keep every link in this chain keyed on a stable value.
  const savedKeys = useMemo(() => Object.keys(state.saved), [state.saved]);
  const trackedKeys = useMemo(
    () => [...new Set([...savedKeys, ...Object.keys(state.watched)])],
    [savedKeys, state.watched],
  );

  // A ref, not state: recording what we have already asked for must not itself
  // trigger a render, or we are back in the same loop.
  const requested = useRef(new Set());

  useEffect(() => {
    let dead = false;
    (async () => {
      for (const key of trackedKeys) {
        if (requested.current.has(key)) continue;
        requested.current.add(key);
        const id = Number(key.split(':')[1]);
        if (!Number.isFinite(id)) continue;
        try {
          const { show } = await fetchShow(id);
          if (dead) return;
          setFull(p => ({ ...p, [key]: show }));
        } catch {
          // Offline: let the row degrade to a name, and allow a later retry.
          requested.current.delete(key);
        }
      }
    })();
    return () => { dead = true; };
  }, [trackedKeys]);

  const shows = useMemo(
    () => trackedKeys.map(k => full[k]).filter(Boolean),
    [trackedKeys, full],
  );

  useEffect(() => {
    let dead = false;
    recommend({ shows, state, pool, limit: 8 })
      .then(r => { if (!dead) setRecs(r); })
      .catch(() => { if (!dead) setRecs([]); });
    return () => { dead = true; };
    // `state` is deliberately not a dependency: the store hands back a new
    // object on every write, and recommendations do not need to be recomputed
    // because a checkbox moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shows, pool]);

  const watching = inProgress(shows, state);
  const finished = finishedShows(shows, state);
  const notStarted = shows.filter(s =>
    state.saved[s.key] && !state.watched[s.key]);

  const leaving = changes.filter(c => c.lost.length);

  return (
    <div className="px-safe pt-safe">
      <header className="flex items-start justify-between pb-3 pt-2">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Mine</h1>
          <p className="mt-0.5 text-[13px] text-haze-400">
            {savedKeys.length} saved · {watching.length} in progress
          </p>
        </div>
        <button type="button" onClick={onSettings} className="tap rounded-full border border-white/12"
                aria-label="Settings">
          <Settings size={18} />
        </button>
      </header>

      {/* Leaving soon — a real diff, with the date it changed */}
      {leaving.length > 0 && (
        <section className="mb-5 rounded-2xl border border-gold/25 bg-gold/[.07] p-3">
          <h2 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase
                         tracking-wider text-gold">
            <AlertTriangle size={13} />Availability changed
          </h2>
          {leaving.map(c => (
            <div key={c.key} className="mb-2 last:mb-0">
              <p className="text-[13.5px] font-medium">{c.name}</p>
              <p className="text-[12px] text-haze-200">
                Left {c.lost.join(', ')}
                {c.nowOn.length ? ` — still on ${c.nowOn.join(', ')}` : ' — not on any subscription now'}.
              </p>
              <p className="text-[10px] text-haze-400">Noticed {ago(Date.now() - c.at)}</p>
            </div>
          ))}
        </section>
      )}
      {changes.some(c => c.gained.length) && (
        <section className="mb-5 rounded-2xl border border-mint/25 bg-mint/[.06] p-3">
          <h2 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase
                         tracking-wider text-mint">
            <TrendingUp size={13} />Newly available
          </h2>
          {changes.filter(c => c.gained.length).map(c => (
            <p key={c.key} className="text-[13px]">
              <span className="font-medium">{c.name}</span>
              <span className="text-haze-200"> arrived on {c.gained.join(', ')}</span>
            </p>
          ))}
        </section>
      )}

      {watching.length > 0 && (
        <Section title="Carry on" icon={<PlayCircle size={13} />}>
          {watching.map(({ show, done, total, pct }) => {
            const up = nextUnwatched(show, watchedSet(state, show.key));
            const next = nextEpisode(show);
            return (
              <Row key={show.key} show={show} onOpen={onOpen}>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-mint" style={{ width: `${pct * 100}%` }} />
                </div>
                <p className="mt-1 text-[12px] text-haze-200">
                  {up ? <>Next: <span className="text-white">S{up.season}E{up.number} — {up.name}</span></>
                      : 'All aired episodes watched'}
                </p>
                <p className="text-[11px] text-haze-400">
                  {done} of {total}
                  {next && ` · S${next.season}E${next.number} airs ${new Date(next.airsAt)
                    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
                </p>
              </Row>
            );
          })}
        </Section>
      )}

      {notStarted.length > 0 && (
        <Section title="Saved, not started" icon={<Bookmark size={13} />}>
          {notStarted.map(show => (
            <Row key={show.key} show={show} onOpen={onOpen}>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <StatusBadge show={show} />
                <HoursChip time={totalTime(show)} />
              </div>
            </Row>
          ))}
        </Section>
      )}

      {finished.length > 0 && (
        <Section title="Finished">
          <p className="mb-2 text-[12px] text-haze-400">
            {finished.map(f => f.show.name).join(', ')}
          </p>
        </Section>
      )}

      <Section title="Because of what you have watched">
        {recs === null && <p className="text-[12.5px] text-haze-400">Working it out…</p>}
        {recs?.length === 0 && (
          <Unknown>
            Nothing to go on yet. Mark some episodes watched and this fills in with
            recommendations that name the show they came from.
          </Unknown>
        )}
        <div className="space-y-2.5">
          {recs?.map((r, i) => (
            <div key={`${r.name}-${i}`}
                 className="rounded-2xl border border-white/10 bg-white/[.03] p-3">
              <div className="flex gap-3">
                {r.poster && (
                  <img src={r.poster} alt="" loading="lazy"
                       className="h-20 w-[54px] shrink-0 rounded-md object-cover no-drag" />
                )}
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold">{r.name}</p>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-haze-200">{r.because}</p>
                  <Reason confidence={r.confidence}>{r.caveat}</Reason>
                  <p className="mt-0.5 text-[10px] text-haze-400">Method: {r.engine}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {!savedKeys.length && !Object.keys(state.watched).length && (
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[.03] p-5 text-center">
          <p className="text-[14px] font-medium">Nothing saved yet.</p>
          <p className="mt-1 text-[12.5px] text-haze-400">
            Save something from the feed and this page starts tracking where you are,
            when the next episode airs, and when a show leaves a service.
          </p>
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase
                     tracking-wider text-haze-400">{icon}{title}</h2>
      {children}
    </section>
  );
}

function Row({ show, onOpen, children }) {
  return (
    <button type="button" onClick={() => onOpen(show)}
      className="mb-2 flex w-full gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-2.5
                 text-left transition active:scale-[.99] last:mb-0">
      {show.poster && (
        <img src={show.poster} alt="" loading="lazy"
             className="h-[86px] w-[58px] shrink-0 rounded-lg object-cover no-drag" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14.5px] font-semibold">{show.name}</p>
        {children}
      </div>
    </button>
  );
}
