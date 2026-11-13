import type { AddressInfo } from "node:net";
import {
  type CommandInput,
  type RoomEvent,
  type RoomState,
  type SeatResponse,
  type ServerMessage,
  ServerMessageSchema,
  initialRoomState,
  reduce,
} from "@lanternkeep/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type App, buildApp } from "../src/app";

let app: App;
let base: string;
let dice: number[];
const open: Client[] = [];

beforeEach(async () => {
  dice = [];
  app = await buildApp({
    dbFile: ":memory:",
    seatRateLimit: { max: 1000, windowMs: 1000 },
    helloTimeoutMs: 300,
    roller: {
      roll: (sides) => {
        const face = dice.shift();
        if (face === undefined) throw new Error(`No scripted face for a d${sides}`);
        return face;
      },
    },
  });
  await app.server.listen({ port: 0, host: "127.0.0.1" });
  base = `127.0.0.1:${(app.server.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const client of open.splice(0)) client.close();
  await app.close();
});

async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`http://${base}${path}`, init);
  return { status: response.status, body: (await response.json()) as T };
}

/** A test double for the browser client: reduces what it receives, and keeps every raw frame for leak checks. */
class Client {
  state: RoomState = initialRoomState();
  events: RoomEvent[] = [];
  messages: ServerMessage[] = [];
  frames: string[] = [];
  online: string[] = [];
  closed = false;
  private socket: WebSocket;
  private waiters: (() => void)[] = [];
  private nextId = 0;

  constructor(roomId: string, token: string, afterSeq = 0, from?: Client) {
    if (from) {
      this.state = from.state;
      this.events = [...from.events];
    }
    this.socket = new WebSocket(`ws://${base}/ws?room=${roomId}`);
    this.socket.on("open", () => this.socket.send(JSON.stringify({ type: "hello", token, afterSeq })));
    this.socket.on("message", (data) => {
      const frame = data.toString();
      this.frames.push(frame);
      // Everything the server sends must satisfy the published wire schema.
      const message = ServerMessageSchema.parse(JSON.parse(frame));
      this.messages.push(message);
      if (message.type === "welcome") {
        if (message.reset) {
          this.state = initialRoomState();
          this.events = [];
        }
        message.events.forEach((event) => this.apply(event));
        this.online = message.online;
      } else if (message.type === "event") this.apply(message.event);
      else if (message.type === "presence") this.online = message.online;
      this.wake();
    });
    this.socket.on("close", () => {
      this.closed = true;
      this.wake();
    });
    open.push(this);
  }

  private apply(event: RoomEvent): void {
    this.state = reduce(this.state, event);
    this.events.push(event);
  }

  private wake(): void {
    this.waiters.splice(0).forEach((resolve) => resolve());
  }

  async until(predicate: () => boolean, what = "condition"): Promise<void> {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Timed out waiting for ${what}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  ready(): Promise<void> {
    return this.until(() => this.messages.some((m) => m.type === "welcome"), "welcome");
  }

  /** Sends a command and resolves with the server's verdict: "ok" or the rejection code. */
  async send(command: CommandInput): Promise<string> {
    const id = `c${(this.nextId += 1)}`;
    this.socket.send(JSON.stringify({ type: "command", id, command }));
    const reply = () => this.messages.find((m) => (m.type === "ack" || m.type === "reject") && m.id === id);
    await this.until(() => reply() !== undefined, `reply to ${command.type}`);
    const message = reply();
    return message?.type === "reject" ? message.code : "ok";
  }

  raw(text: string): void {
    this.socket.send(text);
  }

  seen(type: RoomEvent["type"]): RoomEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  close(): void {
    this.socket.close();
  }
}

async function createRoom(asDm = true): Promise<SeatResponse> {
  const created = await api<SeatResponse>("POST", "/api/rooms", { roomName: "The Sunken Keep", displayName: "Dana", asDm });
  expect(created.status).toBe(201);
  return created.body;
}

async function join(roomId: string, displayName: string): Promise<SeatResponse> {
  const joined = await api<SeatResponse>("POST", `/api/rooms/${roomId}/join`, { displayName });
  expect(joined.status).toBe(201);
  return joined.body;
}

async function table(): Promise<{ roomId: string; dmSeat: SeatResponse; annSeat: SeatResponse; dm: Client; ann: Client }> {
  const dmSeat = await createRoom();
  const annSeat = await join(dmSeat.roomId, "Ann");
  const dm = new Client(dmSeat.roomId, dmSeat.token);
  const ann = new Client(dmSeat.roomId, annSeat.token);
  await Promise.all([dm.ready(), ann.ready()]);
  return { roomId: dmSeat.roomId, dmSeat, annSeat, dm, ann };
}

describe("rooms over HTTP", () => {
  it("creates a room with the creator in the DM seat, and lets others join by its id", async () => {
    const seat = await createRoom();
    expect(seat.roomId).toMatch(/^[23456789a-hjkmnp-z]{12}$/);
    expect(seat.token.length).toBeGreaterThanOrEqual(40);

    const info = await api<{ name: string; playerCount: number }>("GET", `/api/rooms/${seat.roomId}`);
    expect(info).toMatchObject({ status: 200, body: { name: "The Sunken Keep", playerCount: 1 } });

    const ann = await join(seat.roomId, "Ann");
    expect(ann.playerId).not.toBe(seat.playerId);
    expect(ann.token).not.toBe(seat.token);
    expect(ann.roomName).toBe("The Sunken Keep");
  });

  it("leaves the DM seat empty when asked", async () => {
    const seat = await createRoom(false);
    const client = new Client(seat.roomId, seat.token);
    await client.ready();
    expect(client.state.dm).toBeNull();
    expect(await client.send({ type: "claim_dm_seat" })).toBe("ok");
  });

  it("answers errors in one shape", async () => {
    expect(await api("GET", "/api/rooms/nope")).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
    expect(await api("POST", "/api/rooms/nope/join", { displayName: "Ann" })).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
    expect(await api("POST", "/api/rooms", { roomName: "", displayName: "Dana" })).toMatchObject({ status: 400, body: { error: { code: "invalid" } } });
    expect(await api("POST", "/api/rooms", { roomName: "x", displayName: "y".repeat(33) })).toMatchObject({ status: 400 });
    expect(await api("POST", "/api/rooms", { roomName: "x", displayName: "y", admin: true })).toMatchObject({ status: 400 });
    expect(await api("GET", "/api/unknown")).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
  });

  it("caps a room at twelve seats", async () => {
    const seat = await createRoom();
    for (let i = 0; i < 11; i += 1) await join(seat.roomId, `P${i}`);
    expect(await api("POST", `/api/rooms/${seat.roomId}/join`, { displayName: "Late" })).toMatchObject({ status: 409, body: { error: { code: "conflict" } } });
  });

  it("limits how many seats one address can take", async () => {
    await app.close();
    app = await buildApp({ dbFile: ":memory:", seatRateLimit: { max: 2, windowMs: 60_000 } });
    await app.server.listen({ port: 0, host: "127.0.0.1" });
    base = `127.0.0.1:${(app.server.server.address() as AddressInfo).port}`;
    const seat = await createRoom();
    await join(seat.roomId, "Ann");
    expect(await api("POST", `/api/rooms/${seat.roomId}/join`, { displayName: "Bob" })).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
  });
});

describe("SRD reference over HTTP", () => {
  it("searches, lists and fetches", async () => {
    const search = await api<{ results: { index: string }[] }>("GET", "/api/srd/search?q=fireb");
    expect(search.body.results[0]).toMatchObject({ category: "spells", index: "fireball", summary: "3rd-level evocation" });

    const monsters = await api<{ results: unknown[] }>("GET", "/api/srd/search?q=goblin&category=monsters&limit=1");
    expect(monsters.body.results).toEqual([{ category: "monsters", index: "goblin", name: "Goblin", summary: "Small humanoid, CR 1/4" }]);

    const classes = await api<{ results: unknown[] }>("GET", "/api/srd/classes");
    expect(classes.body.results).toHaveLength(12);

    const goblin = await api<{ name: string; record: { hit_points: number } }>("GET", "/api/srd/monsters/goblin");
    expect(goblin.body).toMatchObject({ category: "monsters", index: "goblin", name: "Goblin", record: { hit_points: 7 } });

    const categories = await api<{ categories: { id: string; count: number }[] }>("GET", "/api/srd/categories");
    expect(categories.body.categories).toContainEqual({ id: "spells", name: "Spells", count: 319 });

    const attribution = await api<{ text: string }>("GET", "/api/srd/attribution");
    expect(attribution.body.text).toContain("Creative Commons Attribution 4.0 International License");
  });

  it("answers 404 for unknown categories and entries, 400 for bad queries", async () => {
    expect((await api("GET", "/api/srd/nonsense")).status).toBe(404);
    expect((await api("GET", "/api/srd/monsters/beholder")).status).toBe(404);
    expect((await api("GET", "/api/srd/search?q=x&category=nonsense")).status).toBe(404);
    expect((await api("GET", "/api/srd/search?q=x&limit=0")).status).toBe(400);
  });
});

describe("live play", () => {
  it("shows both players the same log, dice included", async () => {
    const { dm, ann } = await table();
    expect(ann.online.sort()).toEqual(Object.keys(ann.state.players).sort());

    dice = [4, 5];
    expect(await ann.send({ type: "roll", expression: "2d6+3", label: "Shortbow" })).toBe("ok");
    expect(await dm.send({ type: "narrate", text: "The arrow finds its mark." })).toBe("ok");
    await ann.until(() => ann.seen("narration").length === 1);
    await dm.until(() => dm.seen("roll").length === 1);

    expect(ann.events).toEqual(dm.events);
    expect(ann.seen("roll")[0]).toMatchObject({ payload: { label: "Shortbow", result: { total: 12 } } });
    expect(ann.state.seq).toBe(dm.state.seq);
  });

  it("refuses what a player may not do and what makes no sense", async () => {
    const { ann } = await table();
    expect(await ann.send({ type: "narrate", text: "I win." })).toBe("forbidden");
    expect(await ann.send({ type: "roll", expression: "1d20", secret: true })).toBe("forbidden");
    expect(await ann.send({ type: "roll", expression: "banana" })).toBe("invalid");
    expect(await ann.send({ type: "delete_character", characterId: "ghost" })).toBe("not_found");
    expect(await ann.send({ type: "become_dm" } as never)).toBe("invalid");
    expect(await ann.send({ type: "chat", text: "x".repeat(5000) })).toBe("invalid");
    expect(ann.closed).toBe(false);
    expect(ann.events.filter((e) => e.type === "narration" || e.type === "roll")).toEqual([]);
  });

  it("never sends DM-only information to a player", async () => {
    const { dm, ann } = await table();
    dice = [17, 10];
    expect(await dm.send({ type: "roll", expression: "1d20", label: "trap-perception-secret", secret: true })).toBe("ok");
    expect(await dm.send({ type: "start_encounter" })).toBe("ok");
    expect(await dm.send({ type: "add_monster", srdIndex: "goblin", name: "Cloaked figure" })).toBe("ok");
    const goblin = dm.state.encounter?.combatants[0];
    expect(goblin).toMatchObject({ hp: { current: 7 }, armorClass: 15, srdIndex: "goblin" });
    expect(await dm.send({ type: "adjust_hp", target: { kind: "combatant", combatantId: goblin?.id ?? "" }, change: { op: "damage", amount: 4 } })).toBe("ok");
    expect(await dm.send({ type: "chat", text: "note-to-self", to: { kind: "player", playerId: dm.state.dm?.kind === "human" ? dm.state.dm.playerId : "" } })).toBe("ok");
    expect(await dm.send({ type: "chat", text: "marker" })).toBe("ok");
    await ann.until(() => ann.seen("chat").some((e) => e.type === "chat" && e.payload.text === "marker"));

    // The player's own picture of the room.
    expect(ann.seen("roll")).toEqual([]);
    const seen = ann.state.encounter?.combatants[0];
    expect(seen).toMatchObject({ name: "Cloaked figure", band: "bloodied" });
    expect(seen).not.toHaveProperty("hp");

    // And the bytes on the wire: nothing secret was sent and then merely ignored.
    const wire = ann.frames.join("\n");
    for (const leak of ["trap-perception-secret", "note-to-self", '"secret"', "armorClass", "srdIndex", '"goblin"', '"hp"']) {
      expect(wire, leak).not.toContain(leak);
    }
    // The DM got all of it.
    expect(dm.frames.join("\n")).toContain("trap-perception-secret");
    expect(dm.seen("hp_changed")[0]).toMatchObject({ secret: { hp: { current: 3, max: 7 } } });
  });

  it("delivers a whisper to the DM and to nobody else", async () => {
    const { roomId, dm, ann } = await table();
    const bobSeat = await join(roomId, "Bob");
    const bob = new Client(roomId, bobSeat.token);
    await bob.ready();

    expect(await ann.send({ type: "chat", text: "i-pocket-the-gem", to: { kind: "dm" } })).toBe("ok");
    expect(await ann.send({ type: "chat", text: "marker" })).toBe("ok");
    await bob.until(() => bob.seen("chat").length === 1);
    await dm.until(() => dm.seen("chat").length === 2);

    expect(bob.frames.join("\n")).not.toContain("i-pocket-the-gem");
    expect(ann.frames.join("\n")).toContain("i-pocket-the-gem");
    expect(dm.seen("chat")[0]).toMatchObject({ payload: { text: "i-pocket-the-gem", to: { kind: "dm" } } });
  });

  it("replays only what a reconnecting client missed", async () => {
    const { roomId, annSeat, dm, ann } = await table();
    expect(await dm.send({ type: "narrate", text: "one" })).toBe("ok");
    await ann.until(() => ann.seen("narration").length === 1);
    const heldSeq = ann.state.seq;
    ann.close();
    await dm.until(() => !dm.online.includes(annSeat.playerId), "ann to go offline");

    dice = [3];
    expect(await dm.send({ type: "narrate", text: "two" })).toBe("ok");
    expect(await dm.send({ type: "roll", expression: "1d20", secret: true })).toBe("ok");
    expect(await dm.send({ type: "narrate", text: "three" })).toBe("ok");

    const back = new Client(roomId, annSeat.token, heldSeq, ann);
    await back.ready();
    const welcome = back.messages.find((m) => m.type === "welcome");
    expect(welcome).toMatchObject({ reset: false });
    expect(welcome?.type === "welcome" && welcome.events.map((e) => (e.type === "narration" ? e.payload.text : e.type))).toEqual(["two", "three"]);
    expect(back.seen("narration").map((e) => e.type === "narration" && e.payload.text)).toEqual(["one", "two", "three"]);
    expect(back.state.seq).toBe(dm.state.seq);
    await dm.until(() => dm.online.includes(annSeat.playerId), "ann to come back online");
  });

  it("rebuilds a room from its stored log after it has left memory", async () => {
    const { roomId, dmSeat, annSeat, dm, ann } = await table();
    dice = [10, 9];
    await dm.send({ type: "start_encounter" });
    await dm.send({ type: "add_monster", srdIndex: "goblin", count: 2 });
    await ann.send({
      type: "create_character",
      sheet: {
        name: "Mira", race: "Elf", className: "Rogue", level: 5,
        abilities: { str: 8, dex: 16, con: 12, int: 14, wis: 9, cha: 10 },
        saveProficiencies: ["dex", "int"], skillProficiencies: { stealth: "expertise" },
        maxHp: 20, armorClass: 14, speed: 30, notes: "Thieves' tools",
      },
    });
    const miraId = Object.keys(ann.state.characters)[0] ?? "";
    await ann.send({ type: "join_encounter", characterId: miraId });
    await dm.send({ type: "next_turn" });
    await dm.until(() => dm.state.encounter?.currentId != null);
    await ann.until(() => ann.state.seq === dm.state.seq, "ann to catch up");
    const before = { dm: dm.state, ann: ann.state };
    expect(before.dm.encounter?.combatants.map((c) => `${c.name}:${c.initiative}`)).toEqual(["Goblin 1:12", "Goblin 2:12", "Mira:12"]);

    dm.close();
    ann.close();
    await dm.until(() => dm.closed);
    await ann.until(() => ann.closed);
    app.manager.unload(roomId);

    const dm2 = new Client(roomId, dmSeat.token);
    const ann2 = new Client(roomId, annSeat.token);
    await Promise.all([dm2.ready(), ann2.ready()]);
    expect(dm2.state).toEqual(before.dm);
    expect(ann2.state).toEqual(before.ann);
    expect(ann2.state.encounter?.combatants[0]).not.toHaveProperty("hp");
    // The reloaded room keeps going where it stopped.
    expect(await dm2.send({ type: "next_turn" })).toBe("ok");
    await ann2.until(() => ann2.state.seq === before.ann.seq + 1);
  });

  it("hands the DM seat over: the new DM gains the secrets and the old one loses them", async () => {
    const { dm, ann } = await table();
    dice = [10];
    await dm.send({ type: "start_encounter" });
    await dm.send({ type: "add_monster", srdIndex: "goblin" });
    await ann.until(() => ann.state.encounter?.combatants.length === 1);
    expect(ann.state.encounter?.combatants[0]).not.toHaveProperty("hp");

    expect(await dm.send({ type: "release_dm_seat" })).toBe("ok");
    expect(await dm.send({ type: "next_turn" })).toBe("forbidden");
    expect(await ann.send({ type: "claim_dm_seat" })).toBe("ok");
    await ann.until(() => ann.state.encounter?.combatants[0]?.kind === "npc" && ann.state.encounter.combatants[0].hp !== undefined, "ann to see hit points");
    await dm.until(() => dm.state.dm?.kind === "human" && dm.state.encounter?.combatants[0]?.kind === "npc" && dm.state.encounter.combatants[0].hp === undefined, "old DM to lose hit points");

    expect(ann.state.encounter?.combatants[0]).toMatchObject({ hp: { current: 7, max: 7 }, armorClass: 15 });
    expect(dm.messages.filter((m) => m.type === "welcome" && m.reset).length).toBeGreaterThanOrEqual(2);
    expect(await ann.send({ type: "next_turn" })).toBe("ok");
  });
});

describe("connection rules", () => {
  it("rejects a bad token, a token from another room, and an unknown room", async () => {
    const a = await createRoom();
    const b = await createRoom();
    for (const [roomId, token] of [[a.roomId, "not-a-token"], [a.roomId, b.token], ["nope", a.token]] as const) {
      const client = new Client(roomId, token);
      await client.until(() => client.closed, "close");
      expect(client.messages).toEqual([{ type: "fatal", code: "unauthorized", message: expect.any(String) }]);
    }
  });

  it("closes a socket that never says hello, and one that sends a command first", async () => {
    const seat = await createRoom();
    const silent = new WebSocket(`ws://${base}/ws?room=${seat.roomId}`);
    const closed = await new Promise<number>((resolve) => silent.on("close", (code) => resolve(code)));
    expect(closed).toBe(1008);

    const eager = new WebSocket(`ws://${base}/ws?room=${seat.roomId}`);
    const frames: string[] = [];
    eager.on("message", (d) => frames.push(d.toString()));
    eager.on("open", () => eager.send(JSON.stringify({ type: "command", id: "1", command: { type: "chat", text: "hi" } })));
    await new Promise((resolve) => eager.on("close", resolve));
    expect(frames.join("")).toContain("unauthorized");
  });

  it("closes on garbage and on oversized frames without disturbing the room", async () => {
    const { dm, ann } = await table();
    ann.raw("{not json");
    await ann.until(() => ann.closed, "close after garbage");
    expect(ann.messages.at(-1)).toMatchObject({ type: "fatal", code: "invalid" });

    const seq = dm.state.seq;
    expect(await dm.send({ type: "chat", text: "still here" })).toBe("ok");
    expect(dm.state.seq).toBe(seq + 1);
    dm.raw(JSON.stringify({ type: "command", id: "big", command: { type: "chat", text: "x".repeat(70_000) } }));
    await dm.until(() => dm.closed, "close after oversized frame");
  });

  it("throttles a flood of commands", async () => {
    const { ann } = await table();
    const verdicts = await Promise.all(Array.from({ length: 60 }, (_, i) => ann.send({ type: "chat", text: `spam ${i}` })));
    expect(verdicts.filter((v) => v === "rate_limited").length).toBeGreaterThan(0);
    expect(verdicts.filter((v) => v === "ok").length).toBeGreaterThanOrEqual(30);
    expect(ann.closed).toBe(false);
  });
});
