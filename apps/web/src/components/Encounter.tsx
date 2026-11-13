import type { Combatant, SrdHit } from "@lanternkeep/protocol";
import { type FormEvent, useEffect, useState } from "react";
import { srdSearch } from "../lib/api";
import { formatHp } from "../lib/describe";
import { useRoom } from "../room/context";
import { ConditionChips, ConditionPicker, HpControls } from "./HpControls";
import { Button, Check, Field, Input, Panel, cx } from "./ui";

function InitiativeField({ combatant }: { combatant: Combatant }) {
  const { send } = useRoom();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const value = Number(draft);
    setDraft(null);
    if (draft.trim() !== "" && Number.isInteger(value) && value !== combatant.initiative) {
      void send({ type: "set_initiative", combatantId: combatant.id, initiative: value });
    }
  };
  return (
    <input
      data-testid="combatant-initiative"
      aria-label={`Initiative of ${combatant.name}`}
      type="number"
      className="w-9 rounded border border-transparent bg-transparent text-center font-mono text-sm text-amber hover:border-line focus:border-line"
      value={draft ?? combatant.initiative}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

function Row({ combatant, current }: { combatant: Combatant; current: boolean }) {
  const { state, amDm, connected, send } = useRoom();
  const character = combatant.kind === "pc" ? state.characters[combatant.characterId] : undefined;
  const hp = combatant.kind === "pc" ? character?.hp : combatant.hp;
  const armorClass = combatant.kind === "pc" ? character?.sheet.armorClass : combatant.armorClass;
  const conditions = combatant.kind === "pc" ? (character?.conditions ?? []) : combatant.conditions;

  return (
    <li
      data-testid="combatant-row"
      data-combatant-id={combatant.id}
      data-current={current}
      data-kind={combatant.kind}
      aria-current={current ? "true" : undefined}
      className={cx("rounded border px-2 py-1.5", current ? "border-amber bg-amber/10" : "border-line bg-raised")}
    >
      <div className="flex items-center gap-2">
        {amDm ? (
          <InitiativeField combatant={combatant} />
        ) : (
          <span data-testid="combatant-initiative" className="w-9 text-center font-mono text-sm text-amber">
            {combatant.initiative}
          </span>
        )}
        <span data-testid="combatant-name" className={cx("min-w-0 flex-1 truncate", combatant.kind === "pc" && "font-serif")}>
          {combatant.name}
        </span>
        {current && <span className="text-[10px] font-semibold tracking-widest text-amber uppercase">Turn</span>}
        <span className="shrink-0 text-right font-mono text-xs text-muted">
          {armorClass !== undefined && <span className="mr-2">AC {armorClass}</span>}
          {hp && (
            <span data-testid="combatant-hp" className="text-parchment">
              {formatHp(hp)}
            </span>
          )}
          {combatant.kind === "npc" && (
            <span
              data-testid="combatant-band"
              className={cx("ml-2", combatant.band === "healthy" ? "text-good" : combatant.band === "bloodied" ? "text-danger" : "text-faint")}
            >
              {combatant.band}
            </span>
          )}
        </span>
      </div>
      <ConditionChips conditions={conditions} />
      {amDm && combatant.kind === "npc" && (
        <div className="mt-1.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <HpControls
              target={{ kind: "combatant", combatantId: combatant.id }}
              ids={{ amount: "combatant-damage-amount", damage: "combatant-damage", heal: "combatant-heal" }}
            />
            <Button small tone="ghost" data-testid="combatant-remove" disabled={!connected} onClick={() => void send({ type: "remove_combatant", combatantId: combatant.id })}>
              Remove
            </Button>
          </div>
          <ConditionPicker target={{ kind: "combatant", combatantId: combatant.id }} active={combatant.conditions} />
        </div>
      )}
      {amDm && combatant.kind === "pc" && (
        <div className="mt-1 text-right">
          <Button small tone="ghost" data-testid="combatant-remove" disabled={!connected} onClick={() => void send({ type: "remove_combatant", combatantId: combatant.id })}>
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}

function AddMonster() {
  const { connected, send, notify } = useRoom();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SrdHit[]>([]);
  const [picked, setPicked] = useState<SrdHit | null>(null);
  const [count, setCount] = useState("1");
  const [name, setName] = useState("");
  const [hidden, setHidden] = useState(true);

  const term = query.trim();
  useEffect(() => {
    if (term === "") return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      srdSearch(term, "monsters", 8, abort.signal).then(setResults, (cause: unknown) => {
        if (!abort.signal.aborted) notify(cause instanceof Error ? cause.message : "Search failed.");
      });
    }, 200);
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [term, notify]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!picked) return;
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 20) return notify("Add between 1 and 20 creatures at a time.");
    const custom = name.trim();
    if (await send({ type: "add_monster", srdIndex: picked.index, count: n, hidden, ...(custom ? { name: custom } : {}) })) {
      setPicked(null);
      setQuery("");
      setName("");
      setCount("1");
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <Field label="Find a monster">
        <Input
          data-testid="monster-search"
          value={picked ? picked.name : query}
          onChange={(e) => {
            setPicked(null);
            setQuery(e.target.value);
          }}
          placeholder="goblin, owlbear…"
          autoComplete="off"
        />
      </Field>
      {!picked && term !== "" && (
        <ul className="max-h-48 overflow-y-auto rounded border border-line">
          {results.length === 0 && <li className="px-2 py-1.5 text-xs text-muted">No monster by that name in the SRD.</li>}
          {results.map((hit) => (
            <li key={hit.index}>
              <button type="button" data-testid="monster-result" data-index={hit.index} onClick={() => setPicked(hit)} className="flex w-full items-baseline justify-between gap-2 px-2 py-1 text-left hover:bg-raised">
                <span>{hit.name}</span>
                <span className="text-xs text-faint">{hit.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <>
          <div className="flex gap-2">
            <Field label="How many" className="w-20">
              <Input data-testid="monster-count" type="number" min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)} />
            </Field>
            <Field label="Call it (optional)" className="flex-1">
              <Input data-testid="monster-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={picked.name} />
            </Field>
          </div>
          <div className="flex items-center justify-between">
            <Check data-testid="monster-hidden" checked={hidden} onChange={(e) => setHidden(e.target.checked)} label="Hide HP and AC from players" />
            <Button data-testid="monster-add" type="submit" tone="primary" small disabled={!connected}>
              Add
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

function AddCustom() {
  const { connected, send, notify } = useRoom();
  const [name, setName] = useState("");
  const [hp, setHp] = useState("");
  const [ac, setAc] = useState("");
  const [initiative, setInitiative] = useState("");
  const [hidden, setHidden] = useState(true);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const maxHp = Number(hp);
    if (!Number.isInteger(maxHp) || maxHp < 1) return notify("Give the creature at least 1 hit point.");
    const extra: { armorClass?: number; initiative?: number } = {};
    if (ac.trim() !== "") extra.armorClass = Number(ac);
    if (initiative.trim() !== "") extra.initiative = Number(initiative);
    if (Object.values(extra).some((v) => !Number.isInteger(v))) return notify("AC and initiative must be whole numbers.");
    if (await send({ type: "add_combatant", name, maxHp, hidden, ...extra })) {
      setName("");
      setHp("");
      setAc("");
      setInitiative("");
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <Field label="Name">
        <Input data-testid="custom-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Max HP">
          <Input data-testid="custom-hp" type="number" min={1} value={hp} onChange={(e) => setHp(e.target.value)} required />
        </Field>
        <Field label="AC">
          <Input data-testid="custom-ac" type="number" min={0} value={ac} onChange={(e) => setAc(e.target.value)} />
        </Field>
        <Field label="Initiative">
          <Input data-testid="custom-initiative" type="number" value={initiative} onChange={(e) => setInitiative(e.target.value)} placeholder="roll" />
        </Field>
      </div>
      <div className="flex items-center justify-between">
        <Check data-testid="custom-hidden" checked={hidden} onChange={(e) => setHidden(e.target.checked)} label="Hide HP and AC from players" />
        <Button data-testid="custom-add" type="submit" tone="primary" small disabled={!connected}>
          Add
        </Button>
      </div>
    </form>
  );
}

export function EncounterPanel() {
  const { state, me, amDm, connected, send } = useRoom();
  const encounter = state.encounter;

  if (!encounter) {
    return (
      <Panel title="Encounter">
        {amDm ? (
          <Button data-testid="start-encounter" tone="primary" disabled={!connected} onClick={() => void send({ type: "start_encounter" })}>
            Start encounter
          </Button>
        ) : (
          <p className="text-sm text-muted">No encounter is running.</p>
        )}
      </Panel>
    );
  }

  const inEncounter = new Set(encounter.combatants.flatMap((c) => (c.kind === "pc" ? [c.characterId] : [])));
  const waiting = Object.values(state.characters)
    .filter((c) => !inEncounter.has(c.id) && (amDm || c.ownerId === me))
    .sort((a, b) => a.sheet.name.localeCompare(b.sheet.name));

  return (
    <Panel
      title="Encounter"
      action={
        <span className="font-mono text-xs text-muted">
          Round <span data-testid="encounter-round" className="text-parchment">{encounter.round}</span>
        </span>
      }
    >
      <div className="space-y-2.5">
        {encounter.combatants.length === 0 ? (
          <p className="text-sm text-muted">Nobody has rolled initiative yet.</p>
        ) : (
          <ol className="space-y-1.5" aria-label="Initiative order">
            {encounter.combatants.map((combatant) => (
              <Row key={combatant.id} combatant={combatant} current={combatant.id === encounter.currentId} />
            ))}
          </ol>
        )}

        {waiting.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {waiting.map((character) => (
              <Button key={character.id} small data-testid="join-encounter" data-character-id={character.id} disabled={!connected} onClick={() => void send({ type: "join_encounter", characterId: character.id })}>
                Roll initiative: {character.sheet.name}
              </Button>
            ))}
          </div>
        )}

        {amDm && (
          <>
            <div className="flex gap-2">
              <Button data-testid="next-turn" tone="primary" className="flex-1" disabled={!connected || encounter.combatants.length === 0} onClick={() => void send({ type: "next_turn" })}>
                {encounter.currentId === null ? "Begin first turn" : "Next turn"}
              </Button>
              <Button
                data-testid="end-encounter"
                tone="danger"
                disabled={!connected}
                onClick={() => {
                  if (window.confirm("End the encounter? The initiative order is cleared.")) void send({ type: "end_encounter" });
                }}
              >
                End
              </Button>
            </div>
            <details className="rounded border border-line p-2" open={encounter.combatants.length === 0}>
              <summary className="cursor-pointer text-sm text-muted select-none hover:text-parchment">Add monster</summary>
              <div className="mt-2">
                <AddMonster />
              </div>
            </details>
            <details className="rounded border border-line p-2">
              <summary className="cursor-pointer text-sm text-muted select-none hover:text-parchment">Add custom creature</summary>
              <div className="mt-2">
                <AddCustom />
              </div>
            </details>
          </>
        )}
      </div>
    </Panel>
  );
}
