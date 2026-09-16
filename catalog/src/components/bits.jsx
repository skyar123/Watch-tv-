import { AlertTriangle, Check, HelpCircle, Clock, Tv, CircleDot } from 'lucide-react';
import { serviceMeta } from '../lib/providers.js';
import { ago } from '../lib/api.js';

/** Status: Running / Ended / Cancelled. Cancelled only when something knows it. */
export function StatusBadge({ show, tmdbExtra, ending, size = 'sm' }) {
  // TVmaze cannot say "cancelled"; TMDB can. Prefer the source that knows.
  const cancelled = tmdbExtra?.available && tmdbExtra.canceled;
  const label = cancelled ? 'Cancelled' : show.status.label;
  const tone = cancelled ? 'bad'
    : show.status.key === 'running' ? 'good'
    : show.status.key === 'tbd' ? 'warn' : 'neutral';

  const cls = {
    good:    'bg-mint/15 text-mint border-mint/25',
    bad:     'bg-pop/15 text-pop-soft border-pop/30',
    warn:    'bg-gold/15 text-gold border-gold/30',
    neutral: 'bg-white/10 text-haze-200 border-white/15',
  }[tone];

  const risky = ending && (ending.level === 'cliffhanger' || ending.level === 'elevated');

  return (
    <span className="inline-flex items-center gap-1">
      <span className={`chip border ${cls} ${size === 'lg' ? 'text-xs px-3 py-1.5' : ''}`}>
        <CircleDot size={11} />{label}
      </span>
      {risky && (
        <span className="chip border border-gold/30 bg-gold/15 text-gold">
          <AlertTriangle size={11} />
          {ending.confidence === 'checked' ? 'Unresolved ending' : 'Ending may not land'}
        </span>
      )}
    </span>
  );
}

/** Provider logos, filtered to what you pay for. */
export function ProviderRow({ availability, compact = false, max = 4 }) {
  if (!availability?.known) {
    return (
      <span className="chip border border-white/10 bg-white/5 text-haze-400">
        <HelpCircle size={11} />
        {availability?.reason === 'tmdb_key_missing' ? 'No provider data' : 'Availability unknown'}
      </span>
    );
  }
  const mine = availability.onMine;
  const others = availability.otherFlatrate;

  if (!mine.length && !others.length && !availability.free.length) {
    return (
      <span className="chip border border-white/10 bg-white/5 text-haze-400">
        Not streaming on any subscription
      </span>
    );
  }

  const pill = (p, own) => {
    const m = serviceMeta(p.canon || p.name);
    return (
      <span key={`${m.name}-${own}`}
        className={`chip border ${own ? 'text-white' : 'text-haze-400 border-white/10 bg-white/5'}`}
        style={own ? { background: `${m.colour}22`, borderColor: `${m.colour}66` } : undefined}
        title={own ? `You subscribe to ${m.name}` : `${m.name} — not one of your services`}>
        {p.logo
          ? <img src={p.logo} alt="" className="h-3.5 w-3.5 rounded-[3px] no-drag" loading="lazy" />
          : <Tv size={11} />}
        {compact ? m.short : m.name}
      </span>
    );
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {mine.slice(0, max).map(p => pill(p, true))}
      {!mine.length && others.slice(0, max).map(p => pill(p, false))}
      {!mine.length && others.length > 0 && (
        <span className="text-[11px] text-haze-400">not on your services</span>
      )}
      {!mine.length && !others.length && availability.free.length > 0 &&
        availability.free.slice(0, 2).map(p => pill(p, false))}
    </span>
  );
}

/** Total hours, with the basis of the number available on tap. */
export function HoursChip({ time }) {
  if (!time) return null;
  const exact = time.basis === 'exact';
  return (
    <span className={`chip border ${exact ? 'border-white/15 bg-white/10 text-white'
                                          : 'border-gold/25 bg-gold/10 text-gold'}`}
          title={time.note}>
      <Clock size={11} />
      {time.hours < 1 ? `${time.minutes} min`
        : `${time.hours < 10 ? time.hours.toFixed(1) : Math.round(time.hours)} hours`}
      {!exact && <span className="opacity-70">approx</span>}
    </span>
  );
}

/**
 * A season sparkline.
 *
 * Drawn against the show's OWN rating range, not 0–10: a real show spans about
 * 7.0–8.5, and against a 0–10 axis every series in the catalogue is a flat
 * line. The actual numbers sit next to it so the scale can't mislead.
 */
export function Sparkline({ season, width = 96, height = 26 }) {
  const pts = season.points;
  if (pts.length < 2) return null;
  const stepX = width / (pts.length - 1);
  const xy = pts.map((p, i) => [i * stepX, height - 3 - p.y * (height - 6)]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${d} L${width},${height} L0,${height} Z`;
  const hi = pts.reduce((a, b) => (b.rating > a.rating ? b : a));
  const hiIdx = pts.indexOf(hi);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible"
         role="img" aria-label={`Season ${season.season} episode ratings, ` +
           `${season.min.toFixed(1)} to ${season.max.toFixed(1)}`}>
      <path d={area} fill="url(#sparkFill)" opacity="0.35" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xy[hiIdx][0]} cy={xy[hiIdx][1]} r="2.4" fill="currentColor" />
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.7" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Where any number on screen came from, and how old it is. */
export function Freshness({ meta, label = 'data' }) {
  if (!meta) return null;
  const cached = meta.source === 'cache';
  return (
    <span className={`text-[10px] ${cached ? 'text-gold/80' : 'text-haze-400'}`}>
      {cached ? `cached ${ago(meta.ageMs)}${meta.reason === 'timeout' ? ' · network slow' : ''}`
              : `live ${label}`}
    </span>
  );
}

/** Says a thing is not known, rather than leaving a confident blank. */
export function Unknown({ children }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-haze-400">
      <HelpCircle size={12} className="shrink-0" />{children}
    </span>
  );
}

export function Reason({ children, confidence }) {
  const tone = confidence === 'checked' || confidence === 'clear' ? 'text-mint'
             : confidence === 'low' || confidence === 'slight' ? 'text-gold/90' : 'text-haze-200';
  return (
    <p className={`text-[12.5px] leading-snug ${tone}`}>
      {confidence && (
        <span className="mr-1.5 rounded bg-white/10 px-1 py-px text-[9.5px] uppercase tracking-wide text-haze-300">
          {confidence}
        </span>
      )}
      {children}
    </p>
  );
}

export { Check };
