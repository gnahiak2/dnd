import { describe, expect, it } from "vitest";
import { ABILITIES, SKILLS, abilityModifier, formatModifier, proficiencyBonus } from "../src";

describe("abilityModifier", () => {
  // SRD 5.1, "Ability Scores and Modifiers" table.
  const table: [scores: number[], modifier: number][] = [
    [[1], -5],
    [[2, 3], -4],
    [[4, 5], -3],
    [[6, 7], -2],
    [[8, 9], -1],
    [[10, 11], 0],
    [[12, 13], 1],
    [[14, 15], 2],
    [[16, 17], 3],
    [[18, 19], 4],
    [[20, 21], 5],
    [[22, 23], 6],
    [[24, 25], 7],
    [[26, 27], 8],
    [[28, 29], 9],
    [[30], 10],
  ];
  it.each(table)("scores %j give %i", (scores, modifier) => {
    for (const score of scores) expect(abilityModifier(score)).toBe(modifier);
  });

  it("covers every score from 1 to 30", () => {
    expect(table.flatMap(([scores]) => scores)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it.each([0, 31, -1, 10.5, Number.NaN])("rejects %s", (score) => {
    expect(() => abilityModifier(score)).toThrow(RangeError);
  });
});

describe("proficiencyBonus", () => {
  // SRD 5.1, "Character Advancement" table.
  const table: [levels: number[], bonus: number][] = [
    [[1, 2, 3, 4], 2],
    [[5, 6, 7, 8], 3],
    [[9, 10, 11, 12], 4],
    [[13, 14, 15, 16], 5],
    [[17, 18, 19, 20], 6],
  ];
  it.each(table)("levels %j give +%i", (levels, bonus) => {
    for (const level of levels) expect(proficiencyBonus(level)).toBe(bonus);
  });

  it.each([0, 21, 1.5])("rejects level %s", (level) => {
    expect(() => proficiencyBonus(level)).toThrow(RangeError);
  });
});

describe("constants", () => {
  it("has six abilities and eighteen skills", () => {
    expect(ABILITIES).toHaveLength(6);
    expect(SKILLS).toHaveLength(18);
  });

  it("formats modifiers with a sign", () => {
    expect(formatModifier(3)).toBe("+3");
    expect(formatModifier(0)).toBe("+0");
    expect(formatModifier(-2)).toBe("−2");
  });
});
