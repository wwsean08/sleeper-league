import type { ScoringSettings } from "../shared/types.js";
import type { Config } from "./config.js";
import type { LeagueState } from "./league.js";
import { scoreStats } from "./scoring.js";

export type BigPlayKind = "touchdown" | "long_gain" | "turnover";

export interface PlayEntry {
  playId: string;
  gameId: string;
  description: string;
  quarter: string;
  clock: string;
  yards: number;
  kind?: BigPlayKind;
  involved: Array<{ playerId: string; name: string; rosterId: number; points: number }>;
  at: number;
}

// Stat keys that make a play a turnover/defensive splash. The defensive-score, sack and safety
// names (def_td, sack, safe, fum_rec) are UNVERIFIED against live frames; correct them here
// once real data is seen (unknown play_stats keys are logged once by scoreStats).
export const TURNOVER_KEYS = ["pass_int", "fum_lost", "int", "def_td", "sack", "safe", "fum_rec"] as const;

const WAIT_MS = 5000;
const MAX_SEEN = 500;
const VALUE: Record<BigPlayKind, number> = { turnover: 0, long_gain: 1, touchdown: 2 };

interface Opts {
  league: LeagueState;
  rules: ScoringSettings;
  cfg: () => Config;
  now?: () => number;
  onFeed: (p: PlayEntry) => void;
  onTakeover: (p: PlayEntry) => void;
}

export class PlayPipeline {
  private readonly now: () => number;
  private readonly pending = new Map<string, { firstSeen: number }>();
  private readonly done = new Set<string>(); // published or dropped; insertion-ordered
  private queue: PlayEntry[] = [];
  private showingUntil = 0;
  // One stable callback so scoreStats reports each unknown key once per instance.
  private readonly onUnknown = (key: string): void => {
    console.warn(`unknown play stat key: ${key}`);
  };

  constructor(private readonly opts: Opts) {
    this.now = opts.now ?? Date.now;
  }

  handle(event: "new_play" | "updated_play", payload: any): void {
    const playId = payload?.play_id == null ? "" : String(payload.play_id);
    if (!playId || this.done.has(playId)) return;
    if (!this.pending.has(playId)) this.pending.set(playId, { firstSeen: this.now() });
    const involved = this.involved(payload);
    if (involved.length) this.publish(playId, payload, involved);
  }

  tick(): void {
    const now = this.now();
    for (const [id, p] of this.pending) {
      if (now - p.firstSeen >= WAIT_MS) {
        this.pending.delete(id);
        this.markDone(id);
      }
    }
    this.advance();
  }

  private involved(payload: any): PlayEntry["involved"] {
    const out: PlayEntry["involved"] = [];
    for (const ps of payload?.play_stats ?? []) {
      const id = String(ps?.player_id ?? "");
      const rosterId = this.opts.league.starterOwner(id);
      if (rosterId === undefined) continue;
      const name = ps.player?.first_name || ps.player?.last_name
        ? `${ps.player.first_name ?? ""} ${ps.player.last_name ?? ""}`.trim()
        : id;
      const points = Math.round(scoreStats(ps.stats ?? {}, this.opts.rules, this.onUnknown) * 100) / 100;
      out.push({ playerId: id, name, rosterId, points });
    }
    return out;
  }

  private markDone(id: string): void {
    this.done.add(id);
    if (this.done.size > MAX_SEEN) this.done.delete(this.done.values().next().value as string);
  }

  private classify(payload: any, yards: number): BigPlayKind | undefined {
    const stats: Array<Record<string, number>> = [];
    for (const ps of payload?.play_stats ?? []) {
      if (this.opts.league.starterOwner(String(ps?.player_id ?? "")) !== undefined) stats.push(ps.stats ?? {});
    }
    const pos = (v: unknown) => typeof v === "number" && v > 0;
    if (
      payload?.metadata?.is_scoring_play &&
      stats.some((s) => Object.entries(s).some(([k, v]) => (k === "td" || k.endsWith("_td")) && pos(v)))
    ) return "touchdown";
    if (stats.some((s) => TURNOVER_KEYS.some((k) => pos(s[k])))) return "turnover";
    if (yards >= this.opts.cfg().longGainYards) return "long_gain";
    return undefined;
  }

  private publish(playId: string, payload: any, involved: PlayEntry["involved"]): void {
    this.pending.delete(playId);
    this.markDone(playId);
    const m = payload.metadata ?? {};
    const yards = typeof m.yards_gained === "number" ? m.yards_gained : 0;
    const clock =
      m.time_remaining_minutes == null || m.time_remaining_seconds == null
        ? "0:00"
        : `${m.time_remaining_minutes}:${String(m.time_remaining_seconds).padStart(2, "0")}`;
    const entry: PlayEntry = {
      playId,
      gameId: String(payload.game_id ?? ""),
      description: String(m.description ?? ""),
      quarter: String(m.quarter_name ?? ""),
      clock,
      yards,
      involved,
      at: this.now(),
    };
    const kind = this.classify(payload, yards);
    if (kind) entry.kind = kind;
    this.opts.onFeed(entry);
    if (kind) this.enqueue(entry);
  }

  private enqueue(e: PlayEntry): void {
    this.queue.push(e);
    const limit = this.opts.cfg().takeoverQueueLimit;
    // The play on screen is not in the queue, so the queue holds at most `limit` waiting plays.
    while (this.queue.length > limit) {
      let drop = 0;
      for (let i = 1; i < this.queue.length; i++) {
        if (VALUE[this.queue[i].kind!] < VALUE[this.queue[drop].kind!]) drop = i; // strict: oldest wins ties
      }
      this.queue.splice(drop, 1);
    }
    this.advance();
  }

  private advance(): void {
    const now = this.now();
    if (!this.queue.length || now < this.showingUntil) return;
    const next = this.queue.shift()!;
    this.showingUntil = now + this.opts.cfg().takeoverSeconds * 1000;
    this.opts.onTakeover(next);
  }
}
