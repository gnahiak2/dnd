import {
  type Ability,
  type AbilityScores,
  type Skill,
  SKILL_ABILITIES,
  abilityModifier,
  proficiencyBonus,
} from "./abilities";
import type { RollMode } from "./dice";
import type { DieRoller } from "./roller";

export type SkillProficiency = "proficient" | "expertise";

/** The part of a character the d20 tests need. */
export interface CheckStats {
  level: number;
  abilities: AbilityScores;
  saveProficiencies: readonly Ability[];
  skillProficiencies: Partial<Record<Skill, SkillProficiency>>;
}

export type CheckSpec =
  | { kind: "ability"; ability: Ability }
  /** `ability` overrides the skill's usual ability (the "skills with different abilities" variant). */
  | { kind: "skill"; skill: Skill; ability?: Ability }
  | { kind: "save"; ability: Ability };

export function skillModifier(stats: CheckStats, skill: Skill, ability: Ability = SKILL_ABILITIES[skill]): number {
  const proficiency = stats.skillProficiencies[skill];
  const multiplier = proficiency === "expertise" ? 2 : proficiency === "proficient" ? 1 : 0;
  return abilityModifier(stats.abilities[ability]) + multiplier * proficiencyBonus(stats.level);
}

export function savingThrowModifier(stats: CheckStats, ability: Ability): number {
  const proficient = stats.saveProficiencies.includes(ability);
  return abilityModifier(stats.abilities[ability]) + (proficient ? proficiencyBonus(stats.level) : 0);
}

export function checkModifier(stats: CheckStats, spec: CheckSpec): number {
  switch (spec.kind) {
    case "ability":
      return abilityModifier(stats.abilities[spec.ability]);
    case "skill":
      return skillModifier(stats, spec.skill, spec.ability);
    case "save":
      return savingThrowModifier(stats, spec.ability);
  }
}

/** Initiative is a Dexterity check. */
export function initiativeModifier(stats: Pick<CheckStats, "abilities">): number {
  return abilityModifier(stats.abilities.dex);
}

/** Passive score: 10 + modifiers, +5 with advantage, -5 with disadvantage. */
export function passiveScore(modifier: number, mode: RollMode = "normal"): number {
  return 10 + modifier + (mode === "advantage" ? 5 : mode === "disadvantage" ? -5 : 0);
}

export function passivePerception(stats: CheckStats, mode: RollMode = "normal"): number {
  return passiveScore(skillModifier(stats, "perception"), mode);
}

export interface D20TestResult {
  mode: RollMode;
  /** Every d20 rolled, in order: one normally, two with (dis)advantage. */
  d20s: number[];
  /** The die that counts. */
  natural: number;
  modifier: number;
  total: number;
  dc?: number;
  /** Present only when a DC was given. A total equal to the DC succeeds. */
  success?: boolean;
}

/**
 * Ability check or saving throw: d20 + modifier against a DC. A natural 1 or
 * 20 has no special effect here; that rule belongs to attack rolls.
 */
export function rollD20Test(
  input: { modifier: number; mode?: RollMode; dc?: number },
  roller: DieRoller,
): D20TestResult {
  const mode = input.mode ?? "normal";
  const d20s = mode === "normal" ? [roller.roll(20)] : [roller.roll(20), roller.roll(20)];
  const natural = mode === "advantage" ? Math.max(...d20s) : Math.min(...d20s);
  const total = natural + input.modifier;
  const result: D20TestResult = { mode, d20s, natural, modifier: input.modifier, total };
  if (input.dc !== undefined) {
    result.dc = input.dc;
    result.success = total >= input.dc;
  }
  return result;
}
