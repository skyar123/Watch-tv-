import { useEffect, useMemo, useState } from 'react';
import {
  Bookmark, BookmarkCheck, EyeOff, ExternalLink, Loader2, Check,
  CalendarClock, Baby, Heart, Accessibility, ChevronDown,
} from 'lucide-react';
import { useStore, actions, watchedSet } from '../lib/store.js';
import {
  totalTime, shapeOfShow, nextEpisode, nextUnwatched, progress,
  regular, cliffhangerRisk,
} from '../lib/derive.js';
import { availability } from '../lib/providers.js';
import { kidVerdict, VERDICT_TONE } from '../lib/kidsafe.js';
import { getEnding, getRepresentation } from '../data/curated.js';
import { StatusBadge, ProviderRow, HoursChip, Sparkline, Unknown, Reason, Freshness } from './bits.jsx';

export default function ShowDetail({ show, enriched, loading, onClose }) {
  const state = useStore();
  const [tab, setTab] = useState('about');
  const [news, setNews] = useState(null);

  const saved = Boolean(state.saved[show.key]);
  const watched = watchedSet(state, show.key);
  const time = totalTime(show);
  const shape = useMemo(() => shapeOfShow(show), [show]);
  const ending = cliffhangerRisk(show, getEnding(show.tvmazeId));
  const kid = kidVerdict(show);
  const rep = getRepresentation(show.tvmazeId);
  const avail = availability(enriched?.providers, state.services);
  const next = nextEpisode(show);
  const up = show.episodes ? nextUnwatched(show, watched) : null;
  const prog = show.episodes ? progress(show, watched) : null;

  // Per-show news, fetched only when that tab is opened.
  useEffect(() => {
    if (tab !== 'news' || news) return;
    let dead = false;
    (async () => {
      try {
        const r = await fetch(`/api/news?q=${encodeURIComponent(show.name)}&limit=15`);
        const j = await r.json();
        if (!dead) setNews(j);
      } catch { if (!dead) setNews({ items: [], sources: [], error: true }); }
    })();
    return () => { dead = true; };
  }, [tab, news, show.name]);

  const hero = enriched?.backdrop || show.backdrop || show.poster;

  return (
    <div>
      <div className="relative h-44 w-full overflow-hidden">
        {hero && <img src={hero} alt="" className="h-full w-full object-cover no-drag" />}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
          <h1 className="text-shadow-soft text-2xl font-bold leading-tight">{show.name}</h1>
          <p className="mt-0.5 text-[12px] text-haze-300">
            {[show.premiered?.slice(0, 4), show.network, show.genres?.slice(0, 3).join(' · ')]
              .filter(Boolean).join('  ·  ')}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
        <StatusBadge show={show} tmdbExtra={enriched?.extra} ending={ending} size="lg" />
        {time && <HoursChip time={time} />}
        {show.rating != null && (
          <span className="chip border border-gold/25 bg-gold/10 text-gold">★ {show.rating.toFixed(1)}</span>
        )}
      </div>

      <div className="mt-3 flex gap-2 px-4">
        <button
          type="button"
          onClick={() => actions.toggleSave(show)}
          className={`tap flex-1 gap-2 rounded-xl border px-3 text-sm font-medium transition active:scale-[.98]
            ${saved ? 'border-mint/40 bg-mint/15 text-mint' : 'border-white/15 bg-white/5 text-white'}`}
        >
          {saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
          {saved ? 'Saved' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => { actions.notForMe(show); onClose(); }}
          className="tap gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 text-sm text-haze-200
                     transition active:scale-[.98]"
        >
          <EyeOff size={17} />Not for me
        </button>
      </div>

      <div className="mt-4 flex gap-1 border-b border-white/10 px-4">
        {[['about', 'About'], ['episodes', 'Episodes'], ['news', 'News']].map(([id, label]) => (
          <button
            key={id} type="button" onClick={() => setTab(id)}
            className={`tap px-3 text-[13px] font-medium transition
              ${tab === id ? 'border-b-2 border-white text-white' : 'text-haze-400'}`}
          >{label}</button>
        ))}
      </div>

      {tab === 'about' && (
        <div className="space-y-5 px-4 py-4">
          {/* Where can I actually watch it */}
          <Block title="Where you can watch it">
            <ProviderRow availability={avail} />
            {avail.known && avail.paid.length > 0 && !avail.onMine.length && (
              <p className="mt-1.5 text-[11px] text-haze-400">
                Buy or rent only on {avail.paid.slice(0, 3).map(p => p.name).join(', ')} — not
                included in a subscription.
              </p>
            )}
            {avail.known && (
              <p className="mt-1.5 text-[10px] text-haze-400">
                Availability from JustWatch via TMDB
                {avail.fetchedAt && ` · checked ${new Date(avail.fetchedAt).toLocaleString()}`}
              </p>
            )}
            {avail.link && (
              <a href={avail.link} target="_blank" rel="noreferrer"
                 className="mt-2 inline-flex items-center gap-1 text-[12px] text-mint">
                Open on JustWatch <ExternalLink size={12} />
              </a>
            )}
          </Block>

          {/* Is it finished, and does it land */}
          <Block title="Is it finished?">
            <StatusBadge show={show} tmdbExtra={enriched?.extra} ending={ending} />
            {ending && (
              <div className="mt-2">
                <Reason confidence={ending.confidence}>{ending.why}</Reason>
                <p className="mt-1 text-[10px] text-haze-400">Source: {ending.source}</p>
              </div>
            )}
            {!enriched?.extra?.available && (
              <p className="mt-2">
                <Unknown>
                  TVmaze has no cancelled status, so a cancellation can only be confirmed
                  from TMDB, which is unavailable on this deploy.
                </Unknown>
              </p>
            )}
          </Block>

          {/* How long is this */}
          {time && (
            <Block title="How long is this">
              <p className="text-2xl font-semibold">
                {time.hours < 1 ? `${time.minutes} minutes`
                  : `${time.hours < 10 ? time.hours.toFixed(1) : Math.round(time.hours)} hours`}
              </p>
              <p className="mt-0.5 text-[12px] text-haze-300">{time.note}</p>
              {time.basis !== 'exact' && (
                <p className="mt-1 text-[11px] text-gold/90">
                  This is an estimate — not every episode carries a runtime.
                </p>
              )}
            </Block>
          )}

          {/* Does it get good, and when */}
          {shape ? (
            <Block title="Does it get good?">
              {shape.notes.length > 0 ? (
                <div className="space-y-2">
                  {shape.notes.map((n, i) => (
                    <div key={i}>
                      <p className="text-[13.5px] font-medium">{n.text}</p>
                      <Reason confidence={n.confidence}>{n.detail}</Reason>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-haze-300">
                  No clear pattern across seasons — it stays roughly where it starts.
                </p>
              )}

              <div className="mt-3 space-y-1.5">
                {shape.stats.seasons.map(s => (
                  <div key={s.season} className="flex items-center gap-3">
                    <span className="w-8 shrink-0 text-[11px] text-haze-400">S{s.season}</span>
                    <span className="shrink-0 text-mint"><Sparkline season={s} /></span>
                    <span className="text-[11px] tabular-nums text-haze-300">
                      {s.avg.toFixed(1)}
                      <span className="ml-1 text-haze-400">
                        ({s.min.toFixed(1)}–{s.max.toFixed(1)})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-haze-400">
                Drawn against this show's own range ({shape.stats.scaleLo.toFixed(1)}–
                {shape.stats.scaleHi.toFixed(1)}), not 0–10, or every show would be a flat
                line. {shape.stats.rated} of {shape.stats.total} episodes are rated.
                Ratings from TVmaze.
              </p>
            </Block>
          ) : show.episodes && (
            <Block title="Does it get good?">
              <Unknown>Fewer than three rated episodes — not enough to say anything.</Unknown>
            </Block>
          )}

          {/* Kid-friendly, judged on content */}
          <Block title="Kid-friendly?" icon={<Baby size={13} />}>
            <p className={`text-[13.5px] font-medium ${{
              good: 'text-mint', warn: 'text-gold', bad: 'text-pop-soft', muted: 'text-haze-300',
            }[VERDICT_TONE[kid.verdict]]}`}>
              {kid.headline}
            </p>
            <p className="mt-1 text-[12.5px] leading-snug text-haze-300">{kid.why}</p>
            {kid.contains?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {kid.contains.map(c => (
                  <span key={c.what} className="chip border border-white/12 bg-white/5 text-haze-200">
                    {c.what}{c.level === 'heavy' && ' · sustained'}
                  </span>
                ))}
              </div>
            )}
            {kid.absent?.length > 0 && (
              <p className="mt-1.5 text-[11px] text-mint/80">
                Checked and not present: {kid.absent.join(', ')}.
              </p>
            )}
            {kid.certificate && (
              <p className="mt-1.5 text-[10px] text-haze-400">
                Certificate is {kid.certificate}; the judgement above is about content, not the certificate.
              </p>
            )}
          </Block>

          {/* Representation */}
          <Block title="Representation" icon={<Heart size={13} />}>
            {rep?.queer && (
              <RepRow icon={<Heart size={13} />} label="Queer" level={rep.queer.level}
                      why={rep.queer.why} checked={rep.checked} />
            )}
            {rep?.disability && (
              <RepRow icon={<Accessibility size={13} />} label="Disability" level={rep.disability.level}
                      why={rep.disability.why} checked={rep.checked} />
            )}
            {!rep && (
              <Unknown>
                Not checked. No API records whether a queer or disabled character is a lead or
                walks through one scene, so this is only ever filled in by hand.
              </Unknown>
            )}
          </Block>

          {show.summary && (
            <Block title="What it is">
              <p className="text-[13.5px] leading-relaxed text-haze-200">{show.summary}</p>
            </Block>
          )}

          {enriched?.matchConfidence === 'low' && (
            <p className="text-[11px] text-gold/90">
              TMDB data on this page came from a title-only match, so it may be the wrong show.
            </p>
          )}
        </div>
      )}

      {tab === 'episodes' && (
        <EpisodeList show={show} watched={watched} loading={loading}
                     next={next} up={up} prog={prog} />
      )}

      {tab === 'news' && (
        <div className="px-4 py-4">
          {!news && <Loading label="Searching the feeds…" />}
          {news?.items?.length === 0 && (
            <Unknown>No recent articles mentioning {show.name} in the feeds.</Unknown>
          )}
          <div className="space-y-3">
            {news?.items?.map(item => (
              <a key={item.url} href={item.url} target="_blank" rel="noreferrer"
                 className="block rounded-xl border border-white/10 bg-white/[.03] p-3 active:bg-white/[.07]">
                <p className="text-[13.5px] font-medium leading-snug">{item.title}</p>
                <p className="mt-1 text-[11px] text-haze-400">
                  {item.source}
                  {item.sourceTag === 'queer' && <span className="ml-1.5 text-pop-soft">🏳️‍🌈</span>}
                  {item.publishedAt && ` · ${new Date(item.publishedAt).toLocaleDateString()}`}
                </p>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Block({ title, icon, children }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase
                     tracking-wider text-haze-400">
        {icon}{title}
      </h3>
      {children}
    </section>
  );
}

function RepRow({ icon, label, level, why, checked }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <span className="chip border border-pop/30 bg-pop/10 text-pop-soft">{icon}{label} · {level}</span>
      <p className="mt-1.5 text-[12.5px] leading-snug text-haze-200">{why}</p>
      <p className="mt-0.5 text-[10px] text-haze-400">Checked by hand, {checked}.</p>
    </div>
  );
}

function Loading({ label }) {
  return (
    <div className="flex items-center gap-2 py-6 text-haze-400">
      <Loader2 size={16} className="animate-spin" /><span className="text-[13px]">{label}</span>
    </div>
  );
}

/** The episode tracker: where you are, what is next, when it airs. */
function EpisodeList({ show, watched, loading, next, up, prog }) {
  const [openSeason, setOpenSeason] = useState(null);
  const eps = regular(show.episodes);

  useEffect(() => { if (up && openSeason == null) setOpenSeason(up.season); }, [up, openSeason]);

  if (loading) return <div className="px-4"><Loading label="Loading episodes…" /></div>;
  if (!eps.length) return <div className="px-4 py-4"><Unknown>No episode data.</Unknown></div>;

  const seasons = [...new Set(eps.map(e => e.season))].sort((a, b) => a - b);

  return (
    <div className="px-4 py-4">
      {prog && (
        <div className="mb-4 rounded-xl border border-white/10 bg-white/[.03] p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-medium">
              {prog.done} of {prog.total} episodes
            </span>
            <span className="text-[11px] text-haze-400">{Math.round(prog.pct * 100)}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-mint transition-all"
                 style={{ width: `${prog.pct * 100}%` }} />
          </div>
          {up && (
            <p className="mt-2 text-[12.5px] text-haze-200">
              Up next: <span className="font-medium text-white">
                S{up.season}E{up.number} — {up.name}</span>
            </p>
          )}
          {next && (
            <p className="mt-1 flex items-center gap-1.5 text-[12px] text-mint">
              <CalendarClock size={12} />
              S{next.season}E{next.number} airs {new Date(next.airsAt).toLocaleDateString(undefined,
                { weekday: 'short', month: 'short', day: 'numeric' })}
            </p>
          )}
        </div>
      )}

      {seasons.map(s => {
        const list = eps.filter(e => e.season === s).sort((a, b) => a.number - b.number);
        const done = list.filter(e => watched.has(e.id)).length;
        const open = openSeason === s;
        return (
          <div key={s} className="mb-2 overflow-hidden rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => setOpenSeason(open ? null : s)}
              className="flex w-full items-center justify-between px-3 py-3 text-left active:bg-white/5"
              style={{ minHeight: 44 }}
            >
              <span className="text-[13.5px] font-medium">Season {s}</span>
              <span className="flex items-center gap-2 text-[11px] text-haze-400">
                {done}/{list.length}
                <ChevronDown size={15} className={`transition ${open ? 'rotate-180' : ''}`} />
              </span>
            </button>
            {open && (
              <ul className="border-t border-white/10">
                {list.map(e => {
                  const on = watched.has(e.id);
                  const future = e.airsAt && e.airsAt > Date.now();
                  return (
                    <li key={e.id} className="flex items-start gap-2 border-b border-white/5 px-2 py-1.5 last:border-0">
                      <button
                        type="button"
                        onClick={() => actions.markWatched(show.key, e.id, !on)}
                        onDoubleClick={() => actions.markThrough(show.key, eps, e)}
                        aria-label={on ? `Mark S${e.season}E${e.number} unwatched` : `Mark S${e.season}E${e.number} watched`}
                        className={`tap shrink-0 rounded-lg border transition active:scale-90
                          ${on ? 'border-mint/40 bg-mint/20 text-mint' : 'border-white/15 text-haze-400'}`}
                      >
                        <Check size={16} />
                      </button>
                      <div className="min-w-0 flex-1 py-1.5">
                        <p className={`truncate text-[13px] ${on ? 'text-haze-400 line-through' : ''}`}>
                          <span className="tabular-nums text-haze-400">{e.number}.</span> {e.name}
                        </p>
                        <p className="text-[11px] text-haze-400">
                          {e.airdate || 'no air date'}
                          {e.runtime ? ` · ${e.runtime} min` : ''}
                          {e.rating != null ? ` · ★ ${e.rating.toFixed(1)}` : ' · not rated'}
                          {future && ' · upcoming'}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
      <p className="mt-2 text-[10px] text-haze-400">
        Tap to mark one episode. Double-tap to mark everything up to it. Stored on this phone only.
      </p>
    </div>
  );
}
