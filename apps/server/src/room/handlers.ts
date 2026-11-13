import {
  type Actor,
  type Character,
  type Combatant,
  type Command,
  DM_COMMAND_TYPES,
  DM_ONLY,
  type EventDraft,
  type HpChange,
  type NpcCombatant,
  type RoomState,
  type Visibility,
  nextTurn,
} from "@lanternkeep/protocol";
import {
  type CheckStats,
  DiceError,
  type DieRoller,
  type HitPoints,
  abilityModifier,
  applyDamage,
  applyHealing,
  checkModifier,
  healthBand,
  initiativeModifier,
  rollD20Test,
  rollDice,
  setCurrentHp,
  setTempHp,
} from "@lanternkeep/rules";
import type { SrdDataset } from "@lanternkeep/srd-data";
import { CommandError } from "./errors";

export interface CommandContext {
  roller: DieRoller;
  srd: SrdDataset;
  newId: () => string;
}

export const ROOM_LIMITS = { characters: 60, combatants: 100, pendingChecks: 50 } as const;

export function actorIsDm(state: RoomState, actor: Actor): boolean {
  if (!state.dm) return false;
  if (actor.kind === "player") return state.dm.kind === "human" && state.dm.playerId === actor.playerId;
  return actor.kind === "ai" && state.dm.kind === "ai";
}

const fail = (code: CommandError["code"], message: string): never => {
  throw new CommandError(code, message);
};

function statsOf(character: Character): CheckStats {
  const { level, abilities, saveProficiencies, skillProficiencies } = character.sheet;
  return { level, abilities, saveProficiencies, skillProficiencies };
}

function applyHpChange(hp: HitPoints, change: HpChange): HitPoints {
  switch (change.op) {
    case "damage":
      return applyDamage(hp, change.amount);
    case "heal":
      return applyHealing(hp, change.amount);
    case "set":
      return setCurrentHp(hp, change.amount);
    case "temp":
      return setTempHp(hp, change.amount);
  }
}

/**
 * Decides what a command does. Pure apart from the injected dice: it reads the
 * room's state, checks the actor's rights and the rules, and returns the
 * events to append, or throws a CommandError. It never mutates state.
 */
export function handleCommand(state: RoomState, actor: Actor, command: Command, ctx: CommandContext): EventDraft[] {
  const dm = actorIsDm(state, actor);
  if (DM_COMMAND_TYPES.has(command.type) && !dm) fail("forbidden", "Only the DM can do that");

  const playerId = actor.kind === "player" ? actor.playerId : null;

  const character = (id: string): Character => state.characters[id] ?? fail("not_found", "No such character");
  const ownedCharacter = (id: string): Character => {
    const found = character(id);
    if (!dm && found.ownerId !== playerId) fail("forbidden", "That is not your character");
    return found;
  };
  const encounter = () => state.encounter ?? fail("conflict", "No encounter is running");
  const combatant = (id: string): Combatant =>
    encounter().combatants.find((c) => c.id === id) ?? fail("not_found", "No such combatant");
  const npc = (id: string): NpcCombatant => {
    const found = combatant(id);
    if (found.kind !== "npc") fail("invalid", "Player characters are changed through their character sheet");
    return found as NpcCombatant;
  };
  const roomForCombatants = (adding: number): void => {
    if (encounter().combatants.length + adding > ROOM_LIMITS.combatants) fail("conflict", "The encounter is full");
  };

  switch (command.type) {
    case "chat": {
      if (!command.to) return [{ type: "chat", payload: { text: command.text } }];
      if (playerId === null) fail("invalid", "Only players can whisper");
      const self = playerId as string;
      let visibility: Visibility;
      if (command.to.kind === "dm") {
        if (!state.dm) fail("conflict", "Nobody is in the DM seat");
        visibility = { scope: "players", playerIds: [self] };
      } else {
        if (!dm) fail("forbidden", "Only the DM can whisper to a player");
        if (!state.players[command.to.playerId]) fail("not_found", "No such player");
        visibility = { scope: "players", playerIds: [self, command.to.playerId] };
      }
      return [{ type: "chat", payload: { text: command.text, to: command.to }, visibility }];
    }

    case "roll": {
      if (command.secret && !dm) fail("forbidden", "Only the DM can roll in secret");
      try {
        const result = rollDice(command.expression, ctx.roller, command.mode);
        const payload = command.label ? { label: command.label, result } : { result };
        return [command.secret ? { type: "roll", payload, visibility: DM_ONLY } : { type: "roll", payload }];
      } catch (error) {
        if (error instanceof DiceError) fail("invalid", error.message);
        throw error;
      }
    }

    case "roll_check": {
      const who = ownedCharacter(command.characterId);
      let check = command.check;
      let dc: number | undefined;
      if (command.requestId !== undefined) {
        const pending = state.pendingChecks[command.requestId] ?? fail("not_found", "That check is no longer open");
        if (!pending.characterIds.includes(who.id)) fail("conflict", "That character has already rolled this check");
        // The request decides what is rolled, whatever the client sent.
        check = pending.check;
        dc = pending.dc;
      }
      const input = dc === undefined ? { modifier: checkModifier(statsOf(who), check), mode: command.mode } : { modifier: checkModifier(statsOf(who), check), mode: command.mode, dc };
      const { mode, d20s, natural, modifier, total, success } = rollD20Test(input, ctx.roller);
      const draft: EventDraft = {
        type: "check_rolled",
        payload: { characterId: who.id, check, roll: { mode, d20s, natural, modifier, total } },
      };
      if (command.requestId !== undefined) draft.payload.requestId = command.requestId;
      if (success !== undefined) draft.payload.outcome = success ? "success" : "failure";
      if (dc !== undefined) draft.secret = { dc };
      return [draft];
    }

    case "create_character": {
      if (playerId === null) fail("invalid", "Only players can own characters");
      if (Object.keys(state.characters).length >= ROOM_LIMITS.characters) fail("conflict", "This room has too many characters");
      const { maxHp } = command.sheet;
      const created: Character = {
        id: ctx.newId(),
        ownerId: playerId as string,
        sheet: command.sheet,
        hp: { current: maxHp, max: maxHp, temp: 0 },
        conditions: [],
      };
      return [{ type: "character_created", payload: { character: created } }];
    }

    case "update_character": {
      const before = ownedCharacter(command.characterId);
      const max = command.sheet.maxHp;
      // A character at full health stays at full health when the maximum changes.
      const current = before.hp.current === before.hp.max ? max : Math.min(before.hp.current, max);
      const updated: Character = { ...before, sheet: command.sheet, hp: { ...before.hp, max, current } };
      return [{ type: "character_updated", payload: { character: updated } }];
    }

    case "delete_character": {
      const doomed = ownedCharacter(command.characterId);
      return [{ type: "character_deleted", payload: { characterId: doomed.id } }];
    }

    case "adjust_hp": {
      const { target, change } = command;
      if (target.kind === "character") {
        const hp = applyHpChange(ownedCharacter(target.characterId).hp, change);
        return [{ type: "hp_changed", payload: { target, band: healthBand(hp), hp, change } }];
      }
      if (!dm) fail("forbidden", "Only the DM can change a creature's hit points");
      const creature = npc(target.combatantId);
      const before = creature.hp ?? fail("internal", "Creature has no hit points on record");
      const hp = applyHpChange(before, change);
      const band = healthBand(hp);
      return [
        creature.hidden
          ? { type: "hp_changed", payload: { target, band }, secret: { hp, change } }
          : { type: "hp_changed", payload: { target, band, hp, change } },
      ];
    }

    case "set_condition": {
      const { target, condition, active } = command;
      let current: readonly string[];
      if (target.kind === "character") current = ownedCharacter(target.characterId).conditions;
      else {
        if (!dm) fail("forbidden", "Only the DM can change a creature's conditions");
        current = npc(target.combatantId).conditions;
      }
      if (current.includes(condition) === active) return [];
      return [{ type: "condition_set", payload: { target, condition, active } }];
    }

    case "join_encounter": {
      const who = ownedCharacter(command.characterId);
      if (encounter().combatants.some((c) => c.kind === "pc" && c.characterId === who.id)) {
        fail("conflict", `${who.sheet.name} is already in the encounter`);
      }
      roomForCombatants(1);
      const roll = rollD20Test({ modifier: initiativeModifier(statsOf(who)), mode: command.mode }, ctx.roller);
      return [
        {
          type: "combatant_added",
          payload: { combatant: { kind: "pc", id: ctx.newId(), name: who.sheet.name, initiative: roll.total, characterId: who.id } },
        },
      ];
    }

    case "claim_dm_seat": {
      if (playerId === null) fail("invalid", "Only players can claim the seat this way");
      if (state.dm) fail("conflict", dm ? "You already have the DM seat" : "The DM seat is taken");
      return [{ type: "dm_seat_changed", payload: { controller: { kind: "human", playerId: playerId as string } } }];
    }

    case "release_dm_seat": {
      if (!dm) fail("forbidden", "You are not in the DM seat");
      return [{ type: "dm_seat_changed", payload: { controller: null } }];
    }

    case "narrate":
      return [{ type: "narration", payload: { text: command.text } }];

    case "request_check": {
      if (Object.keys(state.pendingChecks).length >= ROOM_LIMITS.pendingChecks) {
        fail("conflict", "Too many open check requests; dismiss some first");
      }
      const characterIds = [...new Set(command.characterIds)];
      characterIds.forEach(character);
      const draft: EventDraft = {
        type: "check_requested",
        payload: { requestId: ctx.newId(), characterIds, check: command.check },
      };
      if (command.note) draft.payload.note = command.note;
      if (command.dc !== undefined) draft.secret = { dc: command.dc };
      return [draft];
    }

    case "dismiss_check": {
      if (!state.pendingChecks[command.requestId]) fail("not_found", "That check is no longer open");
      return [{ type: "check_dismissed", payload: { requestId: command.requestId } }];
    }

    case "start_encounter": {
      if (state.encounter) fail("conflict", "An encounter is already running");
      return [{ type: "encounter_started", payload: { encounterId: ctx.newId() } }];
    }

    case "end_encounter": {
      encounter();
      return [{ type: "encounter_ended", payload: {} }];
    }

    case "add_combatant": {
      roomForCombatants(1);
      const initiative = command.initiative ?? rollD20Test({ modifier: command.initiativeBonus }, ctx.roller).total;
      return [
        npcAdded(
          { id: ctx.newId(), name: command.name, initiative, hidden: command.hidden },
          { hp: { current: command.maxHp, max: command.maxHp, temp: 0 }, armorClass: command.armorClass },
        ),
      ];
    }

    case "add_monster": {
      const monster = ctx.srd.get("monsters", command.srdIndex) ?? fail("not_found", "No such monster in the SRD");
      roomForCombatants(command.count);
      const baseName = command.name ?? monster.name;
      const taken = new Set(encounter().combatants.map((c) => c.name));
      // Number the creatures when there are several, now or already on the table ("Goblin", "Goblin 2", ...).
      const prefix = `${baseName} `;
      const numbered =
        command.count > 1 || [...taken].some((name) => name === baseName || (name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length))));
      // The DM makes one initiative roll for a whole group of identical creatures.
      const initiative = rollD20Test({ modifier: abilityModifier(monster.dexterity) }, ctx.roller).total;
      const drafts: EventDraft[] = [];
      let n = 1;
      for (let i = 0; i < command.count; i += 1) {
        let name = baseName;
        if (numbered) {
          while (taken.has(`${baseName} ${n}`)) n += 1;
          name = `${baseName} ${n}`;
        }
        taken.add(name);
        drafts.push(
          npcAdded(
            { id: ctx.newId(), name, initiative, hidden: command.hidden },
            {
              hp: { current: monster.hit_points, max: monster.hit_points, temp: 0 },
              armorClass: monster.armor_class[0]?.value,
              srdIndex: monster.index,
            },
          ),
        );
      }
      return drafts;
    }

    case "remove_combatant":
      return [{ type: "combatant_removed", payload: { combatantId: combatant(command.combatantId).id } }];

    case "set_initiative":
      return [
        { type: "initiative_set", payload: { combatantId: combatant(command.combatantId).id, initiative: command.initiative } },
      ];

    case "next_turn": {
      const turn = nextTurn(encounter()) ?? fail("conflict", "Nobody is in the encounter yet");
      return [{ type: "turn_advanced", payload: turn }];
    }
  }
}

/** A hidden creature's exact numbers go in the DM-only part; otherwise they are public. */
function npcAdded(
  base: { id: string; name: string; initiative: number; hidden: boolean },
  stats: { hp: HitPoints; armorClass: number | undefined; srdIndex?: string },
): EventDraft {
  const secrets: { hp: HitPoints; armorClass?: number; srdIndex?: string } = { hp: stats.hp };
  if (stats.armorClass !== undefined) secrets.armorClass = stats.armorClass;
  if (stats.srdIndex !== undefined) secrets.srdIndex = stats.srdIndex;
  const combatant: NpcCombatant = { kind: "npc", ...base, band: healthBand(stats.hp), conditions: [] };
  return base.hidden
    ? { type: "combatant_added", payload: { combatant }, secret: secrets }
    : { type: "combatant_added", payload: { combatant: { ...combatant, ...secrets } } };
}
