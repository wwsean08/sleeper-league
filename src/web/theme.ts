import type { Config } from '../server/config';

/** Writes the configured colours/font to CSS variables on :root; Tailwind utilities read them at runtime. */
export function applyTheme(theme: Config['theme']): void {
  const s = document.documentElement.style;
  for (const [k, v] of Object.entries(theme.colors)) if (v) s.setProperty(`--color-${k}`, v);
  if (theme.fontFamily) s.setProperty('--font-main', theme.fontFamily);
}
