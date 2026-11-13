/**
 * Zod schemas for the SRD 5.1 dataset (5e-bits/5e-database, 2014 rules).
 *
 * Objects are loose: the fields the app relies on are typed and checked, and
 * anything else upstream carries is kept as-is so the reference view can show
 * it. Fields get tightened here as the rules engine starts to depend on them.
 */
import { z } from "zod";
import type { CategoryId } from "./categories";

const Ref = z.looseObject({ index: z.string().min(1), name: z.string().min(1), url: z.string().startsWith("/api/2014/") });
const Paragraphs = z.array(z.string());
const base = { index: z.string().min(1), name: z.string().min(1), url: z.string().startsWith("/api/2014/") };
const Cost = z.looseObject({ quantity: z.number().min(0), unit: z.string() });
const Choice = z.looseObject({ choose: z.int().min(1), type: z.string(), from: z.looseObject({ option_set_type: z.string() }) });
const AbilityBonus = z.looseObject({ ability_score: Ref, bonus: z.int() });
const DiceText = z.string().regex(/^\d+(d\d+)?(\s*[+-]\s*\d+(d\d+)?)*$/, "not dice notation");
const Dc = z.looseObject({ dc_type: Ref, dc_value: z.int().optional(), success_type: z.string().optional() });
const Damage = z.looseObject({ damage_type: Ref.optional(), damage_dice: z.string().optional() });

const MonsterAction = z.looseObject({
  name: z.string().min(1),
  desc: z.string(),
  attack_bonus: z.int().optional(),
  dc: Dc.optional(),
  damage: z.array(Damage).optional(),
  usage: z.looseObject({ type: z.string() }).optional(),
});

const AbilityScore = z.int().min(1).max(30);

export const SCHEMAS = {
  "ability-scores": z.looseObject({ ...base, full_name: z.string(), desc: Paragraphs, skills: z.array(Ref) }),
  alignments: z.looseObject({ ...base, abbreviation: z.string(), desc: z.string() }),
  backgrounds: z.looseObject({
    ...base,
    starting_proficiencies: z.array(Ref),
    language_options: Choice,
    starting_equipment: z.array(z.looseObject({ equipment: Ref, quantity: z.int() })),
    starting_equipment_options: z.array(Choice),
    feature: z.looseObject({ name: z.string(), desc: Paragraphs }),
  }),
  classes: z.looseObject({
    ...base,
    hit_die: z.union([z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
    proficiency_choices: z.array(Choice),
    proficiencies: z.array(Ref),
    saving_throws: z.array(Ref).length(2),
    starting_equipment: z.array(z.looseObject({ equipment: Ref, quantity: z.int() })),
    starting_equipment_options: z.array(Choice),
    class_levels: z.string(),
    multi_classing: z.looseObject({}),
    subclasses: z.array(Ref),
    spellcasting: z.looseObject({ level: z.int(), spellcasting_ability: Ref, info: z.array(z.looseObject({ name: z.string(), desc: Paragraphs })) }).optional(),
    spells: z.string().optional(),
  }),
  conditions: z.looseObject({ ...base, desc: Paragraphs }),
  "damage-types": z.looseObject({ ...base, desc: Paragraphs }),
  "equipment-categories": z.looseObject({ ...base, equipment: z.array(Ref) }),
  equipment: z.looseObject({
    ...base,
    equipment_category: Ref,
    cost: Cost,
    weight: z.number().min(0).optional(),
    desc: Paragraphs.optional(),
    weapon_category: z.string().optional(),
    weapon_range: z.string().optional(),
    damage: z.looseObject({ damage_dice: DiceText, damage_type: Ref }).optional(),
    two_handed_damage: z.looseObject({ damage_dice: DiceText, damage_type: Ref }).optional(),
    range: z.looseObject({ normal: z.int(), long: z.int().optional() }).optional(),
    properties: z.array(Ref).optional(),
    armor_category: z.string().optional(),
    armor_class: z.looseObject({ base: z.int(), dex_bonus: z.boolean(), max_bonus: z.int().optional() }).optional(),
    str_minimum: z.int().optional(),
    stealth_disadvantage: z.boolean().optional(),
  }),
  feats: z.looseObject({ ...base, desc: Paragraphs, prerequisites: z.array(z.looseObject({ ability_score: Ref, minimum_score: z.int() })) }),
  features: z.looseObject({
    ...base,
    class: Ref,
    subclass: Ref.optional(),
    level: z.int().min(1).max(20),
    desc: Paragraphs,
    parent: Ref.optional(),
  }),
  languages: z.looseObject({ ...base, type: z.string(), typical_speakers: z.array(z.string()), script: z.string().optional() }),
  /** Level rows have no name of their own upstream. */
  levels: z.looseObject({
    index: base.index,
    url: base.url,
    level: z.int().min(1).max(20),
    class: Ref,
    subclass: Ref.optional(),
    features: z.array(Ref),
    prof_bonus: z.int().min(2).max(6).optional(),
    ability_score_bonuses: z.int().optional(),
    spellcasting: z.looseObject({}).optional(),
    class_specific: z.looseObject({}).optional(),
  }),
  "magic-items": z.looseObject({
    ...base,
    equipment_category: Ref,
    rarity: z.looseObject({ name: z.string() }),
    variants: z.array(Ref),
    variant: z.boolean(),
    desc: Paragraphs,
  }),
  "magic-schools": z.looseObject({ ...base, desc: z.string() }),
  monsters: z.looseObject({
    ...base,
    size: z.enum(["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"]),
    type: z.string().min(1),
    subtype: z.string().optional(),
    alignment: z.string(),
    armor_class: z.array(z.looseObject({ type: z.string(), value: z.int().min(1) })).min(1),
    hit_points: z.int().min(1),
    hit_dice: z.string(),
    hit_points_roll: DiceText,
    speed: z.record(z.string(), z.union([z.string(), z.boolean()])),
    strength: AbilityScore,
    dexterity: AbilityScore,
    constitution: AbilityScore,
    intelligence: AbilityScore,
    wisdom: AbilityScore,
    charisma: AbilityScore,
    proficiencies: z.array(z.looseObject({ value: z.int(), proficiency: Ref })),
    damage_vulnerabilities: z.array(z.string()),
    damage_resistances: z.array(z.string()),
    damage_immunities: z.array(z.string()),
    condition_immunities: z.array(Ref),
    senses: z.looseObject({ passive_perception: z.int() }),
    languages: z.string(),
    challenge_rating: z.number().min(0).max(30),
    proficiency_bonus: z.int().min(2).max(9),
    xp: z.int().min(0),
    special_abilities: z.array(MonsterAction).optional(),
    actions: z.array(MonsterAction).optional(),
    legendary_actions: z.array(MonsterAction).optional(),
    reactions: z.array(MonsterAction).optional(),
    desc: z.string().optional(),
  }),
  proficiencies: z.looseObject({ ...base, type: z.string(), classes: z.array(Ref), races: z.array(Ref), reference: Ref }),
  races: z.looseObject({
    ...base,
    speed: z.int().min(0),
    ability_bonuses: z.array(AbilityBonus),
    alignment: z.string(),
    age: z.string(),
    size: z.string(),
    size_description: z.string(),
    languages: z.array(Ref),
    language_desc: z.string(),
    traits: z.array(Ref),
    subraces: z.array(Ref),
  }),
  "rule-sections": z.looseObject({ ...base, desc: z.string() }),
  rules: z.looseObject({ ...base, desc: z.string(), subsections: z.array(Ref) }),
  skills: z.looseObject({ ...base, desc: Paragraphs, ability_score: Ref }),
  spells: z.looseObject({
    ...base,
    desc: Paragraphs,
    higher_level: Paragraphs.optional(),
    range: z.string(),
    components: z.array(z.enum(["V", "S", "M"])).min(1),
    material: z.string().optional(),
    ritual: z.boolean(),
    duration: z.string(),
    concentration: z.boolean(),
    casting_time: z.string(),
    level: z.int().min(0).max(9),
    attack_type: z.enum(["melee", "ranged"]).optional(),
    damage: z
      .array(
        z.looseObject({
          damage_type: Ref.optional(),
          damage_at_slot_level: z.record(z.string(), z.string()).optional(),
          damage_at_character_level: z.record(z.string(), z.string()).optional(),
        }),
      )
      .optional(),
    dc: z.looseObject({ dc_type: Ref, dc_success: z.string() }).optional(),
    heal_at_slot_level: z.record(z.string(), z.string()).optional(),
    area_of_effect: z.looseObject({ type: z.string(), size: z.int() }).optional(),
    school: Ref,
    classes: z.array(Ref),
    subclasses: z.array(Ref),
  }),
  subclasses: z.looseObject({ ...base, class: Ref, subclass_flavor: z.string(), desc: Paragraphs, subclass_levels: z.string() }),
  subraces: z.looseObject({ ...base, race: Ref, desc: z.string(), ability_bonuses: z.array(AbilityBonus), racial_traits: z.array(Ref) }),
  traits: z.looseObject({ ...base, races: z.array(Ref), subraces: z.array(Ref), desc: Paragraphs, proficiencies: z.array(Ref) }),
  "weapon-properties": z.looseObject({ ...base, desc: Paragraphs }),
} as const satisfies Record<CategoryId, z.ZodType>;

export type SrdRecord<C extends CategoryId = CategoryId> = z.infer<(typeof SCHEMAS)[C]>;
export type Monster = SrdRecord<"monsters">;
export type Spell = SrdRecord<"spells">;
