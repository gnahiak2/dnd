import { type FormEvent, useState } from "react";
import { Attribution, PRODUCT } from "../App";
import { Button, Check, Field, Input } from "../components/ui";
import { createRoom } from "../lib/api";
import { navigate, roomIdFromInvite } from "../lib/router";
import { loadName, saveName, saveSeat } from "../lib/seat";

export function Lobby() {
  const [roomName, setRoomName] = useState("");
  const [displayName, setDisplayName] = useState(loadName);
  const [asDm, setAsDm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const seat = await createRoom({ roomName, displayName, asDm });
      saveName(displayName.trim());
      saveSeat(seat.roomId, { playerId: seat.playerId, token: seat.token });
      navigate(`/r/${seat.roomId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the room.");
      setBusy(false);
    }
  };

  const follow = (event: FormEvent) => {
    event.preventDefault();
    const roomId = roomIdFromInvite(invite);
    if (roomId) navigate(`/r/${roomId}`);
    else setInviteError("That does not look like an invite link.");
  };

  return (
    <div className="flex min-h-full flex-col">
      <main className="mx-auto w-full max-w-md flex-1 px-6 pt-[12vh] pb-10">
        <h1 className="font-serif text-4xl tracking-tight text-parchment">{PRODUCT}</h1>
        <p className="mt-2 text-muted">A quiet table for playing fifth edition with friends. Open a room, share the link, roll.</p>

        <form onSubmit={create} className="mt-10 space-y-4 rounded-md border border-line bg-panel p-5">
          <h2 className="font-serif text-lg">Create a room</h2>
          <Field label="Room name">
            <Input data-testid="create-room-name" value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={60} required placeholder="The Sunken Keep" />
          </Field>
          <Field label="Your name">
            <Input data-testid="create-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} required autoComplete="nickname" />
          </Field>
          <Check data-testid="create-as-dm" checked={asDm} onChange={(e) => setAsDm(e.target.checked)} label="I'll be the DM" />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button data-testid="create-submit" type="submit" tone="primary" disabled={busy} className="w-full">
            {busy ? "Opening…" : "Open the room"}
          </Button>
        </form>

        <form onSubmit={follow} className="mt-6">
          <Field label="Have an invite link? Paste it">
            <div className="flex gap-2">
              <Input
                value={invite}
                onChange={(e) => {
                  setInvite(e.target.value);
                  setInviteError(null);
                }}
                placeholder="https://…/r/abc123"
              />
              <Button type="submit">Go</Button>
            </div>
          </Field>
          {inviteError && (
            <p role="alert" className="mt-1 text-sm text-danger">
              {inviteError}
            </p>
          )}
        </form>
      </main>
      <footer className="px-6 pb-4">
        <Attribution />
      </footer>
    </div>
  );
}
