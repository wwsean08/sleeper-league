import type { StoreState } from '../store';

const MAX_ROWS = 50;
const BADGES = { touchdown: 'TOUCHDOWN', long_gain: 'LONG GAIN', turnover: 'TURNOVER' } as const;
const BADGE_COLOR = { touchdown: 'bg-accent', long_gain: 'bg-good', turnover: 'bg-alert' } as const;

export function Feed({ store }: { store: StoreState }) {
  if (store.feed.length === 0) return <div className="text-5xl text-text">Waiting for plays…</div>;
  const teams = new Map<number, string>();
  for (const m of store.league?.matchups ?? []) for (const s of m.sides) teams.set(s.rosterId, s.teamName);
  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      {store.feed.slice(0, MAX_ROWS).map((p) => {
        const byTeam = new Map<number, number>();
        for (const i of p.involved) byTeam.set(i.rosterId, (byTeam.get(i.rosterId) ?? 0) + i.points);
        return (
          <div key={p.playId} data-testid="feed-row" className="flex shrink-0 items-center gap-6 rounded-xl bg-surface px-6 py-3 text-3xl">
            <span className="w-44 shrink-0 text-text/60 tabular-nums">{`Q${p.quarter} ${p.clock}`}</span>
            {p.kind && <span className={`shrink-0 rounded px-3 py-1 text-xl font-bold text-bg ${BADGE_COLOR[p.kind]}`}>{BADGES[p.kind]}</span>}
            <span className="min-w-0 flex-1 truncate">{p.description}</span>
            {[...byTeam].map(([rid, pts]) => (
              <span key={rid} className="shrink-0 whitespace-nowrap">
                <span className="text-text/70">{teams.get(rid) ?? `Team ${rid}`}</span>{' '}
                <span className="font-semibold text-accent tabular-nums">{`${pts >= 0 ? '+' : ''}${pts.toFixed(1)}`}</span>
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
