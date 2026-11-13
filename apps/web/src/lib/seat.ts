export interface StoredSeat {
  playerId: string;
  token: string;
}

const seatKey = (roomId: string): string => `lk:seat:${roomId}`;
const NAME_KEY = "lk:name";

export function loadSeat(roomId: string): StoredSeat | null {
  try {
    const raw = localStorage.getItem(seatKey(roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSeat> | null;
    return typeof parsed?.playerId === "string" && typeof parsed.token === "string"
      ? { playerId: parsed.playerId, token: parsed.token }
      : null;
  } catch {
    return null;
  }
}

export function saveSeat(roomId: string, seat: StoredSeat): void {
  localStorage.setItem(seatKey(roomId), JSON.stringify(seat));
}

export function clearSeat(roomId: string): void {
  localStorage.removeItem(seatKey(roomId));
}

export const loadName = (): string => localStorage.getItem(NAME_KEY) ?? "";
export const saveName = (name: string): void => localStorage.setItem(NAME_KEY, name);
