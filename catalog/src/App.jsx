import { useCallback, useEffect, useState } from 'react';
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
import { useStore, providerChanges } from './lib/store.js';

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
  const state = useStore();

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
    await loadPool();
  }, [loadPool]);

  /**
   * Open the detail sheet. The feed already has episodes embedded, but a show
   * arriving from search or news does not, so fetch the full record on demand.
   */
  const openDetail = useCallback(async (show, enriched) => {
    setDetail({ show, enriched, loading: !show.episodes });
    if (!show.episodes) {
      try {
        const { show: full } = await fetchShow(show.tvmazeId);
        setDetail(d => (d?.show.key === show.key ? { ...d, show: full, loading: false } : d));
      } catch {
        setDetail(d => (d?.show.key === show.key ? { ...d, loading: false, error: true } : d));
      }
    }
  }, []);

  const changes = providerChanges(state);
  const leavingCount = changes.filter(c => c.saved && c.lost.length).length;

  return (
    <div className="min-h-screen-d bg-ink-950">
      <main className={tab === 'feed' ? '' : 'pb-24'}>
        {tab === 'feed' && (
          <FeedScreen
            shows={pool} meta={poolMeta} loading={loading}
            onOpen={openDetail} onRefresh={hardRefresh}
          />
        )}
        {tab === 'tonight' && <TonightScreen pool={pool} onOpen={openDetail} />}
        {tab === 'mine' && (
          <MineScreen pool={pool} onOpen={openDetail} changes={changes}
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
