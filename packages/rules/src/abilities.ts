export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];
export type AbilityScores = Record<Ability, number>;

export const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

/** Skill ids match the SRD dataset's `index` values. */
export const SKILL_ABILITIES = {
  acrobatics: "dex",
  "animal-handling": "wis",
  arcana: "int",
  athletics: "str",
  deception: "cha",
  history: "int",
  insight: "wis",
  intimidation: "cha",
  investigation: "int",
  medicine: "wis",
  nature: "int",
  perception: "wis",
  performance: "cha",
  persuasion: "cha",
  religion: "int",
  "sleight-of-hand": "dex",
  stealth: "dex",
  survival: "wis",
} as const satisfies Record<string, Ability>;

export type Skill = keyof typeof SKILL_ABILITIES;
export const SKILLS = Object.keys(SKILL_ABILITIES) as Skill[];

export const SKILL_NAMES: Record<Skill, string> = {
  acrobatics: "Acrobatics",
  "animal-handling": "Animal Handling",
  arcana: "Arcana",
  athletics: "Athletics",
  deception: "Deception",
  history: "History",
  insight: "Insight",
  intimidation: "Intimidation",
  investigation: "Investigation",
  medicine: "Medicine",
  nature: "Nature",
  perception: "Perception",
  performance: "Performance",
  persuasion: "Persuasion",
  religion: "Religion",
  "sleight-of-hand": "Sleight of Hand",
  stealth: "Stealth",
  survival: "Survival",
};

export const MIN_ABILITY_SCORE = 1;
export const MAX_ABILITY_SCORE = 30;
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 20;

/** Ability modifier: subtract 10 from the score, divide by 2, round down. */
export function abilityModifier(score: number): number {
  if (!Number.isInteger(score) || score < MIN_ABILITY_SCORE || score > MAX_ABILITY_SCORE) {
    throw new RangeError(`Ability score must be an integer from ${MIN_ABILITY_SCORE} to ${MAX_ABILITY_SCORE}, got ${score}`);
  }
  return Math.floor((score - 10) / 2);
}

/** Proficiency bonus by total character level: +2 at 1st, rising by 1 every 4 levels. */
export function proficiencyBonus(level: number): number {
  if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
    throw new RangeError(`Level must be an integer from ${MIN_LEVEL} to ${MAX_LEVEL}, got ${level}`);
  }
  return 2 + Math.floor((level - 1) / 4);
}

export function formatModifier(modifier: number): string {
  return modifier >= 0 ? `+${modifier}` : `−${Math.abs(modifier)}`;
}
