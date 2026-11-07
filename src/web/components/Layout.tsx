import { useState, type ReactNode } from 'react';

export function Layout({
  logo,
  leagueName,
  badge,
  children,
}: {
  logo?: string | undefined;
  leagueName?: string | undefined;
  /** Shown at the right of the header on every page (e.g. the stale-scores badge). */
  badge?: ReactNode;
  children?: ReactNode;
}) {
  const [logoOk, setLogoOk] = useState(true);
  return (
    <div className="flex h-full w-full flex-col bg-bg font-main text-text">
      <header className="flex items-center gap-6 px-12 py-6">
        {logo && logoOk && <img src={logo} alt="" className="h-20 w-auto" onError={() => setLogoOk(false)} />}
        {leagueName && <h1 className="min-w-0 truncate text-5xl font-bold tracking-wide text-accent">{leagueName}</h1>}
        {badge && <div className="ml-auto shrink-0">{badge}</div>}
      </header>
      <main className="min-h-0 flex-1 px-12 pb-8">{children}</main>
    </div>
  );
}
