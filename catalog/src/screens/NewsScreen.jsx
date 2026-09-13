import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, AlertCircle, Loader2 } from 'lucide-react';
import { ago } from '../lib/api.js';

/**
 * News, merged from thirteen feeds. Seven of them are queer publications.
 *
 * The source strip at the bottom is load-bearing: it names every feed that
 * failed. A queer outlet quietly dropping out of the merge must look like a
 * problem, not like a slow news day.
 */
export default function NewsScreen() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

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

  useEffect(() => { load(filter); }, [load, filter]);

  const down = (data?.sources || []).filter(s => !s.ok);

  return (
    <div className="px-safe pt-safe">
      <header className="flex items-start justify-between pb-3 pt-2">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">News</h1>
          {data?.fetchedAt && (
            <p className="mt-0.5 text-[12px] text-haze-400">
              Fetched {ago(Date.now() - data.fetchedAt)} · {data.items?.length ?? 0} stories
            </p>
          )}
        </div>
        <button type="button" onClick={() => load(filter)}
                className="tap rounded-full border border-white/12" aria-label="Refresh news">
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
        </button>
      </header>

      <div className="mb-3 flex gap-2">
        {[['all', 'Everything'], ['queer', 'Queer press'], ['tv', 'Trades']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)}
            className={`tap rounded-full border px-4 text-[13px] transition
              ${filter === id ? 'border-white/25 bg-white/10 text-white'
                              : 'border-white/10 text-haze-400'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading && !data && (
        <div className="flex items-center gap-2 py-8 text-haze-400">
          <Loader2 size={16} className="animate-spin" /><span className="text-[13px]">Merging feeds…</span>
        </div>
      )}

      <div className="space-y-3">
        {data?.items?.map(item => (
          <a key={item.url} href={item.url} target="_blank" rel="noreferrer"
             className="flex gap-3 rounded-2xl border border-white/10 bg-white/[.03] p-2.5
                        transition active:scale-[.99] active:bg-white/[.06]">
            {item.image && (
              <img src={item.image} alt="" loading="lazy"
                   className="h-[68px] w-[68px] shrink-0 rounded-lg object-cover no-drag" />
            )}
            <div className="min-w-0 flex-1">
              <p className="line-clamp-3 text-[13.5px] font-medium leading-snug">{item.title}</p>
              <p className="mt-1 text-[11px] text-haze-400">
                {item.source}
                {item.sourceTag === 'queer' && <span className="ml-1.5">🏳️‍🌈</span>}
                {item.publishedAt && ` · ${ago(Date.now() - item.publishedAt)}`}
              </p>
            </div>
          </a>
        ))}
      </div>

      {data && !loading && data.items?.length === 0 && (
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
