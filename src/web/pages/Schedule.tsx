import type { StoreState } from '../store';

type Side = { rosterId: number; teamName: string; score: number };

function Row({ side, lead }: { side?: Side | undefined; lead: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <span className={`min-w-0 flex-1 truncate text-3xl font-semibold ${side ? '' : 'text-text/50'}`}>{side ? side.teamName : 'TBD'}</span>
      {side && <span className={`text-4xl font-bold tabular-nums ${lead ? 'text-good' : ''}`}>{side.score.toFixed(1)}</span>}
    </div>
  );
}

export function Schedule({ store }: { store: StoreState }) {
  const league = store.league;
  if (!league) return <div className="text-4xl text-text">Waiting for league data…</div>;
  return (
    <div className="flex h-full flex-col gap-4">
      <h2 className="text-5xl font-bold text-accent">{`Week ${league.week} Schedule`}</h2>
      <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-3 gap-6">
        {league.matchups.map((m) => {
          const [a, b] = m.sides;
          const max = Math.max(...m.sides.map((s) => s.score));
          const tied = m.sides.length === 2 && a!.score === b!.score;
          return (
            <div key={m.matchupId} className="flex min-h-0 min-w-0 flex-col justify-center gap-3 rounded-xl bg-surface px-6">
              <Row side={a} lead={!tied && !!a && a.score === max} />
              <Row side={b} lead={!tied && !!b && b.score === max} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
