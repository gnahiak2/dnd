/**
 * Downloads the SRD 5.1 (2014 rules) dataset from 5e-bits/5e-database at a
 * pinned commit into data/2014, then writes data/manifest.json with the source
 * commit, a checksum and a record count per file.
 *
 *   pnpm srd:import                 re-download the pinned commit
 *   pnpm srd:import -- <commit>     move the pin to another commit
 *
 * The data files are committed, so this only runs when updating the dataset.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "../src/categories";

const DEFAULT_COMMIT = "a6212beb4b278917c2cff41c2b04c4ef4f3e0d6f";
const commit = process.argv.slice(2).find((arg) => /^[0-9a-f]{40}$/.test(arg)) ?? DEFAULT_COMMIT;
const base = `https://raw.githubusercontent.com/5e-bits/5e-database/${commit}/src/2014/en`;
const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
const outDir = path.join(dataDir, "2014");

await mkdir(outDir, { recursive: true });

const files: Record<string, { file: string; sha256: string; count: number }> = {};
for (const category of CATEGORIES) {
  const response = await fetch(`${base}/${category.file}`);
  if (!response.ok) throw new Error(`${category.file}: HTTP ${response.status}`);
  const text = await response.text();
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`${category.file}: expected a JSON array`);
  await writeFile(path.join(outDir, `${category.id}.json`), text);
  files[category.id] = {
    file: category.file,
    sha256: createHash("sha256").update(text).digest("hex"),
    count: parsed.length,
  };
  console.log(`${category.id.padEnd(22)} ${String(parsed.length).padStart(5)} records`);
}

const manifest = { source: "https://github.com/5e-bits/5e-database", commit, ruleset: "SRD 5.1 (2014)", files };
await writeFile(path.join(dataDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nWrote ${Object.keys(files).length} files and manifest.json (commit ${commit.slice(0, 12)})`);
