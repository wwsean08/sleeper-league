import { describe, it, expect } from "vitest";
import { createRest, SleeperHttpError } from "../src/server/sleeper/rest.js";

function fakeFetch(routes: Record<string, unknown>, calls: string[] = []): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    const path = u.replace("https://api.sleeper.app/v1", "");
    if (!(path in routes)) return new Response("nope", { status: 404 });
    return new Response(JSON.stringify(routes[path]), { status: 200 });
  }) as typeof fetch;
}

describe("rest", () => {
  it("merges users into rosters", async () => {
    const rest = createRest(
      fakeFetch({
        "/league/1/rosters": [
          { roster_id: 1, owner_id: "u1", players: ["a"], starters: ["a"], settings: { wins: 3, losses: 1, ties: 0, fpts: 400, fpts_decimal: 25 } },
          { roster_id: 2, owner_id: "u2", players: [], starters: [], settings: { wins: 1, losses: 3, ties: 0, fpts: 300 } },
        ],
        "/league/1/users": [
          { user_id: "u1", display_name: "ty", avatar: "av1", metadata: { team_name: "Ty’s Guys" } },
          { user_id: "u2", display_name: "bob", avatar: null, metadata: {} },
        ],
      }),
    );
    const r = await rest.rosters("1");
    expect(r[0]).toMatchObject({ rosterId: 1, teamName: "Ty’s Guys", avatar: "av1", wins: 3, fpts: 400.25 });
    expect(r[1]!.teamName).toBe("bob");
    expect(r[1]!.fpts).toBe(300);
  });

  it("groups matchups by matchup_id", async () => {
    const rest = createRest(
      fakeFetch({
        "/league/1/matchups/2": [
          { roster_id: 1, matchup_id: 5, points: 10.5, starters: ["a", "0"], players_points: { a: 10.5 } },
          { roster_id: 2, matchup_id: 5, points: 8, starters: ["b"] },
          { roster_id: 3, matchup_id: 6, points: 1, starters: [] },
        ],
      }),
    );
    const m = await rest.matchups("1", 2);
    expect(m).toHaveLength(2);
    expect(m[0]!.matchupId).toBe(5);
    expect(m[0]!.sides[0].playersPoints).toEqual({ a: 10.5 });
    expect(m[0]!.sides[1]!.playersPoints).toBeUndefined();
    expect(m[0]!.sides[0].starters).toEqual(["a", "0"]);
    expect(m[0]!.sides[1]!.rosterId).toBe(2);
    expect(m[1]!.sides[1]).toBeUndefined();
  });

  it("throws SleeperHttpError on non-2xx", async () => {
    const rest = createRest(fakeFetch({}));
    await expect(rest.nflState()).rejects.toMatchObject({ status: 404 });
    await expect(rest.nflState()).rejects.toBeInstanceOf(SleeperHttpError);
  });

  it("parses nflState and league", async () => {
    const rest = createRest(
      fakeFetch({
        "/state/nfl": { week: 9, season_type: "regular" },
        "/league/1": { name: "L", scoring_settings: { pass_td: 4 }, roster_positions: ["QB"] },
      }),
    );
    expect(await rest.nflState()).toEqual({ week: 9, seasonType: "regular" });
    expect(await rest.league("1")).toEqual({ name: "L", scoringSettings: { pass_td: 4 }, rosterPositions: ["QB"] });
  });

  it("caches players for 24h", async () => {
    const calls: string[] = [];
    let now = 0;
    const rest = createRest(
      fakeFetch({ "/players/nfl": { "1": { first_name: "A", last_name: "B", position: "QB", team: "SF" }, SF: { first_name: "San Francisco", last_name: "49ers", position: "DEF", team: "SF" } } }, calls),
      () => now,
    );
    const p = await rest.players();
    expect(p.get("1")).toEqual({ id: "1", name: "A B", position: "QB", team: "SF" });
    expect(p.get("SF")!.name).toBe("San Francisco 49ers");
    await rest.players();
    expect(calls).toHaveLength(1);
    now = 24 * 3600 * 1000 + 1;
    await rest.players();
    expect(calls).toHaveLength(2);
  });
});
