import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMockData, MockIds } from "../src/index.js";
import { migrate, migrations, openDatabase, seedIfEmpty, SqliteMailRepository } from "../src/sqlite/index.js";

describe("SQLite-Schema", () => {
  it("legt alle Tabellen aus Abschnitt 8 an", () => {
    const db = openDatabase(":memory:");
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name),
    );
    for (const table of [
      "account", "mailbox", "thread", "message", "attachment", "attachmentAnalysis", "attachmentText",
      "embedding", "behaviorEvent", "senderProfile", "styleProfile", "reminder", "aiModel", "messageFTS",
    ]) {
      expect(tables, table).toContain(table);
    }
    expect(db.pragma("user_version", { simple: true })).toBe(migrations.length);
  });

  it("zweimal migrieren ist harmlos", () => {
    const db = openDatabase(":memory:");
    expect(migrate(db)).toEqual([]);
  });

  it("verweigert neuere Datenbanken", () => {
    const db = openDatabase(":memory:");
    db.pragma(`user_version = ${migrations.length + 1}`);
    expect(() => migrate(db)).toThrow(/neuer als diese App/);
  });

  it("Datei-Datenbank mit Unterordnern", () => {
    const dir = mkdtempSync(join(tmpdir(), "stinkyma-"));
    try {
      const path = join(dir, "sub", "mail.sqlite");
      const db = openDatabase(path);
      expect(seedIfEmpty(db, createMockData())).toBe(true);
      expect(seedIfEmpty(db, createMockData())).toBe(false);
      db.close();
      const reopened = openDatabase(path);
      expect((reopened.prepare("SELECT COUNT(*) AS n FROM account").get() as { n: number }).n).toBe(3);
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Konto löschen löscht seine Mails mit", () => {
    const db = openDatabase(":memory:");
    seedIfEmpty(db, createMockData());
    db.prepare("DELETE FROM account WHERE id = ?").run(MockIds.gmail);
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM message WHERE accountId = ?").get(MockIds.gmail) as { n: number };
    expect(n).toBe(0);
  });

  it("Volltextindex folgt den Mails, ohne Umlaut- und Groß/klein-Empfindlichkeit", async () => {
    const db = openDatabase(":memory:");
    seedIfEmpty(db, createMockData());
    const search = (q: string) =>
      (db
        .prepare("SELECT message.id FROM message JOIN messageFTS ON messageFTS.rowid = message.rowid WHERE messageFTS MATCH ?")
        .all(q) as { id: string }[]).map((r) => r.id);
    expect(search("Nebenkosten*")).toHaveLength(1);
    expect(search("nudelsalat")).toHaveLength(2);
    expect(search("ABSCHLAGSRECHNUNG")).toHaveLength(1);
    expect(search("wochenruckblick")).toHaveLength(1); // „Wochenrückblick“ ohne Umlaut gefunden
    db.prepare("UPDATE message SET subject = 'Völlig neuer Betreff' WHERE subject = 'Nebenkostenabrechnung 2025'").run();
    expect(search("Völlig")).toHaveLength(1);
    await new SqliteMailRepository(db).setFlag("seen", true, search("Völlig"));
    expect(search("Völlig")).toHaveLength(1);
  });

  it("Mock-Adressen enden auf .example", () => {
    const db = openDatabase(":memory:");
    seedIfEmpty(db, createMockData());
    const rows = db.prepare("SELECT fromAddress AS a FROM message UNION SELECT email FROM account").all() as { a: string }[];
    expect(rows.every((r) => r.a.endsWith(".example"))).toBe(true);
  });
});
