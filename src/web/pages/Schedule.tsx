import type { StoreState } from '../store';
import { EstimatingBadge } from '../components/StaleBanner';

type Side = { rosterId: number; teamName: string; score: number };

export function scheduleLayout(n: number) {
  const cols = n <= 4 ? 2 : n <= 12 ? 3 : 4;
  const rows = Math.max(1, Math.ceil(n / cols));
  const [name, score] =
    n <= 4 ? ['text-4xl', 'text-5xl'] : n <= 9 ? ['text-3xl', 'text-4xl'] : n <= 12 ? ['text-2xl', 'text-3xl'] : ['text-xl', 'text-2xl'];
  return { cols, rows, name: name!, score: score! };
}

function Row({ side, lead, bye, name, score }: { side?: Side | undefined; lead: boolean; bye: boolean; name: string; score: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className={`min-w-0 flex-1 truncate ${name} font-semibold ${side ? '' : 'text-text/50'}`}>{side ? side.teamName : 'TBD'}</span>
      {side && bye && <span className={`${score} font-bold text-text/50`}>BYE</span>}
      {side && !bye && <span className={`${score} font-bold tabular-nums ${lead ? 'text-good' : ''}`}>{side.score.toFixed(1)}</span>}
    </div>
  );
}

export function Schedule({ store }: { store: StoreState }) {
  const league = store.league;
  if (!league) return <div className="text-4xl text-text">Waiting for league data…</div>;
  const { cols, rows, name, score } = scheduleLayout(league.matchups.length);
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-6">
        <h2 className="text-5xl font-bold text-accent">{`Week ${league.week} Schedule`}</h2>
        <EstimatingBadge estimating={league.estimating} />
      </div>
      {league.matchups.length === 0 ? (
        <div className="text-4xl text-text">No matchups this week</div>
      ) : (
        <div
          data-testid="schedule-grid"
          className="grid min-h-0 flex-1 gap-6"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
        >
          {league.matchups.map((m) => {
            const [a, b] = m.sides;
            const bye = m.sides.length < 2;
            const max = Math.max(...m.sides.map((s) => s.score));
            const tied = !bye && a!.score === b!.score;
            return (
              <div key={m.matchupId} className="flex min-h-0 min-w-0 flex-col justify-center gap-3 rounded-xl bg-surface px-6">
                <Row side={a} lead={!bye && !tied && !!a && a.score === max} bye={bye} name={name} score={score} />
                <Row side={b} lead={!bye && !tied && !!b && b.score === max} bye={false} name={name} score={score} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
