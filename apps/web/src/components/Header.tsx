import { useState } from "react";
import { useRoom } from "../room/context";
import { Button, cx } from "./ui";

const STATUS_LABEL = { online: "Connected", connecting: "Connecting…", offline: "Reconnecting…" } as const;

export function Header() {
  const { roomId, state, snapshot, me, amDm, connected, send } = useRoom();
  const [copied, setCopied] = useState(false);
  const invite = `${window.location.origin}/r/${roomId}`;
  const online = new Set(snapshot.online);
  const dmPlayerId = state.dm?.kind === "human" ? state.dm.playerId : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the link is selectable in the field.
    }
  };

  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-panel px-3 py-2">
      <div className="min-w-0">
        <h1 data-testid="room-name" className="truncate font-serif text-lg leading-tight">
          {state.name}
        </h1>
        <p data-testid="connection-status" data-status={snapshot.status} className={cx("text-xs", connected ? "text-faint" : "text-amber")} role="status">
          {STATUS_LABEL[snapshot.status]}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <label className="sr-only" htmlFor="invite-link">
          Invite link
        </label>
        <input
          id="invite-link"
          data-testid="invite-link"
          readOnly
          value={invite}
          onFocus={(e) => e.target.select()}
          className="w-52 rounded border border-line bg-ink px-2 py-1 font-mono text-xs text-muted"
        />
        <Button small onClick={copy}>
          {copied ? "Copied" : "Copy invite"}
        </Button>
      </div>

      <ul className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1" aria-label="Players">
        {Object.values(state.players).map((player) => {
          const isOnline = online.has(player.id);
          const isSeatDm = player.id === dmPlayerId;
          return (
            <li
              key={player.id}
              data-testid="player-item"
              data-player-id={player.id}
              data-online={isOnline}
              data-dm={isSeatDm}
              className={cx("flex items-center gap-1.5 text-sm", isOnline ? "text-parchment" : "text-faint")}
            >
              <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", isOnline ? "bg-good" : "bg-line")} />
              <span>
                {player.displayName}
                {player.id === me && <span className="text-faint"> (you)</span>}
              </span>
              {isSeatDm && <span className="rounded border border-amber-dim px-1 text-[10px] font-semibold tracking-wide text-amber">DM</span>}
              <span className="sr-only">{isOnline ? "online" : "offline"}</span>
            </li>
          );
        })}
        {state.dm?.kind === "ai" && <li className="text-sm text-amber">AI DM</li>}
      </ul>

      {state.dm === null && (
        <Button small tone="primary" data-testid="claim-dm" disabled={!connected} onClick={() => void send({ type: "claim_dm_seat" })}>
          Take the DM seat
        </Button>
      )}
      {amDm && (
        <Button
          small
          data-testid="release-dm"
          disabled={!connected}
          onClick={() => {
            if (window.confirm("Leave the DM seat? Anyone at the table can then take it.")) void send({ type: "release_dm_seat" });
          }}
        >
          Leave the DM seat
        </Button>
      )}
    </header>
  );
}
