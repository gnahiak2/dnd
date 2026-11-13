import { describe, expect, it } from "vitest";
import {
  type Actor,
  ClientMessageSchema,
  CommandSchema,
  DM_COMMAND_TYPES,
  type EventDraft,
  PUBLIC,
  type RoomEvent,
  RoomEventSchema,
  isDm,
  nextTurn,
  redactEvent,
  reduce,
  reduceAll,
  sortByInitiative,
} from "../src";

const dmActor: Actor = { kind: "player", playerId: "dm" };

function log(drafts: EventDraft[], actor: Actor = dmActor): RoomEvent[] {
  return drafts.map((draft, i) =>
    RoomEventSchema.parse({ ...draft, seq: i + 1, at: 1000 + i, actor, visibility: draft.visibility ?? PUBLIC }),
  );
}

const hp = (current: number, max = current) => ({ current, max, temp: 0 });
const npc = (id: string, initiative: number, hidden = true) => ({
  kind: "npc" as const,
  id,
  name: id,
  initiative,
  hidden,
  band: "healthy" as const,
  conditions: [],
});

describe("commands", () => {
  it("fills defaults", () => {
    expect(CommandSchema.parse({ type: "roll", expression: "1d20" })).toEqual({
      type: "roll",
      expression: "1d20",
      mode: "normal",
      secret: false,
    });
    expect(CommandSchema.parse({ type: "add_monster", srdIndex: "goblin" })).toMatchObject({ count: 1, hidden: true });
  });

  it("trims text and rejects blank or oversized text", () => {
    expect(CommandSchema.parse({ type: "chat", text: "  hello  " })).toMatchObject({ text: "hello" });
    expect(CommandSchema.safeParse({ type: "chat", text: "   " }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "chat", text: "x".repeat(2001) }).success).toBe(false);
  });

  it("rejects unknown commands and unknown fields", () => {
    expect(CommandSchema.safeParse({ type: "become_god" }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "narrate", text: "hi", visibility: "dm" }).success).toBe(false);
  });

  it("rejects out-of-range numbers", () => {
    expect(CommandSchema.safeParse({ type: "add_monster", srdIndex: "goblin", count: 21 }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "request_check", characterIds: ["a"], check: { kind: "save", ability: "dex" }, dc: 0 }).success).toBe(false);
    expect(
      CommandSchema.safeParse({ type: "adjust_hp", target: { kind: "character", characterId: "a" }, change: { op: "damage", amount: -5 } }).success,
    ).toBe(false);
  });

  it("knows which commands belong to the DM seat", () => {
    expect([...DM_COMMAND_TYPES].sort()).toEqual(
      ["add_combatant", "add_monster", "dismiss_check", "end_encounter", "narrate", "next_turn", "remove_combatant", "request_check", "set_initiative", "start_encounter"].sort(),
    );
  });

  it("validates the command inside a client message", () => {
    expect(ClientMessageSchema.safeParse({ type: "command", id: "1", command: { type: "chat", text: "hi" } }).success).toBe(true);
    expect(ClientMessageSchema.safeParse({ type: "command", id: "1", command: { type: "chat" } }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "hello", token: "t", afterSeq: -1 }).success).toBe(false);
  });
});

describe("redactEvent", () => {
  const [publicEvent, dmOnly, whisper, withSecret] = log([
    { type: "narration", payload: { text: "The door creaks." } },
    { type: "roll", payload: { result: { expression: "1d20", mode: "normal", terms: [], total: 12 } }, visibility: { scope: "dm" } },
    { type: "chat", payload: { text: "psst", to: { kind: "dm" } }, visibility: { scope: "players", playerIds: ["ann"] } },
    { type: "combatant_added", payload: { combatant: npc("goblin", 12) }, secret: { hp: hp(7), armorClass: 15, srdIndex: "goblin" } },
  ]) as [RoomEvent, RoomEvent, RoomEvent, RoomEvent];

  it("gives the DM everything untouched", () => {
    for (const event of [publicEvent, dmOnly, whisper, withSecret]) {
      expect(redactEvent(event, { playerId: "dm", isDm: true })).toBe(event);
    }
  });

  it("drops DM-only events for players", () => {
    expect(redactEvent(dmOnly, { playerId: "ann", isDm: false })).toBeNull();
  });

  it("delivers whispers only to the players named", () => {
    expect(redactEvent(whisper, { playerId: "ann", isDm: false })).toEqual(whisper);
    expect(redactEvent(whisper, { playerId: "bob", isDm: false })).toBeNull();
  });

  it("strips the secret part and leaves the rest", () => {
    const seen = redactEvent(withSecret, { playerId: "ann", isDm: false });
    expect(seen).not.toBeNull();
    expect(seen).not.toHaveProperty("secret");
    expect(JSON.stringify(seen)).not.toContain("armorClass");
    expect(seen?.payload).toEqual(withSecret.payload);
    // The original is not mutated.
    expect(withSecret.secret).toBeDefined();
    // What players receive is still a valid event.
    expect(RoomEventSchema.safeParse(seen).success).toBe(true);
  });

  it("passes public events through", () => {
    expect(redactEvent(publicEvent, { playerId: "bob", isDm: false })).toBe(publicEvent);
  });
});

describe("reduce", () => {
  const sheet = {
    name: "Mira",
    race: "Elf",
    className: "Wizard",
    level: 3,
    abilities: { str: 8, dex: 14, con: 12, int: 17, wis: 12, cha: 10 },
    saveProficiencies: ["int" as const, "wis" as const],
    skillProficiencies: { arcana: "proficient" as const },
    maxHp: 17,
    armorClass: 12,
    speed: 30,
    notes: "",
  };
  const mira = { id: "mira", ownerId: "ann", sheet, hp: hp(17), conditions: [] };

  const base: EventDraft[] = [
    { type: "room_created", payload: { name: "The Sunken Keep" } },
    { type: "player_joined", payload: { playerId: "dm", displayName: "Dana" } },
    { type: "dm_seat_changed", payload: { controller: { kind: "human", playerId: "dm" } } },
    { type: "player_joined", payload: { playerId: "ann", displayName: "Ann" } },
    { type: "character_created", payload: { character: mira } },
  ];

  it("builds the room from its log", () => {
    const state = reduceAll(log(base));
    expect(state).toMatchObject({ name: "The Sunken Keep", seq: 5, dm: { kind: "human", playerId: "dm" } });
    expect(Object.keys(state.players)).toEqual(["dm", "ann"]);
    expect(isDm(state, "dm")).toBe(true);
    expect(isDm(state, "ann")).toBe(false);
    expect(state.characters.mira?.hp).toEqual(hp(17));
  });

  it("does not mutate the previous state", () => {
    const events = log(base);
    const before = reduceAll(events.slice(0, 4));
    const frozen = structuredClone(before);
    reduce(before, events[4] as RoomEvent);
    expect(before).toEqual(frozen);
  });

  it("tracks pending checks until everyone has rolled", () => {
    const roll = { mode: "normal" as const, d20s: [11], natural: 11, modifier: 2, total: 13 };
    const check = { kind: "skill" as const, skill: "perception" as const };
    const events = log([
      ...base,
      { type: "character_created", payload: { character: { ...mira, id: "bram", ownerId: "bob" } } },
      { type: "check_requested", payload: { requestId: "r1", characterIds: ["mira", "bram"], check }, secret: { dc: 13 } },
      { type: "check_rolled", payload: { characterId: "mira", check, roll, requestId: "r1", outcome: "success" }, secret: { dc: 13 } },
      { type: "check_rolled", payload: { characterId: "bram", check, roll, requestId: "r1", outcome: "success" }, secret: { dc: 13 } },
    ]);
    expect(reduceAll(events.slice(0, 7)).pendingChecks.r1).toMatchObject({ characterIds: ["mira", "bram"], dc: 13 });
    expect(reduceAll(events.slice(0, 8)).pendingChecks.r1?.characterIds).toEqual(["bram"]);
    expect(reduceAll(events).pendingChecks).toEqual({});

    const player = events.map((e) => redactEvent(e, { playerId: "ann", isDm: false })).filter((e) => e !== null);
    expect(reduceAll(player.slice(0, 7)).pendingChecks.r1).not.toHaveProperty("dc");
  });

  it("keeps a hidden creature's numbers out of a player's state", () => {
    const events = log([
      ...base,
      { type: "encounter_started", payload: { encounterId: "e1" } },
      { type: "combatant_added", payload: { combatant: npc("goblin", 12) }, secret: { hp: hp(7), armorClass: 15 } },
      {
        type: "hp_changed",
        payload: { target: { kind: "combatant", combatantId: "goblin" }, band: "bloodied" },
        secret: { hp: hp(3, 7), change: { op: "damage", amount: 4 } },
      },
    ]);
    const dmView = reduceAll(events);
    expect(dmView.encounter?.combatants[0]).toMatchObject({ band: "bloodied", hp: hp(3, 7), armorClass: 15 });

    const playerView = reduceAll(events.map((e) => redactEvent(e, { playerId: "ann", isDm: false })).filter((e) => e !== null));
    const seen = playerView.encounter?.combatants[0];
    expect(seen).toMatchObject({ name: "goblin", band: "bloodied" });
    expect(seen).not.toHaveProperty("hp");
    expect(seen).not.toHaveProperty("armorClass");
  });

  it("orders combatants by initiative, ties in joining order", () => {
    const order = sortByInitiative([npc("a", 10), npc("b", 15), npc("c", 10), npc("d", 20)]).map((c) => c.id);
    expect(order).toEqual(["d", "b", "a", "c"]);
  });

  it("walks turns in order and counts rounds", () => {
    let state = reduceAll(
      log([
        ...base,
        { type: "encounter_started", payload: { encounterId: "e1" } },
        { type: "combatant_added", payload: { combatant: npc("slow", 5) } },
        { type: "combatant_added", payload: { combatant: npc("fast", 18) } },
      ]),
    );
    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const turn = nextTurn(state.encounter!);
      expect(turn).not.toBeNull();
      state = reduce(state, log([{ type: "turn_advanced", payload: turn! }])[0]!);
      seen.push(`${state.encounter!.round}:${state.encounter!.currentId}`);
    }
    expect(seen).toEqual(["1:fast", "1:slow", "2:fast", "2:slow", "3:fast"]);
  });

  it("passes the turn on when the acting combatant is removed", () => {
    const start = reduceAll(
      log([
        ...base,
        { type: "encounter_started", payload: { encounterId: "e1" } },
        { type: "combatant_added", payload: { combatant: npc("a", 20) } },
        { type: "combatant_added", payload: { combatant: npc("b", 15) } },
        { type: "combatant_added", payload: { combatant: npc("c", 10) } },
      ]),
    );
    const at = (id: string) => reduce(start, log([{ type: "turn_advanced", payload: { round: 1, combatantId: id } }])[0]!);
    const remove = (state: typeof start, id: string) => reduce(state, log([{ type: "combatant_removed", payload: { combatantId: id } }])[0]!);

    expect(remove(at("b"), "b").encounter).toMatchObject({ currentId: "c", round: 1 });
    // Removing the last in the order wraps to the top of the next round.
    expect(remove(at("c"), "c").encounter).toMatchObject({ currentId: "a", round: 2 });
    // Removing someone else leaves the turn where it was.
    expect(remove(at("b"), "a").encounter).toMatchObject({ currentId: "b", round: 1 });
    expect(nextTurn({ id: "e", round: 1, currentId: null, combatants: [] })).toBeNull();
  });

  it("removes a deleted character from the encounter and from open checks", () => {
    const check = { kind: "ability" as const, ability: "str" as const };
    const state = reduceAll(
      log([
        ...base,
        { type: "encounter_started", payload: { encounterId: "e1" } },
        { type: "combatant_added", payload: { combatant: { kind: "pc", id: "c1", name: "Mira", initiative: 14, characterId: "mira" } } },
        { type: "check_requested", payload: { requestId: "r1", characterIds: ["mira"], check } },
        { type: "character_deleted", payload: { characterId: "mira" } },
      ]),
    );
    expect(state.characters).toEqual({});
    expect(state.encounter?.combatants).toEqual([]);
    expect(state.pendingChecks).toEqual({});
  });

  it("toggles conditions without duplicates", () => {
    const target = { kind: "character" as const, characterId: "mira" };
    const state = reduceAll(
      log([
        ...base,
        { type: "condition_set", payload: { target, condition: "prone", active: true } },
        { type: "condition_set", payload: { target, condition: "prone", active: true } },
        { type: "condition_set", payload: { target, condition: "poisoned", active: true } },
        { type: "condition_set", payload: { target, condition: "prone", active: false } },
      ]),
    );
    expect(state.characters.mira?.conditions).toEqual(["poisoned"]);
  });
});
