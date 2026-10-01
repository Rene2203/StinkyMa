import { describe, expect, it } from "vitest";
import { createMockData, emptyRule, MockIds, type MailboxRole, type MessageFlagName } from "../src/index.js";
import { RuleService } from "../src/mail/index.js";
import { openDatabase, RuleStore, seedIfEmpty } from "../src/sqlite/index.js";

function setup() {
  const db = openDatabase(":memory:");
  seedIfEmpty(db, createMockData(new Date("2026-09-30T10:00:00Z")));
  const calls: string[] = [];
  const mail = {
    async move(ids: string[], role: MailboxRole) {
      calls.push(`move ${role} ${ids.join(",")}`);
    },
    async moveToMailbox(ids: string[], mailboxId: string) {
      calls.push(`folder ${mailboxId} ${ids.join(",")}`);
    },
    async setFlag(flag: MessageFlagName, enabled: boolean, ids: string[]) {
      calls.push(`${flag} ${enabled} ${ids.join(",")}`);
    },
  };
  let now = new Date("2026-09-30T12:00:00Z");
  let n = 0;
  const store = new RuleStore(db);
  const service = new RuleService(store, mail, { accountIds: async () => [MockIds.iCloud], newId: () => `rule-${++n}`, now: () => now });
  const idOf = (address: string) => (db.prepare("SELECT id FROM message WHERE fromAddress = ? ORDER BY date DESC").get(address) as { id: string }).id;
  return { db, calls, service, store, idOf, setNow: (d: Date) => (now = d) };
}

describe("RuleService", () => {
  it("Text → Regel mit Vorschau (ohne KI), Ordner aus dem Konto", async () => {
    const { service } = setup();
    expect(await service.folders(MockIds.iCloud)).toEqual(["Finanzen"]);
    const preview = await service.interpret("Mails von stadtwerke-musterstadt.example in den Ordner Finanzen", MockIds.iCloud);
    expect(preview.origin).toBe("rules");
    expect(preview.problems).toEqual([]);
    expect(preview.definition).toMatchObject({ from: ["stadtwerke-musterstadt.example"], folder: "Finanzen" });
    expect(preview.matchCount).toBe(1);
    expect(preview.samples[0]?.from.name).toBe("Stadtwerke Musterstadt");
  });

  it("Speichern prüft die Regel; „auch auf vorhandene“ verschiebt passende Posteingangs-Mails", async () => {
    const { service, calls, idOf } = setup();
    await expect(service.save({ text: "x", accountId: null, definition: { ...emptyRule, move: "archive" } }, false)).rejects.toThrow(/Bedingung/);
    const rule = await service.save({ text: "Streamflix archivieren", accountId: null, definition: { ...emptyRule, from: ["streamflix"], move: "archive", markRead: true } }, true);
    expect(rule.enabled).toBe(true);
    expect(await service.list()).toHaveLength(1);
    const id = idOf("no-reply@streamflix.example");
    expect(calls).toEqual([`seen true ${id}`, `move archive ${id}`]);
  });

  it("Neue Mails: sofort angewendet; hängt die Regel an der Einordnung, wird gewartet (höchstens 10 Minuten)", async () => {
    const { service, calls, idOf, db, setNow } = setup();
    await service.save({ text: "", accountId: MockIds.iCloud, definition: { ...emptyRule, from: ["tech-briefing"], category: "newsletter", folder: "Finanzen" } }, false);
    await service.save({ text: "", accountId: null, definition: { ...emptyRule, from: ["paketblitz"], flag: true } }, false);
    const briefing = idOf("briefing@tech-briefing.example");
    const paket = idOf("info@paketblitz.example");
    db.prepare("UPDATE message SET category = NULL WHERE id = ?").run(briefing);
    await service.arrived([briefing, paket]);
    expect(calls).toEqual([`flagged true ${paket}`]);
    // Einordnung kommt nach: jetzt greift die Regel
    db.prepare("UPDATE message SET category = 'newsletter' WHERE id = ?").run(briefing);
    await service.processQueue();
    expect(calls).toEqual([`flagged true ${paket}`, `folder ${MockIds.iCloud}-finanzen ${briefing}`]);
    // Ohne Einordnung nach 10 Minuten: aus der Warteschlange, ohne Aktion
    calls.length = 0;
    db.prepare("UPDATE message SET category = NULL WHERE id = ?").run(briefing);
    await service.arrived([briefing]);
    setNow(new Date("2026-09-30T12:11:00Z"));
    await service.processQueue();
    expect(calls).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ruleQueue").get()).toEqual({ n: 0 });
  });

  it("Ausgeschaltete Regeln und Regeln anderer Konten greifen nicht; ohne Regeln wird nichts vorgemerkt", async () => {
    const { service, calls, idOf, db } = setup();
    await service.arrived([idOf("info@paketblitz.example")]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM ruleQueue").get()).toEqual({ n: 0 });
    const off = await service.save({ text: "", accountId: null, definition: { ...emptyRule, from: ["paketblitz"], flag: true } }, false);
    await service.setEnabled(off.id, false);
    await service.save({ text: "", accountId: MockIds.work, definition: { ...emptyRule, from: ["paketblitz"], move: "trash" } }, false);
    await service.arrived([idOf("info@paketblitz.example")]);
    expect(calls).toEqual([]);
    await service.remove(off.id);
    expect(await service.list()).toHaveLength(1);
  });
});
