import { ABILITIES, CONDITIONS, HEALTH_BANDS, MAX_ABILITY_SCORE, MAX_LEVEL, ROLL_MODES, SKILLS } from "@lanternkeep/rules";
import { z } from "zod";

export const LIMITS = {
  displayName: 32,
  roomName: 60,
  chat: 2000,
  narration: 8000,
  label: 80,
  notes: 8000,
  maxHp: 9999,
  monstersPerAdd: 20,
} as const;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const Id = z.string().min(1).max(64);
export const DisplayName = trimmed(LIMITS.displayName);
export const RoomName = trimmed(LIMITS.roomName);

export const AbilitySchema = z.enum(ABILITIES);
export const SkillSchema = z.enum(SKILLS as [(typeof SKILLS)[number], ...(typeof SKILLS)[number][]]);
export const ConditionSchema = z.enum(CONDITIONS);
export const RollModeSchema = z.enum(ROLL_MODES);
export const HealthBandSchema = z.enum(HEALTH_BANDS);

export const HitPointsSchema = z.strictObject({
  current: z.int().min(0).max(LIMITS.maxHp),
  max: z.int().min(1).max(LIMITS.maxHp),
  temp: z.int().min(0).max(LIMITS.maxHp),
});

export const CheckSpecSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ability"), ability: AbilitySchema }),
  z.strictObject({ kind: z.literal("skill"), skill: SkillSchema, ability: AbilitySchema.optional() }),
  z.strictObject({ kind: z.literal("save"), ability: AbilitySchema }),
]);

const AbilityScore = z.int().min(1).max(MAX_ABILITY_SCORE);

/** What a player types into the sheet. Everything else on a character is derived or tracked. */
export const CharacterSheetSchema = z.strictObject({
  name: trimmed(60),
  race: z.string().trim().max(60),
  className: z.string().trim().max(60),
  level: z.int().min(1).max(MAX_LEVEL),
  abilities: z.strictObject({
    str: AbilityScore,
    dex: AbilityScore,
    con: AbilityScore,
    int: AbilityScore,
    wis: AbilityScore,
    cha: AbilityScore,
  }),
  saveProficiencies: z
    .array(AbilitySchema)
    .max(ABILITIES.length)
    .refine((list) => new Set(list).size === list.length, "Duplicate saving throw proficiency"),
  skillProficiencies: z.partialRecord(SkillSchema, z.enum(["proficient", "expertise"])),
  maxHp: z.int().min(1).max(LIMITS.maxHp),
  armorClass: z.int().min(0).max(99),
  speed: z.int().min(0).max(999),
  notes: z.string().max(LIMITS.notes),
});
export type CharacterSheet = z.infer<typeof CharacterSheetSchema>;

export const CharacterSchema = z.strictObject({
  id: Id,
  ownerId: Id,
  sheet: CharacterSheetSchema,
  hp: HitPointsSchema,
  conditions: z.array(ConditionSchema),
});
export type Character = z.infer<typeof CharacterSchema>;

export const PcCombatantSchema = z.strictObject({
  kind: z.literal("pc"),
  id: Id,
  name: z.string(),
  initiative: z.int(),
  characterId: Id,
});

/**
 * A creature run by the DM. When `hidden` is true, players get `band` but not
 * `hp`, `armorClass` or `srdIndex`; those travel in the event's DM-only part.
 */
export const NpcCombatantSchema = z.strictObject({
  kind: z.literal("npc"),
  id: Id,
  name: z.string(),
  initiative: z.int(),
  hidden: z.boolean(),
  band: HealthBandSchema,
  conditions: z.array(ConditionSchema),
  hp: HitPointsSchema.optional(),
  armorClass: z.int().optional(),
  srdIndex: z.string().optional(),
});

export const CombatantSchema = z.discriminatedUnion("kind", [PcCombatantSchema, NpcCombatantSchema]);
export type PcCombatant = z.infer<typeof PcCombatantSchema>;
export type NpcCombatant = z.infer<typeof NpcCombatantSchema>;
export type Combatant = z.infer<typeof CombatantSchema>;

export const NpcSecretsSchema = z.strictObject({
  hp: HitPointsSchema,
  armorClass: z.int().optional(),
  srdIndex: z.string().optional(),
});

export const HpTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("character"), characterId: Id }),
  z.strictObject({ kind: z.literal("combatant"), combatantId: Id }),
]);
export type HpTarget = z.infer<typeof HpTargetSchema>;

export const HpChangeSchema = z.strictObject({
  op: z.enum(["damage", "heal", "set", "temp"]),
  amount: z.int().min(0).max(LIMITS.maxHp),
});
export type HpChange = z.infer<typeof HpChangeSchema>;

/** Who is sitting in the DM seat. The AI controller arrives with the AI DM. */
export const DmControllerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("human"), playerId: Id }),
  z.strictObject({ kind: z.literal("ai") }),
]);
export type DmController = z.infer<typeof DmControllerSchema>;

export const WhisperTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("dm") }),
  z.strictObject({ kind: z.literal("player"), playerId: Id }),
]);
export type WhisperTarget = z.infer<typeof WhisperTargetSchema>;

const DieResultSchema = z.strictObject({ value: z.int(), kept: z.boolean() });
const KeepSchema = z.strictObject({ which: z.enum(["highest", "lowest"]), count: z.int() });
const Sign = z.union([z.literal(1), z.literal(-1)]);

export const RollResultSchema = z.strictObject({
  expression: z.string(),
  mode: RollModeSchema,
  terms: z.array(
    z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("dice"),
        sign: Sign,
        count: z.int(),
        sides: z.int(),
        keep: KeepSchema.optional(),
        dice: z.array(DieResultSchema),
        subtotal: z.int(),
      }),
      z.strictObject({ kind: z.literal("constant"), sign: Sign, value: z.int(), subtotal: z.int() }),
    ]),
  ),
  total: z.int(),
});

export const D20RollSchema = z.strictObject({
  mode: RollModeSchema,
  d20s: z.array(z.int().min(1).max(20)).min(1).max(2),
  natural: z.int().min(1).max(20),
  modifier: z.int(),
  total: z.int(),
});
export type D20Roll = z.infer<typeof D20RollSchema>;
