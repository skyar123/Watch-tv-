import { useCallback, useEffect, useMemo, useState } from 'react';
import BottomNav from './components/BottomNav.jsx';
import Sheet from './components/Sheet.jsx';
import ShowDetail from './components/ShowDetail.jsx';
import FeedScreen from './screens/FeedScreen.jsx';
import TonightScreen from './screens/TonightScreen.jsx';
import MineScreen from './screens/MineScreen.jsx';
import NewsScreen from './screens/NewsScreen.jsx';
import SearchScreen from './screens/SearchScreen.jsx';
import SettingsScreen from './screens/SettingsScreen.jsx';
import { fetchIndexPage, fetchShow } from './lib/tvmaze.js';
import { REPRESENTATION, ENDINGS, CONTENT } from './data/curated.js';
import { refresh } from './lib/api.js';
import { useStore, providerChanges, getRaw, view, TOGETHER } from './lib/store.js';
import { buildTaste, rankForTaste, rankTogether } from './lib/taste.js';
import { installSync } from './lib/sync.js';
import ProfileBar from './components/ProfileBar.jsx';

/**
 * The shell. Tab state lives here; each screen owns its own data.
 *
 * The feed pool is loaded once and shared, because Tonight and the
 * recommendations both need a candidate pool and refetching it per screen on a
 * phone connection is rude.
 */
export default function App() {
  const [tab, setTab] = useState('feed');
  const [pool, setPool] = useState([]);
  const [poolMeta, setPoolMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);      // { show, enriched }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailShows, setDetailShows] = useState({});   // key -> full show, for taste
  const [reshuffle, setReshuffle] = useState(0);        // manual 'show me others'
  const state = useStore();

  // Sync on load, on returning to the app, and when coming back online.
  useEffect(() => { installSync(); }, []);

  const loadPool = useCallback(async () => {
    setLoading(true);
    try {
      const { shows, meta } = await fetchIndexPage(0);
      // TVmaze `weight` is its own popularity measure; a feed ordered by it
      // opens on things worth looking at rather than alphabetically.
      const ranked = shows
        .filter(s => s.poster && s.summary && s.type === 'Scripted')
        .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || (b.rating ?? 0) - (a.rating ?? 0));
      setPool(ranked);
      setPoolMeta(meta);

      // Every hand-checked show, pulled in by id. Page 0 of the catalogue is
      // ordered by id, so none of the representation entries are in it — and a
      // "queer stories" mood that cannot reach Pose or Heartstopper is a
      // decoration. These are the shows the curation exists for.
      const curatedIds = [...new Set([
        ...Object.keys(REPRESENTATION), ...Object.keys(ENDINGS), ...Object.keys(CONTENT),
      ])].map(Number);
      const extra = (await Promise.all(curatedIds.map(id =>
        fetchShow(id).then(r => r.show).catch(() => null)))).filter(Boolean);
      setPool(prev => {
        const have = new Set(prev.map(s => s.key));
        return [...prev, ...extra.filter(s => !have.has(s.key))];
      });
    } catch {
      setPool([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPool(); }, [loadPool]);

  const hardRefresh = useCallback(async () => {
    await refresh();          // clears the memo AND the service worker API cache
    setReshuffle(n => n + 1); // and rebuild the order, applying seen-fatigue now
    await loadPool();
  }, [loadPool]);

  /**
   * Open the detail sheet. The feed already has episodes embedded, but a show
   * arriving from search or news does not, so fetch the full record on demand.
   */
  const openDetail = useCallback(async (show, enriched) => {
    setDetail({ show, enriched, loading: !show.episodes });
    if (show.episodes) setDetailShows(m => ({ ...m, [show.key]: show }));
    if (!show.episodes) {
      try {
        const { show: full } = await fetchShow(show.tvmazeId);
        setDetailShows(m => ({ ...m, [full.key]: full }));
        setDetail(d => (d?.show.key === show.key ? { ...d, show: full, loading: false } : d));
      } catch {
        setDetail(d => (d?.show.key === show.key ? { ...d, loading: false, error: true } : d));
      }
    }
  }, []);

  /**
   * Everything we know about, keyed, so the taste model can look up the shows
   * behind a save or a finish. The pool plus anything opened in detail.
   */
  const showsByKey = useMemo(() => {
    const m = new Map();
    for (const s of pool) m.set(s.key, s);
    for (const [k, s] of Object.entries(detailShows)) m.set(k, s);
    return m;
  }, [pool, detailShows]);

  const taste = useMemo(
    () => buildTaste(state, showsByKey),
    // Taste is built from saves, finishes and hides. Rebuilding it because a
    // card scrolled past would churn the feed for no gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showsByKey, state.profileId, state.saved, state.watched, state.notForMe, state.taste],
  );

  /**
   * A signature of everything that should legitimately change the feed order.
   *
   * Notably absent: `seen`. The order applies a fatigue penalty to shows you
   * scrolled past, and that penalty has to be applied ONCE, when the order is
   * built. Recomputing it live means the top card is penalised the instant it
   * appears, drops, is replaced, and the replacement is penalised in turn — a
   * feed that deals itself a new hand under your thumb. It marked 54 shows as
   * seen in a single load before it hit React's update limit.
   */
  const orderKey = useMemo(() => [
    state.profileId,
    state.isTogether ? 'together' : 'solo',
    pool.length,
    showsByKey.size,
    Object.keys(state.saved).length,
    Object.keys(state.notForMe).length,
    Object.keys(state.watched).length,
    JSON.stringify(state.taste?.explicit || {}),
    // In Together the other people's lists change the answer too.
    (state.others || []).map(o =>
      `${o.id}:${Object.keys(o.saved || {}).length}:${Object.keys(o.notForMe || {}).length}`).join(','),
    reshuffle,
  ].join('|'), [state, pool.length, showsByKey.size, reshuffle]);

  const [ranked, setRanked] = useState([]);

  useEffect(() => {
    if (!pool.length) { setRanked([]); return; }
    const s = getRaw();
    const v = view(s);
    if (v.isTogether) {
      const people = (v.others || []).map(p => ({
        id: p.id, name: p.name, taste: buildTaste(p, showsByKey),
      }));
      setRanked(rankTogether(pool, people, {
        seen: v.seen, notForMe: v.notForMe, watched: v.watched,
      }).map(r => ({ ...r.show, _why: r.reason, _both: r.both })));
      return;
    }
    setRanked(rankForTaste(pool, taste, { seen: v.seen, notForMe: v.notForMe })
      .map(r => ({ ...r.show, _why: r.taste.reason, _confidence: r.taste.confidence })));
    // orderKey is the whole point: it is the list of things that may reorder
    // the feed, and `seen` is deliberately not one of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey, pool, showsByKey, taste]);

  const changes = providerChanges(state);
  const leavingCount = changes.filter(c => c.saved && c.lost.length).length;

  return (
    <div className="min-h-screen-d bg-ink-950">
      {tab !== 'feed' && (
        <div className="sticky top-0 z-30 glass px-safe pt-safe">
          <div className="flex items-center justify-between gap-2 py-2">
            <ProfileBar />
          </div>
        </div>
      )}

      <main className={tab === 'feed' ? '' : 'pb-24'}>
        {tab === 'feed' && (
          <FeedScreen
            shows={ranked} meta={poolMeta} loading={loading}
            onOpen={openDetail} onRefresh={hardRefresh}
          />
        )}
        {tab === 'tonight' && (
          <TonightScreen pool={pool} ranked={ranked} taste={taste} onOpen={openDetail} />
        )}
        {tab === 'mine' && (
          <MineScreen pool={pool} onOpen={openDetail} changes={changes} taste={taste}
                      onSettings={() => setSettingsOpen(true)} />
        )}
        {tab === 'news' && <NewsScreen />}
        {tab === 'search' && <SearchScreen onOpen={openDetail} />}
      </main>

      <BottomNav tab={tab} onChange={setTab} badge={{ mine: leavingCount }} />

      <Sheet
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.show.name}
      >
        {detail && (
          <ShowDetail
            show={detail.show}
            enriched={detail.enriched}
            loading={detail.loading}
            onClose={() => setDetail(null)}
          />
        )}
      </Sheet>

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings" peek={0.9}>
        <SettingsScreen onClose={() => setSettingsOpen(false)} />
      </Sheet>
    </div>
  );
}
