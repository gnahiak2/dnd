import type { CheckSpec } from "@lanternkeep/rules";
import type { RoomEvent } from "./events";
import type { Character, Combatant, DmController } from "./model";

export interface PlayerInfo {
  id: string;
  displayName: string;
}

export interface PendingCheck {
  requestId: string;
  /** Characters that still owe a roll. */
  characterIds: string[];
  check: CheckSpec;
  note?: string;
  /** Known to the server and the DM only. */
  dc?: number;
}

export interface Encounter {
  id: string;
  round: number;
  /** Whose turn it is; null until the first turn starts. */
  currentId: string | null;
  /** In initiative order, highest first. */
  combatants: Combatant[];
}

/**
 * Everything a room is, minus the scrolling log. It is rebuilt by reducing the
 * room's events in order, on the server (complete) and in each client (as far
 * as that viewer is allowed to see).
 */
export interface RoomState {
  name: string;
  /** Sequence number of the last event applied. */
  seq: number;
  players: Record<string, PlayerInfo>;
  dm: DmController | null;
  characters: Record<string, Character>;
  encounter: Encounter | null;
  pendingChecks: Record<string, PendingCheck>;
}

export function initialRoomState(): RoomState {
  return { name: "", seq: 0, players: {}, dm: null, characters: {}, encounter: null, pendingChecks: {} };
}

export function isDm(state: RoomState, playerId: string): boolean {
  return state.dm?.kind === "human" && state.dm.playerId === playerId;
}

/** Highest initiative first; ties keep the order in which combatants joined. */
export function sortByInitiative(combatants: readonly Combatant[]): Combatant[] {
  return combatants
    .map((combatant, index) => ({ combatant, index }))
    .sort((a, b) => b.combatant.initiative - a.combatant.initiative || a.index - b.index)
    .map((entry) => entry.combatant);
}

/** The combatant who acts after the current one, and the round that turn belongs to. */
export function nextTurn(encounter: Encounter): { combatantId: string; round: number } | null {
  const first = encounter.combatants[0];
  if (!first) return null;
  const index = encounter.combatants.findIndex((c) => c.id === encounter.currentId);
  if (index === -1) return { combatantId: first.id, round: encounter.round };
  const next = encounter.combatants[index + 1];
  return next ? { combatantId: next.id, round: encounter.round } : { combatantId: first.id, round: encounter.round + 1 };
}

function withoutKey<V>(record: Record<string, V>, key: string): Record<string, V> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function removeCombatants(encounter: Encounter, remove: (c: Combatant) => boolean): Encounter {
  const combatants = encounter.combatants.filter((c) => !remove(c));
  let currentId = encounter.currentId;
  let round = encounter.round;
  const current = encounter.combatants.find((c) => c.id === currentId);
  if (current && remove(current)) {
    // The turn passes to the next survivor in order.
    const after = encounter.combatants.slice(encounter.combatants.indexOf(current) + 1).find((c) => !remove(c));
    if (after) currentId = after.id;
    else {
      currentId = combatants[0]?.id ?? null;
      if (currentId !== null) round += 1;
    }
  }
  return { ...encounter, combatants, currentId, round };
}

function mapCombatant(encounter: Encounter | null, id: string, f: (c: Combatant) => Combatant): Encounter | null {
  if (!encounter) return encounter;
  return { ...encounter, combatants: encounter.combatants.map((c) => (c.id === id ? f(c) : c)) };
}

function toggle<T>(list: readonly T[], item: T, active: boolean): T[] {
  const without = list.filter((x) => x !== item);
  return active ? [...without, item] : without;
}

/** Applies one event. Pure: returns a new state and never mutates the old one. */
export function reduce(state: RoomState, event: RoomEvent): RoomState {
  const next = apply(state, event);
  return next.seq === event.seq ? next : { ...next, seq: event.seq };
}

function apply(state: RoomState, event: RoomEvent): RoomState {
  switch (event.type) {
    case "room_created":
      return { ...state, name: event.payload.name };

    case "player_joined": {
      const { playerId, displayName } = event.payload;
      return { ...state, players: { ...state.players, [playerId]: { id: playerId, displayName } } };
    }

    case "dm_seat_changed":
      return { ...state, dm: event.payload.controller };

    case "chat":
    case "narration":
    case "roll":
      return state;

    case "check_requested": {
      const { requestId, characterIds, check, note } = event.payload;
      const pending: PendingCheck = { requestId, characterIds, check };
      if (note !== undefined) pending.note = note;
      if (event.secret) pending.dc = event.secret.dc;
      return { ...state, pendingChecks: { ...state.pendingChecks, [requestId]: pending } };
    }

    case "check_dismissed":
      return { ...state, pendingChecks: withoutKey(state.pendingChecks, event.payload.requestId) };

    case "check_rolled": {
      const { requestId, characterId } = event.payload;
      const pending = requestId === undefined ? undefined : state.pendingChecks[requestId];
      if (!pending) return state;
      const characterIds = pending.characterIds.filter((id) => id !== characterId);
      return {
        ...state,
        pendingChecks:
          characterIds.length === 0
            ? withoutKey(state.pendingChecks, pending.requestId)
            : { ...state.pendingChecks, [pending.requestId]: { ...pending, characterIds } },
      };
    }

    case "character_created":
      return { ...state, characters: { ...state.characters, [event.payload.character.id]: event.payload.character } };

    case "character_updated": {
      const character = event.payload.character;
      const encounter = state.encounter && {
        ...state.encounter,
        combatants: state.encounter.combatants.map((c) =>
          c.kind === "pc" && c.characterId === character.id ? { ...c, name: character.sheet.name } : c,
        ),
      };
      return { ...state, characters: { ...state.characters, [character.id]: character }, encounter };
    }

    case "character_deleted": {
      const id = event.payload.characterId;
      const pendingChecks: Record<string, PendingCheck> = {};
      for (const pending of Object.values(state.pendingChecks)) {
        const characterIds = pending.characterIds.filter((c) => c !== id);
        if (characterIds.length > 0) pendingChecks[pending.requestId] = { ...pending, characterIds };
      }
      return {
        ...state,
        characters: withoutKey(state.characters, id),
        pendingChecks,
        encounter:
          state.encounter && removeCombatants(state.encounter, (c) => c.kind === "pc" && c.characterId === id),
      };
    }

    case "hp_changed": {
      const { target, band } = event.payload;
      const hp = event.payload.hp ?? event.secret?.hp;
      if (target.kind === "character") {
        const character = state.characters[target.characterId];
        if (!character || !hp) return state;
        return { ...state, characters: { ...state.characters, [character.id]: { ...character, hp } } };
      }
      return {
        ...state,
        encounter: mapCombatant(state.encounter, target.combatantId, (c) =>
          c.kind === "npc" ? (hp ? { ...c, band, hp } : { ...c, band }) : c,
        ),
      };
    }

    case "condition_set": {
      const { target, condition, active } = event.payload;
      if (target.kind === "character") {
        const character = state.characters[target.characterId];
        if (!character) return state;
        const conditions = toggle(character.conditions, condition, active);
        return { ...state, characters: { ...state.characters, [character.id]: { ...character, conditions } } };
      }
      return {
        ...state,
        encounter: mapCombatant(state.encounter, target.combatantId, (c) =>
          c.kind === "npc" ? { ...c, conditions: toggle(c.conditions, condition, active) } : c,
        ),
      };
    }

    case "encounter_started":
      return { ...state, encounter: { id: event.payload.encounterId, round: 1, currentId: null, combatants: [] } };

    case "encounter_ended":
      return { ...state, encounter: null };

    case "combatant_added": {
      if (!state.encounter) return state;
      const base = event.payload.combatant;
      const combatant: Combatant = base.kind === "npc" && event.secret ? { ...base, ...event.secret } : base;
      return {
        ...state,
        encounter: { ...state.encounter, combatants: sortByInitiative([...state.encounter.combatants, combatant]) },
      };
    }

    case "combatant_removed":
      return {
        ...state,
        encounter: state.encounter && removeCombatants(state.encounter, (c) => c.id === event.payload.combatantId),
      };

    case "initiative_set": {
      if (!state.encounter) return state;
      const { combatantId, initiative } = event.payload;
      const combatants = state.encounter.combatants.map((c) => (c.id === combatantId ? { ...c, initiative } : c));
      return { ...state, encounter: { ...state.encounter, combatants: sortByInitiative(combatants) } };
    }

    case "turn_advanced":
      return (
        state.encounter && {
          ...state,
          encounter: { ...state.encounter, round: event.payload.round, currentId: event.payload.combatantId },
        }
      ) ?? state;
  }
}

export function reduceAll(events: Iterable<RoomEvent>, from: RoomState = initialRoomState()): RoomState {
  let state = from;
  for (const event of events) state = reduce(state, event);
  return state;
}
