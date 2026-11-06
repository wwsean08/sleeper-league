import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { replayFrames } from "../src/server/replay.js";

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
