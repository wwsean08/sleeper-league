import { useEffect, useState } from 'react';
import { applyTheme } from './theme';
import { hasLiveStarters, useStore } from './store';
import { Takeover } from './components/Takeover';
import { Layout } from './components/Layout';
import { ScoresAsOf, StaleBanner } from './components/StaleBanner';
import { Standings } from './pages/Standings';
import { Schedule } from './pages/Schedule';
import { Spotlight } from './pages/Spotlight';
import { Feed } from './pages/Feed';

export type PageId = 'standings' | 'schedule' | 'spotlight' | 'feed';
const DEFAULT_POLL_SECONDS = 60;
const PAGES: readonly PageId[] = ['standings', 'schedule', 'spotlight', 'feed'];

export function choosePage(opts: { hash: string; playlist: string[]; playlistSeconds: number; live: boolean; now: number }): PageId {
  const forced = PAGES.find((p) => opts.hash === `#/${p}`);
  if (forced) return forced;
  if (opts.live) return 'spotlight';
  const list = opts.playlist.filter((p): p is PageId => (PAGES as readonly string[]).includes(p));
  if (list.length === 0) return 'standings';
  const slot = Math.floor(opts.now / (Math.max(opts.playlistSeconds, 1) * 1000));
  return list[slot % list.length]!;
}

export function App() {
  const store = useStore();
  const [now, setNow] = useState(() => Date.now());
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const h = () => setHash(window.location.hash);
    window.addEventListener('hashchange', h);
    return () => {
      clearInterval(t);
      window.removeEventListener('hashchange', h);
    };
  }, []);
  const theme = store.snapshot?.theme;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  const ui = store.snapshot?.ui;
  const page = choosePage({
    hash,
    playlist: ui?.playlist ?? ['standings', 'schedule'],
    playlistSeconds: ui?.playlistSeconds ?? 20,
    live: hasLiveStarters(store.league, store.feed, now),
    now,
  });
  const View = { standings: Standings, schedule: Schedule, spotlight: Spotlight, feed: Feed }[page];
  return (
    <>
      <StaleBanner status={store.status} connected={store.connected} page={page} everLive={store.everLive} />
      <Layout
        logo={store.snapshot?.theme.logo}
        leagueName={store.snapshot?.leagueName}
        badge={<ScoresAsOf lastPollOkAt={store.lastPollOkAt} pollSeconds={ui?.pollSeconds ?? DEFAULT_POLL_SECONDS} now={now} />}
      >
        <View store={store} />
      </Layout>
      {store.takeover && <Takeover play={store.takeover} seconds={ui?.takeoverSeconds ?? 8} league={store.league} />}
    </>
  );
}
