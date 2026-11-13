import type { CreateRoomRequest, RoomInfo, SeatResponse, SrdHit } from "@lanternkeep/protocol";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, "offline", "Could not reach the server.");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(response.status, error?.code ?? "internal", error?.message ?? `Request failed (${response.status}).`);
  }
  return body as T;
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const createRoom = (body: CreateRoomRequest): Promise<SeatResponse> => post("/api/rooms", body);
export const joinRoom = (roomId: string, displayName: string): Promise<SeatResponse> =>
  post(`/api/rooms/${encodeURIComponent(roomId)}/join`, { displayName });
export const getRoom = (roomId: string): Promise<RoomInfo> => request(`/api/rooms/${encodeURIComponent(roomId)}`);

export interface SrdCategory {
  id: string;
  name: string;
  count: number;
}
export interface SrdEntry {
  category: string;
  index: string;
  name: string;
  record: Record<string, unknown>;
}

export const srdCategories = (): Promise<SrdCategory[]> =>
  request<{ categories: SrdCategory[] }>("/api/srd/categories").then((r) => r.categories);

export function srdSearch(q: string, category?: string, limit = 30, signal?: AbortSignal): Promise<SrdHit[]> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (category) params.set("category", category);
  return request<{ results: SrdHit[] }>(`/api/srd/search?${params.toString()}`, signal ? { signal } : undefined).then((r) => r.results);
}

const lists = new Map<string, Promise<SrdHit[]>>();
/** Every entry of a category. Cached for the life of the page: the SRD does not change under us. */
export function srdList(category: string): Promise<SrdHit[]> {
  let list = lists.get(category);
  if (!list) {
    list = request<{ results: SrdHit[] }>(`/api/srd/${encodeURIComponent(category)}`).then((r) => r.results);
    list.catch(() => lists.delete(category));
    lists.set(category, list);
  }
  return list;
}

export const srdEntry = (category: string, index: string): Promise<SrdEntry> =>
  request(`/api/srd/${encodeURIComponent(category)}/${encodeURIComponent(index)}`);
