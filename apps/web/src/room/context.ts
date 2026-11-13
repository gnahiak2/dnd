import type { CommandInput, RoomState } from "@lanternkeep/protocol";
import { createContext, useContext } from "react";
import type { RoomSnapshot } from "./RoomClient";

export interface RoomContextValue {
  roomId: string;
  snapshot: RoomSnapshot;
  state: RoomState;
  /** This browser's player id. */
  me: string;
  amDm: boolean;
  /** True while commands can be sent. */
  connected: boolean;
  /** Sends a command; failures are shown as a toast. Resolves to whether it was accepted. */
  send(command: CommandInput): Promise<boolean>;
  notify(message: string): void;
  playerName(playerId: string): string;
}

export const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const value = useContext(RoomContext);
  if (!value) throw new Error("useRoom must be used inside a room");
  return value;
}
