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

/** A starter's own gain on the play: rushing, receiving, or a kick/punt return. */
export const GAIN_KEYS = ["rush_yd", "rec_yd", "kr_yd", "pr_yd"] as const;

/**
 * Play types never classified as long_gain: on these `yards_gained` is a kick distance and the
 * starters involved are kickers/punters. Touchdown and turnover classification still apply.
 */
export const NO_LONG_GAIN_PLAY_TYPES: ReadonlySet<string> = new Set(["kickoff", "punt", "field_goal", "extra_point", "play_start"]);

/** Publish once no new frame has arrived for a play for this long (after a starter is involved). */
export const QUIET_MS = 1500;
/** Publish whatever has been merged this long after the FIRST frame that involved a starter. */
export const HARD_CAP_MS = 8000;
/** A play that never involves a starter is forgotten after this long without any frame. */
export const STATS_FREE_DROP_MS = 30_000;

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

interface Pending {
  /** The latest frame seen; description and metadata come from it. */
  frame: any;
  /** play_stats merged by player_id; each player's stats are the latest values seen (per-play cumulative). */
  stats: Map<string, any>;
  lastFrameAt: number;
  firstStarterAt?: number;
}

/**
 * Turns the per-snap new_play/updated_play stream into one published entry per play.
 *
 * Frames for a play_id are merged (latest metadata, play_stats merged by player). Nothing is
 * published from handle(); tick() publishes a play once it has involved a starter AND either
 * QUIET_MS passed with no new frame or HARD_CAP_MS passed since the first starter frame. Scoring
 * plays without a starter TD stat wait for the hard cap. Plays that never involve a starter are
 * dropped after STATS_FREE_DROP_MS of silence. Published/dropped play_ids are ignored afterwards.
 */
export class PlayPipeline {
  private readonly now: () => number;
  private readonly pending = new Map<string, Pending>();
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

  handle(_event: "new_play" | "updated_play", payload: any): void {
    const playId = payload?.play_id == null ? "" : String(payload.play_id);
    if (!playId || this.done.has(playId)) return;
    if (!this.opts.league.isCurrentWeek(payload.week)) return;
    const now = this.now();
    let p = this.pending.get(playId);
    if (!p) this.pending.set(playId, (p = { frame: payload, stats: new Map(), lastFrameAt: now }));
    const prevMeta = p.frame?.metadata;
    p.frame = payload;
    if ((payload.metadata == null || typeof payload.metadata !== "object") && prevMeta) {
      p.frame = { ...payload, metadata: prevMeta };
    }
    for (const ps of this.statsOf(payload)) {
      const id = String(ps?.player_id ?? "");
      if (!id) continue;
      const prev = p.stats.get(id);
      p.stats.set(id, { ...prev, ...ps, player: ps.player ?? prev?.player });
    }
    p.lastFrameAt = now;
    if (p.firstStarterAt === undefined && this.involved(this.merged(p)).length) p.firstStarterAt = now;
  }

  tick(): void {
    const now = this.now();
    for (const [id, p] of this.pending) {
      if (p.firstStarterAt === undefined) {
        if (now - p.lastFrameAt >= STATS_FREE_DROP_MS) {
          this.pending.delete(id);
          this.markDone(id);
        }
        continue;
      }
      const payload = this.merged(p);
      const capped = now - p.firstStarterAt >= HARD_CAP_MS;
      const waitingForTd = !!payload.metadata?.is_scoring_play && !this.hasTd(payload);
      if (capped || (!waitingForTd && now - p.lastFrameAt >= QUIET_MS)) this.publish(id, payload);
    }
    this.advance();
  }

  private merged(p: Pending): any {
    return { ...p.frame, play_stats: [...p.stats.values()] };
  }

  private involved(payload: any): PlayEntry["involved"] {
    const out: PlayEntry["involved"] = [];
    for (const ps of this.statsOf(payload)) {
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

  private statsOf(payload: any): any[] {
    return Array.isArray(payload?.play_stats) ? payload.play_stats : [];
  }

  private starterStats(payload: any): Array<Record<string, number>> {
    return this.statsOf(payload)
      .filter((ps) => this.opts.league.starterOwner(String(ps?.player_id ?? "")) !== undefined)
      .map((ps) => ps.stats ?? {});
  }

  private hasTd(payload: any): boolean {
    return this.starterStats(payload).some((s) =>
      Object.entries(s).some(([k, v]) => (k === "td" || k.endsWith("_td")) && typeof v === "number" && v > 0),
    );
  }

  /** Largest rushing/receiving/return gain by any involved starter (0 when none). */
  private starterGain(payload: any): number {
    let max = 0;
    for (const s of this.starterStats(payload)) {
      for (const k of GAIN_KEYS) {
        const v = s[k];
        if (typeof v === "number" && Number.isFinite(v) && v > max) max = v;
      }
    }
    return max;
  }

  private markDone(id: string): void {
    this.done.add(id);
    if (this.done.size > MAX_SEEN) this.done.delete(this.done.values().next().value as string);
  }

  private classify(payload: any): BigPlayKind | undefined {
    const stats = this.starterStats(payload);
    const pos = (v: unknown) => typeof v === "number" && v > 0;
    if (payload?.metadata?.is_scoring_play && this.hasTd(payload)) return "touchdown";
    if (stats.some((s) => TURNOVER_KEYS.some((k) => pos(s[k])))) return "turnover";
    const type = String(payload?.metadata?.play_type ?? "");
    if (!NO_LONG_GAIN_PLAY_TYPES.has(type) && this.starterGain(payload) >= this.opts.cfg().longGainYards) return "long_gain";
    return undefined;
  }

  private publish(playId: string, payload: any): void {
    this.pending.delete(playId);
    this.markDone(playId);
    const involved = this.involved(payload);
    if (!involved.length) return; // lineup changed since the starter frame; nothing to show
    const m = payload.metadata ?? {};
    const kind = this.classify(payload);
    // On kicks yards_gained is the kick distance; show the starter's own gain there instead.
    const yards =
      kind === "long_gain" || NO_LONG_GAIN_PLAY_TYPES.has(String(m.play_type ?? ""))
        ? this.starterGain(payload)
        : typeof m.yards_gained === "number"
          ? m.yards_gained
          : 0;
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
    if (kind) entry.kind = kind;
    this.opts.onFeed(entry);
    if (kind) this.enqueue(entry);
  }

  private enqueue(e: PlayEntry): void {
    this.queue.push(e);
    const limit = Math.max(1, this.opts.cfg().takeoverQueueLimit);
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
