import { useEffect, useState, useCallback, useMemo } from 'react';
import { RefreshCw, AlertCircle, Loader2, Tv } from 'lucide-react';
import { ago } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { buildShowMatcher } from '../lib/newsmatch.js';

/**
 * News, merged from thirteen feeds. Seven of them are queer publications.
 *
 * The source strip at the bottom is load-bearing: it names every feed that
 * failed. A queer outlet quietly dropping out of the merge must look like a
 * problem, not like a slow news day.
 *
 * Every story is run through the show matcher, so an article carries the show
 * it is about and "Your shows" is a real filter rather than a chronological
 * list to scroll. See lib/newsmatch.js for why that is harder than it sounds
 * and what it refuses to guess at.
 */
export default function NewsScreen({ catalogue = [], onOpen }) {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const state = useStore();

  /**
   * The shows this person actually cares about: saved, watched, or taught to
   * the app by hand. Small enough that matching their names in prose is safe,
   * which is the whole reason this list exists separately from the catalogue.
   */
  const mine = useMemo(() => {
    const keys = new Set([
      ...Object.keys(state.saved || {}),
      ...Object.keys(state.watched || {}),
    ]);
    if (!keys.size || !catalogue.length) return [];
    const byKey = new Map(catalogue.map(s => [s.key, s]));
    return [...keys].map(k => byKey.get(k)).filter(Boolean);
  }, [state.saved, state.watched, catalogue]);

  const matcher = useMemo(
    () => (catalogue.length ? buildShowMatcher(catalogue, mine) : null),
    [catalogue, mine],
  );

  const items = useMemo(() => {
    const raw = data?.items || [];
    if (!matcher) return raw.map(i => ({ ...i, shows: [] }));
    return raw.map(i => ({ ...i, shows: matcher(i) }));
  }, [data, matcher]);

  const mineKeys = useMemo(() => new Set(mine.map(s => s.key)), [mine]);
  const aboutYours = useMemo(
    () => items.filter(i => i.shows.some(h => mineKeys.has(h.show.key))),
    [items, mineKeys],
  );
  const shown = filter === 'mine' ? aboutYours : items;

  const load = useCallback(async (tag) => {
    setLoading(true);
    try {
      const qs = tag && tag !== 'all' ? `?tag=${tag}&limit=60` : '?limit=60';
      const res = await fetch(`/api/news${qs}`);
      setData(await res.json());
    } catch {
      setData({ items: [], sources: [], error: 'Could not reach the news function.' });
    } finally { setLoading(false); }
  }, []);

  /**
   * "Your shows" is a filter over what has already been fetched, not a tag the
   * news function knows about. Passing it through as one asked for the feeds
   * tagged "mine", of which there are none, so the list emptied and coming
   * back to Everything refetched all thirteen feeds for no reason.
   */
  const fetchTag = filter === 'mine' ? 'all' : filter;
  useEffect(() => { load(fetchTag); }, [load, fetchTag]);

  const down = (data?.sources || []).filter(s => !s.ok);

  return (
    <div className="px-safe pt-safe">
      <header className="flex items-start justify-between pb-3 pt-2">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">News</h1>
          {data?.fetchedAt && (
            <p className="mt-0.5 text-[12px] text-haze-400">
              Fetched {ago(Date.now() - data.fetchedAt)} · {items.length} stories
              {items.some(i => i.shows.length) &&
                ` · ${items.filter(i => i.shows.length).length} about a show`}
            </p>
          )}
        </div>
        <button type="button" onClick={() => load(filter)}
                className="tap rounded-full border border-white/12" aria-label="Refresh news">
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {[['all', 'Everything'], ['mine', 'Your shows'], ['queer', 'Queer press'], ['tv', 'Trades']]
          .map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)}
            className={`tap shrink-0 rounded-full border px-4 text-[13px] transition
              ${filter === id ? 'border-white/25 bg-white/10 text-white'
                              : 'border-white/10 text-haze-400'}`}>
            {label}
            {id === 'mine' && aboutYours.length > 0 && (
              <span className="ml-1.5 text-mint">{aboutYours.length}</span>
            )}
          </button>
        ))}
      </div>

      {filter === 'mine' && !loading && aboutYours.length === 0 && (
        <p className="mb-3 rounded-xl border border-white/10 bg-white/[.03] p-3
                      text-[12.5px] leading-snug text-haze-300">
          {mine.length === 0
            ? 'Nothing to match against yet. Save a few shows, or tell the app what you have watched, and coverage of them will collect here.'
            : `None of today's stories mention your ${mine.length} shows. This is checked against the headline and the summary, not guessed at, so an empty list means the press has not written about them today.`}
        </p>
      )}

      {loading && !data && (
        <div className="flex items-center gap-2 py-8 text-haze-400">
          <Loader2 size={16} className="animate-spin" /><span className="text-[13px]">Merging feeds…</span>
        </div>
      )}

      <div className="space-y-3">
        {shown.map(item => (
          <a key={item.url} href={item.url} target="_blank" rel="noreferrer"
             className="flex gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-2.5
                        transition active:scale-[.99] active:bg-white/[.06]">
            {item.image && (
              // Feed images are hotlinked from each publisher and a fair number
              // 404 or block referrers. Collapse the slot rather than leaving a
              // grey hole next to the headline.
              <img src={item.image} alt="" loading="lazy"
                   onError={e => { e.currentTarget.style.display = 'none'; }}
                   className="h-[68px] w-[68px] shrink-0 rounded-lg object-cover no-drag" />
            )}
            <div className="min-w-0 flex-1">
              <p className="line-clamp-3 text-[13.5px] font-medium leading-snug">{item.title}</p>
              <p className="mt-1 text-[11px] text-haze-400">
                {item.source}
                {item.sourceTag === 'queer' && <span className="ml-1.5">🏳️‍🌈</span>}
                {item.publishedAt && ` · ${ago(Date.now() - item.publishedAt)}`}
              </p>
              {item.shows.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {item.shows.slice(0, 3).map(h => (
                    <ShowChip key={h.show.key} hit={h} yours={mineKeys.has(h.show.key)}
                              onOpen={onOpen} />
                  ))}
                </div>
              )}
            </div>
          </a>
        ))}
      </div>

      {data && !loading && items.length === 0 && (
        <p className="py-8 text-center text-[13px] text-haze-400">
          {data.error || 'No stories came back.'}
        </p>
      )}

      {down.length > 0 && (
        <div className="mt-5 rounded-xl border border-gold/25 bg-gold/[.06] p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-gold">
            <AlertCircle size={13} />
            {down.length} source{down.length > 1 ? 's' : ''} unreachable right now
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-haze-300">
            {down.map(s => `${s.name} (${s.reason})`).join(' · ')}
          </p>
          <p className="mt-1 text-[10.5px] text-haze-400">
            Listed rather than hidden, so a missing outlet never looks like a quiet news day.
          </p>
        </div>
      )}

      {data?.sources?.length > 0 && (
        <p className="mt-4 text-[10px] leading-relaxed text-haze-400">
          Sources: {data.sources.map(s => s.name).join(', ')}.
        </p>
      )}
    </div>
  );
}

/**
 * The show an article is about, as a tappable chip.
 *
 * It says HOW the match was made, because "the publication put this title in
 * quotes" and "this is a show you saved and its name is in the headline" are
 * different kinds of evidence and the app does not pretend otherwise.
 */
function ShowChip({ hit, yours, onOpen }) {
  const { show, how, where } = hit;
  const why = how === 'quoted'
    ? `${show.name} is named in the ${where}`
    : `${show.name} is on your list and named in the ${where}`;
  return (
    <button
      type="button"
      title={why}
      aria-label={why}
      onClick={e => { e.preventDefault(); e.stopPropagation(); onOpen?.(show); }}
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px]
                  font-medium transition active:scale-95
        ${yours ? 'border-mint/40 bg-mint/10 text-mint'
                : 'border-white/15 bg-white/[.06] text-haze-200'}`}
    >
      <Tv size={10} />
      <span className="max-w-[10rem] truncate">{show.name}</span>
    </button>
  );
}
