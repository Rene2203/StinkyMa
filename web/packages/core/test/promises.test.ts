import { describe, expect, it } from "vitest";
import { dueFromText, followUpText, parsePromises, rulePromises, type Account } from "../src/index.js";
import { PromiseService } from "../src/llm/index.js";
import { MailWriter, openDatabase, PromiseStore } from "../src/sqlite/index.js";

// Testdaten erfunden. Mittwoch, 30.09.2026.
const wednesday = new Date("2026-09-30T08:00:00Z");
const anna = { name: "Anna Beispiel", address: "anna@example.test" };
const thomas = { name: "Thomas Krüger", address: "thomas@agentur.example" };

describe("Zusagen: Fristen und Erkennen", () => {
  it("rechnet Fristen aus Ausdrücken ab dem Sendedatum", () => {
    expect(dueFromText("bis Freitag", wednesday)).toBe("2026-10-02");
    expect(dueFromText("Ende der Woche", wednesday)).toBe("2026-10-02");
    expect(dueFromText("nächste Woche", wednesday)).toBe("2026-10-09");
    expect(dueFromText("Anfang nächster Woche", wednesday)).toBe("2026-10-05");
    expect(dueFromText("bis Ende des Monats", wednesday)).toBe("2026-09-30");
    expect(dueFromText("in 3 Tagen", wednesday)).toBe("2026-10-03");
    expect(dueFromText("heute Abend", wednesday)).toBe("2026-09-30");
    expect(dueFromText("by next Tuesday", wednesday)).toBe("2026-10-06");
    expect(dueFromText("bis 15.10.", wednesday)).toBe("2026-10-15");
    expect(dueFromText("ich frag Lisa wegen Samstag", wednesday)).toBeNull(); // Anlass, keine Frist
    expect(dueFromText("kümmere mich drum", wednesday)).toBeNull();
  });

  it("Regeln: eigene Zusage ja; Bitte, Frage, Erledigtes, Zitat und Werbung nein", () => {
    expect(rulePromises("Ich schicke dir die Präsentation bis Freitag.", wednesday, "mine", anna)).toMatchObject([{ dueDate: "2026-10-02" }]);
    expect(rulePromises("Kannst du mir bis Freitag die Zahlen schicken?", wednesday, "mine", anna)).toEqual([]);
    expect(rulePromises("Anbei wie versprochen die Präsentation.", wednesday, "mine", anna)).toEqual([]);
    expect(rulePromises("Gern!\n\nAm 29.09. schrieb Lena:\n> Ich schicke dir morgen das Programm.", wednesday, "mine", anna)).toEqual([]);
    expect(rulePromises("Wir melden uns nächste Woche mit neuen Angeboten!", wednesday, "theirs", { name: "Shop", address: "info@shop.example" })).toEqual([]);
    expect(rulePromises("Ihr Paket kommt morgen.", wednesday, "theirs", { name: "Paket", address: "noreply@paket.example" })).toEqual([]);
    expect(rulePromises("Das Angebot bekommst du bis Montag von mir.", wednesday, "theirs", thomas)).toMatchObject([{ dueDate: "2026-10-05" }]);
  });

  it("Modell-Antwort: nur Zusagen mit Zitat aus der Mail; Frist rechnet der Code", () => {
    const mail = "Hallo Thomas, ich schicke dir die Präsentation bis Freitag. Viele Grüße";
    const answer = (zusagen: unknown[]) => JSON.stringify({ zusagen });
    expect(parsePromises(answer([{ was: "Präsentation schicken", frist: "bis Freitag", zitat: "ich schicke dir die Präsentation bis Freitag" }]), mail, wednesday)).toMatchObject([
      { text: "Präsentation schicken", dueDate: "2026-10-02" },
    ]);
    // erfundenes Zitat fällt weg; Frist, die nicht in der Mail steht, wird ignoriert (Zitat zählt)
    expect(parsePromises(answer([{ was: "Vertrag", frist: "", zitat: "Ich unterschreibe den Vertrag morgen" }]), mail, wednesday)).toEqual([]);
    expect(parsePromises(answer([{ was: "Präsentation", frist: "bis Montag", zitat: "ich schicke dir die Präsentation bis Freitag" }]), mail, wednesday)?.[0]?.dueDate).toBe("2026-10-02");
    expect(parsePromises("kaputt", mail, wednesday)).toBeNull();
    expect(followUpText({ counterpart: thomas, text: "Angebot", mailDate: "2026-09-30T08:00:00Z", quote: "Das Angebot bekommst du bis Montag." })).toContain("Hallo Thomas");
  });
});

function setup() {
  const db = openDatabase(":memory:");
  const writer = new MailWriter(db);
  const account: Account = {
    id: "acc", email: anna.address, displayName: "Anna", provider: "imap", username: anna.address,
    imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
    authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0,
  };
  writer.insertAccount(account);
  writer.upsertMailbox({ id: "acc/inbox", accountId: "acc", name: "INBOX", role: "inbox" });
  writer.upsertMailbox({ id: "acc/sent", accountId: "acc", name: "Sent", role: "sent" });
  let uid = 0;
  const add = (box: "inbox" | "sent", thread: string, from: { name: string; address: string }, to: { name: string; address: string }, subject: string, body: string, date: string) => {
    uid += 1;
    const id = `acc/${box}#1:${uid}`;
    writer.insertMessage({
      id, accountId: "acc", mailboxId: `acc/${box}`, uid, messageId: `<p${uid}@example.test>`, threadId: thread, threadSubject: subject,
      from, to: [to], cc: [], subject, date, snippet: body.slice(0, 100), bodyText: body, bodyHtml: null, flags: 0, attachments: [],
    });
    return id;
  };
  let ids = 0;
  const store = new PromiseStore(db, () => `p-${++ids}`);
  return { db, add, store };
}

describe("Zusagen: Speicher und Dienst", () => {
  it("Meine Zusagen und Ich warte auf; Erinnerung für eigene; Folge-Mail schlägt „erledigt“ vor; überfällig", async () => {
    const { add, store, db } = setup();
    add("sent", "t1", anna, thomas, "Re: Angebot", "Hallo Thomas, ich schicke dir die Präsentation bis Freitag.", "2026-09-30T08:00:00.000Z");
    add("inbox", "t2", thomas, anna, "Vertrag", "Hallo Anna, den Vertrag bekommst du bis Montag von mir.", "2026-09-28T08:00:00.000Z");
    add("inbox", "t3", { name: "Shop", address: "noreply@shop.example" }, anna, "Paket", "Wir senden Ihnen morgen Ihr Paket.", "2026-09-29T08:00:00.000Z");
    let now = new Date("2026-09-30T10:00:00Z");
    const service = new PromiseService({ store, now: () => now });
    expect(await service.scan()).toEqual({ found: 2 });
    let view = await service.list();
    expect(view.mine.map((p) => [p.counterpart.name, p.dueDate, p.dueStated])).toEqual([["Thomas Krüger", "2026-10-02", true]]);
    expect(view.theirs.map((p) => [p.counterpart.address, p.dueDate])).toEqual([["thomas@agentur.example", "2026-10-05"]]);
    expect(view.mine[0]?.reminder?.dueDate.slice(0, 10)).toMatch(/^2026-10-0[01]$/); // 1 Tag vorher, 9 Uhr Ortszeit
    expect((db.prepare("SELECT COUNT(*) AS n FROM reminder WHERE actionId LIKE 'prom:%'").get() as { n: number }).n).toBe(1);

    // Später: Folge-Mail im Verlauf → „erledigt?“; fremde Zusage überfällig
    add("sent", "t1", anna, thomas, "Re: Angebot", "Anbei die Präsentation.", "2026-10-02T09:00:00.000Z");
    now = new Date("2026-10-07T10:00:00Z");
    await service.scan();
    view = await service.list();
    expect(view.mine[0]?.followUp?.subject).toBe("Re: Angebot");
    expect(view.overdue).toEqual({ mine: 1, theirs: 1 });
    await service.setStatus(view.mine[0]!.id, "done");
    const draft = await service.followUpDraft(view.theirs[0]!.id);
    expect(draft.body).toContain("Hallo Thomas");
    // erledigte Zusage kommt beim neuen Durchsuchen nicht wieder
    await service.scan({ recheck: true });
    view = await service.list();
    expect(view.mine.map((p) => p.status)).toEqual(["done"]);
    expect(view.overdue.mine).toBe(0);
  });

  it("ohne Frist: Standardfrist; Frist ändern; Modell ersetzt Regel-Funde", async () => {
    const { add, store } = setup();
    add("sent", "t1", anna, thomas, "Re: Grillen", "Ich frag Lisa und geb dir Bescheid.", "2026-09-30T08:00:00.000Z");
    const service = new PromiseService({
      store,
      now: () => wednesday,
      extract: async (message) => ({ findings: [{ text: "Lisa fragen und Bescheid geben", quote: message.bodyText ?? "", dueDate: null }], origin: "onDevice", durationMs: 1 }),
    });
    await service.scan();
    await service.idle();
    const [promise] = (await service.list()).mine;
    expect(promise).toMatchObject({ text: "Lisa fragen und Bescheid geben", dueDate: "2026-10-03", dueStated: false, origin: "onDevice" });
    const moved = await service.setDueDate(promise!.id, "2026-10-10");
    expect(moved).toMatchObject({ dueDate: "2026-10-10", dueStated: true, origin: "user" });
    expect((await service.list()).mine).toHaveLength(1);
  });
});
