import type { Matchup, PlayerInfo, Roster, ScoringSettings } from "../shared/types.js";
import { scoreStats } from "./scoring.js";

export interface ScoreChange {
  rosterId: number;
  matchupId: number;
  playerId: string;
  playerPoints: number;
  matchupScores: Record<number, number>;
}

export interface LeagueView {
  week: number;
  standings: Roster[];
  matchups: Array<{
    matchupId: number;
    sides: Array<{
      rosterId: number;
      teamName: string;
      score: number;
      starters: Array<{ playerId: string; name: string; position: string; points: number; live: boolean }>;
    }>;
  }>;
  estimating: boolean;
}

const ESTIMATE_GAP = 5;
const round2 = (n: number) => Math.round(n * 100) / 100;

export class LeagueState {
  private week = 0;
  private rosters: Roster[] = [];
  private matchups: Matchup[] = [];
  private scores = new Map<number, number>(); // rosterId -> live score
  private starterIndex = new Map<string, { rosterId: number; matchupId: number }>();
  // Last live total seen per player. reconcile() snaps side scores to REST points while
  // keeping these totals, so later updates add only (new total - total already seen),
  // which keeps the displayed score continuous and avoids double counting after a snap.
  // Totals survive loadWeek so a re-promoted starter stays consistent.
  private lastSeen = new Map<string, number>();
  private estimating = false;
  private liveTeams: ReadonlySet<string> = new Set();
  // One stable callback so scoreStats reports each unknown key once per instance.
  private readonly onUnknown = (key: string): void => {
    console.warn(`unknown scoring stat key: ${key}`);
  };

  constructor(
    private readonly rules: ScoringSettings,
    private players: Map<string, PlayerInfo>,
  ) {}

  /** NFL team abbreviations with a game in progress. Returns true when the set changed. */
  setLiveTeams(teams: ReadonlySet<string>): boolean {
    const same = teams.size === this.liveTeams.size && [...teams].every((t) => this.liveTeams.has(t));
    if (same) return false;
    this.liveTeams = new Set(teams);
    return true;
  }

  // A DEF starter's id is the team abbreviation itself, so it counts even if the directory lacks a team field.
  private isLive(id: string): boolean {
    const team = this.players.get(id)?.team;
    return (team !== undefined && this.liveTeams.has(team)) || this.liveTeams.has(id);
  }

  /** Swap in a (re)loaded player directory; view() uses it for names/positions. */
  setPlayers(players: Map<string, PlayerInfo>): void {
    this.players = players;
  }

  loadWeek(week: number, rosters: Roster[], matchups: Matchup[]): void {
    if (week !== this.week) this.lastSeen.clear();
    this.week = week;
    this.rosters = rosters;
    this.matchups = matchups;
    this.estimating = false;
    this.snap(matchups);
  }

  private snap(matchups: Matchup[]): void {
    this.scores.clear();
    this.starterIndex.clear();
    for (const m of matchups) {
      for (const side of m.sides) {
        if (!side) continue;
        this.scores.set(side.rosterId, side.points);
        // REST players_points already reflect what each player scored; seed so the first live delta is relative to it.
        for (const [id, pts] of Object.entries(side.playersPoints ?? {})) {
          if (typeof pts === "number" && Number.isFinite(pts)) this.lastSeen.set(id, pts);
        }
        for (const id of side.starters) {
          if (id === "0") continue;
          this.starterIndex.set(id, { rosterId: side.rosterId, matchupId: m.matchupId });
        }
      }
    }
  }

  /** False only when `week` is a number other than the loaded week (stale/next-week frames are ignored). */
  isCurrentWeek(week: unknown): boolean {
    return typeof week !== "number" || week === this.week;
  }

  starterOwner(playerId: string): number | undefined {
    return this.starterIndex.get(playerId)?.rosterId;
  }

  /** `week` is the payload's week; a numeric week other than the loaded one is ignored. */
  applyStatUpdate(playerId: string, cumulative: Record<string, number>, week?: unknown): ScoreChange | undefined {
    if (!this.isCurrentWeek(week)) return undefined;
    const newTotal = scoreStats(cumulative, this.rules, this.onUnknown);
    const prev = this.lastSeen.get(playerId) ?? 0;
    this.lastSeen.set(playerId, newTotal); // recorded for bench players too
    const owner = this.starterIndex.get(playerId);
    if (!owner) return undefined;
    const delta = newTotal - prev;
    this.scores.set(owner.rosterId, round2((this.scores.get(owner.rosterId) ?? 0) + delta));
    const matchupScores: Record<number, number> = {};
    const m = this.matchups.find((x) => x.matchupId === owner.matchupId);
    for (const side of m?.sides ?? []) {
      if (side) matchupScores[side.rosterId] = this.scores.get(side.rosterId) ?? 0;
    }
    return {
      rosterId: owner.rosterId,
      matchupId: owner.matchupId,
      playerId,
      playerPoints: round2(newTotal),
      matchupScores,
    };
  }

  /** Snap scores to REST; when rosters are given, also refresh standings (wins/losses/points-for). */
  reconcile(matchups: Matchup[], rosters?: Roster[]): void {
    if (rosters) this.rosters = rosters;
    let gap = false;
    for (const m of matchups) {
      for (const side of m.sides) {
        if (!side) continue;
        const live = this.scores.get(side.rosterId);
        if (live !== undefined && Math.abs(live - side.points) > ESTIMATE_GAP) gap = true;
      }
    }
    this.estimating = gap;
    this.matchups = matchups;
    this.snap(matchups);
  }

  view(): LeagueView {
    const byId = new Map(this.rosters.map((r) => [r.rosterId, r]));
    const standings = [...this.rosters].sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);
    return {
      week: this.week,
      standings,
      matchups: this.matchups.map((m) => ({
        matchupId: m.matchupId,
        sides: m.sides
          .filter((s): s is NonNullable<typeof s> => !!s)
          .map((s) => ({
            rosterId: s.rosterId,
            teamName: byId.get(s.rosterId)?.teamName ?? String(s.rosterId),
            score: this.scores.get(s.rosterId) ?? s.points,
            starters: s.starters
              .filter((id) => id !== "0")
              .map((id) => ({
                playerId: id,
                name: this.players.get(id)?.name ?? id,
                position: this.players.get(id)?.position ?? "?",
                points: this.lastSeen.get(id) ?? 0,
                live: this.isLive(id),
              })),
          })),
      })),
      estimating: this.estimating,
    };
  }
}
