import type { SrdHit } from "@lanternkeep/protocol";
import { abilityModifier, formatModifier } from "@lanternkeep/rules";
import { type ReactNode, useEffect, useState } from "react";
import { type SrdCategory, type SrdEntry, srdCategories, srdEntry, srdSearch } from "../lib/api";
import { Button, Input, Select, cx } from "./ui";

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : null);
const nameOf = (v: unknown): string | null => (isRec(v) ? str(v.name) : str(v));
const names = (v: unknown): string | null => {
  if (!Array.isArray(v)) return null;
  const list = v.map(nameOf).filter((n): n is string => n !== null);
  return list.length > 0 ? list.join(", ") : null;
};
const paragraphs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : typeof v === "string" ? [v] : []);
const titleCase = (key: string): string => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function Prose({ text }: { text: string[] }) {
  if (text.length === 0) return null;
  return (
    <div className="space-y-2 font-serif text-[15px] leading-relaxed">
      {text.map((p, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {p}
        </p>
      ))}
    </div>
  );
}

function Facts({ rows }: { rows: [label: string, value: ReactNode][] }) {
  const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Named({ title, items }: { title: string; items: unknown }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <section>
      <h4 className="mb-1 border-b border-line pb-0.5 text-xs tracking-widest text-amber uppercase">{title}</h4>
      <div className="space-y-1.5 text-sm">
        {items.filter(isRec).map((item, i) => (
          <p key={i} className="whitespace-pre-wrap">
            <strong className="font-serif italic">{str(item.name) ?? "—"}.</strong> {paragraphs(item.desc).join("\n")}
          </p>
        ))}
      </div>
    </section>
  );
}

const ordinal = (n: number): string => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const cr = (v: unknown): string | null => (v === 0.125 ? "1/8" : v === 0.25 ? "1/4" : v === 0.5 ? "1/2" : str(v));
const money = (v: unknown): string | null => (isRec(v) && str(v.quantity) && str(v.unit) ? `${str(v.quantity)} ${str(v.unit)}` : null);

function Spell({ r }: { r: Rec }) {
  const level = typeof r.level === "number" ? r.level : 0;
  const school = nameOf(r.school) ?? "";
  const components = Array.isArray(r.components) ? r.components.join(", ") : null;
  return (
    <>
      <p className="text-sm text-muted italic">
        {level === 0 ? `${school} cantrip` : `${ordinal(level)}-level ${school.toLowerCase()}`}
        {r.ritual === true && " (ritual)"}
      </p>
      <Facts
        rows={[
          ["Casting time", str(r.casting_time)],
          ["Range", str(r.range)],
          ["Components", components && `${components}${str(r.material) ? ` (${str(r.material)})` : ""}`],
          ["Duration", str(r.duration) && `${r.concentration === true ? "Concentration, " : ""}${str(r.duration)}`],
          ["Classes", names(r.classes)],
        ]}
      />
      <Prose text={paragraphs(r.desc)} />
      {paragraphs(r.higher_level).length > 0 && (
        <section>
          <h4 className="mb-1 text-xs tracking-widest text-amber uppercase">At higher levels</h4>
          <Prose text={paragraphs(r.higher_level)} />
        </section>
      )}
    </>
  );
}

const SCORES = [
  ["STR", "strength"],
  ["DEX", "dexterity"],
  ["CON", "constitution"],
  ["INT", "intelligence"],
  ["WIS", "wisdom"],
  ["CHA", "charisma"],
] as const;

function Monster({ r }: { r: Rec }) {
  const ac = Array.isArray(r.armor_class) && isRec(r.armor_class[0]) ? r.armor_class[0] : null;
  const speed = isRec(r.speed)
    ? Object.entries(r.speed)
        .map(([mode, value]) => (value === true ? mode : mode === "walk" ? String(value) : `${mode} ${String(value)}`))
        .join(", ")
    : null;
  const senses = isRec(r.senses)
    ? Object.entries(r.senses)
        .map(([key, value]) => `${key.replace(/_/g, " ")} ${String(value)}`)
        .join(", ")
    : null;
  const proficiencies = Array.isArray(r.proficiencies)
    ? r.proficiencies
        .filter(isRec)
        .map((p) => `${(nameOf(p.proficiency) ?? "").replace(/^(Skill|Saving Throw): /, "")} ${formatModifier(Number(p.value))}`)
        .join(", ")
    : null;
  const list = (v: unknown): string | null => (Array.isArray(v) && v.length > 0 ? v.map((x) => nameOf(x) ?? "").join(", ") : null);

  return (
    <>
      <p className="text-sm text-muted italic">
        {[str(r.size), str(r.type), str(r.subtype) && `(${str(r.subtype)})`].filter(Boolean).join(" ")}
        {str(r.alignment) && `, ${str(r.alignment)}`}
      </p>
      <Facts
        rows={[
          ["Armor Class", ac && `${str(ac.value)}${str(ac.type) && ac.type !== "dex" ? ` (${str(ac.type)})` : ""}`],
          ["Hit Points", str(r.hit_points) && `${str(r.hit_points)}${str(r.hit_points_roll) ? ` (${str(r.hit_points_roll)})` : ""}`],
          ["Speed", speed],
        ]}
      />
      <dl className="grid grid-cols-6 gap-1 text-center">
        {SCORES.map(([label, key]) => {
          const score = r[key];
          return (
            <div key={key} className="rounded border border-line bg-raised py-1">
              <dt className="text-[10px] tracking-widest text-muted">{label}</dt>
              <dd className="font-mono text-sm">
                {typeof score === "number" ? (
                  <>
                    {score} <span className="text-amber">({formatModifier(abilityModifier(Math.max(1, Math.min(30, score))))})</span>
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <Facts
        rows={[
          ["Proficiencies", proficiencies],
          ["Vulnerabilities", list(r.damage_vulnerabilities)],
          ["Resistances", list(r.damage_resistances)],
          ["Immunities", list(r.damage_immunities)],
          ["Condition immunities", list(r.condition_immunities)],
          ["Senses", senses],
          ["Languages", str(r.languages)],
          ["Challenge", cr(r.challenge_rating) && `${cr(r.challenge_rating)}${str(r.xp) ? ` (${Number(r.xp).toLocaleString()} XP)` : ""}`],
        ]}
      />
      <Prose text={paragraphs(r.desc)} />
      <Named title="Traits" items={r.special_abilities} />
      <Named title="Actions" items={r.actions} />
      <Named title="Reactions" items={r.reactions} />
      <Named title="Legendary actions" items={r.legendary_actions} />
    </>
  );
}

function Equipment({ r }: { r: Rec }) {
  const damage = (v: unknown): string | null => (isRec(v) && str(v.damage_dice) ? `${str(v.damage_dice)} ${(nameOf(v.damage_type) ?? "").toLowerCase()}` : null);
  const range = isRec(r.range) && str(r.range.normal) ? `${str(r.range.normal)}${str(r.range.long) ? `/${str(r.range.long)}` : ""} ft.` : null;
  const armor = isRec(r.armor_class)
    ? `${str(r.armor_class.base)}${r.armor_class.dex_bonus === true ? ` + Dex modifier${str(r.armor_class.max_bonus) ? ` (max ${str(r.armor_class.max_bonus)})` : ""}` : ""}`
    : null;
  return (
    <>
      <p className="text-sm text-muted italic">
        {[nameOf(r.equipment_category), str(r.weapon_category) && `${str(r.weapon_category)} ${str(r.weapon_range) ?? ""}`.trim(), str(r.armor_category)].filter(Boolean).join(" · ")}
        {isRec(r.rarity) && str(r.rarity.name) && `, ${str(r.rarity.name)?.toLowerCase()}`}
      </p>
      <Facts
        rows={[
          ["Cost", money(r.cost)],
          ["Weight", str(r.weight) && `${str(r.weight)} lb.`],
          ["Damage", damage(r.damage)],
          ["Two-handed", damage(r.two_handed_damage)],
          ["Range", range],
          ["Armor Class", armor],
          ["Strength", str(r.str_minimum) && r.str_minimum !== 0 ? `${str(r.str_minimum)} minimum` : null],
          ["Stealth", r.stealth_disadvantage === true ? "Disadvantage" : null],
          ["Properties", names(r.properties)],
        ]}
      />
      <Prose text={paragraphs(r.desc)} />
    </>
  );
}

const SKIP = new Set(["index", "name", "url", "desc", "image", "full_name"]);

/** For categories without a dedicated layout: prose, then every simple field as a labelled row. */
function Generic({ r }: { r: Rec }) {
  const rows: [string, ReactNode][] = [];
  for (const [key, value] of Object.entries(r)) {
    if (SKIP.has(key)) continue;
    const shown = typeof value === "boolean" ? (value ? "Yes" : "No") : (str(value) ?? nameOf(value) ?? names(value));
    if (shown && !shown.startsWith("/api/")) rows.push([titleCase(key), shown]);
  }
  return (
    <>
      <Facts rows={rows} />
      <Prose text={paragraphs(r.desc)} />
    </>
  );
}

function Detail({ entry }: { entry: SrdEntry }) {
  const r = entry.record;
  return (
    <article data-testid="srd-detail" data-category={entry.category} data-index={entry.index} className="space-y-3">
      <h3 className="font-serif text-xl text-parchment">{entry.name}</h3>
      {entry.category === "spells" ? (
        <Spell r={r} />
      ) : entry.category === "monsters" ? (
        <Monster r={r} />
      ) : entry.category === "equipment" || entry.category === "magic-items" ? (
        <Equipment r={r} />
      ) : (
        <Generic r={r} />
      )}
    </article>
  );
}

export function Reference() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<SrdCategory[]>([]);
  const [results, setResults] = useState<SrdHit[] | null>(null);
  const [entry, setEntry] = useState<SrdEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    srdCategories().then(
      (list) => live && setCategories(list),
      () => undefined, // Search still works across everything without the filter list.
    );
    return () => {
      live = false;
    };
  }, []);

  const term = query.trim();
  useEffect(() => {
    if (term === "") return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      srdSearch(term, category || undefined, 40, abort.signal).then(
        (hits) => {
          setResults(hits);
          setError(null);
        },
        (cause: unknown) => {
          if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Search failed.");
        },
      );
    }, 200);
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [term, category]);

  const open = (hit: SrdHit) => {
    srdEntry(hit.category, hit.index).then(
      (loaded) => {
        setEntry(loaded);
        setError(null);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load that entry."),
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          data-testid="srd-search-input"
          aria-label="Search the rules reference"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setEntry(null);
          }}
          placeholder="Search spells, monsters, items, rules…"
          autoComplete="off"
        />
        <Select data-testid="srd-category" aria-label="Category" className="w-32" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {entry ? (
        <>
          <Button small tone="ghost" data-testid="srd-back" onClick={() => setEntry(null)}>
            Back to results
          </Button>
          <Detail entry={entry} />
        </>
      ) : term === "" ? (
        <p className="text-sm text-muted">Look up anything in the SRD 5.1: a spell, a monster, a condition, a piece of gear.</p>
      ) : results === null ? null : results.length === 0 ? (
        <p className="text-sm text-muted">Nothing in the SRD matches that.</p>
      ) : (
        <ul className="divide-y divide-line rounded border border-line">
          {results.map((hit) => (
            <li key={`${hit.category}/${hit.index}`}>
              <button
                type="button"
                data-testid="srd-result"
                data-category={hit.category}
                data-index={hit.index}
                onClick={() => open(hit)}
                className={cx("flex w-full items-baseline justify-between gap-3 px-2 py-1.5 text-left hover:bg-raised")}
              >
                <span>{hit.name}</span>
                <span className="shrink-0 text-xs text-faint">{hit.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
