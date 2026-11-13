import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export type Db = ReturnType<typeof openDb>;

/** Opens (and migrates) the database. Pass ":memory:" for tests. */
export function openDb(file: string) {
  if (file !== ":memory:") mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return Object.assign(db, { close: () => sqlite.close() });
}
