import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMockData, MockIds } from "../src/index.js";
import { MailWriter, migrate, migrations, openDatabase, seedIfEmpty, SqliteMailRepository } from "../src/sqlite/index.js";

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

describe("Suche in Anhängen", () => {
  it("findet eine Mail über den Text ihres Anhangs; von: gilt für die Mail; Löschen räumt den Index", async () => {
    const db = openDatabase(":memory:");
    seedIfEmpty(db, createMockData(new Date("2026-09-29T10:00:00Z")));
    const repo = new SqliteMailRepository(db);
    const writer = new MailWriter(db);
    const invoice = (await repo.messages({ kind: "unifiedInbox" }, 100)).find((m) => m.subject === "Nebenkostenabrechnung 2025")!;
    const [attachment] = await repo.attachments(invoice.id);
    writer.setAttachmentText(attachment!.id, "Zählernummer 98765 Kaltwasser", "pdf");

    expect((await repo.search("zahlernummer", { limit: 10 })).map((m) => m.id)).toEqual([invoice.id]);
    expect((await repo.search("98765 kaltwasser", { limit: 10 })).map((m) => m.id)).toEqual([invoice.id]);
    expect(await repo.search(`98765 von:${invoice.from.address.split("@")[0]}`, { limit: 10 })).toHaveLength(1);
    expect(await repo.search("98765 von:niemand", { limit: 10 })).toEqual([]);
    // erneutes Setzen ersetzt den Text
    writer.setAttachmentText(attachment!.id, "Neuer Inhalt", "pdf");
    expect(await repo.search("98765", { limit: 10 })).toEqual([]);
    writer.deleteMessages([invoice.id]);
    expect(await repo.search("neuer inhalt", { limit: 10 })).toEqual([]);
  });
});


describe("Türsteher (SQLite)", () => {
  it("neuer Absender nach dem Einschalten wartet unter „Neue Absender“; Erlauben holt ihn in den Posteingang", async () => {
    const db = openDatabase(":memory:");
    seedIfEmpty(db, createMockData(new Date("2026-09-29T10:00:00Z")));
    const repo = new SqliteMailRepository(db);
    await repo.setScreener(MockIds.iCloud, true);
    const inbox = (db.prepare("SELECT id FROM mailbox WHERE accountId = ? AND role = 'inbox'").get(MockIds.iCloud) as { id: string }).id;
    new MailWriter(db).insertMessage({
      id: "neu-1", accountId: MockIds.iCloud, mailboxId: inbox, uid: 9001, messageId: "<neu-1@unbekannt.example>", threadId: "t-neu", threadSubject: "Hallo",
      from: { name: "Unbekannt", address: "Neu@Unbekannt.example" }, to: [], cc: [], subject: "Hallo", date: "2026-09-29T09:00:00.000Z",
      snippet: "Hallo", bodyText: "Hallo", bodyHtml: null, flags: 0, attachments: [],
    });
    expect((await repo.messages({ kind: "screener" }, 10)).map((m) => m.id)).toEqual(["neu-1"]);
    expect((await repo.messages({ kind: "unifiedInbox" }, 100)).some((m) => m.id === "neu-1")).toBe(false);
    expect((await repo.messages({ kind: "mailbox", mailboxId: inbox }, 100)).some((m) => m.id === "neu-1")).toBe(false);
    const overview = await repo.overview();
    expect(overview.counts.screener).toBe(1);
    // Wem man geschrieben hat, der ist bekannt
    repo.allowRecipients(["neu@unbekannt.example"]);
    expect((await repo.overview()).counts.screener).toBe(0);
    expect((await repo.messages({ kind: "unread" }, 100)).some((m) => m.id === "neu-1")).toBe(true);
    // Türsteher aus: nichts wartet mehr
    await repo.decideSender("neu@unbekannt.example", "block");
    await repo.setScreener(MockIds.iCloud, false);
    expect((await repo.messages({ kind: "unifiedInbox" }, 100)).some((m) => m.id === "neu-1")).toBe(false); // blockiert bleibt blockiert
  });
});
