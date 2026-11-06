import type { StoreState } from '../store';

export function Standings({ store }: { store: StoreState }) {
  const league = store.league;
  if (!league) return <div className="text-4xl text-text">Waiting for league data…</div>;
  return (
    <div className="flex h-full flex-col gap-4">
      <h2 className="text-5xl font-bold text-accent">Standings</h2>
      <ol className="grid min-h-0 flex-1 grid-flow-col grid-cols-2 grid-rows-9 gap-x-10 gap-y-2">
        {league.standings.map((r, i) => (
          <li key={r.rosterId} data-testid="standing-row" className="flex min-h-0 items-center gap-5 rounded-lg bg-surface px-5 text-4xl">
            <span className="w-14 text-right font-bold text-accent">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{r.teamName}</span>
            <span className="font-bold text-good">{r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`}</span>
            <span className="w-36 text-right tabular-nums">{r.fpts.toFixed(1)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
