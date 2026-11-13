import type { PendingCheck } from "@lanternkeep/protocol";
import { ABILITIES, ABILITY_NAMES, type Ability, type CheckSpec, type RollMode, SKILLS, SKILL_NAMES, type Skill } from "@lanternkeep/rules";
import { type FormEvent, useState } from "react";
import { describeCheck, joinNames } from "../lib/describe";
import { useRoom } from "../room/context";
import { Button, Check, Field, Input, Panel, Select } from "./ui";

function Prompt({ pending, characterId, name }: { pending: PendingCheck; characterId: string; name: string }) {
  const { connected, send } = useRoom();
  const [mode, setMode] = useState<RollMode>("normal");
  return (
    <li data-testid="pending-check" data-request-id={pending.requestId} data-character-id={characterId} className="rounded border border-amber bg-amber/10 p-2">
      <p className="text-sm">
        <span className="font-serif">{name}</span>: roll a <strong>{describeCheck(pending.check)}</strong>
        {pending.note && <span className="text-muted"> ({pending.note})</span>}
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        <Select data-testid="pending-check-mode" aria-label="Roll mode" className="w-auto py-0.5 text-xs" value={mode} onChange={(e) => setMode(e.target.value as RollMode)}>
          <option value="normal">Normal</option>
          <option value="advantage">Advantage</option>
          <option value="disadvantage">Disadvantage</option>
        </Select>
        <Button
          small
          tone="primary"
          data-testid="pending-check-roll"
          disabled={!connected}
          onClick={() => void send({ type: "roll_check", characterId, check: pending.check, mode, requestId: pending.requestId })}
        >
          Roll
        </Button>
      </div>
    </li>
  );
}

/** Check requests waiting on this viewer's characters, and for the DM, everything still outstanding. */
export function PendingChecks() {
  const { state, me, amDm, connected, send } = useRoom();
  const pending = Object.values(state.pendingChecks);
  const mine = pending.flatMap((p) =>
    p.characterIds.flatMap((id) => {
      const character = state.characters[id];
      return character && character.ownerId === me ? [{ pending: p, character }] : [];
    }),
  );
  if (mine.length === 0 && !(amDm && pending.length > 0)) return null;

  return (
    <Panel title="Checks">
      <div className="space-y-2">
        {mine.length > 0 && (
          <ul className="space-y-2">
            {mine.map(({ pending: p, character }) => (
              <Prompt key={`${p.requestId}:${character.id}`} pending={p} characterId={character.id} name={character.sheet.name} />
            ))}
          </ul>
        )}
        {amDm && pending.length > 0 && (
          <ul className="space-y-1.5">
            {pending.map((p) => (
              <li key={p.requestId} data-testid="open-check" data-request-id={p.requestId} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  {describeCheck(p.check)}
                  {p.dc !== undefined && <span className="font-mono text-xs text-muted"> DC {p.dc}</span>}
                  <span className="block truncate text-xs text-muted">
                    Waiting on {joinNames(p.characterIds.map((id) => state.characters[id]?.sheet.name ?? "someone"))}
                  </span>
                </span>
                <Button small tone="ghost" data-testid="dismiss-check" disabled={!connected} onClick={() => void send({ type: "dismiss_check", requestId: p.requestId })}>
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

type Kind = CheckSpec["kind"];

export function RequestCheckForm() {
  const { state, connected, send, notify, playerName } = useRoom();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [kind, setKind] = useState<Kind>("skill");
  const [ability, setAbility] = useState<Ability>("dex");
  const [skill, setSkill] = useState<Skill>("perception");
  const [dc, setDc] = useState("");
  const [note, setNote] = useState("");

  const characters = Object.values(state.characters).sort((a, b) => a.sheet.name.localeCompare(b.sheet.name));
  const chosen = characters.filter((c) => selected.has(c.id));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (chosen.length === 0) return notify("Pick at least one character.");
    const extra: { dc?: number; note?: string } = {};
    if (dc.trim() !== "") {
      const value = Number(dc);
      if (!Number.isInteger(value) || value < 1 || value > 40) return notify("A DC is a whole number from 1 to 40.");
      extra.dc = value;
    }
    if (note.trim() !== "") extra.note = note.trim();
    const check: CheckSpec = kind === "skill" ? { kind, skill } : { kind, ability };
    if (await send({ type: "request_check", characterIds: chosen.map((c) => c.id), check, ...extra })) {
      setSelected(new Set());
      setNote("");
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <h2 className="font-serif text-[15px]">Request a check</h2>
        <p className="text-xs text-muted">Players roll from their own sheet. The DC stays with you; they see only success or failure.</p>
      </div>
      {characters.length === 0 ? (
        <p className="text-sm text-muted">There are no characters at the table yet.</p>
      ) : (
        <fieldset className="space-y-1">
          <legend className="mb-1 text-xs text-muted">Who rolls</legend>
          {characters.map((character) => (
            <Check
              key={character.id}
              data-testid="request-check-character"
              data-character-id={character.id}
              className="flex"
              checked={selected.has(character.id)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(character.id);
                else next.delete(character.id);
                setSelected(next);
              }}
              label={
                <>
                  <span className="text-parchment">{character.sheet.name}</span> <span className="text-faint">({playerName(character.ownerId)})</span>
                </>
              }
            />
          ))}
        </fieldset>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Kind">
          <Select data-testid="request-check-kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="skill">Skill check</option>
            <option value="ability">Ability check</option>
            <option value="save">Saving throw</option>
          </Select>
        </Field>
        <Field label={kind === "skill" ? "Skill" : "Ability"}>
          {kind === "skill" ? (
            <Select data-testid="request-check-which" value={skill} onChange={(e) => setSkill(e.target.value as Skill)}>
              {SKILLS.map((id) => (
                <option key={id} value={id}>
                  {SKILL_NAMES[id]}
                </option>
              ))}
            </Select>
          ) : (
            <Select data-testid="request-check-which" value={ability} onChange={(e) => setAbility(e.target.value as Ability)}>
              {ABILITIES.map((id) => (
                <option key={id} value={id}>
                  {ABILITY_NAMES[id]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="DC (optional, secret)">
          <Input data-testid="request-check-dc" type="number" min={1} max={40} value={dc} onChange={(e) => setDc(e.target.value)} placeholder="none" />
        </Field>
        <Field label="Note (optional)">
          <Input data-testid="request-check-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="to spot the ambush" />
        </Field>
      </div>
      <Button data-testid="request-check-submit" type="submit" tone="primary" disabled={!connected || characters.length === 0}>
        Ask for the roll
      </Button>
    </form>
  );
}
