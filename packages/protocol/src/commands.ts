import { z } from "zod";
import {
  CharacterSheetSchema,
  CheckSpecSchema,
  ConditionSchema,
  HpChangeSchema,
  HpTargetSchema,
  Id,
  LIMITS,
  RollModeSchema,
  WhisperTargetSchema,
} from "./model";

const text = (max: number) => z.string().trim().min(1).max(max);
const cmd = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ type: z.literal(type), ...shape });

/**
 * Commands any seated participant may send. The server still checks ownership
 * (for example, only a character's owner or the DM may edit it).
 */
export const PLAYER_COMMANDS = [
  cmd("chat", { text: text(LIMITS.chat), to: WhisperTargetSchema.optional() }),
  cmd("roll", {
    expression: z.string().min(1).max(100),
    mode: RollModeSchema.default("normal"),
    label: z.string().trim().max(LIMITS.label).optional(),
    /** DM only: the roll is visible to the DM alone. */
    secret: z.boolean().default(false),
  }),
  cmd("roll_check", {
    characterId: Id,
    check: CheckSpecSchema,
    mode: RollModeSchema.default("normal"),
    /** Set when answering a DM's request; the server then resolves it against the request's DC. */
    requestId: Id.optional(),
  }),
  cmd("create_character", { sheet: CharacterSheetSchema }),
  cmd("update_character", { characterId: Id, sheet: CharacterSheetSchema }),
  cmd("delete_character", { characterId: Id }),
  cmd("adjust_hp", { target: HpTargetSchema, change: HpChangeSchema }),
  cmd("set_condition", { target: HpTargetSchema, condition: ConditionSchema, active: z.boolean() }),
  /** Rolls initiative for the character and adds it to the running encounter. */
  cmd("join_encounter", { characterId: Id, mode: RollModeSchema.default("normal") }),
  cmd("claim_dm_seat", {}),
  cmd("release_dm_seat", {}),
] as const;

/**
 * Commands of the DM seat. A human DM sends them from the UI; the AI DM will
 * call the same set as tools.
 */
export const DM_COMMANDS = [
  cmd("narrate", { text: text(LIMITS.narration) }),
  cmd("request_check", {
    characterIds: z.array(Id).min(1).max(20),
    check: CheckSpecSchema,
    dc: z.int().min(1).max(40).optional(),
    note: z.string().trim().max(LIMITS.label).optional(),
  }),
  cmd("dismiss_check", { requestId: Id }),
  cmd("start_encounter", {}),
  cmd("end_encounter", {}),
  cmd("add_combatant", {
    name: text(60),
    /** Fixed initiative. When absent the server rolls d20 + initiativeBonus. */
    initiative: z.int().min(-20).max(99).optional(),
    initiativeBonus: z.int().min(-20).max(40).default(0),
    maxHp: z.int().min(1).max(LIMITS.maxHp),
    armorClass: z.int().min(0).max(99).optional(),
    /** Keep exact hit points and AC from the players. */
    hidden: z.boolean().default(true),
  }),
  cmd("add_monster", {
    srdIndex: z.string().min(1).max(80),
    count: z.int().min(1).max(LIMITS.monstersPerAdd).default(1),
    name: z.string().trim().min(1).max(60).optional(),
    hidden: z.boolean().default(true),
  }),
  cmd("remove_combatant", { combatantId: Id }),
  cmd("set_initiative", { combatantId: Id, initiative: z.int().min(-20).max(99) }),
  cmd("next_turn", {}),
] as const;

export const CommandSchema = z.discriminatedUnion("type", [...PLAYER_COMMANDS, ...DM_COMMANDS]);
/** A command after validation, with defaults filled in. */
export type Command = z.infer<typeof CommandSchema>;
/** A command as a client writes it, defaults optional. */
export type CommandInput = z.input<typeof CommandSchema>;
export type CommandType = Command["type"];
export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;

export const DM_COMMAND_TYPES: ReadonlySet<CommandType> = new Set(DM_COMMANDS.map((c) => c.shape.type.value));
