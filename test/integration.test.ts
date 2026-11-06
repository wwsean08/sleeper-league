import { describe, it, expect, vi } from "vitest";
import { LeagueState } from "../src/server/league.js";
import { PlayPipeline, type PlayEntry } from "../src/server/plays.js";
import type { Config } from "../src/server/config.js";
import { loadSample, replayTimed } from "./helpers/timedReplay.js";

const KICKOFF = "b3d2b5f0-d983-11f1-bf4f-7fdba515be1b";
const INCOMPLETE = "857ba760-d984-11f1-bf4f-7fdba515be1b";
const COMPLETION = "f6bc92e0-d984-11f1-bf4f-7fdba515be1b";

describe("sample log replay with real timing (LeagueState + PlayPipeline)", () => {
  it("publishes each starter play once, from the latest frame, with no kickoff takeover", () => {
    const rules = { pass_yd: 0.04, rush_yd: 0.1, rec_yd: 0.1, rec: 1, kr_yd: 0.04, pass_td: 4, rec_td: 6 };
    const league = new LeagueState(rules, new Map());
    // Week 9 like the capture. Starters: K 11786 (kicks off), KR 5995, QB 13350, TE 5012.
    league.loadWeek(9, [], [
      { matchupId: 1, sides: [
        { rosterId: 1, points: 0, starters: ["11786", "5012"] },
        { rosterId: 2, points: 0, starters: ["13350", "5995"] },
      ] },
    ]);
    const clock = { t: 0 };
    const cfg = { longGainYards: 40, takeoverSeconds: 8, takeoverQueueLimit: 3 } as Config;
    const calls: Array<{ type: "feed" | "takeover"; play: PlayEntry }> = [];
    const pipeline = new PlayPipeline({
      league, rules, cfg: () => cfg, now: () => clock.t,
      onFeed: (play) => calls.push({ type: "feed", play }),
      onTakeover: (play) => calls.push({ type: "takeover", play }),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Same routing as src/server/index.ts onEvent.
      replayTimed(loadSample(), {
        clock,
        tick: () => pipeline.tick(),
        onEvent: (event, payload) => {
          if (event === "stat_updated") {
            if (payload?.player_id == null || typeof payload.stats !== "object" || !payload.stats) return;
            league.applyStatUpdate(String(payload.player_id), payload.stats, payload.week);
          } else if (event === "new_play" || event === "updated_play") {
            pipeline.handle(event, payload);
          }
        },
      });
    } finally {
      warn.mockRestore();
    }

    expect(calls.map((c) => [c.type, c.play.playId, c.play.at])).toEqual([
      ["feed", KICKOFF, 8_000], // last frame 6.3s + 1.5s quiet -> 7.8s, next tick 8.0s
      ["feed", INCOMPLETE, 12_500], // play_start 6.6s leaves it pending; starter frame 11.0s
      ["feed", COMPLETION, 57_000], // play_start 48.8s, starter frames 55.1s and 55.4s
    ]);
    const [kick, inc, comp] = calls.map((c) => c.play);
    expect(kick!.kind).toBeUndefined();
    expect(kick!.involved.map((i) => i.playerId).sort()).toEqual(["11786", "5995"]);
    expect(inc!.description).toBe("J.Fagnano steps back to pass. Pass incomplete intended for BAL.");
    expect(comp!.description).toBe("J.Fagnano pass complete. Catch made by M.Andrews for 7 yards. Tackled by JAC at BAL 32.");
    expect(comp!.kind).toBeUndefined();
    expect(comp!.involved.map((i) => i.playerId)).toEqual(["13350", "5012"]);
    expect(comp!.involved.find((i) => i.playerId === "5012")!.points).toBeCloseTo(1.7);
    // stat_updated for starter 13350 (7 passing yards) moved roster 2's live score.
    expect(league.view().matchups[0]!.sides[1]!.score).toBeCloseTo(0.28);
  });
});
