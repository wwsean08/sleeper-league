import { useEffect, useState } from 'react';
import type { LeagueView } from '../../server/league';
import type { PlayEntry } from '../../server/plays';

const KINDS = {
  touchdown: { label: 'TOUCHDOWN', bg: 'bg-accent' },
  long_gain: { label: 'LONG GAIN', bg: 'bg-good' },
  turnover: { label: 'TURNOVER', bg: 'bg-alert' },
} as const;

type Side = LeagueView['matchups'][number]['sides'][number];

function Enter({ children, className }: { children: React.ReactNode; className: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(true);
  }, []);
  return (
    <div className={`${className} transition duration-500 ${shown ? 'scale-100 opacity-100' : 'scale-90 opacity-0'}`}>{children}</div>
  );
}

export function Takeover({ play, seconds, league }: { play: PlayEntry; seconds: number; league: LeagueView | undefined }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDismissed(play.playId), Math.max(seconds, 0) * 1000);
    return () => clearTimeout(t);
  }, [play.playId, seconds]);
  if (dismissed === play.playId) return null;

  const kind = play.kind ? KINDS[play.kind] : undefined;
  const primary = play.involved.reduce<PlayEntry['involved'][number] | undefined>((a, i) => (!a || i.points > a.points ? i : a), undefined);
  const involvedIds = new Set(play.involved.map((i) => i.rosterId));
  // Every matchup the play touched, both sides; rosters missing from the league get a lone card.
  const groups: Array<Array<{ rosterId: number; side?: Side }>> = [];
  const placed = new Set<number>();
  for (const m of league?.matchups ?? []) {
    if (!m.sides.some((s) => involvedIds.has(s.rosterId))) continue;
    groups.push(m.sides.map((s) => ({ rosterId: s.rosterId, side: s })));
    for (const s of m.sides) placed.add(s.rosterId);
  }
  for (const rid of involvedIds) if (!placed.has(rid)) groups.push([{ rosterId: rid }]);
  const showYards = play.yards !== 0 && play.kind !== 'turnover';

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${kind?.bg ?? 'bg-accent'} font-main text-bg`}>
      <Enter className="flex w-full max-w-6xl flex-col items-center gap-8 px-12 text-center">
        <div className="text-9xl font-black tracking-widest">{kind?.label ?? 'BIG PLAY'}</div>
        {primary && <div className="text-7xl font-bold">{primary.name}</div>}
        <div className="text-4xl">{play.description}</div>
        {showYards && <div className="text-5xl font-semibold">{`${play.yards} yds`}</div>}
        <div className="flex w-full flex-col items-center gap-6">
          {groups.map((g) => (
            <div key={g.map((x) => x.rosterId).join('-')} data-testid="takeover-matchup" className="flex w-full flex-wrap justify-center gap-8">
              {g.map(({ rosterId, side }) => {
                const involved = involvedIds.has(rosterId);
                const pts = play.involved.filter((i) => i.rosterId === rosterId).reduce((a, i) => a + i.points, 0);
                return (
                  <div
                    key={rosterId}
                    data-testid="takeover-side"
                    data-involved={involved}
                    className={`flex min-w-0 flex-col items-center gap-2 rounded-2xl bg-bg px-10 py-6 text-text ${involved ? 'scale-105' : 'opacity-60'}`}
                  >
                    <div className="max-w-md truncate text-4xl font-semibold">{side?.teamName ?? `Team ${rosterId}`}</div>
                    {involved && (
                      <div className={`text-7xl font-bold tabular-nums ${pts < 0 ? 'text-alert' : 'text-good'}`}>{`${pts >= 0 ? '+' : ''}${pts.toFixed(1)}`}</div>
                    )}
                    {side && <div className="text-3xl tabular-nums">{side.score.toFixed(1)}</div>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Enter>
    </div>
  );
}
