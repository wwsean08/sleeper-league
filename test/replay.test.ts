import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { replayFrames } from "../src/server/replay.js";
import { LeagueState } from "../src/server/league.js";
import { PlayPipeline, type PlayEntry } from "../src/server/plays.js";
import type { Config } from "../src/server/config.js";

describe("replayFrames", () => {
  it("delivers sample log events and ignores phx_reply", () => {
    const text = readFileSync("docs/samples/score-nfl-frames-2026-11-05.log", "utf8");
    const counts: Record<string, number> = {};
    replayFrames(text, (e) => (counts[e] = (counts[e] ?? 0) + 1));
    expect(counts).toEqual({ new_play: 4, updated_play: 2, stat_updated: 6, score_updated: 4 });
  });

  it("skips blank and malformed lines", () => {
    const got: string[] = [];
    replayFrames('\nbogus\n1 not json\n2 [null,null,"t","x",{}]\n', (e) => got.push(e));
    expect(got).toEqual(["x"]);
  });
});

describe("replay integration", () => {
  it("drives LeagueState + PlayPipeline from the sample log without throwing; unknown keys are logged", () => {
    const rules = { pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1, rec: 1, pass_td: 4, rush_td: 6, rec_td: 6 };
    const league = new LeagueState(rules, new Map());
    league.loadWeek(9, [], [
      { matchupId: 1, sides: [
        { rosterId: 1, points: 0, starters: ["13394", "13350"] },
        { rosterId: 2, points: 0, starters: ["5012", "JAX"] },
      ] },
    ]);
    let t = 0;
    const cfg = { longGainYards: 40, takeoverSeconds: 8, takeoverQueueLimit: 3 } as Config;
    const feed: PlayEntry[] = [];
    const pipeline = new PlayPipeline({
      league, rules, cfg: () => cfg, now: () => t,
      onFeed: (p) => feed.push(p), onTakeover: () => {},
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const text = readFileSync("docs/samples/score-nfl-frames-2026-11-05.log", "utf8");
      expect(() =>
        replayFrames(text, (event, payload) => {
          if (event === "stat_updated") league.applyStatUpdate(String(payload.player_id), payload.stats ?? {});
          else if (event === "new_play" || event === "updated_play") pipeline.handle(event, payload);
          t += 100;
          pipeline.tick();
        }),
      ).not.toThrow();
      t += 10_000;
      pipeline.tick();
      expect(feed.length).toBeGreaterThan(0);
      expect(warn.mock.calls.some(([m]) => String(m).startsWith("unknown scoring stat key"))).toBe(true);
      expect(league.view().matchups[0].sides[0].score).toBeGreaterThan(0);
    } finally {
      warn.mockRestore();
    }
  });
});
