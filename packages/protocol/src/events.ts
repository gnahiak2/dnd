import { z } from "zod";
import {
  CharacterSchema,
  CheckSpecSchema,
  CombatantSchema,
  ConditionSchema,
  D20RollSchema,
  DmControllerSchema,
  HealthBandSchema,
  HitPointsSchema,
  HpChangeSchema,
  HpTargetSchema,
  Id,
  NpcSecretsSchema,
  RollResultSchema,
  WhisperTargetSchema,
} from "./model";

export const ActorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("player"), playerId: Id }),
  z.strictObject({ kind: z.literal("ai") }),
  z.strictObject({ kind: z.literal("system") }),
]);
export type Actor = z.infer<typeof ActorSchema>;

/**
 * Who may receive an event at all. The DM seat always receives everything.
 * Independently of this, an event's `secret` part is only ever sent to the DM.
 */
export const VisibilitySchema = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("public") }),
  z.strictObject({ scope: z.literal("dm") }),
  z.strictObject({ scope: z.literal("players"), playerIds: z.array(Id) }),
]);
export type Visibility = z.infer<typeof VisibilitySchema>;

const envelope = {
  seq: z.int().min(1),
  at: z.number(),
  actor: ActorSchema,
  visibility: VisibilitySchema,
};

const ev = <T extends string, P extends z.ZodType, S extends z.ZodType = z.ZodNever>(type: T, payload: P, secret?: S) =>
  z.strictObject({
    ...envelope,
    type: z.literal(type),
    payload,
    secret: (secret ?? z.never()).optional() as z.ZodOptional<S>,
  });

const o = z.strictObject;

export const EVENT_SCHEMAS = [
  ev("room_created", o({ name: z.string() })),
  ev("player_joined", o({ playerId: Id, displayName: z.string() })),
  ev("dm_seat_changed", o({ controller: DmControllerSchema.nullable() })),

  ev("chat", o({ text: z.string(), to: WhisperTargetSchema.optional() })),
  ev("narration", o({ text: z.string() })),
  ev("roll", o({ label: z.string().optional(), result: RollResultSchema })),

  ev(
    "check_requested",
    o({ requestId: Id, characterIds: z.array(Id), check: CheckSpecSchema, note: z.string().optional() }),
    o({ dc: z.int() }),
  ),
  ev("check_dismissed", o({ requestId: Id })),
  ev(
    "check_rolled",
    o({
      characterId: Id,
      check: CheckSpecSchema,
      roll: D20RollSchema,
      requestId: Id.optional(),
      /** Present when the roll answered a request that had a DC. */
      outcome: z.enum(["success", "failure"]).optional(),
    }),
    o({ dc: z.int() }),
  ),

  ev("character_created", o({ character: CharacterSchema })),
  ev("character_updated", o({ character: CharacterSchema })),
  ev("character_deleted", o({ characterId: Id })),

  /** For a hidden creature, `hp` and `change` move to the secret part and players see only `band`. */
  ev(
    "hp_changed",
    o({ target: HpTargetSchema, band: HealthBandSchema, hp: HitPointsSchema.optional(), change: HpChangeSchema.optional() }),
    o({ hp: HitPointsSchema, change: HpChangeSchema }),
  ),
  ev("condition_set", o({ target: HpTargetSchema, condition: ConditionSchema, active: z.boolean() })),

  ev("encounter_started", o({ encounterId: Id })),
  ev("encounter_ended", o({})),
  ev("combatant_added", o({ combatant: CombatantSchema }), NpcSecretsSchema),
  ev("combatant_removed", o({ combatantId: Id })),
  ev("initiative_set", o({ combatantId: Id, initiative: z.int() })),
  ev("turn_advanced", o({ round: z.int().min(1), combatantId: Id })),
] as const;

export const RoomEventSchema = z.discriminatedUnion("type", [...EVENT_SCHEMAS]);
export type RoomEvent = z.infer<typeof RoomEventSchema>;
export type EventType = RoomEvent["type"];
export type EventOf<T extends EventType> = Extract<RoomEvent, { type: T }>;

type DraftOf<E> = E extends RoomEvent ? Omit<E, "seq" | "at" | "actor" | "visibility"> & { visibility?: Visibility } : never;
/** An event before the room stamps it with seq, time and actor. Visibility defaults to public. */
export type EventDraft = DraftOf<RoomEvent>;

export const PUBLIC: Visibility = { scope: "public" };
export const DM_ONLY: Visibility = { scope: "dm" };
