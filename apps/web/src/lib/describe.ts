import type { HpChange } from "@lanternkeep/protocol";
import { ABILITY_NAMES, type CheckSpec, SKILL_ABILITIES, SKILL_NAMES } from "@lanternkeep/rules";

export function describeCheck(check: CheckSpec): string {
  switch (check.kind) {
    case "ability":
      return `${ABILITY_NAMES[check.ability]} check`;
    case "save":
      return `${ABILITY_NAMES[check.ability]} saving throw`;
    case "skill": {
      const unusual = check.ability !== undefined && check.ability !== SKILL_ABILITIES[check.skill];
      return `${SKILL_NAMES[check.skill]}${unusual && check.ability ? ` (${ABILITY_NAMES[check.ability]})` : ""} check`;
    }
  }
}

export function describeHpChange(name: string, change: HpChange): string {
  switch (change.op) {
    case "damage":
      return `${name} takes ${change.amount} damage`;
    case "heal":
      return `${name} regains ${change.amount} hit points`;
    case "set":
      return `${name}'s hit points are set to ${change.amount}`;
    case "temp":
      return change.amount === 0 ? `${name} loses their temporary hit points` : `${name} gains ${change.amount} temporary hit points`;
  }
}

export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "nobody";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export const formatHp = (hp: { current: number; max: number; temp: number }): string =>
  `${hp.current}/${hp.max}${hp.temp > 0 ? ` +${hp.temp}` : ""}`;
