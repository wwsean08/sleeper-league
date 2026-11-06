export function StaleBanner({ status, connected, page }: { status: string; connected: boolean; page: string }) {
  const live = page === 'spotlight' || page === 'feed';
  const msg = !connected ? 'Reconnecting…' : status === 'paused' && live ? 'Live feed paused' : null;
  if (!msg) return null;
  return (
    <div role="alert" className="absolute inset-x-0 top-0 z-50 bg-alert py-3 text-center text-4xl font-bold text-bg">
      {msg}
    </div>
  );
}
