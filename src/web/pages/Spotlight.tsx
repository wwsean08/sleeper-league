import { useEffect, useState } from 'react';
import { liveMatchupIds, type StoreState } from '../store';
import type { LeagueView } from '../../server/league';
import type { PlayEntry } from '../../server/plays';

type Matchup = LeagueView['matchups'][number];
type Side = Matchup['sides'][number];

const DEFAULT_ROTATION_SECONDS = 15;
const MAX_PLAYS = 5;

function Fade({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(true);
  }, []);
  return <div className={`h-full transition-opacity duration-700 ${shown ? 'opacity-100' : 'opacity-0'}`}>{children}</div>;
}

function TeamColumn({ side, lead, bye }: { side: Side; lead: boolean; bye: boolean }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="truncate text-4xl font-semibold">{side.teamName}</div>
      {bye ? (
        <div className="text-8xl font-bold text-text/50">BYE</div>
      ) : (
        <div className={`text-8xl font-bold tabular-nums ${lead ? 'text-good' : ''}`}>{side.score.toFixed(1)}</div>
      )}
      <ul className="flex flex-col gap-1">
        {side.starters.map((st) => (
          <li key={st.playerId} className="flex items-baseline gap-3 text-2xl">
            <span className="w-14 text-text/60">{st.position}</span>
            <span className="min-w-0 flex-1 truncate">{st.name}</span>
            <span className="font-semibold tabular-nums">{st.points.toFixed(1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MatchupView({ matchup, feed }: { matchup: Matchup; feed: PlayEntry[] }) {
  const bye = matchup.sides.length < 2;
  const max = Math.max(...matchup.sides.map((s) => s.score));
  const tied = !bye && matchup.sides[0]!.score === matchup.sides[1]!.score;
  const ids = new Set(matchup.sides.flatMap((s) => s.starters.map((st) => st.playerId)));
  const plays = feed.filter((p) => p.involved.some((i) => ids.has(i.playerId))).slice(0, MAX_PLAYS);
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex min-h-0 gap-12">
        {matchup.sides.map((s) => (
          <TeamColumn key={s.rosterId} side={s} bye={bye} lead={!bye && !tied && s.score === max} />
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-2 rounded-xl bg-surface px-6 py-4">
        {plays.length === 0 && <div className="text-2xl text-text/60">No plays yet</div>}
        {plays.map((p) => {
          const pts = p.involved.filter((i) => ids.has(i.playerId)).reduce((a, i) => a + i.points, 0);
          return (
            <div key={p.playId} className="flex items-baseline gap-4 text-2xl">
              <span className="w-32 text-text/60 tabular-nums">{`Q${p.quarter} ${p.clock}`}</span>
              <span className="min-w-0 flex-1 truncate">{p.description}</span>
              <span className="font-semibold text-accent tabular-nums">{`${pts >= 0 ? '+' : ''}${pts.toFixed(1)}`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Spotlight({ store, now }: { store: StoreState; now?: number }) {
  const matchups = store.league?.matchups ?? [];
  const live = liveMatchupIds(store.league, store.feed, now ?? Date.now());
  const liveList = matchups.filter((m) => live.has(m.matchupId));
  const list = liveList.length > 0 ? liveList : matchups;
  const seconds = store.snapshot?.ui.rotationSeconds ?? DEFAULT_ROTATION_SECONDS;
  const [idx, setIdx] = useState(0);
  const count = list.length;

  useEffect(() => {
    if (count < 2) return;
    const t = setInterval(() => setIdx((i) => i + 1), Math.max(seconds, 1) * 1000);
    return () => clearInterval(t);
  }, [seconds, count]);

  if (count === 0) return <div className="text-5xl text-text">No matchups right now</div>;
  const current = list[idx % count]!;
  return (
    <div className="relative h-full">
      <div className="absolute right-0 top-0 text-2xl text-text/60 tabular-nums">{`${(idx % count) + 1} of ${count}`}</div>
      <Fade key={current.matchupId}>
        <MatchupView matchup={current} feed={store.feed} />
      </Fade>
    </div>
  );
}
