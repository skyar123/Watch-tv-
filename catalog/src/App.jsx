import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BottomNav from './components/BottomNav.jsx';
import Sheet from './components/Sheet.jsx';
import ShowDetail from './components/ShowDetail.jsx';
import FeedScreen from './screens/FeedScreen.jsx';
import TonightScreen from './screens/TonightScreen.jsx';
import MineScreen from './screens/MineScreen.jsx';
import NewsScreen from './screens/NewsScreen.jsx';
import SearchScreen from './screens/SearchScreen.jsx';
import SettingsScreen from './screens/SettingsScreen.jsx';
import TeachScreen from './screens/TeachScreen.jsx';
import { fetchShow } from './lib/tvmaze.js';
import { loadCatalogue } from './lib/catalogue.js';
import { buildIdf } from './lib/taste.js';
import { buildKinship } from './lib/kinship.js';
import { loadRepresentation } from './lib/representation.js';
import { rankCatalogue, rankTogetherCatalogue, appetiteOf, describeCommonGround } from './lib/rank.js';
import { REPRESENTATION, ENDINGS, CONTENT } from './data/curated.js';
import { refresh } from './lib/api.js';
import { useStore, providerChanges, getRaw, view, TOGETHER } from './lib/store.js';
import { buildTaste } from './lib/taste.js';
import { installSync } from './lib/sync.js';
import ProfileBar from './components/ProfileBar.jsx';
import UndoToast from './components/UndoToast.jsx';

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
  const [teachOpen, setTeachOpen] = useState(false);
  const [detailShows, setDetailShows] = useState({});   // key -> full show, for taste
  const [reshuffle, setReshuffle] = useState(0);        // manual 'show me others'
  const state = useStore();

  // Sync on load, on returning to the app, and when coming back online.
  useEffect(() => { installSync(); }, []);

  // The representation index backs the queer and disability filters and the
  // rep: taste features, so it has to be in before the first ranking.
  const [repReady, setRepReady] = useState(false);
  useEffect(() => { loadRepresentation().finally(() => setRepReady(true)); }, []);

  const loadPool = useCallback(async () => {
    setLoading(true);
    try {
      // The catalogue arrives in two pieces: the popular core first so the feed
      // starts, then the rest. The old code fetched /shows?page=0 at runtime —
      // 250 shows out of 94,500 — which is why nothing here could ever feel
      // like a real recommendation.
      await loadCatalogue((shows, meta) => {
        buildIdf(shows);          // feature rarity, recomputed as the pool grows
        setPool(shows);
        setPoolMeta(meta);
        setLoading(false);
      });
    } catch (e) {
      setPool([]);
      setPoolMeta({ error: e.message });
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

  /**
   * Shows this person finished, which is what kinship is computed outward from.
   */
  const finishedSeeds = useMemo(() => {
    const out = [];
    for (const [key, eps] of Object.entries(state.watched || {})) {
      const show = showsByKey.get(key);
      if (!show?.episodes) continue;
      const total = show.episodes.filter(e => e.type === 'regular').length;
      if (total && Object.keys(eps).length / total >= 0.9) out.push(show);
    }
    return out.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  }, [state.watched, showsByKey]);

  const [kinship, setKinship] = useState(new Map());
  const kinshipFor = useRef('');

  useEffect(() => {
    const sig = `${state.profileId}|${finishedSeeds.map(s => s.tvmazeId).join(',')}`;
    if (!finishedSeeds.length || kinshipFor.current === sig) return;
    kinshipFor.current = sig;
    let dead = false;
    buildKinship(finishedSeeds)
      .then(m => { if (!dead) setKinship(m); })
      .catch(() => {});
    return () => { dead = true; };
  }, [finishedSeeds, state.profileId]);

  // Narrow deps, like taste and languages above. Depending on the whole store
  // object meant every "mark seen" produced a new appetite, which re-ran the
  // ranking effect, which replaced every card in the feed — cards were
  // detaching from the DOM mid-tap.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const appetite = useMemo(() => appetiteOf(state, showsByKey), [state.watched, showsByKey]);

  /** The languages this person actually watches in. */
  const languages = useMemo(() => new Set(
    Object.keys(state.watched || {})
      .map(k => showsByKey.get(k)?.language).filter(Boolean),
  ), [state.watched, showsByKey]);

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
    Object.keys(state.watched).length,
    JSON.stringify(state.taste?.explicit || {}),
    reshuffle,
    // Kinship arrives asynchronously and is genuinely new information rather
    // than something you just told it, so it earns a rebuild. Same for the
    // representation index.
    kinship.size,
    repReady,
  ].join('|'), [state, pool.length, showsByKey.size, reshuffle, kinship.size, repReady]);

  /**
   * Swipes are deliberately NOT in orderKey.
   *
   * Every save and hide teaches the model something, and rebuilding the order
   * on each one reshuffles the deck under your thumb — a hidden card is
   * removed by the visible filter anyway, so the re-rank buys nothing and
   * costs everything. Worse, undoing a hide re-ranked the feed and the show
   * you just rescued did not come back: it had picked up a seen-fatigue
   * penalty and dropped three hundred places.
   *
   * So the order holds while you swipe, and what you taught it lands on the
   * next rebuild — a refresh, a profile switch, or the prompt below once you
   * have taught it enough to be worth re-reading.
   */
  const learnedSince = useMemo(
    () => Object.keys(state.saved).length + Object.keys(state.notForMe).length,
    [state.saved, state.notForMe],
  );
  const [learnedAtBuild, setLearnedAtBuild] = useState(0);
  const pendingLessons = Math.max(0, learnedSince - learnedAtBuild);

  const [ranked, setRanked] = useState([]);

  /**
   * The ranker reads these, but a change to them must not itself rebuild the
   * order — taste is derived from saved and hidden, so listing it as a
   * dependency put every swipe straight back into reshuffling the feed by the
   * back door. Refs keep the values current and the rebuild explicit.
   */
  const live = useRef({ taste, kinship, appetite, languages });
  live.current = { taste, kinship, appetite, languages };

  useEffect(() => {
    if (!pool.length) { setRanked([]); return; }
    const s = getRaw();
    const v = view(s);
    const { taste: t, kinship: k, appetite: a, languages: langs } = live.current;
    const shared = {
      seen: v.seen, notForMe: v.notForMe, watched: v.watched,
      hideUnavailable: v.hideUnavailable, languages: langs,
      // Providers are only known for shows the feed has already enriched, so
      // this is a bonus where we have it rather than a filter we pretend to.
      availabilityFor: () => ({ known: false, onMine: [] }),
    };

    if (v.isTogether) {
      const people = (v.others || []).map(p => ({
        id: p.id, name: p.name,
        taste: buildTaste(p, showsByKey),
        kinship: k,
        appetite: appetiteOf(p, showsByKey),
      }));
      setRanked(rankTogetherCatalogue(pool, people, shared)
        .map(r => ({ ...r.show, _why: r.reason, _terms: r.terms,
                     _warnings: r.warnings, _confidence: r.confidence })));
      setLearnedAtBuild(Object.keys(v.saved).length + Object.keys(v.notForMe).length);
      return;
    }

    setRanked(rankCatalogue(pool, { ...shared, taste: t, kinship: k, appetite: a })
      .map(r => ({ ...r.show, _why: r.reason, _terms: r.terms, _warnings: r.warnings,
                   _confidence: r.confidence, _explore: r.explore })));
    setLearnedAtBuild(Object.keys(v.saved).length + Object.keys(v.notForMe).length);
    // orderKey is the complete list of things that may reorder the feed.
    // Everything else the ranker needs is read from `live` at build time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey, pool, showsByKey]);

  /** Where the two of you agree, and where you do not. Only in Together. */
  const household = useMemo(() => {
    if (!state.isTogether) return null;
    const people = (state.others || []).map(p => ({
      name: p.name, taste: buildTaste(p, showsByKey),
    }));
    return { ...describeCommonGround(people), names: people.map(p => p.name) };
  }, [state.isTogether, state.others, showsByKey]);

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
            pendingLessons={pendingLessons}
            onRerank={() => setReshuffle(n => n + 1)}
          />
        )}
        {tab === 'tonight' && (
          <TonightScreen pool={pool} ranked={ranked} taste={taste} onOpen={openDetail}
                         household={household} />
        )}
        {tab === 'mine' && (
          <MineScreen pool={pool} onOpen={openDetail} changes={changes} taste={taste}
                      onSettings={() => setSettingsOpen(true)}
                      onTeach={() => setTeachOpen(true)} />
        )}
        {tab === 'news' && <NewsScreen />}
        {tab === 'search' && <SearchScreen onOpen={openDetail} catalogue={pool} />}
      </main>

      <UndoToast />

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
        <SettingsScreen onClose={() => setSettingsOpen(false)} taste={taste}
                        onTeach={() => { setSettingsOpen(false); setTeachOpen(true); }} />
      </Sheet>

      <Sheet open={teachOpen} onClose={() => setTeachOpen(false)} title="Tell it what you like" peek={0.94}>
        <TeachScreen catalogue={pool} onClose={() => setTeachOpen(false)} />
      </Sheet>
    </div>
  );
}
