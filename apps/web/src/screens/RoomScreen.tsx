import { type CommandInput, type RoomInfo, isDm } from "@lanternkeep/protocol";
import { type FormEvent, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Attribution } from "../App";
import { PendingChecks, RequestCheckForm } from "../components/Checks";
import { Composer } from "../components/Composer";
import { DiceBar } from "../components/DiceBar";
import { EncounterPanel } from "../components/Encounter";
import { Header } from "../components/Header";
import { Log } from "../components/Log";
import { Party } from "../components/Party";
import { Reference } from "../components/Reference";
import { SheetPanel } from "../components/Sheet";
import { Button, Field, Input, cx } from "../components/ui";
import { ApiError, getRoom, joinRoom } from "../lib/api";
import { navigate } from "../lib/router";
import { type StoredSeat, clearSeat, loadName, loadSeat, saveName, saveSeat } from "../lib/seat";
import { RoomClient } from "../room/RoomClient";
import { RoomContext, type RoomContextValue } from "../room/context";

export function RoomScreen({ roomId }: { roomId: string }) {
  const [seat, setSeat] = useState<StoredSeat | null>(() => loadSeat(roomId));
  const dropSeat = useCallback(() => {
    clearSeat(roomId);
    setSeat(null);
  }, [roomId]);

  if (!seat) {
    return (
      <JoinGate
        roomId={roomId}
        onSeated={(next) => {
          saveSeat(roomId, next);
          setSeat(next);
        }}
      />
    );
  }
  // Keyed by token so a new seat gets a new connection.
  return <Tabletop key={seat.token} roomId={roomId} seat={seat} onSeatInvalid={dropSeat} />;
}

function JoinGate({ roomId, onSeated }: { roomId: string; onSeated: (seat: StoredSeat) => void }) {
  const [info, setInfo] = useState<RoomInfo | "missing" | null>(null);
  const [displayName, setDisplayName] = useState(loadName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getRoom(roomId).then(
      (room) => live && setInfo(room),
      (cause: unknown) => {
        if (!live) return;
        if (cause instanceof ApiError && cause.status === 404) setInfo("missing");
        else setError(cause instanceof Error ? cause.message : "Could not load the room.");
      },
    );
    return () => {
      live = false;
    };
  }, [roomId]);

  const join = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const seat = await joinRoom(roomId, displayName);
      saveName(displayName.trim());
      onSeated({ playerId: seat.playerId, token: seat.token });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not join the room.");
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-md px-6 pt-[14vh]">
      {info === "missing" ? (
        <div data-testid="room-not-found">
          <h1 className="font-serif text-2xl">Room not found</h1>
          <p className="mt-2 text-muted">This invite link does not lead to a room. Check it with whoever sent it.</p>
          <button type="button" className="mt-6 text-amber underline" onClick={() => navigate("/")}>
            Back to the lobby
          </button>
        </div>
      ) : (
        <form onSubmit={join} className="space-y-4 rounded-md border border-line bg-panel p-5">
          <div>
            <p className="text-xs text-muted">You are invited to</p>
            <h1 className="font-serif text-2xl">{info ? info.name : "…"}</h1>
            {info && (
              <p className="mt-1 text-xs text-faint">
                {info.playerCount} {info.playerCount === 1 ? "person" : "people"} at the table
              </p>
            )}
          </div>
          <Field label="Your name">
            <Input data-testid="join-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} required autoFocus autoComplete="nickname" />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button data-testid="join-submit" type="submit" tone="primary" disabled={busy || !info} className="w-full">
            {busy ? "Joining…" : "Take a seat"}
          </Button>
        </form>
      )}
    </main>
  );
}

interface Toast {
  id: number;
  message: string;
}
let toastIds = 0;

type MobilePane = "log" | "party" | "side";
type SideTab = "sheet" | "reference" | "dm";

function Tabletop({ roomId, seat, onSeatInvalid }: { roomId: string; seat: StoredSeat; onSeatInvalid: () => void }) {
  const [client] = useState(
    () =>
      new RoomClient({
        url: `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws?room=${encodeURIComponent(roomId)}`,
        token: seat.token,
      }),
  );
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pane, setPane] = useState<MobilePane>("log");
  const [sideTab, setSideTab] = useState<SideTab>("sheet");

  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);

  const unauthorized = snapshot.fatal?.code === "unauthorized";
  useEffect(() => {
    if (unauthorized) onSeatInvalid();
  }, [unauthorized, onSeatInvalid]);

  const notify = useCallback((message: string) => {
    const id = (toastIds += 1);
    setToasts((list) => [...list.slice(-3), { id, message }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 7000);
  }, []);

  const send = useCallback(
    async (command: CommandInput): Promise<boolean> => {
      try {
        await client.send(command);
        return true;
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : "That did not work.");
        return false;
      }
    },
    [client, notify],
  );

  const me = snapshot.playerId ?? seat.playerId;
  const amDm = isDm(snapshot.state, me);
  const context = useMemo<RoomContextValue>(
    () => ({
      roomId,
      snapshot,
      state: snapshot.state,
      me,
      amDm,
      connected: snapshot.status === "online",
      send,
      notify,
      playerName: (id) => snapshot.state.players[id]?.displayName ?? "Someone",
    }),
    [roomId, snapshot, me, amDm, send, notify],
  );

  if (snapshot.fatal && !unauthorized) {
    return (
      <main className="mx-auto max-w-md px-6 pt-[14vh]">
        <h1 className="font-serif text-2xl">Disconnected</h1>
        <p role="alert" className="mt-2 text-muted">
          {snapshot.fatal.message}
        </p>
        <Button className="mt-6" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </main>
    );
  }

  if (snapshot.playerId === null) {
    return (
      <main className="flex h-full items-center justify-center text-muted" data-testid="connection-status" data-status={snapshot.status}>
        {snapshot.status === "offline" ? "Cannot reach the table. Retrying…" : "Finding your seat…"}
      </main>
    );
  }

  const showDmTab = amDm;
  const activeSide: SideTab = sideTab === "dm" && !showDmTab ? "sheet" : sideTab;
  const tab = (id: SideTab, label: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      data-testid={`tab-${id}`}
      aria-selected={activeSide === id}
      onClick={() => setSideTab(id)}
      className={cx(
        "border-b-2 px-3 py-2 text-sm transition-colors",
        activeSide === id ? "border-amber text-parchment" : "border-transparent text-muted hover:text-parchment",
      )}
    >
      {label}
    </button>
  );
  const mobileTab = (id: MobilePane, label: string) => (
    <button
      key={id}
      type="button"
      data-testid={`tab-${id}`}
      aria-pressed={pane === id}
      onClick={() => setPane(id)}
      className={cx("flex-1 border-b-2 py-2 text-sm", pane === id ? "border-amber text-parchment" : "border-transparent text-muted")}
    >
      {label}
    </button>
  );

  return (
    <RoomContext.Provider value={context}>
      <div className="flex h-full flex-col">
        <Header />
        <nav className="flex border-b border-line bg-panel lg:hidden" aria-label="Panels">
          {mobileTab("log", "Log")}
          {mobileTab("party", "Party")}
          {mobileTab("side", "Sheets & rules")}
        </nav>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[330px_minmax(0,1fr)_390px]">
          <aside className={cx("min-h-0 space-y-3 overflow-y-auto border-line p-3 lg:block lg:border-r", pane === "party" ? "block" : "hidden")}>
            <PendingChecks />
            <EncounterPanel />
            <Party />
          </aside>

          <main className={cx("min-h-0 min-w-0 flex-col lg:flex", pane === "log" ? "flex" : "hidden")}>
            <Log />
            <div className="space-y-2 border-t border-line bg-panel p-3">
              <Composer />
              <DiceBar />
            </div>
          </main>

          <aside className={cx("min-h-0 flex-col border-line lg:flex lg:border-l", pane === "side" ? "flex" : "hidden")}>
            <div role="tablist" className="flex border-b border-line bg-panel px-1">
              {tab("sheet", "Sheet")}
              {tab("reference", "Reference")}
              {showDmTab && tab("dm", "DM")}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {activeSide === "sheet" && <SheetPanel />}
              {activeSide === "reference" && <Reference />}
              {activeSide === "dm" && <RequestCheckForm />}
            </div>
          </aside>
        </div>

        <footer className="border-t border-line bg-panel px-3 py-1.5">
          <Attribution />
        </footer>

        <div className="pointer-events-none fixed right-3 bottom-10 z-50 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col gap-2" aria-live="assertive">
          {toasts.map((toast) => (
            <div key={toast.id} data-testid="toast" role="alert" className="pointer-events-auto flex items-start gap-2 rounded border border-danger/60 bg-raised px-3 py-2 text-sm shadow-lg">
              <span className="flex-1">{toast.message}</span>
              <button type="button" aria-label="Dismiss" className="text-muted hover:text-parchment" onClick={() => setToasts((list) => list.filter((t) => t.id !== toast.id))}>
                {"×"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </RoomContext.Provider>
  );
}
