import { describe, expect, it } from "vitest";
import { amountToCents, lastCancelDay, monthlyCents, parseNotice, parseSubscription, ruleSubscription, type Account, type SubscriptionFinding } from "../src/index.js";
import { SubscriptionService } from "../src/llm/index.js";
import { MailWriter, openDatabase, SubscriptionStore } from "../src/sqlite/index.js";

// Testdaten erfunden.
const mailDate = new Date("2026-09-30T08:00:00Z");
const base: SubscriptionFinding = {
  kind: "subscription", provider: "X", amount: null, interval: null, startDate: null, minTermMonths: null, trialEnd: null, termEnd: null,
  renewalDate: null, cancelBy: null, notice: null, cancelled: false, quote: "",
};

describe("Abos: rechnen", () => {
  it("letzter Kündigungstag aus Probezeit, Laufzeit, Verlängerung, Frist", () => {
    expect(lastCancelDay({ ...base, trialEnd: "2026-10-14" })).toBe("2026-10-14");
    expect(lastCancelDay({ ...base, startDate: "2026-10-01", minTermMonths: 24, notice: { amount: 1, unit: "month" } })).toBe("2028-08-30");
    expect(lastCancelDay({ ...base, termEnd: "2026-12-31", notice: { amount: 6, unit: "week" } })).toBe("2026-11-19");
    expect(lastCancelDay({ ...base, renewalDate: "2026-10-20" })).toBe("2026-10-19");
    expect(lastCancelDay({ ...base, renewalDate: "2027-03-01", notice: { amount: 3, unit: "month" } })).toBe("2026-12-01");
    expect(lastCancelDay({ ...base, termEnd: "2027-03-31", notice: { amount: 1, unit: "month" } })).toBe("2027-02-28"); // Monatsende
    expect(lastCancelDay({ ...base, cancelBy: "2026-11-30", termEnd: "2026-12-31" })).toBe("2026-11-30");
    expect(lastCancelDay({ ...base, cancelled: true, termEnd: "2026-12-31" })).toBeNull();
    expect(lastCancelDay(base)).toBeNull();
  });

  it("Frist, Betrag, Kosten pro Monat", () => {
    expect(parseNotice("einen Monat zum Ende")).toEqual({ amount: 1, unit: "month" });
    expect(parseNotice("6 Wochen")).toEqual({ amount: 6, unit: "week" });
    expect(parseNotice("14 Tage")).toEqual({ amount: 14, unit: "day" });
    expect(parseNotice("jederzeit")).toBeNull();
    expect(amountToCents("12,99 €")).toBe(1299);
    expect(amountToCents("€8.99")).toBe(899);
    expect(amountToCents("1.200,00 €")).toBe(120000);
    expect(amountToCents("48 €")).toBe(4800);
    expect(monthlyCents({ amountCents: 11988, interval: "yearly" })).toBe(999);
    expect(monthlyCents({ amountCents: 1299, interval: null })).toBeNull();
  });
});

describe("Abos: erkennen", () => {
  const from = { name: "Streamflix", address: "no-reply@streamflix.example" };
  it("Regeln: Probe-Abo mit Betrag und Ende; Werbung und Phishing nicht", () => {
    const trial = ruleSubscription("Probemonat", "Dein kostenloser Probemonat läuft bis 14.10.2026. Danach kostet dein Abo 12,99 € pro Monat.", from, mailDate);
    expect(trial).toMatchObject({ kind: "trial", amount: "12,99 €", interval: "monthly", trialEnd: "2026-10-14" });
    expect(ruleSubscription("Angebot", "Jetzt abonnieren: 3 Monate gratis, danach 12,99 € im Monat.", from, mailDate)).toBeNull();
    expect(ruleSubscription("Abo pausiert", "Aktualisieren Sie innerhalb von 24 Stunden Ihre Zahlungsdaten.", from, mailDate)).toBeNull();
    expect(ruleSubscription("Hallo", "Wie geht es dir?", from, mailDate)).toBeNull();
  });

  it("Modell-Antwort: nur belegte Angaben; „kein Abo“ wird respektiert", () => {
    const mail = "Dein Abo verlängert sich am 20.10.2026 für 59,99 € pro Jahr.";
    const json = (patch: Record<string, unknown>) =>
      JSON.stringify({ isSubscription: true, kind: "subscription", provider: "Wolke", amount: "59,99 €", interval: "yearly", startDate: "", minTermMonths: 0, trialEnd: "", termEnd: "", renewalDate: "2026-10-20", cancelBy: "", notice: "", cancelled: false, quote: "verlängert sich", ...patch });
    expect(parseSubscription(json({}), mail, mailDate, from)).toMatchObject({ amount: "59,99 €", renewalDate: "2026-10-20" });
    // erfundener Betrag und erfundenes Datum fallen weg
    expect(parseSubscription(json({ amount: "99,99 €", renewalDate: "2026-11-01" }), mail, mailDate, from)).toMatchObject({ amount: null, renewalDate: null, interval: "yearly" });
    expect(parseSubscription(json({ isSubscription: false }), mail, mailDate, from)).toBe("none");
    expect(parseSubscription("kaputt", mail, mailDate, from)).toBeNull();
  });
});

function setup() {
  const db = openDatabase(":memory:");
  const writer = new MailWriter(db);
  const account: Account = {
    id: "acc", email: "anna@example.test", displayName: "Anna", provider: "imap", username: "anna@example.test",
    imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
    authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0,
  };
  writer.insertAccount(account);
  writer.upsertMailbox({ id: "acc/inbox", accountId: "acc", name: "INBOX", role: "inbox" });
  let uid = 0;
  const add = (from: { name: string; address: string }, subject: string, body: string, date: string) => {
    uid += 1;
    const id = `acc/inbox#1:${uid}`;
    writer.insertMessage({
      id, accountId: "acc", mailboxId: "acc/inbox", uid, messageId: `<s${uid}@example.test>`, threadId: `t${uid}`, threadSubject: subject,
      from, to: [], cc: [], subject, date, snippet: body.slice(0, 100), bodyText: body, bodyHtml: null, flags: 0, attachments: [],
    });
    return id;
  };
  let ids = 0;
  const store = new SubscriptionStore(db, () => `id-${++ids}`);
  return { db, add, store };
}

describe("Abos: Speicher und Suchlauf", () => {
  const streamflix = { name: "Streamflix", address: "no-reply@streamflix.example" };

  it("ein Eintrag je Anbieter; neuere Mail aktualisiert, ältere füllt nur Lücken; Kündigung setzt den Status", async () => {
    const { add, store } = setup();
    add(streamflix, "Dein Probemonat", "Dein kostenloser Probemonat läuft bis 14.10.2026. Danach kostet dein Abo 12,99 € pro Monat.", "2026-09-30T08:00:00.000Z");
    add({ name: "Lena", address: "lena@mailbox.example" }, "Kino?", "Hast du Lust auf Kino?", "2026-09-30T09:00:00.000Z");
    const service = new SubscriptionService({ store, now: () => new Date("2026-09-30T10:00:00Z") });
    expect(await service.scan()).toEqual({ found: 1 });
    let view = await service.list();
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({ kind: "trial", provider: "Streamflix", lastCancelDay: "2026-10-14", origin: "rules" });
    expect(view.monthlyCents).toBe(0); // Probe-Abo zählt noch nicht

    // Später: Preisänderung (neueres Abo) – Probezeit vorbei, zählt zu den Kosten
    add(streamflix, "Dein Abo wurde geändert", "Ab dem nächsten Abrechnungszeitraum zahlst du für dein Abo 4,99 € pro Monat.", "2026-11-02T08:00:00.000Z");
    await service.scan();
    view = await service.list();
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({ kind: "subscription", amount: "4,99 €", trialEnd: null });
    expect(view.monthlyCents).toBe(499);
    expect(view.yearlyCents).toBe(5988);

    // Kündigungsbestätigung
    add(streamflix, "Kündigung", "Wir bestätigen die Kündigung deines Abos. Es endet am 30.11.2026.", "2026-11-10T08:00:00.000Z");
    await service.scan();
    view = await service.list();
    expect(view.items[0]?.status).toBe("cancelled");
    expect(view.monthlyCents).toBe(0);
    // Schon geprüfte Mails werden nicht noch einmal durchsucht
    expect(await service.scan()).toEqual({ found: 0 });
  });

  it("von Hand korrigiert: neue Mails überschreiben die Angaben nicht; Erinnerung vor dem Kündigungstag", async () => {
    const { add, store, db } = setup();
    add(streamflix, "Dein Probemonat", "Dein kostenloser Probemonat läuft bis 14.10.2026. Danach kostet dein Abo 12,99 € pro Monat.", "2026-09-30T08:00:00.000Z");
    const service = new SubscriptionService({ store, now: () => new Date("2026-10-01T10:00:00Z") });
    await service.scan();
    const id = (await service.list()).items[0]!.id;
    await service.update(id, { amount: "9,99 €", lastCancelDay: "2026-10-12" });
    add(streamflix, "Preis", "Dein Abo kostet ab sofort 14,99 € pro Monat.", "2026-10-20T08:00:00.000Z");
    await service.scan();
    const sub = (await service.list()).items[0]!;
    expect(sub).toMatchObject({ amount: "9,99 €", amountCents: 999, lastCancelDay: "2026-10-12", origin: "user", userEdited: true });

    const reminded = await service.remind(id, 3);
    expect(reminded.reminder?.dueDate.slice(0, 10)).toMatch(/^2026-10-0[89]$/); // 9 Uhr Ortszeit, 3 Tage vorher
    expect((db.prepare("SELECT COUNT(*) AS n FROM reminder WHERE actionId = ? AND status = 'pending'").get(`sub:${id}`) as { n: number }).n).toBe(1);
    // Kündigungstag fast erreicht: Erinnerung nie in der Vergangenheit
    const late = new SubscriptionService({ store, now: () => new Date("2026-10-11T12:00:00Z") });
    expect(new Date((await late.remind(id, 3)).reminder!.dueDate).getTime()).toBeGreaterThan(new Date("2026-10-11T12:00:00Z").getTime());
    await service.setStatus(id, "cancelled");
    expect((await service.list()).items[0]?.reminder).toBeNull(); // Erinnerung fällt mit weg
  });

  it("Modell im Hintergrund: ergänzt Funde und entfernt, was laut Modell kein Abo ist", async () => {
    const { add, store } = setup();
    add({ name: "Lena", address: "lena@mailbox.example" }, "Abo", "Kannst du mir die 9,99 € für das geteilte Abo vom letzten Monat überweisen?", "2026-09-30T08:00:00.000Z");
    add({ name: "Readly Plus", address: "hello@readlyplus.example" }, "Thanks for subscribing", "You will be billed €8.99 monthly.", "2026-09-30T09:00:00.000Z");
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const service = new SubscriptionService({
      store,
      extract: async (message) => {
        await gate; // erst nach der Prüfung des Zwischenstands antworten
        calls++;
        if (message.from.address.startsWith("lena")) return { finding: null, origin: "onDevice", providerId: "fake", durationMs: 1 };
        return { finding: { ...base, provider: "Readly Plus", amount: "€8.99", interval: "monthly", quote: "billed €8.99 monthly" }, origin: "onDevice", providerId: "fake", durationMs: 1 };
      },
    });
    await service.scan();
    expect((await service.list()).items.map((s) => s.provider)).toEqual(["Lena"]); // Regeln irren hier
    expect((await service.list()).scanning).toEqual({ done: 0, total: 2 });
    release();
    await service.idle();
    const items = (await service.list()).items;
    expect(items.map((s) => [s.provider, s.origin])).toEqual([["Readly Plus", "onDevice"]]);
    expect(calls).toBe(2);
    await service.scan(); // nichts Neues fürs Modell
    await service.idle();
    expect(calls).toBe(2);
  });
});
