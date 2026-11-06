export function StaleBanner({ status, connected }: { status: string; connected: boolean }) {
  const msg = !connected ? 'Reconnecting…' : status === 'paused' ? 'Live feed paused' : null;
  if (!msg) return null;
  return (
    <div role="alert" className="absolute inset-x-0 top-0 z-50 bg-alert py-3 text-center text-4xl font-bold text-bg">
      {msg}
    </div>
  );
}
