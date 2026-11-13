import type { RoomEvent } from "./events";

export interface Viewer {
  playerId: string;
  isDm: boolean;
}

/**
 * The single gate between the room's full event log and a client. Returns the
 * event as this viewer may see it, or null if they may not see it at all.
 * Every event leaving the server for a client passes through here.
 */
export function redactEvent(event: RoomEvent, viewer: Viewer): RoomEvent | null {
  if (viewer.isDm) return event;
  const visibility = event.visibility;
  if (visibility.scope === "dm") return null;
  if (visibility.scope === "players" && !visibility.playerIds.includes(viewer.playerId)) return null;
  if (event.secret === undefined) return event;
  const { secret: _secret, ...rest } = event;
  return rest as RoomEvent;
}
