import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CATEGORIES, type CategoryId, isCategoryId } from "./categories";
import { SCHEMAS, type SrdRecord } from "./schemas";

export { CATEGORIES, CATEGORY_IDS, isCategoryId, type CategoryId } from "./categories";
export { SCHEMAS, type Monster, type Spell, type SrdRecord } from "./schemas";

export const SRD_ATTRIBUTION =
  'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC ' +
  "and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the " +
  "Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.";

const ManifestSchema = z.strictObject({
  source: z.string(),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  ruleset: z.string(),
  files: z.record(z.string(), z.strictObject({ file: z.string(), sha256: z.string(), count: z.int() })),
});
export type SrdManifest = z.infer<typeof ManifestSchema>;

export interface SrdHit {
  category: CategoryId;
  index: string;
  name: string;
  summary: string;
}

export interface SrdDataset {
  readonly manifest: SrdManifest;
  categories(): { id: CategoryId; name: string; count: number }[];
  get<C extends CategoryId>(category: C, index: string): SrdRecord<C> | undefined;
  all<C extends CategoryId>(category: C): readonly SrdRecord<C>[];
  /** Every entry of a category as a search hit, sorted by name. */
  list(category: CategoryId): SrdHit[];
  /** Name search, best match first. Without a category, lookup-table categories are left out. */
  search(query: string, options?: { category?: CategoryId; limit?: number }): SrdHit[];
}

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");

/** Order in which equally good matches are listed, and the categories searched when none is given. */
const SEARCH_ORDER: CategoryId[] = [
  "spells",
  "monsters",
  "equipment",
  "magic-items",
  "conditions",
  "classes",
  "races",
  "skills",
  "features",
  "traits",
  "subclasses",
  "subraces",
  "backgrounds",
  "feats",
  "rule-sections",
  "rules",
  "damage-types",
  "weapon-properties",
  "magic-schools",
  "languages",
  "ability-scores",
  "alignments",
];

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

export function formatChallengeRating(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

type Describers = { [C in CategoryId]: (record: SrdRecord<C>) => { name: string; summary: string } };

const DESCRIBE: Describers = {
  "ability-scores": (r) => ({ name: r.full_name, summary: "Ability score" }),
  alignments: (r) => ({ name: r.name, summary: "Alignment" }),
  backgrounds: (r) => ({ name: r.name, summary: "Background" }),
  classes: (r) => ({ name: r.name, summary: `Class, hit die d${r.hit_die}` }),
  conditions: (r) => ({ name: r.name, summary: "Condition" }),
  "damage-types": (r) => ({ name: r.name, summary: "Damage type" }),
  "equipment-categories": (r) => ({ name: r.name, summary: `${r.equipment.length} items` }),
  equipment: (r) => ({ name: r.name, summary: `${r.equipment_category.name}, ${r.cost.quantity} ${r.cost.unit}` }),
  feats: (r) => ({ name: r.name, summary: "Feat" }),
  features: (r) => ({
    name: r.name,
    summary: `${r.subclass ? `${r.subclass.name} ` : ""}${r.class.name} feature, level ${r.level}`,
  }),
  languages: (r) => ({ name: r.name, summary: `${r.type} language` }),
  levels: (r) => ({
    name: `${r.subclass ? `${r.subclass.name} ` : ""}${r.class.name} ${r.level}`,
    summary: `${r.features.length} feature${r.features.length === 1 ? "" : "s"}`,
  }),
  "magic-items": (r) => ({ name: r.name, summary: `${r.equipment_category.name}, ${r.rarity.name.toLowerCase()}` }),
  "magic-schools": (r) => ({ name: r.name, summary: "School of magic" }),
  monsters: (r) => ({
    name: r.name,
    summary: `${r.size} ${r.type}, CR ${formatChallengeRating(r.challenge_rating)}`,
  }),
  proficiencies: (r) => ({ name: r.name, summary: `${r.type} proficiency` }),
  races: (r) => ({ name: r.name, summary: `Race, ${r.size.toLowerCase()}, speed ${r.speed} ft.` }),
  "rule-sections": (r) => ({ name: r.name, summary: "Rules" }),
  rules: (r) => ({ name: r.name, summary: "Rules chapter" }),
  skills: (r) => ({ name: r.name, summary: `${r.ability_score.name} skill` }),
  spells: (r) => ({
    name: r.name,
    summary:
      (r.level === 0 ? `${r.school.name} cantrip` : `${ordinal(r.level)}-level ${r.school.name.toLowerCase()}`) +
      (r.ritual ? " (ritual)" : ""),
  }),
  subclasses: (r) => ({ name: r.name, summary: `${r.class.name} subclass` }),
  subraces: (r) => ({ name: r.name, summary: `${r.race.name} subrace` }),
  traits: (r) => ({ name: r.name, summary: "Racial trait" }),
  "weapon-properties": (r) => ({ name: r.name, summary: "Weapon property" }),
};

interface Entry extends SrdHit {
  key: string;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** 0 = exact, 1 = name starts with query, 2 = a word starts with it, 3 = contains it, -1 = no match. */
function matchRank(key: string, query: string): number {
  if (key === query) return 0;
  if (key.startsWith(query)) return 1;
  if (key.includes(` ${query}`)) return 2;
  return key.includes(query) ? 3 : -1;
}

/**
 * Reads and validates the whole dataset. Throws if a file does not match the
 * manifest's checksum or any record fails its schema, so a corrupted or
 * half-updated dataset stops the server at startup instead of at a table.
 */
export function loadSrd(dataDir: string = DATA_DIR): SrdDataset {
  const manifest = ManifestSchema.parse(JSON.parse(readFileSync(path.join(dataDir, "manifest.json"), "utf8")));
  const records = new Map<CategoryId, Map<string, SrdRecord>>();
  const entries = new Map<CategoryId, Entry[]>();

  for (const category of CATEGORIES) {
    const expected = manifest.files[category.id];
    if (!expected) throw new Error(`SRD manifest has no entry for ${category.id}`);
    const text = readFileSync(path.join(dataDir, "2014", `${category.id}.json`), "utf8");
    if (createHash("sha256").update(text).digest("hex") !== expected.sha256) {
      throw new Error(`SRD file ${category.id}.json does not match the manifest checksum; run pnpm srd:import`);
    }
    const result = z.array(SCHEMAS[category.id]).safeParse(JSON.parse(text));
    if (!result.success) {
      const issues = result.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
      throw new Error(`SRD ${category.id}: ${result.error.issues.length} invalid field(s), e.g. ${issues.join("; ")}`);
    }

    const byIndex = new Map<string, SrdRecord>();
    const list: Entry[] = [];
    const describe = DESCRIBE[category.id] as (record: SrdRecord) => { name: string; summary: string };
    for (const record of result.data) {
      if (byIndex.has(record.index)) throw new Error(`SRD ${category.id}: duplicate index ${record.index}`);
      byIndex.set(record.index, record);
      const { name, summary } = describe(record);
      list.push({ category: category.id, index: record.index, name, summary, key: normalize(name) });
    }
    list.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    records.set(category.id, byIndex);
    entries.set(category.id, list);
  }

  const toHit = ({ key: _key, ...hit }: Entry): SrdHit => hit;

  return {
    manifest,
    categories: () => CATEGORIES.map((c) => ({ id: c.id, name: c.name, count: records.get(c.id)?.size ?? 0 })),
    get: <C extends CategoryId>(category: C, index: string) =>
      records.get(category)?.get(index) as SrdRecord<C> | undefined,
    all: <C extends CategoryId>(category: C) => [...(records.get(category)?.values() ?? [])] as SrdRecord<C>[],
    list: (category) => (entries.get(category) ?? []).map(toHit),
    search(query, options = {}) {
      const q = normalize(query);
      const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
      if (q === "") return [];
      const pool = options.category ? [options.category] : SEARCH_ORDER;
      const ranked: { entry: Entry; rank: number; order: number }[] = [];
      pool.forEach((category, order) => {
        for (const entry of entries.get(category) ?? []) {
          const rank = matchRank(entry.key, q);
          if (rank >= 0) ranked.push({ entry, rank, order });
        }
      });
      ranked.sort((a, b) => a.rank - b.rank || a.order - b.order || a.entry.name.localeCompare(b.entry.name));
      return ranked.slice(0, limit).map((r) => toHit(r.entry));
    },
  };
}

export function parseCategory(value: string): CategoryId | undefined {
  return isCategoryId(value) ? value : undefined;
}
