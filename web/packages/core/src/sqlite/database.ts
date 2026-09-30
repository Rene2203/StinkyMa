import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./schema.js";

/** Öffnet (und migriert) die Datenbank. `":memory:"` für Tests und den Mock-Modus. */
export function openDatabase(path: string | ":memory:" = ":memory:"): Database.Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  if (path !== ":memory:") db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}
