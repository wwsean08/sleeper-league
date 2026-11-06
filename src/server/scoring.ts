import type { ScoringSettings } from "../shared/types.js";

// Dedupe per callback so each key is reported once per consumer.
const reported = new WeakMap<(key: string) => void, Set<string>>();

export function scoreStats(
  stats: Record<string, number>,
  rules: ScoringSettings,
  onUnknown?: (key: string) => void,
): number {
  let total = 0;
  for (const [key, value] of Object.entries(stats)) {
    const rule = rules[key];
    if (rule === undefined) {
      if (onUnknown) {
        let seen = reported.get(onUnknown);
        if (!seen) reported.set(onUnknown, (seen = new Set()));
        if (!seen.has(key)) {
          seen.add(key);
          onUnknown(key);
        }
      }
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    total += value * rule;
  }
  return Math.round(total * 100) / 100;
}
