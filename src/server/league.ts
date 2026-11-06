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
      starters: Array<{ playerId: string; name: string; position: string; points: number }>;
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
  // One stable callback so scoreStats reports each unknown key once per instance.
  private readonly onUnknown = (key: string): void => {
    console.warn(`unknown scoring stat key: ${key}`);
  };

  constructor(
    private readonly rules: ScoringSettings,
    private readonly players: Map<string, PlayerInfo>,
  ) {}

  loadWeek(week: number, rosters: Roster[], matchups: Matchup[]): void {
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
        for (const id of side.starters) {
          if (id === "0") continue;
          this.starterIndex.set(id, { rosterId: side.rosterId, matchupId: m.matchupId });
        }
      }
    }
  }

  starterOwner(playerId: string): number | undefined {
    return this.starterIndex.get(playerId)?.rosterId;
  }

  applyStatUpdate(playerId: string, cumulative: Record<string, number>): ScoreChange | undefined {
    const owner = this.starterIndex.get(playerId);
    if (!owner) return undefined;
    const newTotal = scoreStats(cumulative, this.rules, this.onUnknown);
    const delta = newTotal - (this.lastSeen.get(playerId) ?? 0);
    this.lastSeen.set(playerId, newTotal);
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
      playerPoints: newTotal,
      matchupScores,
    };
  }

  reconcile(matchups: Matchup[]): void {
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
              })),
          })),
      })),
      estimating: this.estimating,
    };
  }
}
