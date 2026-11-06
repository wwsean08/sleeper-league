import { readFileSync } from "node:fs";

export const SAMPLE_LOG = "docs/samples/score-nfl-frames-2026-11-05.log";

export interface TimedFrame {
  /** Milliseconds since the start of the capture (from the line's leading seconds). */
  atMs: number;
  event: string;
  payload: any;
}

/** Parses "<secs> <json frame>" lines, skipping phx_reply and malformed lines. */
export function parseTimedLog(text: string): TimedFrame[] {
  const out: TimedFrame[] = [];
  for (const line of text.split("\n")) {
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    const secs = Number(line.slice(0, sp));
    let frame: unknown;
    try {
      frame = JSON.parse(line.slice(sp + 1));
    } catch {
      continue;
    }
    if (!Number.isFinite(secs) || !Array.isArray(frame)) continue;
    const event = frame[3];
    if (typeof event !== "string" || event === "phx_reply") continue;
    out.push({ atMs: Math.round(secs * 1000), event, payload: frame[4] });
  }
  return out;
}

export function loadSample(): TimedFrame[] {
  return parseTimedLog(readFileSync(SAMPLE_LOG, "utf8"));
}

/**
 * Replays frames against a fake clock using the capture's real timestamps: the clock advances to
 * each frame's time, with tick() called every tickMs in between (like the server's 500ms tick),
 * then keeps ticking for tailMs after the last frame.
 */
export function replayTimed(
  frames: TimedFrame[],
  h: {
    clock: { t: number };
    onEvent: (event: string, payload: any) => void;
    tick: () => void;
    tickMs?: number;
    tailMs?: number;
  },
): void {
  const tickMs = h.tickMs ?? 500;
  const base = h.clock.t;
  let nextTick = base + tickMs;
  const runTo = (until: number) => {
    while (nextTick <= until) {
      h.clock.t = nextTick;
      h.tick();
      nextTick += tickMs;
    }
    h.clock.t = until;
  };
  for (const f of frames) {
    runTo(base + f.atMs);
    h.onEvent(f.event, f.payload);
  }
  const last = frames.length ? frames[frames.length - 1]!.atMs : 0;
  runTo(base + last + (h.tailMs ?? 35_000));
}
