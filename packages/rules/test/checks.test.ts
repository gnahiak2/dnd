import { describe, expect, it } from "vitest";
import {
  type CheckStats,
  applyDamage,
  applyHealing,
  checkModifier,
  healthBand,
  initiativeModifier,
  passivePerception,
  passiveScore,
  rollD20Test,
  savingThrowModifier,
  scriptedRoller,
  setCurrentHp,
  setTempHp,
  skillModifier,
} from "../src";

// A 5th-level rogue: proficiency bonus +3.
const rogue: CheckStats = {
  level: 5,
  abilities: { str: 8, dex: 16, con: 12, int: 14, wis: 9, cha: 10 },
  saveProficiencies: ["dex", "int"],
  skillProficiencies: { stealth: "expertise", acrobatics: "proficient" },
};

describe("modifiers", () => {
  it("adds the proficiency bonus to proficient skills and doubles it for expertise", () => {
    expect(skillModifier(rogue, "athletics")).toBe(-1);
    expect(skillModifier(rogue, "acrobatics")).toBe(3 + 3);
    expect(skillModifier(rogue, "stealth")).toBe(3 + 6);
  });

  it("can use a different ability for a skill", () => {
    // Variant rule: Strength (Intimidation) instead of Charisma.
    expect(skillModifier(rogue, "intimidation")).toBe(0);
    expect(skillModifier(rogue, "intimidation", "str")).toBe(-1);
  });

  it("adds the proficiency bonus only to proficient saves", () => {
    expect(savingThrowModifier(rogue, "dex")).toBe(6);
    expect(savingThrowModifier(rogue, "int")).toBe(5);
    expect(savingThrowModifier(rogue, "wis")).toBe(-1);
  });

  it("resolves a check spec", () => {
    expect(checkModifier(rogue, { kind: "ability", ability: "dex" })).toBe(3);
    expect(checkModifier(rogue, { kind: "skill", skill: "stealth" })).toBe(9);
    expect(checkModifier(rogue, { kind: "save", ability: "dex" })).toBe(6);
  });

  it("initiative is a Dexterity check", () => {
    expect(initiativeModifier(rogue)).toBe(3);
  });

  it("passive scores are 10 + modifier, with 5 either way for advantage and disadvantage", () => {
    // SRD example: a 1st-level character with Wisdom 15 and Perception proficiency has passive Perception 14.
    const example: CheckStats = {
      level: 1,
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 15, cha: 10 },
      saveProficiencies: [],
      skillProficiencies: { perception: "proficient" },
    };
    expect(passivePerception(example)).toBe(14);
    expect(passivePerception(rogue)).toBe(9);
    expect(passiveScore(4, "advantage")).toBe(19);
    expect(passiveScore(4, "disadvantage")).toBe(9);
  });
});

describe("rollD20Test", () => {
  it("meets the DC on a tie", () => {
    expect(rollD20Test({ modifier: 5, dc: 15 }, scriptedRoller([10]))).toMatchObject({ total: 15, success: true, d20s: [10] });
    expect(rollD20Test({ modifier: 5, dc: 15 }, scriptedRoller([9]))).toMatchObject({ total: 14, success: false });
  });

  it("reports no outcome without a DC", () => {
    expect(rollD20Test({ modifier: 2 }, scriptedRoller([11])).success).toBeUndefined();
  });

  it("uses the higher die with advantage and the lower with disadvantage", () => {
    expect(rollD20Test({ modifier: 0, mode: "advantage" }, scriptedRoller([4, 17]))).toMatchObject({ natural: 17, d20s: [4, 17] });
    expect(rollD20Test({ modifier: 0, mode: "disadvantage" }, scriptedRoller([4, 17]))).toMatchObject({ natural: 4 });
  });

  it("gives a natural 20 or 1 no automatic result on checks and saves", () => {
    expect(rollD20Test({ modifier: -2, dc: 25 }, scriptedRoller([20])).success).toBe(false);
    expect(rollD20Test({ modifier: 12, dc: 10 }, scriptedRoller([1])).success).toBe(true);
  });
});

describe("hit points", () => {
  it("takes damage from temporary hit points first", () => {
    // SRD example: 5 temporary hit points and 7 damage: lose the temporary hit points, then take 2.
    expect(applyDamage({ current: 20, max: 20, temp: 5 }, 7)).toEqual({ current: 18, max: 20, temp: 0 });
    expect(applyDamage({ current: 20, max: 20, temp: 5 }, 3)).toEqual({ current: 20, max: 20, temp: 2 });
  });

  it("never drops below zero", () => {
    expect(applyDamage({ current: 4, max: 20, temp: 0 }, 50)).toEqual({ current: 0, max: 20, temp: 0 });
  });

  it("healing stops at the maximum and does not touch temporary hit points", () => {
    expect(applyHealing({ current: 15, max: 20, temp: 3 }, 10)).toEqual({ current: 20, max: 20, temp: 3 });
    expect(applyHealing({ current: 0, max: 20, temp: 0 }, 6)).toEqual({ current: 6, max: 20, temp: 0 });
  });

  it("temporary hit points replace rather than add", () => {
    expect(setTempHp({ current: 10, max: 20, temp: 5 }, 8).temp).toBe(8);
  });

  it("setting hit points is capped at the maximum", () => {
    expect(setCurrentHp({ current: 10, max: 20, temp: 0 }, 99).current).toBe(20);
  });

  it.each([-1, 1.5, Number.NaN])("rejects amount %s", (amount) => {
    expect(() => applyDamage({ current: 10, max: 10, temp: 0 }, amount)).toThrow(RangeError);
    expect(() => applyHealing({ current: 10, max: 10, temp: 0 }, amount)).toThrow(RangeError);
  });

  it.each([
    [20, 20, "healthy"],
    [11, 20, "healthy"],
    [10, 20, "bloodied"],
    [1, 20, "bloodied"],
    [0, 20, "down"],
    [4, 7, "healthy"],
    [3, 7, "bloodied"],
  ] as const)("%i of %i is %s", (current, max, band) => {
    expect(healthBand({ current, max, temp: 0 })).toBe(band);
  });
});
