import {
  type Actor,
  type CharacterSheet,
  type CommandInput,
  CommandSchema,
  DM_COMMAND_TYPES,
  type EventDraft,
  PUBLIC,
  type RoomEvent,
  RoomEventSchema,
  type RoomState,
  initialRoomState,
  isDm,
  redactEvent,
  reduce,
} from "@lanternkeep/protocol";
import { loadSrd } from "@lanternkeep/srd-data";
import { beforeEach, describe, expect, it } from "vitest";
import { CommandError } from "../src/room/errors";
import { handleCommand } from "../src/room/handlers";

const srd = loadSrd();

/** A room without a server: commands in, events out, with the dice scripted. */
class Table {
  state: RoomState = initialRoomState();
  events: RoomEvent[] = [];
  dice: number[] = [];
  private ids = 0;

  run(playerId: string, input: CommandInput): RoomEvent[] {
    const actor: Actor = { kind: "player", playerId };
    const drafts = handleCommand(this.state, actor, CommandSchema.parse(input), {
      srd,
      newId: () => `id${(this.ids += 1)}`,
      roller: {
        roll: (sides) => {
          const face = this.dice.shift();
          if (face === undefined) throw new Error(`No scripted face for a d${sides}`);
          return face;
        },
      },
    });
    return this.append(actor, drafts);
  }

  append(actor: Actor, drafts: EventDraft[]): RoomEvent[] {
    const stamped = drafts.map((draft) => {
      const event = RoomEventSchema.parse({ ...draft, seq: this.state.seq + 1, at: 0, actor, visibility: draft.visibility ?? PUBLIC });
      this.state = reduce(this.state, event);
      this.events.push(event);
      return event;
    });
    return stamped;
  }

  join(playerId: string): void {
    this.append({ kind: "player", playerId }, [{ type: "player_joined", payload: { playerId, displayName: playerId } }]);
  }

  /** The room as a player's client would rebuild it from what the server sends them. */
  viewOf(playerId: string): RoomState {
    let view = initialRoomState();
    let full = initialRoomState();
    for (const event of this.events) {
      full = reduce(full, event);
      const visible = redactEvent(event, { playerId, isDm: isDm(full, playerId) });
      if (visible) view = reduce(view, visible);
    }
    return view;
  }

  only(events: RoomEvent[]): RoomEvent {
    expect(events).toHaveLength(1);
    return events[0] as RoomEvent;
  }
}

const refusal = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof CommandError) return error.code;
    throw error;
  }
  return "accepted";
};

const sheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  name: "Mira",
  race: "Elf",
  className: "Rogue",
  level: 5,
  abilities: { str: 8, dex: 16, con: 12, int: 14, wis: 9, cha: 10 },
  saveProficiencies: ["dex", "int"],
  skillProficiencies: { stealth: "expertise", perception: "proficient" },
  maxHp: 20,
  armorClass: 14,
  speed: 30,
  notes: "",
  ...overrides,
});

let t: Table;
let miraId: string;

beforeEach(() => {
  t = new Table();
  for (const p of ["dm", "ann", "bob"]) t.join(p);
  t.run("dm", { type: "claim_dm_seat" });
  const created = t.only(t.run("ann", { type: "create_character", sheet: sheet() }));
  miraId = created.type === "character_created" ? created.payload.character.id : "";
});

describe("the DM seat", () => {
  const samples: Record<string, CommandInput> = {
    narrate: { type: "narrate", text: "x" },
    request_check: { type: "request_check", characterIds: ["x"], check: { kind: "ability", ability: "str" } },
    dismiss_check: { type: "dismiss_check", requestId: "x" },
    start_encounter: { type: "start_encounter" },
    end_encounter: { type: "end_encounter" },
    add_combatant: { type: "add_combatant", name: "x", maxHp: 5 },
    add_monster: { type: "add_monster", srdIndex: "goblin" },
    remove_combatant: { type: "remove_combatant", combatantId: "x" },
    set_initiative: { type: "set_initiative", combatantId: "x", initiative: 3 },
    next_turn: { type: "next_turn" },
  };

  it("has a sample for every DM command", () => {
    expect(Object.keys(samples).sort()).toEqual([...DM_COMMAND_TYPES].sort());
  });

  it.each(Object.entries(samples))("refuses %s from a player", (_type, command) => {
    expect(refusal(() => t.run("ann", command))).toBe("forbidden");
  });

  it("refuses every DM command when the seat is empty, even from the former DM", () => {
    t.run("dm", { type: "release_dm_seat" });
    for (const command of Object.values(samples)) expect(refusal(() => t.run("dm", command))).toBe("forbidden");
  });

  it("can be claimed only when empty and released only by its holder", () => {
    expect(refusal(() => t.run("ann", { type: "claim_dm_seat" }))).toBe("conflict");
    expect(refusal(() => t.run("dm", { type: "claim_dm_seat" }))).toBe("conflict");
    expect(refusal(() => t.run("ann", { type: "release_dm_seat" }))).toBe("forbidden");
    t.run("dm", { type: "release_dm_seat" });
    expect(t.state.dm).toBeNull();
    t.run("ann", { type: "claim_dm_seat" });
    expect(isDm(t.state, "ann")).toBe(true);
    expect(refusal(() => t.run("ann", { type: "narrate", text: "Night falls." }))).toBe("accepted");
  });
});

describe("dice and chat", () => {
  it("rolls on the server with the injected dice", () => {
    t.dice = [4, 5];
    const event = t.only(t.run("ann", { type: "roll", expression: "2d6+3", label: "Sneak attack" }));
    expect(event).toMatchObject({ type: "roll", visibility: { scope: "public" }, payload: { label: "Sneak attack", result: { total: 12 } } });
  });

  it("refuses bad dice with the parser's message", () => {
    expect(refusal(() => t.run("ann", { type: "roll", expression: "2d" }))).toBe("invalid");
    expect(refusal(() => t.run("ann", { type: "roll", expression: "2d6", mode: "advantage" }))).toBe("invalid");
  });

  it("lets only the DM roll in secret, and hides that roll from players", () => {
    expect(refusal(() => t.run("ann", { type: "roll", expression: "1d20", secret: true }))).toBe("forbidden");
    t.dice = [17];
    const event = t.only(t.run("dm", { type: "roll", expression: "1d20", secret: true }));
    expect(event.visibility).toEqual({ scope: "dm" });
    expect(redactEvent(event, { playerId: "ann", isDm: false })).toBeNull();
  });

  it("routes whispers", () => {
    const toDm = t.only(t.run("ann", { type: "chat", text: "I palm the key", to: { kind: "dm" } }));
    expect(redactEvent(toDm, { playerId: "bob", isDm: false })).toBeNull();
    expect(redactEvent(toDm, { playerId: "ann", isDm: false })).not.toBeNull();

    const toPlayer = t.only(t.run("dm", { type: "chat", text: "You notice a draft", to: { kind: "player", playerId: "bob" } }));
    expect(redactEvent(toPlayer, { playerId: "bob", isDm: false })).not.toBeNull();
    expect(redactEvent(toPlayer, { playerId: "ann", isDm: false })).toBeNull();

    expect(refusal(() => t.run("ann", { type: "chat", text: "hey", to: { kind: "player", playerId: "bob" } }))).toBe("forbidden");
    expect(refusal(() => t.run("dm", { type: "chat", text: "hey", to: { kind: "player", playerId: "nobody" } }))).toBe("not_found");
  });
});

describe("characters", () => {
  it("starts at full hit points and belongs to its creator", () => {
    expect(t.state.characters[miraId]).toMatchObject({ ownerId: "ann", hp: { current: 20, max: 20, temp: 0 }, conditions: [] });
  });

  it("can be edited by its owner and the DM, not by another player", () => {
    expect(refusal(() => t.run("bob", { type: "update_character", characterId: miraId, sheet: sheet({ name: "Hax" }) }))).toBe("forbidden");
    expect(refusal(() => t.run("bob", { type: "delete_character", characterId: miraId }))).toBe("forbidden");
    expect(refusal(() => t.run("bob", { type: "adjust_hp", target: { kind: "character", characterId: miraId }, change: { op: "damage", amount: 5 } }))).toBe("forbidden");
    t.run("dm", { type: "update_character", characterId: miraId, sheet: sheet({ name: "Mira the Bold" }) });
    expect(t.state.characters[miraId]?.sheet.name).toBe("Mira the Bold");
    expect(t.state.characters[miraId]?.ownerId).toBe("ann");
  });

  it("keeps a full-health character full when the maximum rises, and clamps when it falls", () => {
    t.run("ann", { type: "update_character", characterId: miraId, sheet: sheet({ maxHp: 26 }) });
    expect(t.state.characters[miraId]?.hp).toEqual({ current: 26, max: 26, temp: 0 });
    t.run("ann", { type: "adjust_hp", target: { kind: "character", characterId: miraId }, change: { op: "damage", amount: 6 } });
    t.run("ann", { type: "update_character", characterId: miraId, sheet: sheet({ maxHp: 30 }) });
    expect(t.state.characters[miraId]?.hp).toEqual({ current: 20, max: 30, temp: 0 });
    t.run("ann", { type: "update_character", characterId: miraId, sheet: sheet({ maxHp: 12 }) });
    expect(t.state.characters[miraId]?.hp).toEqual({ current: 12, max: 12, temp: 0 });
  });

  it("applies damage through temporary hit points and caps healing", () => {
    const target = { kind: "character" as const, characterId: miraId };
    t.run("ann", { type: "adjust_hp", target, change: { op: "temp", amount: 5 } });
    const hit = t.only(t.run("dm", { type: "adjust_hp", target, change: { op: "damage", amount: 7 } }));
    expect(hit).toMatchObject({ payload: { hp: { current: 18, max: 20, temp: 0 }, band: "healthy", change: { op: "damage", amount: 7 } } });
    expect(hit).not.toHaveProperty("secret");
    t.run("ann", { type: "adjust_hp", target, change: { op: "heal", amount: 99 } });
    expect(t.state.characters[miraId]?.hp.current).toBe(20);
  });

  it("emits nothing when a condition is already in the requested state", () => {
    const target = { kind: "character" as const, characterId: miraId };
    expect(t.run("ann", { type: "set_condition", target, condition: "prone", active: true })).toHaveLength(1);
    expect(t.run("ann", { type: "set_condition", target, condition: "prone", active: true })).toHaveLength(0);
    expect(t.run("ann", { type: "set_condition", target, condition: "blinded", active: false })).toHaveLength(0);
    expect(t.state.characters[miraId]?.conditions).toEqual(["prone"]);
  });
});

describe("checks", () => {
  it("rolls with the modifier from the sheet", () => {
    // Level 5 (+3), Dex 16 (+3), Stealth expertise: 3 + 2 x 3 = +9.
    t.dice = [10];
    const event = t.only(t.run("ann", { type: "roll_check", characterId: miraId, check: { kind: "skill", skill: "stealth" } }));
    expect(event).toMatchObject({ type: "check_rolled", payload: { roll: { natural: 10, modifier: 9, total: 19 } } });
    expect(event.payload).not.toHaveProperty("outcome");
  });

  it("refuses rolling for someone else's character", () => {
    expect(refusal(() => t.run("bob", { type: "roll_check", characterId: miraId, check: { kind: "ability", ability: "str" } }))).toBe("forbidden");
  });

  it("resolves a requested check against a DC the player never receives", () => {
    const check = { kind: "skill" as const, skill: "perception" as const };
    const asked = t.only(t.run("dm", { type: "request_check", characterIds: [miraId, miraId], check, dc: 13 }));
    const requestId = asked.type === "check_requested" ? asked.payload.requestId : "";
    expect(asked).toMatchObject({ payload: { characterIds: [miraId] }, secret: { dc: 13 } });
    expect(JSON.stringify(redactEvent(asked, { playerId: "ann", isDm: false }))).not.toContain("13");
    expect(t.viewOf("ann").pendingChecks[requestId]).not.toHaveProperty("dc");
    expect(t.viewOf("dm").pendingChecks[requestId]?.dc).toBe(13);

    // Wis 9 (-1) + proficiency 3 = +2. A natural 11 totals 13 and meets DC 13.
    t.dice = [11];
    // The client claims a different, easier check; the request decides.
    const rolled = t.only(
      t.run("ann", { type: "roll_check", characterId: miraId, check: { kind: "skill", skill: "stealth" }, requestId }),
    );
    expect(rolled).toMatchObject({ payload: { check, roll: { modifier: 2, total: 13 }, outcome: "success", requestId }, secret: { dc: 13 } });
    expect(redactEvent(rolled, { playerId: "bob", isDm: false })).not.toHaveProperty("secret");
    expect(t.state.pendingChecks).toEqual({});
    expect(refusal(() => t.run("ann", { type: "roll_check", characterId: miraId, check, requestId }))).toBe("not_found");
  });

  it("reports failure one short of the DC, and no outcome when the request has no DC", () => {
    const check = { kind: "save" as const, ability: "dex" as const };
    let asked = t.only(t.run("dm", { type: "request_check", characterIds: [miraId], check, dc: 15 }));
    t.dice = [8]; // +6 Dex save: 14
    let rolled = t.only(t.run("ann", { type: "roll_check", characterId: miraId, check, requestId: asked.type === "check_requested" ? asked.payload.requestId : "" }));
    expect(rolled).toMatchObject({ payload: { roll: { total: 14 }, outcome: "failure" } });

    asked = t.only(t.run("dm", { type: "request_check", characterIds: [miraId], check }));
    expect(asked).not.toHaveProperty("secret");
    t.dice = [8];
    rolled = t.only(t.run("ann", { type: "roll_check", characterId: miraId, check, requestId: asked.type === "check_requested" ? asked.payload.requestId : "" }));
    expect(rolled.payload).not.toHaveProperty("outcome");
    expect(rolled).not.toHaveProperty("secret");
  });

  it("refuses a request naming an unknown character, and lets the DM dismiss one", () => {
    const check = { kind: "ability" as const, ability: "str" as const };
    expect(refusal(() => t.run("dm", { type: "request_check", characterIds: ["ghost"], check }))).toBe("not_found");
    const asked = t.only(t.run("dm", { type: "request_check", characterIds: [miraId], check }));
    const requestId = asked.type === "check_requested" ? asked.payload.requestId : "";
    t.run("dm", { type: "dismiss_check", requestId });
    expect(t.state.pendingChecks).toEqual({});
    expect(refusal(() => t.run("dm", { type: "dismiss_check", requestId }))).toBe("not_found");
  });
});

describe("encounters", () => {
  beforeEach(() => {
    t.run("dm", { type: "start_encounter" });
  });

  it("needs a running encounter", () => {
    t.run("dm", { type: "end_encounter" });
    expect(refusal(() => t.run("dm", { type: "add_monster", srdIndex: "goblin" }))).toBe("conflict");
    expect(refusal(() => t.run("ann", { type: "join_encounter", characterId: miraId }))).toBe("conflict");
    expect(refusal(() => t.run("dm", { type: "end_encounter" }))).toBe("conflict");
    t.run("dm", { type: "start_encounter" });
    expect(refusal(() => t.run("dm", { type: "start_encounter" }))).toBe("conflict");
  });

  it("adds SRD monsters as a numbered group sharing one initiative roll", () => {
    t.dice = [10]; // one d20 for the group; goblin Dex 14 gives +2
    const added = t.run("dm", { type: "add_monster", srdIndex: "goblin", count: 3 });
    expect(t.dice).toEqual([]);
    expect(added.map((e) => (e.type === "combatant_added" ? e.payload.combatant.name : ""))).toEqual(["Goblin 1", "Goblin 2", "Goblin 3"]);
    expect(t.state.encounter?.combatants.map((c) => c.initiative)).toEqual([12, 12, 12]);
    // SRD goblin: AC 15, 7 hit points.
    expect(added[0]).toMatchObject({ secret: { hp: { current: 7, max: 7, temp: 0 }, armorClass: 15, srdIndex: "goblin" } });

    t.dice = [5];
    const more = t.run("dm", { type: "add_monster", srdIndex: "goblin" });
    expect(more[0]).toMatchObject({ payload: { combatant: { name: "Goblin 4" } } });
    expect(refusal(() => t.run("dm", { type: "add_monster", srdIndex: "tarrasque-jr" }))).toBe("not_found");
  });

  it("hides a monster's numbers from players and shows them to the DM", () => {
    t.dice = [10];
    t.run("dm", { type: "add_monster", srdIndex: "goblin" });
    const seenByPlayer = t.viewOf("ann").encounter?.combatants[0];
    expect(seenByPlayer).toMatchObject({ name: "Goblin", band: "healthy", hidden: true });
    expect(seenByPlayer).not.toHaveProperty("hp");
    expect(seenByPlayer).not.toHaveProperty("armorClass");
    expect(seenByPlayer).not.toHaveProperty("srdIndex");
    expect(t.viewOf("dm").encounter?.combatants[0]).toMatchObject({ hp: { current: 7 }, armorClass: 15, srdIndex: "goblin" });
  });

  it("shows players only the health band when a hidden monster is hurt", () => {
    t.dice = [10];
    const [added] = t.run("dm", { type: "add_monster", srdIndex: "goblin" });
    const combatantId = added?.type === "combatant_added" ? added.payload.combatant.id : "";
    const target = { kind: "combatant" as const, combatantId };

    expect(refusal(() => t.run("ann", { type: "adjust_hp", target, change: { op: "damage", amount: 1 } }))).toBe("forbidden");
    const hit = t.only(t.run("dm", { type: "adjust_hp", target, change: { op: "damage", amount: 4 } }));
    expect(hit).toMatchObject({ payload: { band: "bloodied" }, secret: { hp: { current: 3, max: 7 }, change: { amount: 4 } } });
    expect(hit.payload).not.toHaveProperty("hp");
    expect(hit.payload).not.toHaveProperty("change");

    expect(t.viewOf("ann").encounter?.combatants[0]).toMatchObject({ band: "bloodied" });
    expect(t.viewOf("ann").encounter?.combatants[0]).not.toHaveProperty("hp");
    t.run("dm", { type: "adjust_hp", target, change: { op: "damage", amount: 40 } });
    expect(t.viewOf("ann").encounter?.combatants[0]).toMatchObject({ band: "down" });
    expect(t.state.encounter?.combatants[0]).toMatchObject({ hp: { current: 0 } });
  });

  it("publishes numbers for a creature the DM chose not to hide", () => {
    const event = t.only(t.run("dm", { type: "add_combatant", name: "Town guard", maxHp: 11, armorClass: 16, initiative: 9, hidden: false }));
    expect(event).not.toHaveProperty("secret");
    expect(t.viewOf("ann").encounter?.combatants[0]).toMatchObject({ hp: { current: 11, max: 11 }, armorClass: 16 });
    expect(t.dice).toEqual([]);
  });

  it("rolls initiative for a custom creature when none is given", () => {
    t.dice = [13];
    t.run("dm", { type: "add_combatant", name: "Ogre", maxHp: 59, initiativeBonus: -1 });
    expect(t.state.encounter?.combatants[0]?.initiative).toBe(12);
  });

  it("rolls a character's initiative from Dexterity and refuses a second entry", () => {
    t.dice = [9]; // Dex 16: +3
    const event = t.only(t.run("ann", { type: "join_encounter", characterId: miraId }));
    expect(event).toMatchObject({ payload: { combatant: { kind: "pc", name: "Mira", initiative: 12, characterId: miraId } } });
    expect(refusal(() => t.run("ann", { type: "join_encounter", characterId: miraId }))).toBe("conflict");
    expect(refusal(() => t.run("bob", { type: "join_encounter", characterId: miraId }))).toBe("forbidden");
  });

  it("refuses hit point changes aimed at a player character's combatant", () => {
    t.dice = [9];
    const event = t.only(t.run("ann", { type: "join_encounter", characterId: miraId }));
    const combatantId = event.type === "combatant_added" ? event.payload.combatant.id : "";
    expect(refusal(() => t.run("dm", { type: "adjust_hp", target: { kind: "combatant", combatantId }, change: { op: "damage", amount: 1 } }))).toBe("invalid");
  });

  it("runs turns in initiative order and counts rounds", () => {
    expect(refusal(() => t.run("dm", { type: "next_turn" }))).toBe("conflict");
    t.run("dm", { type: "add_combatant", name: "Slow", maxHp: 5, initiative: 3 });
    t.run("dm", { type: "add_combatant", name: "Fast", maxHp: 5, initiative: 19 });
    const names = () => {
      const e = t.state.encounter;
      return `${e?.round}:${e?.combatants.find((c) => c.id === e.currentId)?.name}`;
    };
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      t.run("dm", { type: "next_turn" });
      seen.push(names());
    }
    expect(seen).toEqual(["1:Fast", "1:Slow", "2:Fast", "2:Slow"]);

    const slow = t.state.encounter?.combatants.find((c) => c.name === "Slow");
    t.run("dm", { type: "set_initiative", combatantId: slow?.id ?? "", initiative: 25 });
    expect(t.state.encounter?.combatants.map((c) => c.name)).toEqual(["Slow", "Fast"]);
    // It is Slow's turn in round 2 and Slow now sits first in the order, so Fast is still to act this round.
    t.run("dm", { type: "remove_combatant", combatantId: slow?.id ?? "" });
    expect(names()).toBe("2:Fast");
  });
});
