import { type FormEvent, useState } from "react";
import { useRoom } from "../room/context";
import { Button, Input, Select, cx } from "./ui";

export function Composer() {
  const { state, me, amDm, connected, send } = useRoom();
  const [text, setText] = useState("");
  const [narrate, setNarrate] = useState(true);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const others = Object.values(state.players).filter((p) => p.id !== me);
  // A whisper target that is no longer valid (seat changed, role changed) falls back to everyone.
  const validTarget = amDm ? others.some((p) => p.id === target) : target === "dm" && state.dm !== null;
  const to = validTarget ? target : "";
  const narrating = amDm && narrate && to === "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const ok = narrating
      ? await send({ type: "narrate", text: body })
      : to === ""
        ? await send({ type: "chat", text: body })
        : await send({ type: "chat", text: body, to: to === "dm" ? { kind: "dm" } : { kind: "player", playerId: to } });
    setBusy(false);
    if (ok) setText("");
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      {amDm && (
        <button
          type="button"
          data-testid="narrate-toggle"
          aria-pressed={narrating}
          disabled={to !== ""}
          onClick={() => setNarrate((v) => !v)}
          title="Switch between narrating as the DM and talking at the table"
          className={cx(
            "rounded border px-2 py-1.5 text-xs disabled:opacity-40",
            narrating ? "border-amber bg-amber/15 text-amber" : "border-line bg-raised text-muted",
          )}
        >
          {narrating ? "Narrating" : "Talking"}
        </button>
      )}
      <Input
        data-testid="chat-input"
        aria-label={narrating ? "Narration" : "Message"}
        className={cx("min-w-40 flex-1", narrating && "font-serif")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={narrating ? 8000 : 2000}
        placeholder={narrating ? "Describe what happens…" : to ? "Whisper…" : "Say something…"}
        autoComplete="off"
      />
      <Select data-testid="whisper-target" aria-label="Who hears this" className="w-auto" value={to} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Everyone</option>
        {amDm
          ? others.map((p) => (
              <option key={p.id} value={p.id}>
                Whisper: {p.displayName}
              </option>
            ))
          : state.dm !== null && <option value="dm">Whisper: DM</option>}
      </Select>
      <Button data-testid="chat-send" type="submit" tone="primary" disabled={!connected || busy || text.trim() === ""}>
        Send
      </Button>
    </form>
  );
}
