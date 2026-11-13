import { useSyncExternalStore } from "react";

export type Route = { name: "lobby" } | { name: "room"; roomId: string } | { name: "not-found" };

function parse(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { name: "lobby" };
  const room = /^\/r\/([A-Za-z0-9_-]{1,64})\/?$/.exec(pathname);
  return room?.[1] ? { name: "room", roomId: room[1] } : { name: "not-found" };
}

const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
};

export function navigate(path: string): void {
  window.history.pushState(null, "", path);
  for (const listener of listeners) listener();
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function useRoute(): Route {
  return parse(usePath());
}

/** Accepts a full invite link, a path, or a bare room code. */
export function roomIdFromInvite(text: string): string | null {
  const trimmed = text.trim();
  const fromLink = /\/r\/([A-Za-z0-9_-]{1,64})/.exec(trimmed);
  if (fromLink?.[1]) return fromLink[1];
  return /^[A-Za-z0-9_-]{4,64}$/.test(trimmed) ? trimmed : null;
}
