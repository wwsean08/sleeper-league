import { useState, type ReactNode } from 'react';

export function Layout({ logo, leagueName, children }: { logo?: string | undefined; leagueName?: string | undefined; children?: ReactNode }) {
  const [logoOk, setLogoOk] = useState(true);
  return (
    <div className="flex h-full w-full flex-col bg-bg font-main text-text">
      <header className="flex items-center gap-6 px-12 py-6">
        {logo && logoOk && <img src={logo} alt="" className="h-20 w-auto" onError={() => setLogoOk(false)} />}
        <h1 className="text-5xl font-bold tracking-wide text-accent">{leagueName}</h1>
      </header>
      <main className="min-h-0 flex-1 px-12 pb-8">{children}</main>
    </div>
  );
}
