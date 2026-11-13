import {
  type ClientMessage,
  type CommandInput,
  type RoomEvent,
  type RoomState,
  ServerMessageSchema,
  initialRoomState,
  reduce,
} from "@lanternkeep/protocol";

export type ConnectionStatus = "online" | "connecting" | "offline";

/** The part of the browser WebSocket the client uses. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
}

export type SocketConstructor = new (url: string) => SocketLike;

export type TimerHandle = ReturnType<typeof setTimeout>;

export interface Timers {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface FatalError {
  code: string;
  message: string;
}

export interface RoomSnapshot {
  status: ConnectionStatus;
  state: RoomState;
  /** Every event received, in seq order. The scrolling log is rendered from this. */
  log: readonly RoomEvent[];
  online: readonly string[];
  /** Confirmed by the server in `welcome`; null until then. */
  playerId: string | null;
  fatal: FatalError | null;
}

export interface RoomClientOptions {
  /** Full WebSocket URL, e.g. `wss://host/ws?room=abc`. */
  url: string;
  token: string;
  WebSocket?: SocketConstructor;
  timers?: Timers;
  commandTimeoutMs?: number;
  /** Generates command ids. */
  newId?: () => string;
}

const OPEN = 1;
export const MIN_BACKOFF_MS = 500;
export const MAX_BACKOFF_MS = 8000;
export const COMMAND_TIMEOUT_MS = 10_000;

interface PendingCommand {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: TimerHandle;
}

export class CommandError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CommandError";
    this.code = code;
  }
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

let idCounter = 0;
const defaultNewId = (): string => {
  idCounter += 1;
  return `c${Date.now().toString(36)}${idCounter.toString(36)}`;
};

/**
 * Connection and state for one room seat, independent of any UI framework.
 * Exposes `subscribe`/`getSnapshot` for React's `useSyncExternalStore`.
 */
export class RoomClient {
  private readonly url: string;
  private readonly token: string;
  private readonly SocketImpl: SocketConstructor;
  private readonly timers: Timers;
  private readonly commandTimeoutMs: number;
  private readonly newId: () => string;

  private socket: SocketLike | null = null;
  private reconnectTimer: TimerHandle | null = null;
  private backoff = MIN_BACKOFF_MS;
  private running = false;
  private welcomed = false;
  private readonly pending = new Map<string, PendingCommand>();
  private readonly listeners = new Set<() => void>();
  private snapshot: RoomSnapshot = {
    status: "offline",
    state: initialRoomState(),
    log: [],
    online: [],
    playerId: null,
    fatal: null,
  };

  constructor(options: RoomClientOptions) {
    this.url = options.url;
    this.token = options.token;
    const SocketImpl = options.WebSocket ?? globalThis.WebSocket;
    if (!SocketImpl) throw new Error("No WebSocket implementation available");
    this.SocketImpl = SocketImpl;
    this.timers = options.timers ?? defaultTimers;
    this.commandTimeoutMs = options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS;
    this.newId = options.newId ?? defaultNewId;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RoomSnapshot => this.snapshot;

  /** Opens the connection. Safe to call again after `stop()`. */
  start(): void {
    if (this.running || this.snapshot.fatal) return;
    this.running = true;
    this.backoff = MIN_BACKOFF_MS;
    this.connect();
  }

  /** Closes the connection for good (until `start()` is called again). */
  stop(): void {
    this.running = false;
    this.clearReconnect();
    this.closeSocket();
    this.failPending("Disconnected");
    this.update({ status: "offline" });
  }

  /**
   * Sends a command. Resolves on `ack`; rejects with the server's message on
   * `reject`, on timeout, or immediately when the connection is down.
   */
  send(command: CommandInput): Promise<void> {
    const socket = this.socket;
    if (!socket || !this.welcomed || socket.readyState !== OPEN) {
      return Promise.reject(new CommandError("offline", "Not connected to the room. Try again in a moment."));
    }
    const id = this.newId();
    return new Promise<void>((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        this.pending.delete(id);
        reject(new CommandError("timeout", "The server did not answer in time."));
      }, this.commandTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ type: "command", id, command });
    });
  }

  private connect(): void {
    this.welcomed = false;
    this.update({ status: "connecting" });
    const socket = new this.SocketImpl(this.url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.write({ type: "hello", token: this.token, afterSeq: this.snapshot.state.seq });
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      if (typeof ev.data === "string") this.handleMessage(ev.data);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.welcomed = false;
      this.failPending("Connection lost before the server answered.");
      if (this.running && !this.snapshot.fatal) this.scheduleReconnect();
      else this.update({ status: "offline" });
    };
    // A close event always follows an error; reconnecting is handled there.
    socket.onerror = () => {};
  }

  private scheduleReconnect(): void {
    this.update({ status: "offline" });
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running) this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      this.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.welcomed = false;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
  }

  private failPending(message: string): void {
    for (const [id, entry] of this.pending) {
      this.timers.clearTimeout(entry.timer);
      entry.reject(new CommandError("offline", message));
      this.pending.delete(id);
    }
  }

  private write(message: ClientMessage): void {
    this.socket?.send(JSON.stringify(message));
  }

  private handleMessage(data: string): void {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = ServerMessageSchema.safeParse(json);
    if (!parsed.success) return;
    const message = parsed.data;

    switch (message.type) {
      case "welcome": {
        this.welcomed = true;
        this.backoff = MIN_BACKOFF_MS;
        const base = message.reset
          ? { state: initialRoomState(), log: [] as readonly RoomEvent[] }
          : { state: this.snapshot.state, log: this.snapshot.log };
        const { state, log } = applyEvents(base.state, base.log, message.events);
        this.update({ status: "online", state, log, online: message.online, playerId: message.playerId });
        return;
      }
      case "event": {
        const { state, log } = applyEvents(this.snapshot.state, this.snapshot.log, [message.event]);
        if (log !== this.snapshot.log) this.update({ state, log });
        return;
      }
      case "presence":
        this.update({ online: message.online });
        return;
      case "ack": {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        this.timers.clearTimeout(entry.timer);
        entry.resolve();
        return;
      }
      case "reject": {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        this.timers.clearTimeout(entry.timer);
        entry.reject(new CommandError(message.code, message.message));
        return;
      }
      case "fatal":
        this.running = false;
        this.clearReconnect();
        this.update({ fatal: { code: message.code, message: message.message } });
        this.closeSocket();
        this.failPending(message.message);
        this.update({ status: "offline" });
        return;
    }
  }

  private update(patch: Partial<RoomSnapshot>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof RoomSnapshot)[]) {
      if (patch[key] !== this.snapshot[key]) changed = true;
    }
    if (!changed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/** Applies events in order, skipping any the state already holds. */
function applyEvents(
  state: RoomState,
  log: readonly RoomEvent[],
  events: readonly RoomEvent[],
): { state: RoomState; log: readonly RoomEvent[] } {
  let next = state;
  const applied: RoomEvent[] = [];
  for (const event of events) {
    if (event.seq <= next.seq) continue;
    next = reduce(next, event);
    applied.push(event);
  }
  return applied.length === 0 ? { state, log } : { state: next, log: [...log, ...applied] };
}
