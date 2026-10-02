import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calendarFileName, createMockData, fixYear, parseActions, quoteFound, ruleActions, toICalendar, type AIRequest, type CatalogModel } from "../src/index.js";
import { AIService, ModelStore, type ManagedProvider } from "../src/llm/index.js";
import { ActionStore, AIResultStore, MailWriter, openDatabase, seedIfEmpty, SqliteMailRepository } from "../src/sqlite/index.js";

// Testdaten erfunden.

const mailDate = new Date("2026-09-30T08:00:00Z");
const mail = "Betreff: Jahresabrechnung\n\nDer Nachzahlungsbetrag von 84,20 € wird am 15.10.2026 abgebucht. Termin zur Ablesung: Dienstag, 14.10.2026, um 8:30 Uhr.";

describe("Aktionen – Antwort des Modells prüfen", () => {
  it("übernimmt belegte Aktionen und normalisiert Datum, Uhrzeit, Betrag", () => {
    const text = JSON.stringify({ items: [
      { type: "payment", title: "Nachzahlung", date: "2026-10-15", time: "", amount: "84,20 €", quote: "Der Nachzahlungsbetrag von 84,20 € wird am 15.10.2026 abgebucht." },
      { type: "appointment", title: "Ablesung", date: "2026-10-14", time: "08:30", amount: "", quote: "Termin zur Ablesung: Dienstag, 14.10.2026, um 8:30 Uhr" },
    ] });
    expect(parseActions(text, mail, mailDate)).toEqual([
      { type: "payment", title: "Nachzahlung", date: "2026-10-15", time: null, amount: "84,20 €", quote: "Der Nachzahlungsbetrag von 84,20 € wird am 15.10.2026 abgebucht." },
      { type: "appointment", title: "Ablesung", date: "2026-10-14", time: "08:30", amount: null, quote: "Termin zur Ablesung: Dienstag, 14.10.2026, um 8:30 Uhr" },
    ]);
  });

  it("verwirft Erfundenes: Zitat nicht in der Mail, Betrag nicht in der Mail, Termin ohne Datum, unmögliche Daten", () => {
    const text = JSON.stringify({ items: [
      { type: "payment", title: "Erfunden", date: "2026-10-15", time: "", amount: "99,99 €", quote: "Bitte zahlen Sie sofort 99,99 € an uns." },
      { type: "payment", title: "Falscher Betrag", date: "2026-10-15", time: "", amount: "99,99 €", quote: "Der Nachzahlungsbetrag von 84,20 € wird am 15.10.2026 abgebucht." },
      { type: "appointment", title: "Ohne Datum", date: "", time: "08:30", amount: "", quote: "Termin zur Ablesung" },
      { type: "deadline", title: "Unmöglich", date: "2026-02-30", time: "25:00", amount: "", quote: "Termin zur Ablesung: Dienstag" },
    ] });
    expect(parseActions(text, mail, mailDate)).toEqual([
      { type: "payment", title: "Falscher Betrag", date: "2026-10-15", time: null, amount: null, quote: "Der Nachzahlungsbetrag von 84,20 € wird am 15.10.2026 abgebucht." },
      // Fehlt das Datum oder ist es unmöglich, gilt das Datum aus dem Satz der Mail („Dienstag, 14.10.2026“)
      { type: "appointment", title: "Ohne Datum", date: "2026-10-14", time: "08:30", amount: null, quote: "Termin zur Ablesung" },
      { type: "deadline", title: "Unmöglich", date: "2026-10-14", time: null, amount: null, quote: "Termin zur Ablesung: Dienstag" },
    ]);
    // Termin ohne Datum – auch im Satz keins: verworfen
    expect(parseActions(JSON.stringify({ items: [{ type: "appointment", title: "X", date: "", time: "08:30", amount: "", quote: "Bitte melden Sie sich." }] }), "Bitte melden Sie sich.", mailDate)).toEqual([]);
    expect(parseActions("kein json", mail, mailDate)).toBeNull();
    expect(parseActions('{"items": []}', mail, mailDate)).toEqual([]);
  });

  it("Zitate dürfen leicht geglättet sein, aber nicht erfunden", () => {
    expect(quoteFound("Nachzahlungsbetrag von 84,20 € wird am 15.10.2026 abgebucht", mail)).toBe(true);
    expect(quoteFound("„Termin zur Ablesung“ – Dienstag 14.10.2026", mail)).toBe(true);
    expect(quoteFound("Ihr Konto wird gesperrt", mail)).toBe(false);
    expect(quoteFound("", mail)).toBe(false);
  });
});

describe("Aktionen – Regeln ohne KI", () => {
  it("erkennt Zahlung mit Datum, Termin mit Uhrzeit und Zahlung ohne Datum", () => {
    expect(ruleActions("Jahresabrechnung", "Der Nachzahlungsbetrag von 84,20 € wird am 15.10.2026 abgebucht.", mailDate)).toEqual([
      expect.objectContaining({ type: "payment", date: "2026-10-15", amount: "84,20 €" }),
    ]);
    expect(ruleActions("Elternabend", "Wir laden zum Elternabend am 21.10. um 19:30 Uhr ein.", mailDate)).toEqual([
      expect.objectContaining({ type: "appointment", date: "2026-10-21", time: "19:30" }),
    ]);
    expect(ruleActions("Rechnung", "Ihre Rechnung beträgt 39,99 €.", mailDate)).toEqual([expect.objectContaining({ type: "payment", date: null, amount: "39,99 €" })]);
  });

  it("Zeitspanne: Beginn zählt; Datum ohne Jahr: nächstes passendes", () => {
    expect(ruleActions("Besichtigung", "Unser Mitarbeiter kommt am Dienstag, 21.10., zwischen 9 und 10 Uhr zur Besichtigung.", mailDate)[0]).toMatchObject({ date: "2026-10-21", time: "09:00" });
    expect(ruleActions("Termin", "Ihr Termin ist am 5. Januar um 10 Uhr.", mailDate)[0]).toMatchObject({ date: "2027-01-05", time: "10:00" });
  });

  it("schweigt bei Werbung und reinen Infos", () => {
    expect(ruleActions("Herbstangebote", "Nur diese Woche 20 % auf alles – ab 9,99 €! Gültig bis 31.10.", mailDate)).toEqual([]);
    expect(ruleActions("Build", "Der Build #212 war erfolgreich.", mailDate)).toEqual([]);
  });
});

describe("Aktionen – Feinabstimmung", () => {
  it("Jahr: steht keins in der Mail, gilt das nächste passende – auch wenn das Modell ein anderes setzt", () => {
    expect(fixYear("2027-10-31", "Der Vertrag endet am 31. Oktober.", mailDate)).toBe("2026-10-31");
    expect(fixYear("2027-10-15", "Bitte bis 15.10. einreichen.", mailDate)).toBe("2026-10-15");
    expect(fixYear("2027-01-10", "Abgabe bis 10.01.", mailDate)).toBe("2027-01-10");
    // Jahr steht da: bleibt
    expect(fixYear("2027-10-31", "Der Vertrag endet am 31. Oktober 2027.", mailDate)).toBe("2027-10-31");
    expect(fixYear("2027-10-15", "Bitte bis 15.10.2027 einreichen.", mailDate)).toBe("2027-10-15");
    // Datum gar nicht wörtlich in der Mail („morgen“): Modell entscheidet
    expect(fixYear("2026-10-01", "Bis morgen bitte.", mailDate)).toBe("2026-10-01");
    const parsed = parseActions('{"items":[{"type":"deadline","title":"Kündigen","date":"2027-10-31","time":"","amount":"","quote":"endet am 31. Oktober"}]}', "Ihr Vertrag endet am 31. Oktober.", mailDate);
    expect(parsed?.[0]?.date).toBe("2026-10-31");
  });

  it("Gegenprobe: falsch umgerechnete Wochentage und Werbung/Öffnungszeiten aus dem Modell werden korrigiert bzw. verworfen", () => {
    const body = "Die Besichtigung ist übermorgen um 10 Uhr. Unsere Hotline ist Montag bis Freitag von 8 bis 18 Uhr erreichbar.";
    const items = [
      { type: "appointment", title: "Besichtigung", date: "2026-10-01", time: "10:00", amount: "", quote: "Die Besichtigung ist übermorgen um 10 Uhr." },
      { type: "appointment", title: "Hotline", date: "2026-10-05", time: "08:00", amount: "", quote: "Unsere Hotline ist Montag bis Freitag von 8 bis 18 Uhr erreichbar." },
    ];
    expect(parseActions(JSON.stringify({ items }), body, mailDate)?.map((a) => [a.title, a.date])).toEqual([["Besichtigung", "2026-10-02"]]);
  });

  it("Wochentage, morgen, übermorgen (Mail vom Mittwoch); Öffnungszeiten und Wiederkehrendes zählen nicht", () => {
    const one = (body: string) => ruleActions("Betreff", body, mailDate).map((a) => [a.type, a.date, a.time]);
    expect(one("Können wir uns am Dienstag um 9:30 Uhr treffen?")).toEqual([["appointment", "2026-10-06", "09:30"]]);
    expect(one("Bitte schick mir das bis Freitag.")).toEqual([["deadline", "2026-10-02", null]]);
    expect(one("Morgen kommt niemand. morgen um 14 Uhr kommt der Techniker.")).toEqual([["appointment", "2026-10-01", "14:00"]]);
    expect(one("Übermorgen ist frei. Die Besichtigung ist übermorgen um 10 Uhr.")).toEqual([["appointment", "2026-10-02", "10:00"]]);
    expect(one("Am Mittwoch um 10 Uhr?")).toEqual([["appointment", "2026-10-07", "10:00"]]); // gleicher Wochentag: nächste Woche
    expect(one("Unsere Hotline ist Montag bis Freitag von 8 bis 18 Uhr erreichbar.")).toEqual([]);
    expect(one("Der Kurs ist immer dienstags um 18 Uhr.")).toEqual([]);
    expect(one("Guten Morgen! heute morgen war es kalt.")).toEqual([]);
    expect(one("Ihr Termin ist morgen um 8:45 Uhr, Schalter 3. Bitte Ausweis mitbringen.")).toEqual([["appointment", "2026-10-01", "08:45"]]);
    // festes Datum im Satz geht vor
    expect(one("Am Dienstag, 13.10., um 9 Uhr ist der Termin.")).toEqual([["appointment", "2026-10-13", "09:00"]]);
  });
});

describe("Kalendereintrag (.ics)", () => {
  it("Termin mit Uhrzeit: Ortszeit, Dauer, Erinnerung; Text maskiert, lange Zeilen gefaltet", () => {
    const ics = toICalendar({ uid: "a1@stinkyma", title: "Zahnarzt; Dr. Sommer, Praxis", date: "2026-10-14", time: "08:30", alarmMinutesBefore: 60, description: `Zeile 1\nZeile 2 ${"x".repeat(100)}` }, new Date("2026-10-01T10:00:00Z"));
    expect(ics).toContain("DTSTART:20261014T083000\r\n");
    expect(ics).toContain("DTEND:20261014T093000\r\n");
    expect(ics).toContain("SUMMARY:Zahnarzt\\; Dr. Sommer\\, Praxis");
    expect(ics).toContain("TRIGGER:-PT60M");
    expect(ics).toContain("DTSTAMP:20261001T100000Z");
    expect(ics.split("\r\n").every((line) => line.length <= 75)).toBe(true);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("ohne Uhrzeit ganztägig; Jahreswechsel", () => {
    const ics = toICalendar({ uid: "b", title: "Frist", date: "2026-12-31", time: null });
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101");
    expect(calendarFileName("Zahnarzt: Dr. Sommer / Kontrolle", "2026-10-14")).toBe("2026-10-14 Zahnarzt Dr Sommer  Kontrolle.ics");
  });
});

describe("ActionStore und KI-Dienst", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stinkyma-actions-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const model: CatalogModel = {
    id: "klein", name: "Klein", family: "gemma", paramsB: 2, quantization: "Q4_K_M", url: "https://models.example/klein.gguf", sizeBytes: 4,
    sha256: "0".repeat(64), minRamGb: 4, capabilities: ["text"], license: "Apache-2.0", note: "",
  };

  function setup(options: { aiEnabled: boolean }) {
    const db = openDatabase(":memory:");
    seedIfEmpty(db, createMockData(new Date("2026-09-30T10:00:00Z")));
    const repository = new SqliteMailRepository(db);
    const store = new ModelStore(join(dir, "models"));
    const path = store.pathFor(model);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "gguf");
    let ids = 0;
    const actions = new ActionStore(db, () => `act-${++ids}`);
    const requests: AIRequest[] = [];
    let calendar: { ics: string; filename: string } | null = null;
    const updates: string[] = [];
    const provider: ManagedProvider = {
      id: "klein", displayName: "Klein", privacyClass: "onDevice", contextWindow: 4096,
      async generate(request) {
        requests.push(request);
        const user = request.messages.at(-1)?.content ?? "";
        const quote = user.split("\n").find((l) => /\d{1,2}\.\d{1,2}\./.test(l)) ?? "";
        const text = request.task === "extractActions"
          ? JSON.stringify({ items: quote ? [{ type: "appointment", title: "Termin", date: "2026-10-14", time: "09:00", amount: "", quote }] : [] })
          : '{"category":"work","confidence":0.5}';
        return { text, providerId: "klein", privacyClass: "onDevice", durationMs: 2 };
      },
      async unload() {},
      async dispose() {},
    };
    const service = new AIService({
      store,
      results: new AIResultStore(db),
      actions,
      message: (id) => repository.message(id),
      thread: (id) => repository.thread(id),
      ownAddresses: async () => [],
      settings: { load: () => ({ enabled: options.aiEnabled, modelId: "klein", autoCategorize: false }), save: () => undefined },
      ramGb: 8,
      catalog: [model],
      createProvider: () => provider,
      openCalendarFile: async (ics, filename) => {
        calendar = { ics, filename };
      },
      now: () => new Date("2026-10-01T10:00:00Z"),
      onActionsUpdated: (id) => updates.push(id),
    });
    let uid = 1000;
    const insertMail = (id: string, mailboxRole: string, body: string, category: string | null = null) => {
      const mailbox = (db.prepare("SELECT id FROM mailbox WHERE role = ? LIMIT 1").get(mailboxRole) as { id: string }).id;
      const accountId = (db.prepare("SELECT accountId FROM mailbox WHERE id = ?").get(mailbox) as { accountId: string }).accountId;
      new MailWriter(db).insertMessage({
        id, accountId, mailboxId: mailbox, uid: uid++, messageId: `<${id}@example.test>`, threadId: `t-${id}`, threadSubject: "Test",
        from: { name: "Praxis", address: "praxis@example.test" }, to: [], cc: [], subject: "Terminbestätigung", date: "2026-09-30T08:00:00.000Z",
        snippet: body.slice(0, 40), bodyText: body, bodyHtml: null, flags: 0, attachments: [], category: category as never,
      });
    };
    return { db, service, actions, requests, insertMail, updates, calendar: () => calendar };
  }

  it("mit Modell: sofort Regeln, dann im Hintergrund verfeinert und gemeldet; danach aus der Datenbank", async () => {
    const { service, requests, insertMail, updates } = setup({ aiEnabled: true });
    insertMail("m1", "inbox", "Ihr Termin ist am 14.10.2026 um 9:00 Uhr.");
    const first = await service.messageActions("m1");
    expect(first.origin).toBe("rules");
    expect(first.actions).toEqual([expect.objectContaining({ date: "2026-10-14", time: "09:00" })]);
    await service.settled();
    expect(updates).toEqual(["m1"]);
    const refined = await service.messageActions("m1");
    expect(refined).toMatchObject({ origin: "onDevice", actions: [expect.objectContaining({ type: "appointment", date: "2026-10-14", time: "09:00", status: "open" })] });
    await service.messageActions("m1");
    await service.settled();
    expect(requests.filter((r) => r.task === "extractActions")).toHaveLength(1);
  });

  it("ohne Modell: Regeln; gesendete Mails und Newsletter werden nicht untersucht", async () => {
    const { service, requests, insertMail } = setup({ aiEnabled: false });
    insertMail("m1", "inbox", "Ihr Termin ist am 14.10.2026 um 9:00 Uhr.");
    insertMail("m2", "sent", "Wir sehen uns am 14.10.2026 um 9:00 Uhr.");
    insertMail("m3", "inbox", "Nur bis 31.10.2026: 20 % Rabatt um 9:00 Uhr!", "newsletter");
    expect(await service.messageActions("m1")).toMatchObject({ origin: "rules", actions: [expect.objectContaining({ date: "2026-10-14", time: "09:00" })] });
    expect(await service.messageActions("m2")).toEqual({ messageId: "m2", actions: [], origin: null });
    expect(await service.messageActions("m3")).toEqual({ messageId: "m3", actions: [], origin: null });
    expect(requests).toHaveLength(0);
  });

  it("Erledigt/ausgeblendet bleibt beim erneuten Erkennen; Erinnerung genau einmal fällig; Kalender", async () => {
    const { service, actions, insertMail, calendar } = setup({ aiEnabled: false });
    insertMail("m1", "inbox", "Ihr Termin ist am 14.10.2026 um 9:00 Uhr.");
    const [action] = (await service.messageActions("m1")).actions;
    if (!action) throw new Error("keine Aktion");
    await service.remind(action.id, "2026-10-13T07:00:00.000Z");
    expect((await service.messageActions("m1")).actions[0]?.reminder).toMatchObject({ dueDate: "2026-10-13T07:00:00.000Z" });
    expect(actions.takeDueReminders("2026-10-13T06:59:00.000Z")).toEqual([]);
    expect(actions.takeDueReminders("2026-10-13T07:00:30.000Z").map((r) => r.text)).toEqual(["Terminbestätigung"]);
    expect(actions.takeDueReminders("2026-10-13T08:00:00.000Z")).toEqual([]);

    await service.addToCalendar(action.id);
    expect(calendar()?.filename).toBe("2026-10-14 Terminbestätigung.ics");
    expect(calendar()?.ics).toContain("DTSTART:20261014T090000");

    await service.setActionStatus(action.id, "dismissed");
    expect((await service.messageActions("m1")).actions).toEqual([]);
    // erneut untersuchen (z. B. neue Prompt-Version): ausgeblendete Aktion kommt nicht zurück
    actions.saveScan("m1", [{ type: "appointment", title: "Termin", date: "2026-10-14", time: "09:00", amount: null, quote: "x" }], { origin: "rules", promptVersion: 1, at: "x" });
    expect(actions.actions("m1").filter((a) => a.status === "open")).toEqual([]);
  });

  it("Archivieren (neue ID): Aktionen, Erinnerung, Anhang-Text und Leseergebnis ziehen mit", async () => {
    const { db, service, actions, insertMail } = setup({ aiEnabled: false });
    insertMail("m1", "inbox", "Ihr Termin ist am 14.10.2026 um 9:00 Uhr.");
    const [action] = (await service.messageActions("m1")).actions;
    await service.remind(action?.id ?? "", "2026-10-13T07:00:00.000Z");
    db.prepare("INSERT INTO attachment (id, messageId, filename, mimeType, size) VALUES ('m1/a0', 'm1', 'Scan.pdf', 'application/pdf', 1)").run();
    db.prepare("INSERT INTO attachmentText (attachmentId, text, source) VALUES ('m1/a0', 'Vertragsnummer 4711', 'vision')").run();
    db.prepare("INSERT INTO attachmentAnalysis (attachmentId, summary, extractedJSON, modelId, privacyClass, analyzedAt) VALUES ('m1/a0', 'Brief', '{}', 'x', 'onDevice', 'x')").run();
    const archive = (db.prepare("SELECT id FROM mailbox WHERE role = 'archive' LIMIT 1").get() as { id: string }).id;
    new MailWriter(db).relocateMessage("m1", { newId: "m1-neu", mailboxId: archive, uid: 7 });
    expect(actions.actions("m1-neu")).toHaveLength(1);
    expect(actions.scan("m1-neu")).not.toBeNull();
    expect(actions.remindersForMessage("m1-neu")).toHaveLength(1);
    expect(db.prepare("SELECT text FROM attachmentText WHERE attachmentId = 'm1-neu/a0'").get()).toEqual({ text: "Vertragsnummer 4711" });
    expect(db.prepare("SELECT summary FROM attachmentAnalysis WHERE attachmentId = 'm1-neu/a0'").get()).toEqual({ summary: "Brief" });
  });
});
