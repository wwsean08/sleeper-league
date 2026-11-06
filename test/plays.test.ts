import { describe, it, expect } from "vitest";
import { LeagueState } from "../src/server/league.js";
import { HARD_CAP_MS, PlayPipeline, QUIET_MS, STATS_FREE_DROP_MS, type PlayEntry } from "../src/server/plays.js";
import { scoreStats } from "../src/server/scoring.js";
import type { Config } from "../src/server/config.js";
import type { PlayerInfo } from "../src/shared/types.js";
import { loadSample, replayTimed } from "./helpers/timedReplay.js";

const rules = { rec_yd: 0.1, rec_td: 6, pass_int: -2, rec: 1 };
const players = new Map<string, PlayerInfo>();
const cfg = { longGainYards: 40, takeoverSeconds: 8, takeoverQueueLimit: 3 } as Config;

function setup(starters: [string[], string[]] = [["s1"], ["s2"]], week = 1) {
  const league = new LeagueState(rules, players);
  league.loadWeek(
    week,
    [],
    [{ matchupId: 1, sides: [{ rosterId: 1, points: 0, starters: starters[0] }, { rosterId: 2, points: 0, starters: starters[1] }] }],
  );
  const clock = { t: 1000 };
  const feed: PlayEntry[] = [];
  const takeovers: PlayEntry[] = [];
  const p = new PlayPipeline({
    league, rules, cfg: () => cfg, now: () => clock.t,
    onFeed: (e) => feed.push(e), onTakeover: (e) => takeovers.push(e),
  });
  const advance = (ms: number) => { clock.t += ms; };
  /** Lets the quiet period elapse and runs one tick. */
  const settle = () => { advance(QUIET_MS); p.tick(); };
  return { p, feed, takeovers, advance, settle, clock };
}
const play = (id: string, stats: Record<string, Record<string, number>>, meta: object = {}) => ({
  play_id: id, game_id: "g1", week: 1,
  metadata: { description: "d", yards_gained: 5, play_type: "pass_complete", quarter_name: "Q1", time_remaining_minutes: 3, time_remaining_seconds: 5, ...meta },
  play_stats: Object.entries(stats).map(([player_id, s]) => ({
    player_id, stats: s, player: { first_name: "A", last_name: player_id, position: "WR", team: "X" },
  })),
});

describe("PlayPipeline publishing", () => {
  it("ignores bench-only plays", () => {
    const { p, feed, advance } = setup();
    p.handle("new_play", play("a", { bench: { rec: 1 } }));
    advance(STATS_FREE_DROP_MS + 1000); p.tick();
    expect(feed).toHaveLength(0);
  });
  it("never publishes from handle(); publishes once after the quiet period", () => {
    const { p, feed, settle } = setup();
    p.handle("new_play", play("a", {}));
    p.handle("updated_play", play("a", { s1: { rec: 1 } }));
    p.handle("updated_play", play("a", { s1: { rec: 1 } }));
    expect(feed).toHaveLength(0);
    settle();
    expect(feed).toHaveLength(1);
    expect(feed[0].clock).toBe("3:05");
    expect(feed[0].involved[0]).toMatchObject({ playerId: "s1", rosterId: 1, name: "A s1", points: 1 });
    settle();
    expect(feed).toHaveLength(1);
  });
  it("merges frames: latest description, play_stats merged by player with latest values", () => {
    const { p, feed, advance, settle } = setup([["s1", "s3"], ["s2"]]);
    p.handle("updated_play", play("a", { s1: { rec: 1, rec_yd: 5 }, s3: { pass_cmp: 1 } }, { description: "Play over." }));
    advance(300);
    p.handle("new_play", play("a", { s1: { rec: 1, rec_yd: 7 }, s2: { tkl: 1 } }, { description: "Full description" }));
    settle();
    expect(feed).toHaveLength(1);
    expect(feed[0].description).toBe("Full description");
    expect(feed[0].involved.map((i) => i.playerId)).toEqual(["s1", "s3", "s2"]);
    expect(feed[0].involved[0].points).toBeCloseTo(1.7);
  });
  it("quiet period boundary: 1499ms no, 1500ms yes", () => {
    const { p, feed, advance } = setup();
    p.handle("new_play", play("a", { s1: { rec: 1 } }));
    advance(QUIET_MS - 1); p.tick();
    expect(feed).toHaveLength(0);
    advance(1); p.tick();
    expect(feed).toHaveLength(1);
  });
  it("hard cap: a continuing stream publishes 8000ms after the first starter frame, with the latest merge", () => {
    const { p, feed, advance } = setup();
    p.handle("new_play", play("a", {}, { description: "start" })); // stats-free: does not start the cap
    advance(3000);
    p.handle("updated_play", play("a", { s1: { rec: 1 } }, { description: "f0" }));
    for (let i = 1; i <= 7; i++) {
      advance(1000);
      p.handle("updated_play", play("a", { s1: { rec: 1 } }, { description: `f${i}` }));
      p.tick();
    }
    expect(feed).toHaveLength(0); // 7000ms after the first starter frame, never quiet
    advance(999); p.tick();
    expect(feed).toHaveLength(0);
    advance(1); p.tick();
    expect(feed).toHaveLength(1);
    expect(feed[0].description).toBe("f7");
    advance(500);
    p.handle("updated_play", play("a", { s1: { rec: 1 } }, { description: "late" }));
    advance(QUIET_MS); p.tick();
    expect(feed).toHaveLength(1);
  });
  it("stats-free play is dropped only after 30s since its LAST frame", () => {
    const { p, feed, advance, settle } = setup();
    p.handle("new_play", play("a", {}));
    advance(20_000);
    p.handle("updated_play", play("a", {}));
    advance(STATS_FREE_DROP_MS - 1); p.tick(); // 49.999s after the first frame, 29.999s of silence
    p.handle("updated_play", play("a", { s1: { rec: 1 } }));
    settle();
    expect(feed).toHaveLength(1);
  });
  it("stats-free play at 30s of silence is dropped; later frames are ignored", () => {
    const { p, feed, advance, settle } = setup();
    p.handle("new_play", play("a", {}));
    advance(STATS_FREE_DROP_MS); p.tick();
    p.handle("updated_play", play("a", { s1: { rec: 1 } }));
    settle();
    expect(feed).toHaveLength(0);
  });
  it("ignores frames whose week is not the loaded week", () => {
    const { p, feed, settle } = setup();
    p.handle("new_play", { ...play("a", { s1: { rec: 1 } }), week: 2 });
    settle();
    expect(feed).toHaveLength(0);
    p.handle("new_play", { ...play("b", { s1: { rec: 1 } }), week: undefined });
    settle();
    expect(feed).toHaveLength(1);
  });
  it("treats non-array play_stats as empty", () => {
    const { p, feed, settle } = setup();
    expect(() => p.handle("new_play", { ...play("a", {}), play_stats: {} })).not.toThrow();
    settle();
    expect(feed).toHaveLength(0);
  });
  it("unknown stat keys do not throw", () => {
    const { p, feed, settle } = setup();
    expect(() => p.handle("new_play", play("a", { s1: { weird_key: 3 } }))).not.toThrow();
    settle();
    expect(feed).toHaveLength(1);
  });
});

describe("PlayPipeline scoring plays", () => {
  it("classifies touchdown with points", () => {
    const { p, feed, takeovers, settle } = setup();
    const stats = { rec_td: 1, rec_yd: 62 };
    p.handle("new_play", play("a", { s1: stats }, { is_scoring_play: true, yards_gained: 62 }));
    settle();
    expect(feed[0].kind).toBe("touchdown");
    expect(feed[0].involved[0].points).toBe(scoreStats(stats, rules));
    expect(takeovers).toHaveLength(1);
  });
  it("holds scoring play until TD stat arrives, then publishes after the quiet period as touchdown", () => {
    const { p, feed, advance, settle } = setup();
    p.handle("new_play", play("a", { s1: { rec_yd: 30 } }, { is_scoring_play: true }));
    advance(2000); p.tick();
    expect(feed).toHaveLength(0);
    p.handle("updated_play", play("a", { s1: { rec_yd: 30, rec_td: 1 } }, { is_scoring_play: true }));
    settle();
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBe("touchdown");
    expect(feed[0].involved[0].points).toBe(9);
    advance(10_000); p.tick();
    expect(feed).toHaveLength(1);
  });
  it("scoring play with no TD stat waits for the 8000ms hard cap, then publishes without kind, once", () => {
    const { p, feed, advance } = setup();
    p.handle("new_play", play("a", { s1: { rec_yd: 30 } }, { is_scoring_play: true, yards_gained: 5 }));
    advance(HARD_CAP_MS - 1); p.tick();
    expect(feed).toHaveLength(0);
    advance(1); p.tick();
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBeUndefined();
    advance(10_000); p.tick();
    expect(feed).toHaveLength(1);
  });
  it("pass_int is turnover", () => {
    const { p, feed, settle } = setup();
    p.handle("new_play", play("a", { s1: { pass_int: 1 } }));
    settle();
    expect(feed[0].kind).toBe("turnover");
  });
});

describe("PlayPipeline long gain", () => {
  const kindOf = (stats: Record<string, Record<string, number>>, meta: object = {}, starters?: [string[], string[]]) => {
    const { p, feed, takeovers, settle } = setup(starters);
    p.handle("new_play", play("a", stats, meta));
    settle();
    expect(feed).toHaveLength(1);
    return { kind: feed[0].kind, feed, takeovers };
  };
  it("rec_yd threshold 40: 39 no, 40 yes (metadata.yards_gained is ignored)", () => {
    expect(kindOf({ s1: { rec: 1, rec_yd: 39 } }, { yards_gained: 80 }).kind).toBeUndefined();
    expect(kindOf({ s1: { rec: 1, rec_yd: 40 } }, { yards_gained: 0 }).kind).toBe("long_gain");
  });
  it("rush_yd: 39 no, 40 yes", () => {
    expect(kindOf({ s1: { rush_yd: 39 } }, { play_type: "rush" }).kind).toBeUndefined();
    expect(kindOf({ s1: { rush_yd: 40 } }, { play_type: "rush" }).kind).toBe("long_gain");
  });
  it("a starting WR with rec_yd 62 on a pass play fires, with yards from his gain", () => {
    const r = kindOf({ s1: { rec: 1, rec_yd: 62 } }, { yards_gained: 62 });
    expect(r.kind).toBe("long_gain");
    expect(r.feed[0].yards).toBe(62);
    expect(r.takeovers).toHaveLength(1);
  });
  it("a starting QB's 60-yard completion to a non-starter does not fire", () => {
    expect(kindOf({ s1: { pass_yd: 60, pass_cmp: 1 }, bench: { rec: 1, rec_yd: 60 } }, { yards_gained: 60 }).kind).toBeUndefined();
  });
  it("a starting punter's 50-yard punt does not fire", () => {
    expect(kindOf({ s1: { punt: 1, punt_yd: 50 } }, { play_type: "punt", yards_gained: 50 }).kind).toBeUndefined();
  });
  it("kick plays never classify as long_gain, even with a long return", () => {
    expect(kindOf({ s1: { kr: 1, kr_yd: 55 } }, { play_type: "kickoff", yards_gained: 62 }).kind).toBeUndefined();
  });
  it("the sample's opening kickoff (starting K, 62 yards) is published without kind and no takeover", () => {
    const frame = loadSample().find((f) => f.payload?.metadata?.play_type === "kickoff")!;
    const { p, feed, takeovers, settle } = setup([["11786"], ["s2"]], 9);
    p.handle("updated_play", frame.payload);
    settle();
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBeUndefined();
    expect(feed[0].yards).toBe(0);
    expect(takeovers).toHaveLength(0);
  });
});

describe("PlayPipeline takeover queue", () => {
  it("queue keeps 3 waiting plus the one showing; spacing by takeoverSeconds", () => {
    const { p, feed, takeovers, advance, settle } = setup();
    for (let i = 0; i < 10; i++) {
      p.handle("new_play", play(`t${i}`, { s1: { rec_td: 1 } }, { is_scoring_play: true }));
    }
    settle();
    expect(feed).toHaveLength(10);
    expect(takeovers).toHaveLength(1);
    advance(7999); p.tick();
    expect(takeovers).toHaveLength(1);
    advance(1); p.tick();
    expect(takeovers).toHaveLength(2);
    for (let i = 0; i < 10; i++) { advance(8000); p.tick(); }
    expect(takeovers).toHaveLength(4);
  });
  it("overflow drops lowest-value kind first, keeps newest high-value", () => {
    const { p, takeovers, advance, settle } = setup();
    const td = (id: string) => p.handle("new_play", play(id, { s1: { rec_td: 1 } }, { is_scoring_play: true }));
    td("show");
    p.handle("new_play", play("lg", { s1: { rec: 1, rec_yd: 50 } }));
    p.handle("new_play", play("to", { s1: { pass_int: 1 } }));
    td("td1");
    td("td2");
    settle();
    for (let i = 0; i < 6; i++) { advance(8000); p.tick(); }
    expect(takeovers.map((e) => e.playId)).toEqual(["show", "lg", "td1", "td2"]);
  });
});

describe("PlayPipeline sample replay with real timestamps", () => {
  it("publishes f6bc92e0 exactly once, with the later frame's description; nothing twice", () => {
    const { p, feed, takeovers, clock } = setup([["5012", "11786"], ["s2"]], 9);
    clock.t = 0;
    replayTimed(loadSample(), {
      clock,
      tick: () => p.tick(),
      onEvent: (event, payload) => {
        if (event === "new_play" || event === "updated_play") p.handle(event, payload);
      },
    });
    const ids = feed.map((e) => e.playId);
    expect(new Set(ids).size).toBe(ids.length);
    const target = feed.filter((e) => e.playId.startsWith("f6bc92e0"));
    expect(target).toHaveLength(1);
    expect(target[0].description).toBe("J.Fagnano pass complete. Catch made by M.Andrews for 7 yards. Tackled by JAC at BAL 32.");
    expect(target[0].involved.map((i) => i.playerId)).toEqual(["5012"]);
    // Published one quiet period after the last frame (55.4s), on the next 500ms tick.
    expect(target[0].at).toBe(57_000);
    expect(takeovers).toHaveLength(0);
    expect(ids).toEqual(["b3d2b5f0-d983-11f1-bf4f-7fdba515be1b", "f6bc92e0-d984-11f1-bf4f-7fdba515be1b"]);
  });
});
