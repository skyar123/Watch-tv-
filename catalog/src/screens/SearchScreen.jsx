import { useEffect, useRef, useState } from 'react';
import { Search as SearchIcon, Loader2, X } from 'lucide-react';
import { searchShows } from '../lib/tvmaze.js';
import { searchLocal } from '../lib/catalogue.js';
import { totalTime } from '../lib/derive.js';
import { useStore } from '../lib/store.js';
import { StatusBadge, HoursChip, Unknown } from '../components/bits.jsx';

export default function SearchScreen({ onOpen, catalogue = [] }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const state = useStore();
  const timer = useRef(null);

  const [source, setSource] = useState('local');

  useEffect(() => {
    clearTimeout(timer.current);
    const needle = q.trim();
    if (needle.length < 2) { setResults(null); return; }

    // The whole catalogue is already in memory, so the first results are
    // instant and work offline. No request, no spinner, no debounce.
    const local = searchLocal(catalogue, needle)
      .filter(s => !state.notForMe[s.key])
      .map(show => ({ show, score: 1 }));
    setResults(local);
    setSource('local');

    // Then ask TVmaze, which reaches the ~62,000 shows the bake filtered out
    // for having no artwork or no rating. Only replaces the local results if
    // it genuinely finds more.
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { results: r } = await searchShows(needle);
        const remote = r.filter(x => !state.notForMe[x.show.key]);
        if (remote.length > local.length) { setResults(remote); setSource('tvmaze'); }
      } catch { /* the local results stand */ }
      finally { setLoading(false); }
    }, 380);
    return () => clearTimeout(timer.current);
  }, [q, state.notForMe, catalogue]);

  return (
    <div className="px-safe pt-safe">
      <header className="pb-3 pt-2">
        <h1 className="text-[26px] font-bold tracking-tight">Search</h1>
      </header>

      <div className="relative mb-4">
        <SearchIcon size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-haze-400" />
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Show name"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck="false"
          // 16px comes from the base layer. Anything smaller and Safari zooms
          // the page on focus and never zooms back.
          className="w-full rounded-xl border border-white/12 bg-white/[.05] py-3 pl-10 pr-10
                     text-white placeholder:text-haze-400 focus:border-white/30 focus:outline-none"
          style={{ minHeight: 44 }}
        />
        {q && (
          <button type="button" onClick={() => setQ('')}
            className="tap absolute right-0 top-1/2 -translate-y-1/2 text-haze-400"
            aria-label="Clear search">
            <X size={17} />
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-haze-400">
          <Loader2 size={15} className="animate-spin" /><span className="text-[13px]">Searching…</span>
        </div>
      )}

      {results?.length === 0 && !loading && (
        <Unknown>Nothing matching “{q}”, here or on TVmaze.</Unknown>
      )}

      <div className="space-y-2">
        {results?.map(({ show, score }) => (
          <button key={show.key} type="button" onClick={() => onOpen(show)}
            className="flex w-full gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-2.5
                       text-left transition active:scale-[.99]">
            {show.poster ? (
              <img src={show.poster} alt="" loading="lazy"
                   className="h-[86px] w-[58px] shrink-0 rounded-lg object-cover no-drag" />
            ) : (
              <div className="grid h-[86px] w-[58px] shrink-0 place-items-center rounded-lg
                              bg-ink-800 text-[10px] text-haze-400">no art</div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14.5px] font-semibold">{show.name}</p>
              <p className="text-[11.5px] text-haze-400">
                {[show.premiered?.slice(0, 4), show.network, show.genres?.slice(0, 2).join(' · ')]
                  .filter(Boolean).join(' · ')}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <StatusBadge show={show} />
                {show.rating != null && (
                  <span className="chip border border-gold/25 bg-gold/10 text-gold">
                    ★ {show.rating.toFixed(1)}
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {results?.length > 0 && (
        <p className="mt-4 text-[10px] leading-snug text-haze-400">
          {source === 'local'
            ? `Instant, from the ${catalogue.length.toLocaleString()} shows held on this phone.`
            : 'From TVmaze — this one was outside the offline catalogue.'}
          {' '}Total hours and ratings load when you open a show.
        </p>
      )}
    </div>
  );
}
