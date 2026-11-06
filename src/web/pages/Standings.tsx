import type { StoreState } from '../store';

export function standingsLayout(n: number) {
  const cols = n <= 6 ? 1 : 2;
  const rows = Math.max(1, Math.ceil(n / cols));
  const text = n <= 12 ? 'text-4xl' : n <= 18 ? 'text-3xl' : n <= 24 ? 'text-2xl' : 'text-xl';
  return { cols, rows, text };
}

export function Standings({ store }: { store: StoreState }) {
  const league = store.league;
  if (!league) return <div className="text-4xl text-text">Waiting for league data…</div>;
  const { cols, rows, text } = standingsLayout(league.standings.length);
  return (
    <div className="flex h-full flex-col gap-4">
      <h2 className="text-5xl font-bold text-accent">Standings</h2>
      <ol
        data-testid="standings-grid"
        className="grid min-h-0 flex-1 grid-flow-col gap-x-10 gap-y-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {league.standings.map((r, i) => (
          <li key={r.rosterId} data-testid="standing-row" className={`flex min-h-0 items-center gap-5 rounded-lg bg-surface px-5 ${text}`}>
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
