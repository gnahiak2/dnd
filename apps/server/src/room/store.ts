import { createHash, randomBytes } from "node:crypto";
import type { RoomEvent } from "@lanternkeep/protocol";
import { asc, count, eq } from "drizzle-orm";
import type { Db } from "../db";
import { events, players, rooms } from "../db/schema";

export interface StoredPlayer {
  id: string;
  roomId: string;
  displayName: string;
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** All persistence for rooms. Synchronous, like the SQLite driver underneath. */
export class RoomStore {
  constructor(private readonly db: Db) {}

  createRoom(room: { id: string; name: string; createdAt: number }): void {
    this.db.insert(rooms).values(room).run();
  }

  findRoom(id: string): { id: string; name: string } | undefined {
    return this.db.select({ id: rooms.id, name: rooms.name }).from(rooms).where(eq(rooms.id, id)).get();
  }

  /** Creates a guest seat and returns its one-time-visible token. */
  createPlayer(player: StoredPlayer & { createdAt: number }): string {
    const token = randomBytes(32).toString("base64url");
    this.db.insert(players).values({ ...player, tokenHash: hashToken(token) }).run();
    return token;
  }

  findPlayerByToken(token: string): StoredPlayer | undefined {
    return this.db
      .select({ id: players.id, roomId: players.roomId, displayName: players.displayName })
      .from(players)
      .where(eq(players.tokenHash, hashToken(token)))
      .get();
  }

  countPlayers(roomId: string): number {
    return this.db.select({ n: count() }).from(players).where(eq(players.roomId, roomId)).get()?.n ?? 0;
  }

  /** Appends atomically: either every event is stored or none is. */
  appendEvents(roomId: string, batch: readonly RoomEvent[]): void {
    if (batch.length === 0) return;
    this.db.transaction((tx) => {
      for (const event of batch) {
        tx.insert(events)
          .values({ roomId, seq: event.seq, at: event.at, type: event.type, data: JSON.stringify(event) })
          .run();
      }
    });
  }

  loadEvents(roomId: string): RoomEvent[] {
    return this.db
      .select({ data: events.data })
      .from(events)
      .where(eq(events.roomId, roomId))
      .orderBy(asc(events.seq))
      .all()
      .map((row) => JSON.parse(row.data) as RoomEvent);
  }
}
