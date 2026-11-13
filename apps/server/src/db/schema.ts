import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    /** SHA-256 of the guest token. The token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("players_room_idx").on(t.roomId)],
);

/** The room's append-only log: narrative feed, save file and reconnect source in one. */
export const events = sqliteTable(
  "events",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    at: integer("at").notNull(),
    type: text("type").notNull(),
    /** The complete event as JSON, including its DM-only part. */
    data: text("data").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.seq] })],
);
