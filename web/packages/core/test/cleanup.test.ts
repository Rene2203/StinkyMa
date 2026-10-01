import { describe, expect, it } from "vitest";
import { groupKey, groupRuleFrom, MessageFlag, protectReason, registeredDomain, ruleMatches, type Account, type MailboxRole, type MessageCategory, type ProtectInput } from "../src/index.js";
import { CleanupService } from "../src/mail/index.js";
import { CleanupStore, MailWriter, openDatabase } from "../src/sqlite/index.js";

const base: ProtectInput = { subject: "", body: "", category: null, flagged: false, answered: false, hasAttachments: false, hasOpenAction: false };
const reason = (patch: Partial<ProtectInput>) => protectReason({ ...base, ...patch });

describe("Aufräumen: Schutz", () => {
  it("schützt Rechnungen, Bestellungen, Tickets, Zugangsdaten und Sicherheitscodes am Betreff", () => {
    expect(reason({ subject: "Ihre Rechnung Nr. 2026-0815" })).toBe("invoice");
    expect(reason({ subject: "Zahlungsbestätigung für Ihren Einkauf" })).toBe("invoice");
    expect(reason({ subject: "Deine Bestellung ist unterwegs" })).toBe("order");
    expect(reason({ subject: "[#48213] Ihre Anfrage beim Kundenservice" })).toBe("ticket");
    expect(reason({ subject: "Willkommen bei Beispielshop – Konto erstellt" })).toBe("account");
    expect(reason({ subject: "Passwort zurücksetzen" })).toBe("account");
    expect(reason({ subject: "Dein Bestätigungscode: 482913" })).toBe("security");
    expect(reason({ subject: "Neue Anmeldung bei deinem Konto" })).toBe("security");
    expect(reason({ subject: "Kündigung Ihres Vertrags" })).toBe("contract");
    expect(reason({ subject: "Lohnabrechnung September" })).toBe("document");
  });

  it("schützt am Text nur bei eindeutigen Formulierungen – Newsletter-Fußzeilen zählen nicht", () => {
    expect(reason({ subject: "Ihr Einkauf", body: "Rechnungsnummer: 4711\nBetrag 19,99 €" })).toBe("invoice");
    expect(reason({ subject: "Hallo", body: "Ihr neues Passwort lautet: ..." })).toBe("account");
    expect(reason({ subject: "Herbst-Sale: 30 % auf alles", body: "Jetzt shoppen! Passwort vergessen? Support · Kundennummer · Abmelden" })).toBeNull();
    expect(reason({ subject: "Wochenangebote", body: "Ticket für das Konzert gewinnen!" })).toBeNull();
  });

  it("eigene Spuren und KI-Einordnung", () => {
    expect(reason({ subject: "Sale", flagged: true })).toBe("flagged");
    expect(reason({ subject: "Sale", answered: true })).toBe("answered");
    expect(reason({ subject: "Sale", hasOpenAction: true })).toBe("openAction");
    expect(reason({ subject: "Sale", category: "invoice" })).toBe("invoice");
    expect(reason({ subject: "Sale", category: "personal" })).toBe("personal");
    expect(reason({ subject: "Sale", category: "newsletter" })).toBeNull();
    expect(reason({ subject: "Sale", category: "newsletter", hasAttachments: true })).toBeNull();
    expect(reason({ subject: "Unterlagen", hasAttachments: true })).toBe("attachment");
    // Verdacht der KI: „Passwort“ im Betreff ist dort meist Phishing – kein Schutz durch den Inhalt
    expect(reason({ subject: "Ihr Passwort läuft ab – jetzt bestätigen", category: "spam_suspect" })).toBeNull();
    expect(reason({ subject: "Ihr Passwort läuft ab", category: "spam_suspect", flagged: true })).toBe("flagged");
  });

  it("Domains werden auf die registrierte Domain zusammengefasst; Regel trifft genau die Gruppe", () => {
    expect(registeredDomain("news@mail.shop.example")).toBe("shop.example");
    expect(registeredDomain("info@shop.co.uk")).toBe("shop.co.uk");
    expect(registeredDomain("a@b.mail.shop.co.uk")).toBe("shop.co.uk");
    expect(groupKey("Info@Shop.Example", "address")).toBe("info@shop.example");
    const rule = { from: groupRuleFrom("shop.example", "domain"), subject: [], category: null, hasAttachment: false, move: "trash" as const, folder: null, markRead: false, flag: false };
    const mail = (address: string) => ({ from: { address }, subject: "x", hasAttachments: false, category: null });
    expect(ruleMatches(rule, mail("news@shop.example"))).toBe(true);
    expect(ruleMatches(rule, mail("news@mail.shop.example"))).toBe(true);
    expect(ruleMatches(rule, mail("news@myshop.example"))).toBe(false);
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
  const roles: MailboxRole[] = ["inbox", "archive", "trash", "spam", "sent"];
  for (const role of roles) writer.upsertMailbox({ id: `acc/${role}`, accountId: "acc", name: role, role });
  let uid = 0;
  const add = (from: string, subject: string, opts: { role?: MailboxRole; flags?: number; category?: MessageCategory; messageId?: string; body?: string; date?: string } = {}) => {
    uid += 1;
    const id = `acc/${opts.role ?? "inbox"}#1:${uid}`;
    writer.insertMessage({
      id, accountId: "acc", mailboxId: `acc/${opts.role ?? "inbox"}`, uid, messageId: opts.messageId ?? `<m${uid}@example.test>`, threadId: `t${uid}`, threadSubject: subject,
      from: { name: from.split("@")[0] ?? null, address: from }, to: [{ address: "anna@example.test" }], cc: [], subject,
      date: opts.date ?? `2026-09-${String(10 + (uid % 15)).padStart(2, "0")}T10:00:00.000Z`, snippet: opts.body ?? subject, bodyText: opts.body ?? subject, bodyHtml: null,
      flags: opts.flags ?? 0, category: opts.category ?? null, attachments: [],
    });
    return id;
  };
  return { db, add, store: new CleanupStore(db) };
}

describe("Aufräumen: Gruppen und Mails (SQLite)", () => {
  it("zählt je Absender bzw. Domain – ohne Papierkorb, Spam, Gesendet und Gmail-Doppel im Archiv", () => {
    const { add, store } = setup();
    for (let i = 0; i < 5; i++) add("deals@shop.example", `Angebot ${i}`, { flags: i < 2 ? MessageFlag.seen : 0 });
    add("deals@shop.example", "Ihre Rechnung 2026-17");
    add("news@mail.shop.example", "Newsletter");
    add("news@mail.shop.example", "Newsletter 2", { role: "archive" });
    // Gmail: dieselbe Mail im Posteingang und in „Alle Nachrichten“ – nur einmal zählen
    add("tom@example.test", "Hallo", { messageId: "<same@example.test>" });
    add("tom@example.test", "Hallo", { role: "archive", messageId: "<same@example.test>" });
    add("deals@shop.example", "Schon gelöscht", { role: "trash" });
    add("deals@shop.example", "Spam", { role: "spam" });

    const byAddress = store.groups({ accountId: null, groupBy: "address", limit: 10 });
    expect(byAddress[0]).toMatchObject({ key: "deals@shop.example", count: 6, unread: 4, protectedCount: 1, uncategorized: 6, addresses: 1, name: "deals" });
    expect(byAddress.find((g) => g.key === "tom@example.test")?.count).toBe(1);
    expect(byAddress.find((g) => g.key === "news@mail.shop.example")?.count).toBe(2);

    const byDomain = store.groups({ accountId: null, groupBy: "domain", limit: 10, minCount: 2 });
    expect(byDomain.map((g) => [g.key, g.count, g.addresses])).toEqual([["shop.example", 8, 2]]);

    const mails = store.groupMails("shop.example", "domain", null, 100);
    expect(mails).toHaveLength(8);
    expect(mails.filter((m) => m.protect).map((m) => [m.subject, m.protect])).toEqual([["Ihre Rechnung 2026-17", "invoice"]]);
    expect(store.groupMails("example", "domain", null, 100)).toEqual([]); // keine Teiltreffer
  });

  it("Löschen verschiebt nur die übergebenen Mails in den Papierkorb; „KI prüfen“ reicht nur Uneingeordnete weiter", async () => {
    const { add, store } = setup();
    const a = add("deals@shop.example", "Angebot");
    const b = add("deals@shop.example", "Angebot 2", { category: "newsletter" });
    const moved: [string[], string][] = [];
    const asked: string[][] = [];
    const service = new CleanupService(store, { move: async (ids, role) => void moved.push([ids, role]) }, { categorize: (ids) => (asked.push(ids), ids.length) });
    expect(await service.trash([a, a, b])).toEqual({ moved: 2 });
    expect(moved).toEqual([[[a, b], "trash"]]);
    expect(await service.trash([])).toEqual({ moved: 0 });
    expect(moved).toHaveLength(1);
    expect(await service.check("deals@shop.example", "address", null)).toEqual({ queued: 1 });
    expect(asked).toEqual([[a]]);
    expect(await new CleanupService(store, { move: async () => undefined }).check("deals@shop.example", "address", null)).toEqual({ queued: 0 });
  });
});
