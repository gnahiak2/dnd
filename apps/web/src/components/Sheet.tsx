import { type Character, type CharacterSheet, CharacterSheetSchema, type SrdHit } from "@lanternkeep/protocol";
import {
  ABILITIES,
  ABILITY_NAMES,
  type Ability,
  type CheckSpec,
  type CheckStats,
  type RollMode,
  SKILLS,
  SKILL_ABILITIES,
  SKILL_NAMES,
  type Skill,
  abilityModifier,
  formatModifier,
  initiativeModifier,
  passivePerception,
  proficiencyBonus,
  savingThrowModifier,
  skillModifier,
} from "@lanternkeep/rules";
import { type FormEvent, useEffect, useId, useState } from "react";
import { srdEntry, srdList } from "../lib/api";
import { formatHp } from "../lib/describe";
import { useRoom } from "../room/context";
import { Button, Field, Input, Select, Textarea, cx } from "./ui";

type Proficiency = "none" | "proficient" | "expertise";

/** The form holds numbers as text so a field can be empty while it is being typed in. */
interface Draft {
  name: string;
  race: string;
  className: string;
  level: string;
  abilities: Record<Ability, string>;
  saves: Record<Ability, boolean>;
  skills: Record<Skill, Proficiency>;
  maxHp: string;
  armorClass: string;
  speed: string;
  notes: string;
}

const fromEntries = <K extends string, V>(keys: readonly K[], value: (key: K) => V): Record<K, V> =>
  Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<K, V>;

function toDraft(sheet?: CharacterSheet): Draft {
  return {
    name: sheet?.name ?? "",
    race: sheet?.race ?? "",
    className: sheet?.className ?? "",
    level: String(sheet?.level ?? 1),
    abilities: fromEntries(ABILITIES, (a) => String(sheet?.abilities[a] ?? 10)),
    saves: fromEntries(ABILITIES, (a) => sheet?.saveProficiencies.includes(a) ?? false),
    skills: fromEntries(SKILLS, (s) => sheet?.skillProficiencies[s] ?? "none"),
    maxHp: String(sheet?.maxHp ?? 10),
    armorClass: String(sheet?.armorClass ?? 10),
    speed: String(sheet?.speed ?? 30),
    notes: sheet?.notes ?? "",
  };
}

const FIELD_LABELS: Record<string, string> = { maxHp: "Max HP", armorClass: "AC", className: "Class" };

function fromDraft(draft: Draft): { sheet: CharacterSheet } | { error: string } {
  const int = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text));
  const skillProficiencies: CharacterSheet["skillProficiencies"] = {};
  for (const skill of SKILLS) {
    const level = draft.skills[skill];
    if (level !== "none") skillProficiencies[skill] = level;
  }
  const parsed = CharacterSheetSchema.safeParse({
    name: draft.name,
    race: draft.race,
    className: draft.className,
    level: int(draft.level),
    abilities: fromEntries(ABILITIES, (a) => int(draft.abilities[a])),
    saveProficiencies: ABILITIES.filter((a) => draft.saves[a]),
    skillProficiencies,
    maxHp: int(draft.maxHp),
    armorClass: int(draft.armorClass),
    speed: int(draft.speed),
    notes: draft.notes,
  });
  if (parsed.success) return { sheet: parsed.data };
  const issue = parsed.error.issues[0];
  const key = String(issue?.path.at(-1) ?? "");
  const label = ABILITY_NAMES[key as Ability] ?? FIELD_LABELS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Sheet");
  return { error: `${label}: ${issue?.message ?? "invalid"}` };
}

function useSrdNames(category: string): SrdHit[] {
  const [hits, setHits] = useState<SrdHit[]>([]);
  useEffect(() => {
    let live = true;
    srdList(category).then(
      (list) => live && setHits(list),
      () => undefined, // The pickers are a convenience; the fields still take free text.
    );
    return () => {
      live = false;
    };
  }, [category]);
  return hits;
}

function SheetForm({ character, onDone }: { character: Character | null; onDone: (characterId: string | null) => void }) {
  const { connected, send } = useRoom();
  const [draft, setDraft] = useState<Draft>(() => toDraft(character?.sheet));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const classes = useSrdNames("classes");
  const races = useSrdNames("races");
  const listId = useId();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // Picking an SRD class or race fills in what the SRD says about it.
  const pickClass = (value: string) => {
    set("className", value);
    const hit = classes.find((c) => c.name.toLowerCase() === value.trim().toLowerCase());
    if (!hit) return;
    void srdEntry("classes", hit.index).then((entry) => {
      const saves = (entry.record.saving_throws as { index: string }[] | undefined)?.map((s) => s.index) ?? [];
      setDraft((d) => (d.className === value ? { ...d, saves: fromEntries(ABILITIES, (a) => saves.includes(a)) } : d));
    }, () => undefined);
  };
  const pickRace = (value: string) => {
    set("race", value);
    const hit = races.find((r) => r.name.toLowerCase() === value.trim().toLowerCase());
    if (!hit) return;
    void srdEntry("races", hit.index).then((entry) => {
      const speed = entry.record.speed;
      if (typeof speed === "number") setDraft((d) => (d.race === value ? { ...d, speed: String(speed) } : d));
    }, () => undefined);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = fromDraft(draft);
    if ("error" in result) return setError(result.error);
    setError(null);
    setBusy(true);
    const ok = character
      ? await send({ type: "update_character", characterId: character.id, sheet: result.sheet })
      : await send({ type: "create_character", sheet: result.sheet });
    setBusy(false);
    if (ok) onDone(character?.id ?? null);
  };

  const level = Number(draft.level);
  const bonus = Number.isInteger(level) && level >= 1 && level <= 20 ? proficiencyBonus(level) : null;
  const modOf = (text: string): string => {
    const score = Number(text);
    return text.trim() !== "" && Number.isInteger(score) && score >= 1 && score <= 30 ? formatModifier(abilityModifier(score)) : "";
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-label={character ? `Edit ${character.sheet.name}` : "New character"}>
      <Field label="Name">
        <Input data-testid="sheet-name" value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={60} required autoFocus />
      </Field>
      <div className="grid grid-cols-[1fr_1fr_4rem] gap-2">
        <Field label="Class">
          <Input data-testid="sheet-class" list={`${listId}-classes`} value={draft.className} onChange={(e) => pickClass(e.target.value)} maxLength={60} />
          <datalist id={`${listId}-classes`}>
            {classes.map((c) => (
              <option key={c.index} value={c.name} />
            ))}
          </datalist>
        </Field>
        <Field label="Race">
          <Input data-testid="sheet-race" list={`${listId}-races`} value={draft.race} onChange={(e) => pickRace(e.target.value)} maxLength={60} />
          <datalist id={`${listId}-races`}>
            {races.map((r) => (
              <option key={r.index} value={r.name} />
            ))}
          </datalist>
        </Field>
        <Field label="Level">
          <Input data-testid="sheet-level" type="number" min={1} max={20} value={draft.level} onChange={(e) => set("level", e.target.value)} required />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1 text-xs text-muted">Ability scores{bonus !== null && <span className="text-faint"> · proficiency bonus {formatModifier(bonus)}</span>}</legend>
        <div className="grid grid-cols-3 gap-2">
          {ABILITIES.map((ability) => (
            <label key={ability} className="rounded border border-line bg-raised p-1.5 text-center">
              <span className="block text-[10px] tracking-widest text-muted uppercase">{ability}</span>
              <input
                data-testid={`sheet-ability-${ability}`}
                aria-label={ABILITY_NAMES[ability]}
                type="number"
                min={1}
                max={30}
                required
                className="w-full bg-transparent text-center font-mono text-lg text-parchment"
                value={draft.abilities[ability]}
                onChange={(e) => set("abilities", { ...draft.abilities, [ability]: e.target.value })}
              />
              <span className="block h-4 font-mono text-xs text-amber">{modOf(draft.abilities[ability])}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-3 gap-2">
        <Field label="Max HP">
          <Input data-testid="sheet-max-hp" type="number" min={1} max={9999} value={draft.maxHp} onChange={(e) => set("maxHp", e.target.value)} required />
        </Field>
        <Field label="AC">
          <Input data-testid="sheet-ac" type="number" min={0} max={99} value={draft.armorClass} onChange={(e) => set("armorClass", e.target.value)} required />
        </Field>
        <Field label="Speed (ft.)">
          <Input data-testid="sheet-speed" type="number" min={0} max={999} step={5} value={draft.speed} onChange={(e) => set("speed", e.target.value)} required />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1 text-xs text-muted">Saving throw proficiencies</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {ABILITIES.map((ability) => (
            <label key={ability} className="inline-flex items-center gap-1 text-sm text-muted">
              <input
                type="checkbox"
                data-testid={`sheet-save-${ability}`}
                className="h-3.5 w-3.5 accent-amber"
                checked={draft.saves[ability]}
                onChange={(e) => set("saves", { ...draft.saves, [ability]: e.target.checked })}
              />
              {ABILITY_NAMES[ability]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-xs text-muted">Skill proficiencies</legend>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {SKILLS.map((skill) => (
            <label key={skill} className="flex items-center justify-between gap-2 text-sm">
              <span className={cx(draft.skills[skill] === "none" ? "text-muted" : "text-parchment")}>
                {SKILL_NAMES[skill]} <span className="text-[10px] text-faint uppercase">{SKILL_ABILITIES[skill]}</span>
              </span>
              <select
                data-testid={`sheet-skill-${skill}`}
                className="rounded border border-line bg-ink px-1 py-0.5 text-xs"
                value={draft.skills[skill]}
                onChange={(e) => set("skills", { ...draft.skills, [skill]: e.target.value as Proficiency })}
              >
                <option value="none">–</option>
                <option value="proficient">Proficient</option>
                <option value="expertise">Expertise</option>
              </select>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Notes: equipment, features, spells">
        <Textarea data-testid="sheet-notes" rows={6} value={draft.notes} onChange={(e) => set("notes", e.target.value)} maxLength={8000} />
      </Field>

      {error && (
        <p data-testid="sheet-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button data-testid="sheet-submit" type="submit" tone="primary" disabled={!connected || busy}>
          {character ? "Save changes" : "Create character"}
        </Button>
        <Button onClick={() => onDone(character?.id ?? null)}>Cancel</Button>
      </div>
    </form>
  );
}

function RollButton({ id, label, modifier, proficient, onRoll }: { id: string; label: string; modifier: number; proficient?: boolean; onRoll: () => void }) {
  const { connected } = useRoom();
  return (
    <button
      type="button"
      data-testid={id}
      disabled={!connected}
      onClick={onRoll}
      title={`Roll ${label}`}
      className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left text-sm hover:bg-raised disabled:opacity-50"
    >
      <span className={cx(proficient ? "text-parchment" : "text-muted")}>
        {proficient && <span aria-label="proficient" className="mr-1 text-amber">•</span>}
        {label}
      </span>
      <span className="font-mono text-amber">{formatModifier(modifier)}</span>
    </button>
  );
}

function SheetView({ character, onEdit }: { character: Character; onEdit: () => void }) {
  const { me, amDm, connected, send, playerName } = useRoom();
  const [mode, setMode] = useState<RollMode>("normal");
  const { sheet } = character;
  const stats: CheckStats = sheet;
  const canEdit = amDm || character.ownerId === me;
  const roll = (check: CheckSpec) => void send({ type: "roll_check", characterId: character.id, check, mode });

  return (
    <article className="space-y-3" data-testid="sheet-view" data-character-id={character.id}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate font-serif text-xl">{sheet.name}</h2>
          <p className="text-sm text-muted">
            {[sheet.race, sheet.className].filter(Boolean).join(" ") || "Adventurer"}, level {sheet.level}
            <span className="text-faint"> · played by {playerName(character.ownerId)}</span>
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-1">
            <Button small data-testid="sheet-edit" onClick={onEdit}>
              Edit
            </Button>
            <Button
              small
              tone="danger"
              data-testid="sheet-delete"
              disabled={!connected}
              onClick={() => {
                if (window.confirm(`Delete ${sheet.name}? This cannot be undone.`)) void send({ type: "delete_character", characterId: character.id });
              }}
            >
              Delete
            </Button>
          </div>
        )}
      </header>

      <dl className="grid grid-cols-5 gap-1.5 text-center">
        {(
          [
            ["HP", formatHp(character.hp)],
            ["AC", sheet.armorClass],
            ["Speed", `${sheet.speed} ft.`],
            ["Init", formatModifier(initiativeModifier(stats))],
            ["Prof", formatModifier(proficiencyBonus(sheet.level))],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded border border-line bg-raised px-1 py-1.5">
            <dt className="text-[10px] tracking-widest text-muted uppercase">{label}</dt>
            <dd className="font-mono text-sm">{value}</dd>
          </div>
        ))}
      </dl>

      {canEdit && (
        <label className="flex items-center justify-between gap-2 text-xs text-muted">
          Click any ability, save or skill to roll it
          <Select data-testid="sheet-roll-mode" aria-label="Roll mode for the sheet" className="w-auto py-0.5 text-xs" value={mode} onChange={(e) => setMode(e.target.value as RollMode)}>
            <option value="normal">Normal</option>
            <option value="advantage">Advantage</option>
            <option value="disadvantage">Disadvantage</option>
          </Select>
        </label>
      )}

      <fieldset disabled={!canEdit} className="grid grid-cols-2 gap-x-4 gap-y-3">
        <section>
          <h3 className="mb-1 text-xs tracking-widest text-muted uppercase">Abilities</h3>
          {ABILITIES.map((ability) => (
            <RollButton
              key={ability}
              id={`roll-ability-${ability}`}
              label={`${ABILITY_NAMES[ability]} ${sheet.abilities[ability]}`}
              modifier={abilityModifier(sheet.abilities[ability])}
              onRoll={() => roll({ kind: "ability", ability })}
            />
          ))}
        </section>
        <section>
          <h3 className="mb-1 text-xs tracking-widest text-muted uppercase">Saving throws</h3>
          {ABILITIES.map((ability) => (
            <RollButton
              key={ability}
              id={`roll-save-${ability}`}
              label={ABILITY_NAMES[ability]}
              modifier={savingThrowModifier(stats, ability)}
              proficient={sheet.saveProficiencies.includes(ability)}
              onRoll={() => roll({ kind: "save", ability })}
            />
          ))}
        </section>
        <section className="col-span-2">
          <h3 className="mb-1 flex justify-between text-xs tracking-widest text-muted uppercase">
            <span>Skills</span>
            <span className="tracking-normal normal-case">
              Passive Perception <span data-testid="passive-perception" className="font-mono text-parchment">{passivePerception(stats)}</span>
            </span>
          </h3>
          <div className="grid grid-cols-2 gap-x-4">
            {SKILLS.map((skill) => (
              <RollButton
                key={skill}
                id={`roll-skill-${skill}`}
                label={SKILL_NAMES[skill]}
                modifier={skillModifier(stats, skill)}
                proficient={sheet.skillProficiencies[skill] !== undefined}
                onRoll={() => roll({ kind: "skill", skill })}
              />
            ))}
          </div>
        </section>
      </fieldset>

      {sheet.notes.trim() !== "" && (
        <section>
          <h3 className="mb-1 text-xs tracking-widest text-muted uppercase">Notes</h3>
          <p className="text-sm whitespace-pre-wrap text-parchment">{sheet.notes}</p>
        </section>
      )}
    </article>
  );
}

type Mode = { kind: "view" } | { kind: "new" } | { kind: "edit"; characterId: string };

export function SheetPanel() {
  const { state, me, amDm } = useRoom();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  /** Character ids that existed when the "new character" form was opened, to find the one it creates. */
  const [knownBeforeNew, setKnownBeforeNew] = useState<ReadonlySet<string> | null>(null);

  const visible = Object.values(state.characters)
    .filter((c) => amDm || c.ownerId === me)
    .sort((a, b) => a.sheet.name.localeCompare(b.sheet.name));
  const justCreated = knownBeforeNew ? visible.find((c) => c.ownerId === me && !knownBeforeNew.has(c.id)) : undefined;
  // The chosen sheet, else the one just created, else the first.
  const current = visible.find((c) => c.id === selected) ?? justCreated ?? visible[0] ?? null;
  const editing = mode.kind === "edit" ? (state.characters[mode.characterId] ?? null) : null;

  if (mode.kind === "new" || editing) {
    return (
      <SheetForm
        key={editing?.id ?? "new"}
        character={editing}
        onDone={(id) => {
          setSelected(id);
          setMode({ kind: "view" });
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {visible.map((character) => (
          <Button
            key={character.id}
            small
            data-testid="sheet-pick"
            data-character-id={character.id}
            aria-pressed={current?.id === character.id}
            tone={current?.id === character.id ? "default" : "ghost"}
            onClick={() => setSelected(character.id)}
          >
            {character.sheet.name}
          </Button>
        ))}
        <Button
          small
          tone="primary"
          data-testid="new-character"
          className="ml-auto"
          onClick={() => {
            setKnownBeforeNew(new Set(Object.keys(state.characters)));
            setSelected(null);
            setMode({ kind: "new" });
          }}
        >
          New character
        </Button>
      </div>
      {current ? (
        <SheetView character={current} onEdit={() => setMode({ kind: "edit", characterId: current.id })} />
      ) : (
        <p className="text-sm text-muted">
          {amDm ? "No characters at the table yet." : "You have no character yet. Create one to roll from your sheet and join encounters."}
        </p>
      )}
    </div>
  );
}
