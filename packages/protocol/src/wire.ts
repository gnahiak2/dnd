import { z } from "zod";
import { CommandSchema } from "./commands";
import { RoomEventSchema } from "./events";
import { DisplayName, Id, RoomName } from "./model";

// ---- HTTP ----

export const CreateRoomRequestSchema = z.strictObject({
  roomName: RoomName,
  displayName: DisplayName,
  /** Take the DM seat on creation. */
  asDm: z.boolean().default(true),
});
export type CreateRoomRequest = z.input<typeof CreateRoomRequestSchema>;

export const JoinRoomRequestSchema = z.strictObject({ displayName: DisplayName });
export type JoinRoomRequest = z.input<typeof JoinRoomRequestSchema>;

/** `token` is the guest's only credential for the room. The server keeps a hash, never the token. */
export const SeatResponseSchema = z.strictObject({ roomId: Id, roomName: z.string(), playerId: Id, token: z.string() });
export type SeatResponse = z.infer<typeof SeatResponseSchema>;

export const RoomInfoSchema = z.strictObject({ roomId: Id, name: z.string(), playerCount: z.int() });
export type RoomInfo = z.infer<typeof RoomInfoSchema>;

export const ApiErrorSchema = z.strictObject({ error: z.strictObject({ code: z.string(), message: z.string() }) });

export const SrdHitSchema = z.strictObject({
  category: z.string(),
  index: z.string(),
  name: z.string(),
  /** One line that tells entries apart in a result list, e.g. "3rd-level evocation". */
  summary: z.string(),
});
export type SrdHit = z.infer<typeof SrdHitSchema>;

// ---- WebSocket ----

export const ERROR_CODES = ["invalid", "forbidden", "not_found", "conflict", "unauthorized", "rate_limited", "internal"] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ClientMessageSchema = z.discriminatedUnion("type", [
  /** First message on every connection. `afterSeq` is the last event the client already holds. */
  z.strictObject({ type: z.literal("hello"), token: z.string().min(1).max(200), afterSeq: z.int().min(0) }),
  /** `id` is echoed in the ack or reject so the client can match replies. */
  z.strictObject({ type: z.literal("command"), id: z.string().min(1).max(64), command: CommandSchema }),
]);
export type ClientMessage = z.input<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  /**
   * Reply to hello, and sent again whenever the viewer's rights change (the DM
   * seat moved). With `reset`, the client drops its state and replays `events`
   * from the start; otherwise it applies them on top of what it has.
   */
  z.strictObject({
    type: z.literal("welcome"),
    playerId: Id,
    reset: z.boolean(),
    events: z.array(RoomEventSchema),
    online: z.array(Id),
  }),
  z.strictObject({ type: z.literal("event"), event: RoomEventSchema }),
  z.strictObject({ type: z.literal("presence"), online: z.array(Id) }),
  z.strictObject({ type: z.literal("ack"), id: z.string() }),
  z.strictObject({ type: z.literal("reject"), id: z.string(), code: z.enum(ERROR_CODES), message: z.string() }),
  /** The connection is about to be closed and reconnecting will not help. */
  z.strictObject({ type: z.literal("fatal"), code: z.enum(ERROR_CODES), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
