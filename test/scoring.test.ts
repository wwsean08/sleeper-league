import { describe, it, expect } from "vitest";
import { scoreStats } from "../src/server/scoring.js";

const rules = { sack: 2.5, pass_int: -2, fgm_40_49: 4, x: 0.333 };

describe("scoreStats", () => {
  it("scores known stats", () => {
    expect(scoreStats({ sack: 2 }, rules)).toBe(5);
    expect(scoreStats({ pass_int: 1 }, rules)).toBe(-2);
  });
  it("reports unknown keys once and contributes 0", () => {
    const seen: string[] = [];
    const cb = (k: string) => seen.push(k);
    expect(scoreStats({ zzz: 3 }, rules, cb)).toBe(0);
    expect(scoreStats({ zzz: 3 }, rules, cb)).toBe(0);
    expect(seen).toEqual(["zzz"]);
  });
  it("handles empty and rounds", () => {
    expect(scoreStats({}, rules)).toBe(0);
    expect(scoreStats({ x: 1 }, rules)).toBe(0.33);
  });
  it("treats non-finite values as 0", () => {
    expect(scoreStats({ sack: NaN, pass_int: "a" as unknown as number }, rules)).toBe(0);
  });
});
