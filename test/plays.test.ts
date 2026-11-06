import { describe, it, expect } from "vitest";
import { LeagueState } from "../src/server/league.js";
import { PlayPipeline, type PlayEntry } from "../src/server/plays.js";
import { scoreStats } from "../src/server/scoring.js";
import type { Config } from "../src/server/config.js";
import type { PlayerInfo } from "../src/shared/types.js";

const rules = { rec_yd: 0.1, rec_td: 6, pass_int: -2, rec: 1 };
const players = new Map<string, PlayerInfo>();
const cfg = { longGainYards: 40, takeoverSeconds: 8, takeoverQueueLimit: 3 } as Config;

function setup() {
  const league = new LeagueState(rules, players);
  league.loadWeek(
    1,
    [],
    [{ matchupId: 1, sides: [{ rosterId: 1, points: 0, starters: ["s1"] }, { rosterId: 2, points: 0, starters: ["s2"] }] }],
  );
  let t = 1000;
  const feed: PlayEntry[] = [];
  const takeovers: PlayEntry[] = [];
  const p = new PlayPipeline({
    league, rules, cfg: () => cfg, now: () => t,
    onFeed: (e) => feed.push(e), onTakeover: (e) => takeovers.push(e),
  });
  return { p, feed, takeovers, advance: (ms: number) => { t += ms; } };
}
const play = (id: string, stats: Record<string, Record<string, number>>, meta: object = {}) => ({
  play_id: id, game_id: "g1", week: 1,
  metadata: { description: "d", yards_gained: 5, quarter_name: "Q1", time_remaining_minutes: 3, time_remaining_seconds: 5, ...meta },
  play_stats: Object.entries(stats).map(([player_id, s]) => ({
    player_id, stats: s, player: { first_name: "A", last_name: player_id, position: "WR", team: "X" },
  })),
});

describe("PlayPipeline", () => {
  it("ignores bench-only plays", () => {
    const { p, feed, advance } = setup();
    p.handle("new_play", play("a", { bench: { rec: 1 } }));
    advance(6000); p.tick();
    expect(feed).toHaveLength(0);
  });
  it("publishes once when updated_play brings starter stats", () => {
    const { p, feed } = setup();
    p.handle("new_play", play("a", {}));
    expect(feed).toHaveLength(0);
    p.handle("updated_play", play("a", { s1: { rec: 1 } }));
    p.handle("updated_play", play("a", { s1: { rec: 1 } }));
    expect(feed).toHaveLength(1);
    expect(feed[0].clock).toBe("3:05");
    expect(feed[0].involved[0]).toMatchObject({ playerId: "s1", rosterId: 1, name: "A s1", points: 1 });
  });
  it("drops after 5s with no starter, ignoring later updates", () => {
    const { p, feed, advance } = setup();
    p.handle("new_play", play("a", {}));
    advance(5000); p.tick();
    p.handle("updated_play", play("a", { s1: { rec: 1 } }));
    expect(feed).toHaveLength(0);
  });
  it("classifies touchdown with points", () => {
    const { p, feed, takeovers } = setup();
    const stats = { rec_td: 1, rec_yd: 62 };
    p.handle("new_play", play("a", { s1: stats }, { is_scoring_play: true, yards_gained: 62 }));
    expect(feed[0].kind).toBe("touchdown");
    expect(feed[0].involved[0].points).toBe(scoreStats(stats, rules));
    expect(takeovers).toHaveLength(1);
  });
  it("long gain threshold 40", () => {
    const { p, feed } = setup();
    p.handle("new_play", play("a", { s1: { rec: 1 } }, { yards_gained: 39 }));
    p.handle("new_play", play("b", { s1: { rec: 1 } }, { yards_gained: 40 }));
    expect(feed[0].kind).toBeUndefined();
    expect(feed[1].kind).toBe("long_gain");
  });
  it("pass_int is turnover", () => {
    const { p, feed } = setup();
    p.handle("new_play", play("a", { s1: { pass_int: 1 } }));
    expect(feed[0].kind).toBe("turnover");
  });
  it("queue keeps 3 waiting plus the one showing; spacing by takeoverSeconds", () => {
    const { p, feed, takeovers, advance } = setup();
    for (let i = 0; i < 10; i++) {
      p.handle("new_play", play(`t${i}`, { s1: { rec_td: 1 } }, { is_scoring_play: true }));
    }
    p.tick();
    expect(feed).toHaveLength(10);
    expect(takeovers).toHaveLength(1);
    advance(7999); p.tick();
    expect(takeovers).toHaveLength(1);
    advance(1); p.tick();
    expect(takeovers).toHaveLength(2);
    for (let i = 0; i < 10; i++) { advance(8000); p.tick(); }
    expect(takeovers).toHaveLength(4);
  });
  it("unknown stat keys do not throw", () => {
    const { p, feed } = setup();
    expect(() => p.handle("new_play", play("a", { s1: { weird_key: 3 } }))).not.toThrow();
    expect(feed).toHaveLength(1);
  });
  it("holds scoring play until TD stat arrives, publishing once as touchdown", () => {
    const { p, feed, advance } = setup();
    p.handle("new_play", play("a", { s1: { rec_yd: 30 } }, { is_scoring_play: true }));
    expect(feed).toHaveLength(0);
    advance(2000);
    p.handle("updated_play", play("a", { s1: { rec_yd: 30, rec_td: 1 } }, { is_scoring_play: true }));
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBe("touchdown");
    expect(feed[0].involved[0].points).toBe(9);
    advance(6000); p.tick();
    expect(feed).toHaveLength(1);
  });
  it("scoring play with no TD stat publishes at 5s without kind, once", () => {
    const { p, feed, advance } = setup();
    p.handle("new_play", play("a", { s1: { rec_yd: 30 } }, { is_scoring_play: true, yards_gained: 5 }));
    advance(4999); p.tick();
    expect(feed).toHaveLength(0);
    advance(1); p.tick();
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBeUndefined();
    advance(6000); p.tick();
    expect(feed).toHaveLength(1);
  });
  it("non-scoring play publishes immediately", () => {
    const { p, feed } = setup();
    p.handle("new_play", play("a", { s1: { rec_yd: 5 } }));
    expect(feed).toHaveLength(1);
  });
  it("treats non-array play_stats as empty", () => {
    const { p, feed } = setup();
    expect(() => p.handle("new_play", { ...play("a", {}), play_stats: {} })).not.toThrow();
    expect(feed).toHaveLength(0);
  });
  it("overflow drops lowest-value kind first, keeps newest high-value", () => {
    const { p, takeovers, advance } = setup();
    const td = (id: string) => p.handle("new_play", play(id, { s1: { rec_td: 1 } }, { is_scoring_play: true }));
    td("show");
    p.handle("new_play", play("lg", { s1: { rec: 1 } }, { yards_gained: 50 }));
    p.handle("new_play", play("to", { s1: { pass_int: 1 } }));
    td("td1");
    td("td2");
    for (let i = 0; i < 6; i++) { advance(8000); p.tick(); }
    expect(takeovers.map((e) => e.playId)).toEqual(["show", "lg", "td1", "td2"]);
  });
});
