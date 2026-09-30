import { describe, expect, it } from "vitest";
import {
  InMemoryMailRepository,
  MockIds,
  createMockData,
  isFlagged,
  isRead,
  type MailRepository,
} from "../src/index.js";
import { SqliteMailRepository, openDatabase, seedIfEmpty } from "../src/sqlite/index.js";

// Beide Implementierungen müssen sich gleich verhalten – dieselben Tests laufen gegen beide.
const now = new Date("2026-09-29T10:00:00Z");

const implementations: [string, () => MailRepository][] = [
  ["InMemory", () => new InMemoryMailRepository(createMockData(now))],
  [
    "SQLite",
    () => {
      const db = openDatabase(":memory:");
      seedIfEmpty(db, createMockData(now));
      return new SqliteMailRepository(db);
    },
  ],
];

describe.each(implementations)("MailRepository (%s)", (_name, make) => {
  it("sortiert Konten", async () => {
    const accounts = await make().accounts();
    expect(accounts.map((a) => a.id)).toEqual([MockIds.iCloud, MockIds.gmail, MockIds.work]);
  });

  it("zeigt den Posteingang zuerst, eigene Ordner zuletzt", async () => {
    const boxes = await make().mailboxes(MockIds.iCloud);
    expect(boxes).toHaveLength(7);
    expect(boxes[0]?.role).toBe("inbox");
    expect(boxes.at(-1)?.name).toBe("Finanzen");
  });

  it("gemeinsamer Posteingang: nur Posteingänge, neueste zuerst, alle Konten", async () => {
    const messages = await make().messages({ kind: "unifiedInbox" }, 100);
    const inboxes = [MockIds.iCloud, MockIds.gmail, MockIds.work].map((id) => MockIds.mailbox(id, "inbox"));
    expect(messages.length).toBeGreaterThan(10);
    expect(messages.every((m) => inboxes.includes(m.mailboxId))).toBe(true);
    const dates = messages.map((m) => m.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(new Set(messages.map((m) => m.accountId)).size).toBe(3);
  });

  it("beachtet das Limit", async () => {
    expect(await make().messages({ kind: "unifiedInbox" }, 3)).toHaveLength(3);
  });

  it("Ungelesen-Bereich und Zähler stimmen überein", async () => {
    const repo = make();
    const unread = await repo.messages({ kind: "unread" }, 100);
    expect(unread.every((m) => !isRead(m))).toBe(true);
    expect(await repo.unreadCount({ kind: "unifiedInbox" })).toBe(unread.length);
    expect(await repo.unreadCount({ kind: "unread" })).toBe(unread.length);
  });

  it("Markiert: über Ordner hinweg, aber ohne Papierkorb", async () => {
    const repo = make();
    const flagged = await repo.messages({ kind: "flagged" }, 100);
    expect(flagged).toHaveLength(2);
    await repo.move([flagged[0]!.id], "trash");
    expect(await repo.messages({ kind: "flagged" }, 100)).toHaveLength(1);
  });

  it("Thread: älteste zuerst, über Ordner hinweg", async () => {
    const thread = await make().thread("mock-thread-relaunch");
    expect(thread).toHaveLength(3);
    expect(thread.map((m) => m.date)).toEqual(thread.map((m) => m.date).sort());
    expect(new Set(thread.map((m) => m.mailboxId)).size).toBe(2);
  });

  it("setFlag setzt und entfernt nur dieses Flag", async () => {
    const repo = make();
    const [target] = await repo.messages({ kind: "unread" }, 1);
    await repo.setFlag("seen", true, [target!.id]);
    const read = await repo.message(target!.id);
    expect(read && isRead(read)).toBe(true);
    await repo.setFlag("seen", false, [target!.id]);
    expect((await repo.message(target!.id))?.flags).toBe(target!.flags);
    await repo.setFlag("flagged", true, [target!.id]);
    const flaggedNow = await repo.message(target!.id);
    expect(flaggedNow && isFlagged(flaggedNow)).toBe(true);
  });

  it("verschiebt in den Ordner des jeweiligen Kontos", async () => {
    const repo = make();
    const inbox = await repo.messages({ kind: "unifiedInbox" }, 100);
    const icloud = inbox.find((m) => m.accountId === MockIds.iCloud)!;
    const work = inbox.find((m) => m.accountId === MockIds.work)!;
    await repo.move([icloud.id, work.id], "archive");
    expect((await repo.message(icloud.id))?.mailboxId).toBe(MockIds.mailbox(MockIds.iCloud, "archive"));
    expect((await repo.message(work.id))?.mailboxId).toBe(MockIds.mailbox(MockIds.work, "archive"));
    expect(await repo.messages({ kind: "unifiedInbox" }, 100)).toHaveLength(inbox.length - 2);
  });

  it("ohne Zielordner bleibt die Mail, wo sie ist", async () => {
    const repo = make();
    const inbox = await repo.messages({ kind: "unifiedInbox" }, 100);
    const gmail = inbox.find((m) => m.accountId === MockIds.gmail)!;
    await repo.move([gmail.id], "custom"); // „custom“ gibt es nur im iCloud-Konto
    expect((await repo.message(gmail.id))?.mailboxId).toBe(gmail.mailboxId);
  });

  it("leere ID-Listen sind erlaubt", async () => {
    const repo = make();
    await repo.setFlag("seen", true, []);
    await repo.move([], "trash");
  });

  it("Anhänge gehören zur Mail, alphabetisch", async () => {
    const repo = make();
    const inbox = await repo.messages({ kind: "unifiedInbox" }, 100);
    const invoice = inbox.find((m) => m.subject === "Ihre Abschlagsrechnung Oktober")!;
    expect(invoice.hasAttachments).toBe(true);
    expect((await repo.attachments(invoice.id)).map((a) => a.filename)).toEqual(["AGB.pdf", "Rechnung_2026-10.pdf"]);
  });

  it("overview liefert Konten, Ordner und dieselben Zähler wie unreadCount", async () => {
    const repo = make();
    const { accounts, mailboxesByAccount, counts } = await repo.overview();
    expect(accounts.map((a) => a.id)).toEqual((await repo.accounts()).map((a) => a.id));
    expect(mailboxesByAccount[MockIds.iCloud]?.map((m) => m.id)).toEqual((await repo.mailboxes(MockIds.iCloud)).map((m) => m.id));
    expect(counts.unifiedInbox).toBe(await repo.unreadCount({ kind: "unifiedInbox" }));
    expect(counts.unread).toBe(await repo.unreadCount({ kind: "unread" }));
    expect(counts.flagged).toBe(await repo.unreadCount({ kind: "flagged" }));
    for (const box of Object.values(mailboxesByAccount).flat()) {
      expect(counts.mailboxes[box.id] ?? 0, box.id).toBe(await repo.unreadCount({ kind: "mailbox", mailboxId: box.id }));
    }
  });

  it("unbekannte Mail ergibt null", async () => {
    expect(await make().message("gibt-es-nicht")).toBeNull();
  });
});
