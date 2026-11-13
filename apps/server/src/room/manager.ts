import { customAlphabet } from "nanoid";
import { CommandError } from "./errors";
import type { CommandContext } from "./handlers";
import { Room } from "./room";
import type { RoomStore, StoredPlayer } from "./store";

/** No look-alike characters, so an invite code survives being read aloud. */
const roomId = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 12);
const shortId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
export const newId = (): string => shortId();

export const MAX_PLAYERS_PER_ROOM = 12;
const IDLE_EVICT_MS = 10 * 60_000;

export interface Seat {
  roomId: string;
  roomName: string;
  playerId: string;
  token: string;
}

/** Owns the live rooms: creates them, loads them from the log on demand, and drops idle ones from memory. */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly store: RoomStore,
    private readonly context: CommandContext,
    private readonly now: () => number = Date.now,
  ) {}

  create(input: { roomName: string; displayName: string; asDm: boolean }): Seat {
    const id = roomId();
    const createdAt = this.now();
    this.store.createRoom({ id, name: input.roomName, createdAt });
    const room = new Room(id, [], { store: this.store, context: this.context, now: this.now });
    this.rooms.set(id, room);
    room.append({ kind: "system" }, [{ type: "room_created", payload: { name: input.roomName } }]);
    const seat = this.seat(room, input.displayName);
    if (input.asDm) room.execute({ kind: "player", playerId: seat.playerId }, { type: "claim_dm_seat" });
    return seat;
  }

  join(id: string, displayName: string): Seat {
    const room = this.get(id) ?? this.missing();
    if (this.store.countPlayers(id) >= MAX_PLAYERS_PER_ROOM) throw new CommandError("conflict", "This room is full");
    return this.seat(room, displayName);
  }

  /** The live room, loaded from its event log if it is not in memory. */
  get(id: string): Room | undefined {
    const live = this.rooms.get(id);
    if (live) return live;
    if (!this.store.findRoom(id)) return undefined;
    const room = new Room(id, this.store.loadEvents(id), { store: this.store, context: this.context, now: this.now });
    this.rooms.set(id, room);
    return room;
  }

  /** The player a token belongs to, if it is a seat in this room. */
  authenticate(id: string, token: string): StoredPlayer | undefined {
    const player = this.store.findPlayerByToken(token);
    return player && player.roomId === id ? player : undefined;
  }

  /** Forgets rooms nobody is connected to. Their log stays on disk and reloads on the next visit. */
  evictIdle(): number {
    const cutoff = this.now() - IDLE_EVICT_MS;
    let evicted = 0;
    for (const [id, room] of this.rooms) {
      if (room.connectionCount === 0 && room.lastActiveAt < cutoff) {
        this.rooms.delete(id);
        evicted += 1;
      }
    }
    return evicted;
  }

  /** Drops a room from memory regardless of activity. For tests and maintenance. */
  unload(id: string): void {
    this.rooms.delete(id);
  }

  private seat(room: Room, displayName: string): Seat {
    const playerId = newId();
    const token = this.store.createPlayer({ id: playerId, roomId: room.id, displayName, createdAt: this.now() });
    room.append({ kind: "player", playerId }, [{ type: "player_joined", payload: { playerId, displayName } }]);
    return { roomId: room.id, roomName: room.snapshot.name, playerId, token };
  }

  private missing(): never {
    throw new CommandError("not_found", "No such room");
  }
}
