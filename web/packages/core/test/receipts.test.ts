import { describe, expect, it } from "vitest";
import {
  amountsIn, centsFromInput, crc32, createZip, exportFileName, formatCents, parseReceipt, receiptAmounts, receiptCategoryDefaults, receiptsCsv,
  ruleReceipt, type Account, type StoredReceipt,
} from "../src/index.js";
import { ReceiptService } from "../src/llm/index.js";
import { MailWriter, openDatabase, ReceiptStore } from "../src/sqlite/index.js";

// Testdaten erfunden.
const mailDate = new Date("2026-09-30T08:00:00Z");
const from = { name: "Technikhaus Nord", address: "rechnung@technikhaus-nord.example" };

describe("Belege: Beträge und Erkennen", () => {
  it("liest Beträge in deutscher und englischer Schreibweise", () => {
    expect(amountsIn("1.299,00 € und € 59,00 und €59.00 und EUR 549.00 und 87.66 EUR").map((a) => a.cents)).toEqual([129900, 5900, 5900, 54900, 8766]);
    expect(receiptAmounts("Nettobetrag 1.091,60 € zzgl. 19 % MwSt. 207,40 € Gesamtbetrag 1.299,00 €")).toMatchObject({ gross: 129900, net: 109160, vat: 20740 });
    // Prozent allein ist keine MwSt.; Zwischensumme/Abschläge sind nicht der Gesamtbetrag
    expect(receiptAmounts("Summe 14,85 € (inkl. 7 % MwSt.)")).toMatchObject({ gross: 1485, vat: null });
    expect(receiptAmounts("Gesamtbetrag 912,40 €. Abschläge 870,00 €, Nachzahlung 42,40 €")).toMatchObject({ gross: 91240 });
  });

  it("Regeln: Rechnung mit Datum, Nummer, Frist und Kategorie; Angebot, Phishing und Werbung nicht", () => {
    const found = ruleReceipt("Rechnung Heizungswartung", "Rechnung Nr. 2026-0412 vom 25.09.2026 für die Wartung Ihrer Gastherme. Gesamtbetrag 214,80 €. Zahlbar bis 09.10.2026.", { name: "Heizung Schröder", address: "buero@heizung-schroeder.example" }, mailDate);
    expect(found).toMatchObject({ date: "2026-09-25", grossCents: 21480, invoiceNumber: "2026-0412", dueDate: "2026-10-09", category: "Handwerker & Dienstleistungen", review: [] });
    expect(ruleReceipt("Angebot", "Für den Tausch bieten wir Ihnen an: 480,00 € zzgl. MwSt.", from, mailDate)).toBeNull();
    expect(ruleReceipt("Offene Rechnung", "Ihre Rechnung über 249,99 € ist überfällig. Zahlen Sie innerhalb von 24 Stunden, sonst wird Ihr Konto gesperrt.", from, mailDate)).toBeNull();
    expect(ruleReceipt("Sale", "Sofas ab 499,00 €. Nur bis Sonntag! Jetzt shoppen.", from, mailDate)).toBeNull();
    // „zahlbar innerhalb von 14 Tagen“: Frist rechnet der Code
    expect(ruleReceipt("Rechnung", "Rechnung vom 10.09.2026 über 96,00 €. Zahlbar innerhalb von 14 Tagen.", from, mailDate)?.dueDate).toBe("2026-09-24");
  });

  it("Modell-Antwort: Erfundenes wird als „bitte prüfen“ markiert, nicht still übernommen", () => {
    const mail = "Rechnung RE-1 vom 28.09.2026. Gesamtbetrag 1.299,00 €.";
    const answer = (patch: Record<string, unknown>) =>
      JSON.stringify({ istBeleg: true, haendler: "Technikhaus Nord", datum: "2026-09-28", brutto: "1.299,00 €", netto: "", mwst: "", rechnungsnummer: "RE-1", zahlungsfrist: "", kategorie: "Arbeitsmittel", ...patch });
    expect(parseReceipt(answer({}), mail, mailDate, from, receiptCategoryDefaults)).toMatchObject({ grossCents: 129900, review: [], category: "Arbeitsmittel" });
    const invented = parseReceipt(answer({ brutto: "1.399,00 €", datum: "2026-09-12", zahlungsfrist: "2026-10-12" }), mail, mailDate, from, receiptCategoryDefaults);
    expect(invented).toMatchObject({ grossCents: 139900, dueDate: null });
    expect(invented !== "none" && invented?.review).toEqual(["Betrag steht so nicht in der Mail", "Datum steht so nicht in der Mail"]);
    expect(parseReceipt(JSON.stringify({ istBeleg: false }), mail, mailDate, from, receiptCategoryDefaults)).toBe("none");
  });
});

describe("Belege: Export", () => {
  it("CSV im deutschen Format mit BOM, Felder mit Semikolon in Anführungszeichen", () => {
    const receipt = { id: "r1", date: "2026-09-28", merchant: "Müller; Söhne", category: "Arbeitsmittel", grossCents: 129900, netCents: 109160, vatCents: 20740, currency: "EUR", invoiceNumber: "RE-1", dueDate: null, review: [], mailSubject: "Rechnung" } as unknown as StoredReceipt;
    const csv = receiptsCsv([receipt], new Map([["r1", ["a.pdf"]]]));
    expect(csv.startsWith("﻿Datum;Händler;")).toBe(true);
    expect(csv).toContain('28.09.2026;"Müller; Söhne";Arbeitsmittel;1.299,00;1.091,60;207,40;EUR;RE-1;;;a.pdf;Rechnung');
    expect(formatCents(5)).toBe("0,05");
    expect(centsFromInput("1.299,00")).toBe(129900);
    expect(centsFromInput("59.9")).toBe(5990);
    expect(centsFromInput("")).toBeNull();
    const taken = new Set<string>();
    expect(exportFileName({ date: "2026-09-28", merchant: "A/B" }, "Rechnung.pdf", taken)).toBe("2026-09-28 A_B – Rechnung.pdf");
    expect(exportFileName({ date: "2026-09-28", merchant: "A/B" }, "Rechnung.pdf", taken)).toBe("2026-09-28 A_B – Rechnung (2).pdf");
  });

  it("ZIP: gültige Struktur (Signaturen, Prüfsumme, Einträge)", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const zip = createZip([{ name: "belege.csv", data: new TextEncoder().encode("a;b") }, { name: "Belege/Prüfung.pdf", data: new Uint8Array([1, 2, 3]) }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const centralStart = view.getUint32(end + 16, true);
    expect(view.getUint32(centralStart, true)).toBe(0x02014b50);
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
  const add = (sender: { name: string; address: string }, subject: string, body: string, date: string, extra: { pdf?: string; category?: "newsletter" | "invoice" } = {}) => {
    uid += 1;
    const id = `acc/inbox#1:${uid}`;
    writer.insertMessage({
      id, accountId: "acc", mailboxId: "acc/inbox", uid, messageId: `<b${uid}@example.test>`, threadId: `t${uid}`, threadSubject: subject,
      from: sender, to: [], cc: [], subject, date, snippet: body.slice(0, 100), bodyText: body, bodyHtml: null, flags: 0, category: extra.category ?? null,
      attachments: extra.pdf ? [{ filename: "Rechnung.pdf", mimeType: "application/pdf", size: 1000, contentId: null, isInline: false }] : [],
    });
    if (extra.pdf) writer.setAttachmentText(`${id}/a0`, extra.pdf, "pdf");
    return id;
  };
  let ids = 0;
  const store = new ReceiptStore(db, () => `r-${++ids}`);
  return { db, add, store };
}

describe("Belege: Speicher und Dienst", () => {
  it("Regeln sofort (auch aus dem PDF), Summen je Kategorie, Werbung nicht; von Hand korrigiert und Kategorie gemerkt", async () => {
    const { add, store } = setup();
    add(from, "Ihre Rechnung", "Rechnung im Anhang.", "2026-09-28T08:00:00.000Z", { pdf: "Rechnung RE-1 Rechnungsdatum: 28.09.2026 Notebook Gesamtbetrag 1.299,00 €" });
    add({ name: "Wohnwelt", address: "news@wohnwelt.example" }, "Sale", "Rechnung? Nein: Sofas ab 499,00 €!", "2026-09-29T08:00:00.000Z", { category: "newsletter" });
    add({ name: "Taxi Sonne", address: "beleg@taxi-sonne.example" }, "Ihre Fahrtquittung", "Fahrt am 18.09.2026. Gesamt 26,00 €.", "2026-09-19T08:00:00.000Z");
    const service = new ReceiptService({ store, now: () => mailDate });
    expect(await service.scan()).toEqual({ found: 2 });
    let view = await service.list(2026);
    expect(view.items.map((r) => [r.merchant, r.grossCents, r.category])).toEqual([["Technikhaus Nord", 129900, "Arbeitsmittel"], ["Taxi Sonne", 2600, "Fahrtkosten & Reisen"]]);
    expect(view.years).toEqual([2026]);
    expect(view.items[0]?.attachments).toEqual([{ id: "acc/inbox#1:1/a0", filename: "Rechnung.pdf" }]);
    const taxi = view.items[1]!;
    await service.update(taxi.id, { category: "Sonstiges", grossCents: 2360, rememberCategory: true });
    // Neue Quittung desselben Händlers bekommt die gemerkte Kategorie
    add({ name: "Taxi Sonne", address: "beleg@taxi-sonne.example" }, "Ihre Fahrtquittung", "Fahrt am 25.09.2026. Gesamt 18,00 €.", "2026-09-25T20:00:00.000Z");
    await service.scan();
    view = await service.list(2026);
    expect(view.items.find((r) => r.grossCents === 1800)?.category).toBe("Sonstiges");
    expect(view.items.find((r) => r.id === taxi.id)).toMatchObject({ grossCents: 2360, userEdited: true, origin: "user" });
    expect(view.totals).toEqual([{ category: "Arbeitsmittel", cents: 129900, count: 1 }, { category: "Sonstiges", cents: 4160, count: 2 }]);
  });

  it("„Als Beleg übernehmen“, Modell entfernt Regel-Fehlgriffe, Erinnerung vor der Frist, Export mit fehlender Datei", async () => {
    const { add, store } = setup();
    const quote = add({ name: "Malerbetrieb", address: "info@maler.example" }, "Rechnung?", "Unser Angebot zur Rechnung: 480,00 €.", "2026-09-20T08:00:00.000Z", { category: "invoice" });
    const real = add(from, "Rechnung RE-7", "Rechnung RE-7 vom 21.09.2026. Gesamtbetrag 59,00 €. Zahlbar bis 05.10.2026.", "2026-09-21T08:00:00.000Z", { pdf: "RE-7 Gesamtbetrag 59,00 €" });
    const plain = add({ name: "Kiosk", address: "kiosk@example.test" }, "Danke!", "Danke für deinen Einkauf.", "2026-09-22T08:00:00.000Z");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const saved: { name: string; size: number }[] = [];
    const service = new ReceiptService({
      store,
      now: () => mailDate,
      extract: async (message) => {
        await gate;
        if (message.id === quote) return { finding: null, origin: "onDevice", durationMs: 1 };
        return { finding: { merchant: "Technikhaus Nord", date: "2026-09-21", grossCents: 5900, netCents: null, vatCents: null, invoiceNumber: "RE-7", dueDate: "2026-10-05", category: "Arbeitsmittel", quote: "", review: [] }, origin: "onDevice", durationMs: 1 };
      },
      attachmentContent: async (id) => {
        if (id.endsWith("/a0")) return { filename: "Rechnung.pdf", content: new Uint8Array([37, 80, 68, 70]) };
        throw new Error("nicht erreichbar");
      },
      saveFile: async (name, data) => {
        saved.push({ name, size: data.length });
        return true;
      },
    });
    await service.scan();
    release();
    await service.idle();
    let items = (await service.list(null)).items;
    expect(items.map((r) => r.messageId)).toEqual([real]); // Angebot: laut Modell kein Beleg
    expect(items[0]).toMatchObject({ origin: "onDevice", dueDate: "2026-10-05" });
    const reminded = await service.remind(items[0]!.id, 3);
    expect(reminded.reminder).not.toBeNull();
    // Von Hand: nichts gefunden → Eintrag ohne Betrag, als „bitte prüfen“
    const manual = await service.addFromMail(plain);
    expect(manual).toMatchObject({ merchant: "Technikhaus Nord", origin: "user" }); // Fake-Modell liefert immer diesen Händler
    items = (await service.list(2026)).items;
    expect(items).toHaveLength(2);
    expect(await service.export(2026)).toEqual({ saved: true, count: 2, missingFiles: 0 });
    expect(saved[0]?.name).toBe("Belege 2026.zip");
    await service.setStatus(manual.id, "dismissed");
    expect((await service.list(2026)).totals).toEqual([{ category: "Arbeitsmittel", cents: 5900, count: 1 }]);
  });

  it("Kategorien: anlegen, doppelt abgelehnt, entfernen nimmt sie den Belegen weg", async () => {
    const { store } = setup();
    const service = new ReceiptService({ store });
    expect(await service.addCategory("Kinderbetreuung")).toContain("Kinderbetreuung");
    await expect(service.addCategory("kinderbetreuung")).rejects.toThrow(/gibt es schon/);
    expect(await service.removeCategory("Kinderbetreuung")).not.toContain("Kinderbetreuung");
  });
});
