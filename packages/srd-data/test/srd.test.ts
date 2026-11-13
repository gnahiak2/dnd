import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ABILITIES, CONDITIONS, SKILLS, SKILL_ABILITIES, proficiencyBonus } from "@lanternkeep/rules";
import { describe, expect, it } from "vitest";
import { CATEGORIES, SRD_ATTRIBUTION, formatChallengeRating, loadSrd } from "../src";

const dataDir = path.resolve(import.meta.dirname, "../data");
const srd = loadSrd();

describe("import", () => {
  it.each(CATEGORIES.map((c) => c.id))("%s: every record parses and the count matches the source", (id) => {
    const text = readFileSync(path.join(dataDir, "2014", `${id}.json`), "utf8");
    const raw = JSON.parse(text) as unknown[];
    const manifest = srd.manifest.files[id];
    expect(manifest?.count).toBe(raw.length);
    expect(srd.all(id)).toHaveLength(raw.length);
    expect(createHash("sha256").update(text).digest("hex")).toBe(manifest?.sha256);
  });

  it("matches the size of the SRD 5.1 as published", () => {
    const count = Object.fromEntries(srd.categories().map((c) => [c.id, c.count]));
    // Counted from the SRD 5.1 document, not from the dataset.
    expect(count).toMatchObject({
      "ability-scores": 6,
      skills: 18,
      conditions: 15,
      "damage-types": 13,
      "magic-schools": 8,
      alignments: 9,
      classes: 12,
      races: 9,
      subclasses: 12,
      backgrounds: 1,
      feats: 1,
    });
    // Dataset totals at the pinned commit; a change here means upstream changed and deserves a look.
    expect(count).toMatchObject({ spells: 319, monsters: 334, equipment: 237, "magic-items": 362 });
  });

  it("pins the source commit", () => {
    expect(srd.manifest.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(srd.manifest.source).toBe("https://github.com/5e-bits/5e-database");
  });

  it("resolves every cross-reference", () => {
    const dangling: string[] = [];
    const visit = (value: unknown, from: string): void => {
      if (Array.isArray(value)) return value.forEach((v) => visit(v, from));
      if (value === null || typeof value !== "object") return;
      const obj = value as Record<string, unknown>;
      if (typeof obj.url === "string" && typeof obj.index === "string" && typeof obj.name === "string" && Object.keys(obj).length === 3) {
        const [, , , category, index] = obj.url.split("/");
        const known = CATEGORIES.some((c) => c.id === category);
        if (!known || !srd.get(category as never, index ?? "")) dangling.push(`${from} -> ${obj.url}`);
      }
      Object.values(obj).forEach((v) => visit(v, from));
    };
    for (const category of CATEGORIES) {
      for (const record of srd.all(category.id)) {
        for (const [key, value] of Object.entries(record)) if (key !== "url") visit(value, `${category.id}/${record.index}`);
      }
    }
    expect(dangling).toEqual([]);
  });
});

describe("licensing", () => {
  it("contains no creatures that are outside the SRD", () => {
    const names = srd.all("monsters").map((m) => m.name.toLowerCase());
    for (const banned of ["beholder", "mind flayer", "illithid", "displacer beast", "githyanki", "githzerai", "umber hulk", "carrion crawler", "yuan-ti", "kuo-toa", "slaad"]) {
      expect(names.filter((n) => n.includes(banned))).toEqual([]);
    }
  });

  it("has one subclass per class, as in the SRD", () => {
    const perClass = new Map<string, number>();
    for (const sub of srd.all("subclasses")) perClass.set(sub.class.index, (perClass.get(sub.class.index) ?? 0) + 1);
    expect([...perClass.values()]).toEqual(Array.from({ length: 12 }, () => 1));
  });

  it("carries the CC-BY attribution", () => {
    expect(SRD_ATTRIBUTION).toContain("System Reference Document 5.1");
    expect(SRD_ATTRIBUTION).toContain("https://creativecommons.org/licenses/by/4.0/legalcode");
    expect(readFileSync(path.resolve(dataDir, "../ATTRIBUTION.md"), "utf8")).toContain("https://creativecommons.org/licenses/by/4.0/legalcode");
  });
});

describe("agreement with the rules engine", () => {
  it("abilities match", () => {
    expect(srd.all("ability-scores").map((a) => a.index).sort()).toEqual([...ABILITIES].sort());
  });

  it("skills and their abilities match", () => {
    const fromData = Object.fromEntries(srd.all("skills").map((s) => [s.index, s.ability_score.index]));
    expect(fromData).toEqual(SKILL_ABILITIES);
    expect(Object.keys(fromData).sort()).toEqual([...SKILLS].sort());
  });

  it("conditions match", () => {
    expect(srd.all("conditions").map((c) => c.index).sort()).toEqual([...CONDITIONS].sort());
  });

  it("the proficiency bonus formula matches every class level row", () => {
    const rows = srd.all("levels").filter((row) => row.prof_bonus !== undefined);
    expect(rows.length).toBe(12 * 20);
    for (const row of rows) expect(proficiencyBonus(row.level), row.index).toBe(row.prof_bonus);
  });
});

describe("content spot checks against the SRD text", () => {
  it("fireball", () => {
    const fireball = srd.get("spells", "fireball");
    expect(fireball).toMatchObject({ level: 3, school: { index: "evocation" }, range: "150 feet", concentration: false });
    expect(fireball?.damage?.[0]?.damage_at_slot_level?.["3"]).toBe("8d6");
    expect(fireball?.dc).toMatchObject({ dc_type: { index: "dex" }, dc_success: "half" });
  });

  it("goblin", () => {
    expect(srd.get("monsters", "goblin")).toMatchObject({
      size: "Small",
      hit_points: 7,
      hit_points_roll: "2d6",
      dexterity: 14,
      challenge_rating: 0.25,
      xp: 50,
    });
    expect(srd.get("monsters", "goblin")?.armor_class[0]?.value).toBe(15);
  });

  it("wizard", () => {
    const wizard = srd.get("classes", "wizard");
    expect(wizard?.hit_die).toBe(6);
    expect(wizard?.saving_throws.map((s) => s.index).sort()).toEqual(["int", "wis"]);
  });

  it("longsword", () => {
    expect(srd.get("equipment", "longsword")).toMatchObject({
      cost: { quantity: 15, unit: "gp" },
      damage: { damage_dice: "1d8", damage_type: { index: "slashing" } },
      two_handed_damage: { damage_dice: "1d10" },
      weight: 3,
    });
  });
});

describe("search", () => {
  it("ranks an exact name first", () => {
    expect(srd.search("goblin")[0]).toMatchObject({ category: "monsters", index: "goblin", summary: "Small humanoid, CR 1/4" });
    expect(srd.search("Fireball")[0]).toMatchObject({ category: "spells", index: "fireball", summary: "3rd-level evocation" });
  });

  it("ranks prefixes before word matches before substrings", () => {
    const names = srd.search("bolt", { category: "spells" }).map((h) => h.name);
    expect(names).toContain("Fire Bolt");
    expect(names).toContain("Lightning Bolt");
    const hits = srd.search("dragon", { category: "monsters", limit: 100 }).map((h) => h.name);
    expect(hits.indexOf("Dragon Turtle")).toBeLessThan(hits.indexOf("Adult Black Dragon"));
  });

  it("ignores case and punctuation", () => {
    expect(srd.search("  SLEIGHT-of hand ")[0]?.index).toBe("sleight-of-hand");
  });

  it("honours category and limit", () => {
    const hits = srd.search("a", { category: "conditions", limit: 3 });
    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.category === "conditions")).toBe(true);
    expect(srd.search("a", { limit: 1000 })).toHaveLength(100);
  });

  it("returns nothing for an empty or unmatched query", () => {
    expect(srd.search("   ")).toEqual([]);
    expect(srd.search("zzzzqqq")).toEqual([]);
  });

  it("lists a category by name", () => {
    expect(srd.list("classes").map((c) => c.name)).toEqual([
      "Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard",
    ]);
  });

  it("formats fractional challenge ratings", () => {
    expect([0, 0.125, 0.25, 0.5, 1, 30].map(formatChallengeRating)).toEqual(["0", "1/8", "1/4", "1/2", "1", "30"]);
  });
});
