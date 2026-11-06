import { describe, it, expect } from "vitest";
import { LeagueState } from "../src/server/league.js";
import type { Roster, Matchup, PlayerInfo } from "../src/shared/types.js";

const rules = { rec_yd: 0.1 };
const players = new Map<string, PlayerInfo>([
  ["p1", { id: "p1", name: "Alpha", position: "WR" }],
  ["p2", { id: "p2", name: "Beta", position: "RB" }],
  ["p3", { id: "p3", name: "Gamma", position: "WR" }],
  ["p4", { id: "p4", name: "Delta", position: "TE" }],
]);
const roster = (rosterId: number, wins: number, fpts: number, starters: string[]): Roster => ({
  rosterId, ownerId: `o${rosterId}`, teamName: `Team${rosterId}`, wins, losses: 0, ties: 0, fpts,
  players: ["p1", "p2", "p3", "p4"], starters,
});
const rosters = [roster(1, 1, 100, ["p1", "0"]), roster(2, 1, 120, ["p3"])];
const mk = (p1: number, p2: number, s1 = ["p1", "0"], s2 = ["p3"]): Matchup[] => [
  { matchupId: 7, sides: [{ rosterId: 1, points: p1, starters: s1 }, { rosterId: 2, points: p2, starters: s2 }] },
];
const fresh = () => {
  const l = new LeagueState(rules, players);
  l.loadWeek(3, rosters, mk(10, 20));
  return l;
};

describe("LeagueState", () => {
  it("ignores bench players", () => {
    const l = fresh();
    expect(l.applyStatUpdate("p2", { rec_yd: 100 })).toBeUndefined();
    expect(l.view().matchups[0].sides[0].score).toBe(10);
  });
  it("applies starter deltas", () => {
    const l = fresh();
    expect(l.starterOwner("p1")).toBe(1);
    const c = l.applyStatUpdate("p1", { rec_yd: 100 })!;
    expect(c.matchupScores).toEqual({ 1: 20, 2: 20 });
    expect(c.playerPoints).toBe(10);
    expect(c.rosterId).toBe(1);
    expect(c.matchupId).toBe(7);
    const c2 = l.applyStatUpdate("p1", { rec_yd: 120 })!;
    expect(c2.matchupScores[1]).toBe(22);
  });
  it("swapped starter makes old starter invisible; '0' ignored", () => {
    const l = fresh();
    l.loadWeek(3, rosters, mk(10, 20, ["p4", "0"]));
    expect(l.applyStatUpdate("p1", { rec_yd: 100 })).toBeUndefined();
    expect(l.starterOwner("p1")).toBeUndefined();
    expect(l.starterOwner("0")).toBeUndefined();
    expect(l.starterOwner("p4")).toBe(1);
  });
  it("reconcile snaps and sets estimating when gap > 5", () => {
    const l = fresh();
    l.applyStatUpdate("p1", { rec_yd: 100 });
    l.reconcile(mk(12, 20));
    const v = l.view();
    expect(v.matchups[0].sides[0].score).toBe(12);
    expect(v.estimating).toBe(true);
    l.applyStatUpdate("p1", { rec_yd: 120 });
    expect(l.view().matchups[0].sides[0].score).toBe(14);
    l.reconcile(mk(14, 20));
    expect(l.view().estimating).toBe(false);
  });
  it("standings sort wins then fpts, stable", () => {
    const l = new LeagueState(rules, players);
    const rs = [roster(1, 1, 100, []), roster(2, 2, 50, []), roster(3, 1, 100, []), roster(4, 1, 130, [])];
    l.loadWeek(1, rs, []);
    expect(l.view().standings.map((r) => r.rosterId)).toEqual([2, 4, 1, 3]);
  });
  it("tied matchup scores both appear; view details", () => {
    const l = new LeagueState(rules, players);
    l.loadWeek(3, rosters, mk(50, 50));
    const s = l.view().matchups[0].sides;
    expect(s.map((x) => x.score)).toEqual([50, 50]);
    expect(s[0].teamName).toBe("Team1");
    expect(s[0].starters).toEqual([{ playerId: "p1", name: "Alpha", position: "WR", points: 0 }]);
  });
});
