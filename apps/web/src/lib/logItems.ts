import type { D20Roll, EventOf, RoomEvent } from "@lanternkeep/protocol";
import type { RollResult } from "@lanternkeep/rules";
import { describeCheck, describeHpChange, formatHp, joinNames } from "./describe";

interface Base {
  seq: number;
  at: number;
  type: RoomEvent["type"];
}

export type LogItem = Base &
  (
    | { kind: "narration"; text: string }
    | { kind: "chat"; speaker: string; text: string; whisper: string | null }
    | { kind: "roll"; speaker: string; label: string | null; result: RollResult; secret: boolean }
    | { kind: "request"; text: string; dc: number | null }
    | { kind: "check"; who: string; what: string; roll: D20Roll; outcome: "success" | "failure" | null; dc: number | null }
    | { kind: "system"; text: string }
  );

/**
 * Turns the event log into what the feed shows. Names are resolved as of each
 * event, so a line still reads correctly after a character is renamed or
 * deleted. Events with nothing to say to this viewer produce no item.
 */
export function buildLogItems(events: readonly RoomEvent[]): LogItem[] {
  const players = new Map<string, string>();
  const characters = new Map<string, string>();
  const combatants = new Map<string, string>();
  const bands = new Map<string, string>();
  const items: LogItem[] = [];

  const player = (id: string): string => players.get(id) ?? "Someone";
  const character = (id: string): string => characters.get(id) ?? "Someone";
  const actorName = (event: RoomEvent): string =>
    event.actor.kind === "player" ? player(event.actor.playerId) : event.actor.kind === "ai" ? "The DM" : "The table";

  for (const event of events) {
    const base: Base = { seq: event.seq, at: event.at, type: event.type };
    const system = (text: string): void => {
      items.push({ ...base, kind: "system", text });
    };

    switch (event.type) {
      case "room_created":
        system(`${event.payload.name} opens.`);
        break;
      case "player_joined":
        players.set(event.payload.playerId, event.payload.displayName);
        system(`${event.payload.displayName} takes a seat.`);
        break;
      case "dm_seat_changed": {
        const controller = event.payload.controller;
        if (controller === null) system(`${actorName(event)} leaves the DM seat. It is empty.`);
        else if (controller.kind === "ai") system("The AI DM takes the DM seat.");
        else system(`${player(controller.playerId)} takes the DM seat.`);
        break;
      }
      case "narration":
        items.push({ ...base, kind: "narration", text: event.payload.text });
        break;
      case "chat": {
        const to = event.payload.to;
        const whisper = !to ? null : to.kind === "dm" ? "whisper to DM" : `whisper to ${player(to.playerId)}`;
        items.push({ ...base, kind: "chat", speaker: actorName(event), text: event.payload.text, whisper });
        break;
      }
      case "roll":
        items.push({
          ...base,
          kind: "roll",
          speaker: actorName(event),
          label: event.payload.label ?? null,
          result: event.payload.result,
          secret: event.visibility.scope === "dm",
        });
        break;
      case "check_requested": {
        const who = joinNames(event.payload.characterIds.map(character));
        const note = event.payload.note ? ` (${event.payload.note})` : "";
        items.push({
          ...base,
          kind: "request",
          text: `The DM asks ${who} for a ${describeCheck(event.payload.check)}${note}.`,
          dc: event.secret?.dc ?? null,
        });
        break;
      }
      case "check_rolled":
        items.push({
          ...base,
          kind: "check",
          who: character(event.payload.characterId),
          what: describeCheck(event.payload.check),
          roll: event.payload.roll,
          outcome: event.payload.outcome ?? null,
          dc: event.secret?.dc ?? null,
        });
        break;
      case "character_created":
        characters.set(event.payload.character.id, event.payload.character.sheet.name);
        system(`${actorName(event)} brings ${event.payload.character.sheet.name} to the table.`);
        break;
      case "character_updated":
        characters.set(event.payload.character.id, event.payload.character.sheet.name);
        break;
      case "hp_changed":
        hpLine(event, system);
        break;
      case "encounter_started":
        system("An encounter begins. Roll initiative.");
        break;
      case "encounter_ended":
        system("The encounter ends.");
        break;
      case "combatant_added": {
        const { combatant } = event.payload;
        combatants.set(combatant.id, combatant.name);
        if (combatant.kind === "npc") bands.set(combatant.id, combatant.band);
        system(`${combatant.name} joins the encounter (initiative ${combatant.initiative}).`);
        break;
      }
      case "combatant_removed":
        system(`${combatants.get(event.payload.combatantId) ?? "A combatant"} leaves the encounter.`);
        break;
      case "turn_advanced":
        system(`Round ${event.payload.round}: ${combatants.get(event.payload.combatantId) ?? "someone"}'s turn.`);
        break;
      case "check_dismissed":
      case "character_deleted":
      case "condition_set":
      case "initiative_set":
        break;
    }
  }
  return items;

  function hpLine(event: EventOf<"hp_changed">, system: (text: string) => void): void {
    const { target, band } = event.payload;
    const hp = event.payload.hp ?? event.secret?.hp;
    const change = event.payload.change ?? event.secret?.change;
    const name = target.kind === "character" ? character(target.characterId) : (combatants.get(target.combatantId) ?? "A creature");
    const previous = target.kind === "combatant" ? bands.get(target.combatantId) : undefined;
    if (target.kind === "combatant") bands.set(target.combatantId, band);

    if (change && hp) {
      system(`${describeHpChange(name, change)} (${formatHp(hp)}).`);
      return;
    }
    // Exact numbers are hidden from this viewer: report only a visible change of state.
    if (band !== previous) {
      system(band === "down" ? `${name} is down.` : band === "bloodied" ? `${name} is bloodied.` : `${name} looks healthy again.`);
    }
  }
}
