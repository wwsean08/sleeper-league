import { feedPaused, isStale } from '../store';
import type { FeedStatus } from '../../server/sleeper/socket';

export function StaleBanner({ status, connected, page, everLive = false }: { status: FeedStatus | string; connected: boolean; page: string; everLive?: boolean }) {
  const live = page === 'spotlight' || page === 'feed';
  const msg = !connected ? 'Reconnecting…' : live && feedPaused(status as FeedStatus, everLive) ? 'Live feed paused' : null;
  if (!msg) return null;
  return (
    <div role="alert" className="absolute inset-x-0 top-0 z-50 bg-alert py-3 text-center text-4xl font-bold text-bg">
      {msg}
    </div>
  );
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Scores as of 7:42 PM", shown on every page once REST polling has fallen behind by two intervals. */
export function ScoresAsOf({ lastPollOkAt, pollSeconds, now }: { lastPollOkAt: number | undefined; pollSeconds: number; now: number }) {
  if (lastPollOkAt === undefined || !isStale(lastPollOkAt, pollSeconds, now)) return null;
  return (
    <div data-testid="scores-as-of" className="rounded-lg bg-alert px-4 py-2 text-2xl font-bold text-bg">
      {`Scores as of ${formatClock(lastPollOkAt)}`}
    </div>
  );
}

/** Live scores drifted from REST at the last reconcile; the shown numbers are estimates. */
export function EstimatingBadge({ estimating }: { estimating: boolean | undefined }) {
  if (!estimating) return null;
  return <span className="rounded-lg bg-surface px-3 py-1 text-xl font-semibold text-text/70">estimating</span>;
}
