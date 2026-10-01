import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMockData, digestCounts, digestDue, isDigestImportant, localDay } from "../src/index.js";
import { AIService, ModelStore } from "../src/llm/index.js";
import { ActionStore, AIResultStore, DigestStore, openDatabase, seedIfEmpty, SqliteMailRepository } from "../src/sqlite/index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "stinkyma-digest-"));
  dirs.push(dir);
  const db = openDatabase(":memory:");
  seedIfEmpty(db, createMockData(new Date("2026-09-30T10:00:00Z")));
  const repository = new SqliteMailRepository(db);
  let now = new Date("2026-09-30T12:00:00Z");
  let ids = 0;
  const service = new AIService({
    store: new ModelStore(join(dir, "models")),
    results: new AIResultStore(db),
    actions: new ActionStore(db, () => `act-${++ids}`),
    digest: new DigestStore(db),
    message: (id) => repository.message(id),
    thread: (id) => repository.thread(id),
    ownAddresses: async () => [],
    settings: { load: () => null, save: () => undefined },
    ramGb: 8,
    now: () => now,
  });
  return { db, service, setNow: (d: Date) => (now = d) };
}

describe("Tagesüberblick", () => {
  it("ohne Modell: wichtige ungelesene Mails, Newsletter nur gezählt, Fristen aus ungeöffneten Mails per Regeln", async () => {
    const { service, setNow, db } = setup();
    db.prepare("UPDATE message SET flags = 0, date = '2026-09-30T11:00:00.000Z' WHERE id = (SELECT id FROM message WHERE category = 'newsletter' LIMIT 1)").run();
    const view = await service.dailyDigest();
    expect(view.day).toBe(localDay(new Date("2026-09-30T12:00:00Z")));
    expect(view.important.length).toBeGreaterThan(0);
    expect(view.important.every((m) => isDigestImportant(m.category))).toBe(true);
    expect(view.counts.newsletter).toBe(1);
    expect(view.important.some((m) => m.category === "newsletter")).toBe(false);
    // Die Abschlagsrechnung (86,00 € am 15.10.) wurde nie geöffnet – trotzdem gefunden
    expect(db.prepare("SELECT COUNT(*) AS n FROM messageActionScan").get()).not.toEqual({ n: 0 });
    setNow(new Date("2026-10-10T08:00:00Z"));
    const later = await service.dailyDigest();
    const payment = later.due.find((a) => a.amount === "86,00 €");
    expect(payment).toMatchObject({ type: "payment", date: "2026-10-15", overdue: false });
    expect(later.important).toEqual([]); // nichts Neues in den letzten 2 Tagen
    setNow(new Date("2026-10-16T08:00:00Z"));
    expect((await service.dailyDigest()).due.find((a) => a.amount === "86,00 €")?.overdue).toBe(true);
  });

  it("Erledigtes und Mails im Papierkorb erscheinen nicht", async () => {
    const { service, setNow, db } = setup();
    await service.dailyDigest();
    setNow(new Date("2026-10-10T08:00:00Z"));
    const payment = (await service.dailyDigest()).due.find((a) => a.amount === "86,00 €")!;
    await service.setActionStatus(payment.actionId, "done");
    expect((await service.dailyDigest()).due.some((a) => a.actionId === payment.actionId)).toBe(false);
    await service.setActionStatus(payment.actionId, "open");
    const trash = (db.prepare("SELECT id FROM mailbox WHERE role = 'trash' AND accountId = (SELECT accountId FROM message WHERE id = ?)").get(payment.messageId) as { id: string }).id;
    db.prepare("UPDATE message SET mailboxId = ? WHERE id = ?").run(trash, payment.messageId);
    expect((await service.dailyDigest()).due.some((a) => a.actionId === payment.actionId)).toBe(false);
  });

  it("fällig ab der eingestellten Uhrzeit, einmal am Tag", () => {
    const at = (h: number, m: number) => new Date(2026, 9, 1, h, m);
    expect(digestDue(at(7, 29), "07:30", null)).toBe(false);
    expect(digestDue(at(7, 30), "07:30", null)).toBe(true);
    expect(digestDue(at(9, 0), "07:30", "2026-10-01")).toBe(false);
    expect(digestDue(at(9, 0), "07:30", "2026-09-30")).toBe(true);
    expect(digestDue(at(9, 0), "kaputt", null)).toBe(false);
    expect(digestCounts({ day: "2026-10-01", due: [], important: [], waitingOnMe: [], counts: { newsletter: 0, notification: 0, spamSuspect: 0, flagged: 0 } })).toEqual({ due: 0, dueToday: 0, overdue: 0, important: 0, waiting: 0 });
  });
});
