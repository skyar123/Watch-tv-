import { useState } from 'react';
import { Check, Download, Upload, Trash2, RotateCcw } from 'lucide-react';
import { CATALOGUE } from '../lib/providers.js';
import { useStore, actions } from '../lib/store.js';
import { coverage } from '../data/curated.js';
import { tmdbAvailable } from '../lib/tmdb.js';

export default function SettingsScreen({ onClose }) {
  const state = useStore();
  const [imported, setImported] = useState(null);
  const cov = coverage();
  const hidden = Object.entries(state.notForMe);

  const toggle = name => {
    const on = state.services.includes(name);
    actions.setServices(on ? state.services.filter(s => s !== name) : [...state.services, name]);
  };

  const exportAll = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tonight-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const importAll = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const obj = JSON.parse(r.result);
        if (typeof obj !== 'object' || !obj.version) throw new Error('not a backup file');
        actions.importAll(obj);
        setImported('Imported.');
      } catch (err) { setImported(`Could not import: ${err.message}`); }
    };
    r.readAsText(file);
  };

  return (
    <div className="space-y-6 px-4 py-4">
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-haze-400">
          What you subscribe to
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {CATALOGUE.map(s => {
            const on = state.services.includes(s.name);
            return (
              <button key={s.id} type="button" onClick={() => toggle(s.name)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left
                  transition active:scale-[.98]
                  ${on ? 'border-white/25 bg-white/10' : 'border-white/10 bg-white/[.02] text-haze-400'}`}
                style={{ minHeight: 44 }}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: on ? s.colour : '#3a3a44' }} />
                <span className="flex-1 truncate text-[13px]">{s.name}</span>
                {on && <Check size={14} className="shrink-0 text-mint" />}
              </button>
            );
          })}
        </div>

        <label className="mt-3 flex items-center justify-between gap-3 rounded-xl border
                          border-white/10 bg-white/[.03] px-3 py-2.5" style={{ minHeight: 44 }}>
          <span className="text-[13px]">Hide what I cannot stream</span>
          <input
            type="checkbox"
            checked={state.hideUnavailable}
            onChange={e => actions.setHideUnavailable(e.target.checked)}
            className="h-6 w-6 accent-mint"
          />
        </label>
        <p className="mt-1 text-[11px] text-haze-400">
          Off by default: a show you cannot stream is dimmed rather than hidden, so you can
          still see it exists.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-haze-400">
          What this deploy actually knows
        </h3>
        <ul className="space-y-1.5 text-[12.5px] text-haze-200">
          <li className="flex justify-between">
            <span>TMDB (trailers, providers, cancelled status)</span>
            <span className={tmdbAvailable() ? 'text-mint' : 'text-gold'}>
              {tmdbAvailable() ? 'available' : 'no API key'}
            </span>
          </li>
          <li className="flex justify-between"><span>TVmaze (episodes, ratings, art)</span>
            <span className="text-mint">no key needed</span></li>
          <li className="flex justify-between"><span>Hand-checked endings</span>
            <span className="text-haze-400">{cov.endings} shows</span></li>
          <li className="flex justify-between"><span>Hand-checked content descriptors</span>
            <span className="text-haze-400">{cov.content} shows</span></li>
          <li className="flex justify-between"><span>Hand-checked representation</span>
            <span className="text-haze-400">{cov.representation} shows</span></li>
        </ul>
        <p className="mt-2 text-[11px] leading-snug text-haze-400">
          The hand-checked counts are small on purpose. No API carries content descriptors or
          says whether a queer or disabled character matters to the plot, so those are written
          by hand and everything else reads “not checked” rather than guessing.
        </p>
      </section>

      {hidden.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-haze-400">
            Hidden ({hidden.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {hidden.map(([key]) => (
              <button key={key} type="button" onClick={() => actions.unhide(key)}
                className="chip border border-white/12 bg-white/5 text-haze-200">
                <RotateCcw size={11} />{state.saved[key]?.name || key}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-haze-400">Tap to put one back.</p>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-haze-400">
          Your data
        </h3>
        <p className="mb-2 text-[12px] text-haze-400">
          Everything lives in this browser only. Nothing is sent anywhere.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportAll}
            className="tap gap-2 rounded-xl border border-white/15 bg-white/5 px-3 text-[13px]">
            <Download size={15} />Export
          </button>
          <label className="tap cursor-pointer gap-2 rounded-xl border border-white/15
                            bg-white/5 px-3 text-[13px]">
            <Upload size={15} />Import
            <input type="file" accept="application/json" onChange={importAll} className="hidden" />
          </label>
          <button type="button"
            onClick={() => { if (confirm('Erase everything saved on this phone?')) actions.reset(); }}
            className="tap gap-2 rounded-xl border border-pop/30 bg-pop/10 px-3 text-[13px] text-pop-soft">
            <Trash2 size={15} />Erase
          </button>
        </div>
        {imported && <p className="mt-2 text-[12px] text-mint">{imported}</p>}
      </section>

      <section className="border-t border-white/10 pt-4">
        <p className="text-[10.5px] leading-relaxed text-haze-400">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
          Streaming availability is provided by JustWatch through TMDB.
          Episode data, ratings and artwork from TVmaze.
        </p>
      </section>
    </div>
  );
}
