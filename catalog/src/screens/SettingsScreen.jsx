import { useState } from 'react';
import { Check, Download, Upload, Trash2, RotateCcw, RefreshCw, Users, Copy } from 'lucide-react';
import { CATALOGUE } from '../lib/providers.js';
import { useStore, actions, getRaw } from '../lib/store.js';
import { syncNow } from '../lib/sync.js';
import ProfileBar, { ProfileHint } from '../components/ProfileBar.jsx';
import { coverage } from '../data/curated.js';
import { tmdbAvailable } from '../lib/tmdb.js';

export default function SettingsScreen({ onClose }) {
  const state = useStore();
  const [imported, setImported] = useState(null);
  const [syncMsg, setSyncMsg] = useState(null);
  const [codeDraft, setCodeDraft] = useState('');
  const cov = coverage();
  const hidden = Object.entries(state.notForMe);

  const runSync = async () => {
    setSyncMsg('Syncing…');
    const code = actions.ensureHousehold();
    const r = await syncNow();
    setSyncMsg(r.ok
      ? `Synced${r.adopted ? `, pulled ${r.adopted} update${r.adopted > 1 ? 's' : ''}` : ' — already up to date'}.`
      : r.reason === 'blobs_unavailable'
        ? 'Sync is unavailable on this deploy. Each phone still works on its own.'
        : `Could not sync (${r.reason}).`);
    return code;
  };

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
          Who is watching
        </h3>
        <ProfileBar />
        <ProfileHint />
        <p className="mt-1.5 text-[11px] leading-snug text-haze-400">
          Each person has their own services, saved shows, progress and taste.
          Together keeps its own list but reads both of you: the services are
          combined, and anything either of you has hidden stays hidden.
        </p>
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase
                       tracking-wider text-haze-400">
          <Users size={12} />Share between two phones
        </h3>
        <p className="mb-2 text-[12px] leading-snug text-haze-300">
          Together only works if both phones can see each other's lists. Sync on
          one phone, then enter the same code on the other.
        </p>
        {state.household ? (
          <div className="rounded-xl border border-white/12 bg-white/[.04] p-3">
            <p className="text-[11px] text-haze-400">Household code</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="select-all rounded-lg bg-black/40 px-2.5 py-1.5 text-[15px]
                               tracking-widest text-mint">{state.household}</code>
              <button type="button" onClick={() => navigator.clipboard?.writeText(state.household)}
                      className="tap rounded-lg border border-white/15 px-2 text-[12px]">
                <Copy size={14} />
              </button>
            </div>
            <p className="mt-2 text-[11px] text-haze-400">
              {state.lastSyncAt
                ? `Last synced ${new Date(state.lastSyncAt).toLocaleString()}`
                : 'Not synced yet'}
            </p>
          </div>
        ) : (
          <p className="text-[12px] text-haze-400">No code yet — sync once to create one.</p>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={runSync}
            className="tap gap-2 rounded-xl border border-mint/35 bg-mint/10 px-3 text-[13px] text-mint">
            <RefreshCw size={15} />Sync now
          </button>
          <form
            onSubmit={e => { e.preventDefault(); if (codeDraft.trim()) { actions.setHousehold(codeDraft); setCodeDraft(''); runSync(); } }}
            className="flex gap-2"
          >
            <input
              value={codeDraft}
              onChange={e => setCodeDraft(e.target.value)}
              placeholder="Enter their code"
              autoCapitalize="none" autoCorrect="off" spellCheck="false"
              className="w-36 rounded-xl border border-white/15 bg-white/[.05] px-3 text-white
                         placeholder:text-haze-400 focus:border-white/30 focus:outline-none"
              style={{ minHeight: 44 }}
              aria-label="Household code"
            />
            <button type="submit" className="tap rounded-xl border border-white/15 px-3 text-[13px]">
              Join
            </button>
          </form>
        </div>
        {syncMsg && <p className="mt-2 text-[12px] text-haze-200">{syncMsg}</p>}
        <p className="mt-2 text-[10.5px] leading-snug text-haze-400">
          The code is a random string, not a password. Anyone who has it can read
          and write this household's lists. It holds only which shows you saved —
          no name, no email — but do not treat it as protecting anything else.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-haze-400">
          {state.isTogether ? 'What you can watch together' : `What ${state.name} subscribes to`}
        </h3>

        {state.isTogether ? (
          // In Together the services are a computed union of both people's, so
          // a toggle here would write to a value the view never reads — a
          // control that looks live and does nothing. Show the result instead.
          <div className="rounded-xl border border-white/10 bg-white/[.03] p-3">
            <div className="flex flex-wrap gap-1.5">
              {state.services.length === 0 && (
                <span className="text-[12.5px] text-haze-400">Neither of you has set any services.</span>
              )}
              {state.services.map(name => {
                const meta = CATALOGUE.find(c => c.name === name);
                const who = (state.others || [])
                  .filter(o => (o.services || []).includes(name)).map(o => o.name);
                return (
                  <span key={name} className="chip border border-white/15 bg-white/[.06] text-white">
                    <span className="h-2 w-2 rounded-full"
                          style={{ background: meta?.colour || '#6b7280' }} />
                    {name}
                    <span className="text-haze-400">· {who.join(' & ') || 'unknown'}</span>
                  </span>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-haze-400">
              Combined from both of you, because you watch on one screen — either
              subscription works. Switch to a person above to change theirs.
            </p>
          </div>
        ) : (
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
        )}

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
          Tell it what you want more of
        </h3>
        <p className="mb-2 text-[11.5px] leading-snug text-haze-400">
          The feed learns from what you save, finish and hide. These switches say
          it out loud, and count as much as finishing a show.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['rep:queer', 'Queer stories'],
            ['rep:disability', 'Disability representation'],
            ['status:ended', 'Finished stories'],
            ['length:half hour', 'Short episodes'],
            ['genre:Comedy', 'Comedy'],
            ['genre:Drama', 'Drama'],
            ['genre:Science-Fiction', 'Science fiction'],
            ['genre:Documentary', 'Documentary'],
          ].map(([feature, label]) => {
            const on = Boolean(state.taste?.explicit?.[feature]);
            return (
              <button key={feature} type="button"
                onClick={() => actions.setExplicitTaste({ [feature]: !on })}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition
                  active:scale-[.98] ${on ? 'border-mint/40 bg-mint/10' : 'border-white/10 bg-white/[.02] text-haze-400'}`}
                style={{ minHeight: 44 }}>
                <span className="flex-1 text-[13px]">{label}</span>
                {on && <Check size={14} className="shrink-0 text-mint" />}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-haze-400">
          What this deploy actually knows
        </h3>
        <ul className="space-y-1.5 text-[12.5px] text-haze-200">
          <li className="flex justify-between gap-3">
            <span>TVmaze — episodes, ratings, artwork</span>
            <span className="shrink-0 text-mint">no key needed</span></li>
          <li className="flex justify-between gap-3">
            {/* Trailers no longer depend on TMDB, and saying they do here was
                the one line in Settings that had gone out of date. */}
            <span>Trailers</span>
            <span className="shrink-0 text-mint">
              {tmdbAvailable() ? 'TMDB' : 'YouTube search'}
            </span></li>
          <li className="flex justify-between gap-3">
            <span>TMDB — watch providers, cancelled status</span>
            <span className={`shrink-0 ${tmdbAvailable() ? 'text-mint' : 'text-gold'}`}>
              {tmdbAvailable() ? 'available' : 'no API key'}
            </span>
          </li>
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
