import {
  type Actor,
  type Command,
  type EventDraft,
  PUBLIC,
  type RoomEvent,
  RoomEventSchema,
  type RoomState,
  type ServerMessage,
  type Viewer,
  initialRoomState,
  isDm,
  redactEvent,
  reduce,
} from "@lanternkeep/protocol";
import { type CommandContext, handleCommand } from "./handlers";
import type { RoomStore } from "./store";

export interface Connection {
  readonly playerId: string;
  send(message: ServerMessage): void;
}

export interface RoomDeps {
  store: RoomStore;
  context: CommandContext;
  now: () => number;
}

/**
 * One live room: the authoritative state, the full event log, and the sockets
 * watching it. Everything here is synchronous, so commands are applied one at
 * a time in arrival order without locks.
 */
export class Room {
  private state: RoomState = initialRoomState();
  private readonly events: RoomEvent[] = [];
  private readonly connections = new Set<Connection>();
  /** Seq of the last DM seat change; clients holding older state must replay from scratch. */
  private seatChangedAt = 0;
  lastActiveAt: number;

  constructor(
    readonly id: string,
    history: readonly RoomEvent[],
    private readonly deps: RoomDeps,
  ) {
    for (const event of history) this.applyLocally(event);
    this.lastActiveAt = deps.now();
  }

  get snapshot(): RoomState {
    return this.state;
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  online(): string[] {
    return [...new Set([...this.connections].map((c) => c.playerId))];
  }

  /** Runs a command for an actor. Throws CommandError when it is refused. */
  execute(actor: Actor, command: Command): RoomEvent[] {
    return this.append(actor, handleCommand(this.state, actor, command, this.deps.context));
  }

  /** Stamps, validates, persists and broadcasts events. Nothing is applied unless all of them are stored. */
  append(actor: Actor, drafts: readonly EventDraft[]): RoomEvent[] {
    if (drafts.length === 0) return [];
    const at = this.deps.now();
    const batch = drafts.map((draft, i) =>
      RoomEventSchema.parse({ ...draft, seq: this.state.seq + i + 1, at, actor, visibility: draft.visibility ?? PUBLIC }),
    );
    this.deps.store.appendEvents(this.id, batch);
    for (const event of batch) this.applyLocally(event);
    this.lastActiveAt = at;

    if (batch.some((event) => event.type === "dm_seat_changed")) {
      // Rights changed: every client rebuilds from a log redacted for its new role.
      for (const connection of this.connections) this.sendWelcome(connection, 0);
    } else {
      for (const connection of this.connections) {
        const viewer = this.viewer(connection.playerId);
        for (const event of batch) {
          const visible = redactEvent(event, viewer);
          if (visible) connection.send({ type: "event", event: visible });
        }
      }
    }
    return batch;
  }

  connect(connection: Connection, afterSeq: number): void {
    this.connections.add(connection);
    this.lastActiveAt = this.deps.now();
    this.sendWelcome(connection, afterSeq);
    this.broadcastPresence(connection);
  }

  disconnect(connection: Connection): void {
    if (!this.connections.delete(connection)) return;
    this.lastActiveAt = this.deps.now();
    this.broadcastPresence();
  }

  private viewer(playerId: string): Viewer {
    return { playerId, isDm: isDm(this.state, playerId) };
  }

  private applyLocally(event: RoomEvent): void {
    this.state = reduce(this.state, event);
    this.events.push(event);
    if (event.type === "dm_seat_changed") this.seatChangedAt = event.seq;
  }

  private sendWelcome(connection: Connection, afterSeq: number): void {
    // Replay from scratch if the client is new, is ahead of us, or last synced under different rights.
    const reset = afterSeq === 0 || afterSeq > this.state.seq || afterSeq < this.seatChangedAt;
    const from = reset ? 0 : afterSeq;
    const viewer = this.viewer(connection.playerId);
    const events: RoomEvent[] = [];
    for (const event of this.events) {
      if (event.seq <= from) continue;
      const visible = redactEvent(event, viewer);
      if (visible) events.push(visible);
    }
    connection.send({ type: "welcome", playerId: connection.playerId, reset, events, online: this.online() });
  }

  private broadcastPresence(except?: Connection): void {
    const message: ServerMessage = { type: "presence", online: this.online() };
    for (const connection of this.connections) if (connection !== except) connection.send(message);
  }
}
