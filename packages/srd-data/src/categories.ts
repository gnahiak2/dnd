/** One entry per file in the upstream dataset. `id` doubles as the URL segment and the data file name. */
export const CATEGORIES = [
  { id: "ability-scores", name: "Ability Scores", file: "5e-SRD-Ability-Scores.json" },
  { id: "alignments", name: "Alignments", file: "5e-SRD-Alignments.json" },
  { id: "backgrounds", name: "Backgrounds", file: "5e-SRD-Backgrounds.json" },
  { id: "classes", name: "Classes", file: "5e-SRD-Classes.json" },
  { id: "conditions", name: "Conditions", file: "5e-SRD-Conditions.json" },
  { id: "damage-types", name: "Damage Types", file: "5e-SRD-Damage-Types.json" },
  { id: "equipment-categories", name: "Equipment Categories", file: "5e-SRD-Equipment-Categories.json" },
  { id: "equipment", name: "Equipment", file: "5e-SRD-Equipment.json" },
  { id: "feats", name: "Feats", file: "5e-SRD-Feats.json" },
  { id: "features", name: "Class Features", file: "5e-SRD-Features.json" },
  { id: "languages", name: "Languages", file: "5e-SRD-Languages.json" },
  { id: "levels", name: "Class Levels", file: "5e-SRD-Levels.json" },
  { id: "magic-items", name: "Magic Items", file: "5e-SRD-Magic-Items.json" },
  { id: "magic-schools", name: "Schools of Magic", file: "5e-SRD-Magic-Schools.json" },
  { id: "monsters", name: "Monsters", file: "5e-SRD-Monsters.json" },
  { id: "proficiencies", name: "Proficiencies", file: "5e-SRD-Proficiencies.json" },
  { id: "races", name: "Races", file: "5e-SRD-Races.json" },
  { id: "rule-sections", name: "Rules", file: "5e-SRD-Rule-Sections.json" },
  { id: "rules", name: "Rule Chapters", file: "5e-SRD-Rules.json" },
  { id: "skills", name: "Skills", file: "5e-SRD-Skills.json" },
  { id: "spells", name: "Spells", file: "5e-SRD-Spells.json" },
  { id: "subclasses", name: "Subclasses", file: "5e-SRD-Subclasses.json" },
  { id: "subraces", name: "Subraces", file: "5e-SRD-Subraces.json" },
  { id: "traits", name: "Racial Traits", file: "5e-SRD-Traits.json" },
  { id: "weapon-properties", name: "Weapon Properties", file: "5e-SRD-Weapon-Properties.json" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];

export function isCategoryId(value: string): value is CategoryId {
  return (CATEGORY_IDS as readonly string[]).includes(value);
}
