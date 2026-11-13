import { describe, expect, it } from "vitest";
import { DiceError, combineRollModes, formatDice, parseDice, rollDice, scriptedRoller, seededRoller } from "../src";

describe("parseDice", () => {
  it.each([
    ["2d6+3", "2d6+3"],
    ["d20", "1d20"],
    [" 1D20 + 5 ", "1d20+5"],
    ["4d6kh3", "4d6kh3"],
    ["2d20kl1-1", "2d20kl1-1"],
    ["1d8+2d6+3", "1d8+2d6+3"],
    ["d%", "1d100"],
    ["-1d4+10", "-1d4+10"],
    ["7", "7"],
  ])("%s normalizes to %s", (input, normalized) => {
    expect(formatDice(parseDice(input))).toBe(normalized);
  });

  it.each([
    "",
    "   ",
    "abc",
    "2d",
    "d",
    "2d6+",
    "+",
    "2d6++3",
    "2d6 3",
    "0d6",
    "1d1",
    "1d0",
    "101d6",
    "1d1001",
    "4d6kh5",
    "4d6kh0",
    "1d20kh",
    "2x6",
    "1.5d6",
    "1d6*2",
    "9".repeat(7),
    "1+".repeat(20) + "1",
    "1d20".padEnd(101, " "),
  ])("rejects %j", (input) => {
    expect(() => parseDice(input)).toThrow(DiceError);
  });
});

describe("rollDice", () => {
  it("sums dice and constants", () => {
    const result = rollDice("2d6+3", scriptedRoller([4, 5]));
    expect(result.total).toBe(12);
    expect(result.expression).toBe("2d6+3");
    expect(result.terms[0]).toMatchObject({ kind: "dice", subtotal: 9, dice: [{ value: 4, kept: true }, { value: 5, kept: true }] });
    expect(result.terms[1]).toMatchObject({ kind: "constant", subtotal: 3 });
  });

  it("subtracts negative terms", () => {
    expect(rollDice("1d20-1d4-2", scriptedRoller([10, 3])).total).toBe(5);
  });

  it("keeps the highest dice", () => {
    const result = rollDice("4d6kh3", scriptedRoller([1, 6, 3, 6]));
    expect(result.total).toBe(15);
    expect(result.terms[0]).toMatchObject({ dice: [{ kept: false }, { kept: true }, { kept: true }, { kept: true }] });
  });

  it("keeps the lowest dice, dropping only as many as asked when faces tie", () => {
    const result = rollDice("3d6kl1", scriptedRoller([2, 2, 5]));
    expect(result.total).toBe(2);
    const term = result.terms[0];
    expect(term?.kind === "dice" && term.dice.filter((d) => d.kept)).toHaveLength(1);
  });

  it("advantage rolls the d20 twice and keeps the higher", () => {
    const result = rollDice("1d20+5", scriptedRoller([7, 15]), "advantage");
    expect(result.total).toBe(20);
    expect(result.mode).toBe("advantage");
    expect(result.terms[0]).toMatchObject({ dice: [{ value: 7, kept: false }, { value: 15, kept: true }] });
  });

  it("disadvantage rolls the d20 twice and keeps the lower", () => {
    expect(rollDice("d20+5", scriptedRoller([7, 15]), "disadvantage").total).toBe(12);
  });

  it("advantage leaves the other dice alone", () => {
    const roller = scriptedRoller([3, 18, 4]);
    expect(rollDice("1d20+1d4", roller, "advantage").total).toBe(22);
    expect(roller.remaining()).toBe(0);
  });

  it.each(["2d6", "2d20", "1d20+1d20", "5", "2d20kh1", "-1d20+30"])("advantage on %s is an error", (expr) => {
    expect(() => rollDice(expr, seededRoller(1), "advantage")).toThrow(DiceError);
  });

  it("is deterministic for a seed and differs across seeds", () => {
    const run = (seed: number) => Array.from({ length: 20 }, () => 0).map(((r) => () => rollDice("3d6", r).total)(seededRoller(seed)));
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it("stays in range and reaches every face", () => {
    const roller = seededRoller(2024);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const face = roller.roll(20);
      expect(face).toBeGreaterThanOrEqual(1);
      expect(face).toBeLessThanOrEqual(20);
      seen.add(face);
    }
    expect(seen.size).toBe(20);
  });

  it("rejects a roller that returns an impossible face", () => {
    expect(() => rollDice("1d6", { roll: () => 7 })).toThrow(/returned 7/);
  });
});

describe("combineRollModes", () => {
  it.each([
    [[], "normal"],
    [["advantage"], "advantage"],
    [["advantage", "advantage"], "advantage"],
    [["disadvantage", "normal"], "disadvantage"],
    // SRD: with both, "you roll one d20", even if multiple circumstances impose one and only one grants the other.
    [["advantage", "disadvantage"], "normal"],
    [["disadvantage", "disadvantage", "advantage"], "normal"],
  ] as const)("%j is %s", (modes, expected) => {
    expect(combineRollModes(modes)).toBe(expected);
  });
});
