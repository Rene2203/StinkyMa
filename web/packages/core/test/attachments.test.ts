import { describe, expect, it } from "vitest";
import {
  AttachmentRisk, attachmentRiskFlags, createZip, documentPages, parseAttachmentAnswer, parseAttachmentRelevance, prefilterAttachment, relevantPages,
  ruleRelevance, type Account, type RelevanceAttachment,
} from "../src/index.js";
import { officeText } from "../src/mail/attachmentText.js";
import { AttachmentService } from "../src/llm/index.js";
import { AttachmentStore, MailWriter, openDatabase, SqliteMailRepository } from "../src/sqlite/index.js";

// Testdaten erfunden.
const text = (s: string) => new TextEncoder().encode(s);

describe("Anhänge: Risiko und Vorfilter (W9.1)", () => {
  it("erkennt Programme, getarnte Endungen, Makros, verschlüsselte Archive und HTML-Anmeldeseiten", () => {
    expect(attachmentRiskFlags("Rechnung.pdf.exe", "application/octet-stream")).toBe(AttachmentRisk.executable | AttachmentRisk.doubleExtension);
    expect(attachmentRiskFlags("Bericht.docm", "application/vnd.ms-word")).toBe(AttachmentRisk.macro);
    expect(attachmentRiskFlags("Rechnung.pdf", "application/pdf")).toBe(0);
    const zip = createZip([{ name: "rechnung.txt", data: text("x") }]);
    expect(attachmentRiskFlags("akte.zip", "application/zip", zip)).toBe(0);
    const locked = Uint8Array.from(zip);
    locked[6] = (locked[6] ?? 0) | 1; // „verschlüsselt“-Bit im lokalen Kopf
    expect(attachmentRiskFlags("akte.zip", "application/zip", locked)).toBe(AttachmentRisk.encryptedArchive);
    expect(attachmentRiskFlags("login.html", "text/html", text('<form action="x"><input type="password"></form>'))).toBe(AttachmentRisk.htmlLoginForm);
  });

  it("sortiert Logos, Signatur-Bilder und Standardtexte ohne KI aus", () => {
    expect(prefilterAttachment({ filename: "image001.png", mimeType: "image/png", size: 9000, isInline: true, contentId: "a" })?.relevance).toBe("irrelevant");
    expect(prefilterAttachment({ filename: "AGB_Shop.pdf", mimeType: "application/pdf", size: 90_000, isInline: false, contentId: null })?.documentType).toBe("Standardtext");
    expect(prefilterAttachment({ filename: "Widerrufsbelehrung.pdf", mimeType: "application/pdf", size: 9000, isInline: false, contentId: null })?.relevance).toBe("irrelevant");
    expect(prefilterAttachment({ filename: "einladung.ics", mimeType: "text/calendar", size: 900, isInline: false, contentId: null })?.relevance).toBe("supporting");
    expect(prefilterAttachment({ filename: "IMG_2041.jpg", mimeType: "image/jpeg", size: 2_000_000, isInline: false, contentId: null })).toBeNull();
    expect(prefilterAttachment({ filename: "Rechnung_4711.pdf", mimeType: "application/pdf", size: 60_000, isInline: false, contentId: null })).toBeNull();
  });
});

describe("Anhänge: Relevanz (W9.1)", () => {
  const mail = { subject: "Ihre Bestellung", from: "shop@shop.example", body: "Anbei die Rechnung zu Ihrer Bestellung." };
  const list: RelevanceAttachment[] = [
    { id: "a", filename: "Rechnung_4711.pdf", mimeType: "application/pdf", size: 60_000, snippet: "Rechnung Nr. 4711" },
    { id: "b", filename: "Gutschein.pdf", mimeType: "application/pdf", size: 60_000, snippet: "10 % auf alles" },
  ];

  it("Regeln: was die Mail nennt, ist zentral; sonst unterstützend", () => {
    expect(ruleRelevance(mail, list).map((r) => [r.relevance, r.documentType])).toEqual([["central", "Rechnung"], ["supporting", "Sonstiges"]]);
  });

  it("KI-Antwort wird geprüft: Verweist die Mail auf den Anhang, wird er nie unwichtig", () => {
    const parsed = parseAttachmentRelevance(
      '{"anhaenge": [{"nr": 1, "relevanz": "unwichtig", "art": "Sonstiges", "grund": "Werbung"}, {"nr": 2, "relevanz": "unwichtig", "art": "Sonstiges", "grund": "Gutschein-Werbung"}]}',
      mail,
      list,
    );
    expect(parsed?.map((r) => [r.relevance, r.documentType])).toEqual([["central", "Rechnung"], ["irrelevant", "Sonstiges"]]);
    expect(parseAttachmentRelevance("kein json", mail, list)).toBeNull();
  });
});

describe("Anhänge: Text, Seiten und „Frag den Anhang“ (W9.2)", () => {
  it("liest Word und PowerPoint (Folien als Seiten)", () => {
    const docx = Buffer.from(createZip([{ name: "word/document.xml", data: text("<w:document><w:body><w:p><w:r><w:t>Mietvertrag</w:t></w:r></w:p><w:p><w:r><w:t>Miete 850 &amp; Nebenkosten</w:t></w:r></w:p></w:body></w:document>") }]));
    expect(officeText(docx).text.trim()).toBe("Mietvertrag\nMiete 850 & Nebenkosten");
    const pptx = Buffer.from(createZip([
      { name: "ppt/slides/slide2.xml", data: text("<p:sld><a:p><a:r><a:t>Zahlen</a:t></a:r></a:p></p:sld>") },
      { name: "ppt/slides/slide1.xml", data: text("<p:sld><a:p><a:r><a:t>Titel</a:t></a:r></a:p></p:sld>") },
    ]));
    const slides = officeText(pptx);
    expect(slides.pageCount).toBe(2);
    expect(documentPages(slides.text).map((p) => [p.number, p.text])).toEqual([[1, "Titel"], [2, "Zahlen"]]);
  });

  it("zeigt bei langen Dokumenten die passenden Seiten und prüft Seiten und Zitat der Antwort", () => {
    const pages = Array.from({ length: 12 }, (_, i) => `Seite ${i + 1}: ${"Allgemeines ".repeat(80)}${i === 7 ? "Die Kündigungsfrist beträgt drei Monate zum Monatsende." : ""}`).join("\f");
    const shown = relevantPages(documentPages(pages), "Wie lang ist die Kündigungsfrist?", 3000);
    expect(shown.map((p) => p.number)).toContain(8);
    const answer = parseAttachmentAnswer('{"antwort": "Drei Monate zum Monatsende.", "seiten": [8, 99], "zitat": "Die Kündigungsfrist beträgt drei Monate zum Monatsende."}', shown);
    expect(answer).toMatchObject({ found: true, pages: [8], quote: "Die Kündigungsfrist beträgt drei Monate zum Monatsende." });
    // Erfundenes Zitat fällt weg; „steht nichts“ wird erkannt
    expect(parseAttachmentAnswer('{"antwort": "Drei Monate.", "seiten": [], "zitat": "Frist: 3 Monate"}', shown)?.quote).toBe("");
    expect(parseAttachmentAnswer('{"antwort": "Dazu steht in diesem Anhang nichts.", "seiten": [], "zitat": ""}', shown)?.found).toBe(false);
  });
});

describe("Anhänge: Speicher und Dienst (W9.1)", () => {
  it("Vorfilter, Regeln, KI im Hintergrund, Entscheidung mit Regel je Absender; Verschieben behält alles", async () => {
    const db = openDatabase(":memory:");
    const writer = new MailWriter(db);
    const account: Account = {
      id: "acc", email: "anna@example.test", displayName: "Anna", provider: "imap", username: "anna@example.test",
      imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
      authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0,
    };
    writer.insertAccount(account);
    writer.upsertMailbox({ id: "acc/inbox", accountId: "acc", name: "INBOX", role: "inbox" });
    writer.upsertMailbox({ id: "acc/archive", accountId: "acc", name: "Archiv", role: "archive" });
    const shop = { name: "Shop", address: "rechnung@shop.example" };
    const add = (uid: number, body: string, attachments: { filename: string; mimeType: string; size: number; sha256?: string }[]) =>
      writer.insertMessage({
        id: `acc/inbox#1:${uid}`, accountId: "acc", mailboxId: "acc/inbox", uid, messageId: `<m${uid}@example.test>`, threadId: `t${uid}`, threadSubject: "Bestellung",
        from: shop, to: [{ name: "Anna", address: "anna@example.test" }], cc: [], subject: "Ihre Bestellung", date: `2026-09-${10 + uid}T08:00:00.000Z`, snippet: "", bodyText: body, bodyHtml: null, flags: 0,
        attachments: attachments.map((a) => ({ ...a, contentId: null, isInline: false })),
      });
    add(1, "Anbei die Rechnung.", [{ filename: "Rechnung_1.pdf", mimeType: "application/pdf", size: 50_000 }, { filename: "AGB.pdf", mimeType: "application/pdf", size: 80_000, sha256: "f".repeat(64) }, { filename: "Prospekt_09.pdf", mimeType: "application/pdf", size: 900_000 }]);
    add(2, "Unser neuer Prospekt.", [{ filename: "Prospekt_10.pdf", mimeType: "application/pdf", size: 900_000 }]);
    writer.setAttachmentText("acc/inbox#1:1/a0", "Rechnung Nr. 1\fSeite zwei", "pdf");

    const store = new AttachmentStore(db, () => "r1");
    const calls: string[] = [];
    const service = new AttachmentService({
      store,
      check: async (_mail, list) => {
        calls.push(list.map((a) => a.filename).join(","));
        return { fromModel: true, results: list.map((a) => ({ id: a.id, relevance: a.filename.startsWith("Prospekt") ? "irrelevant" : "central", documentType: a.filename.startsWith("Rechnung") ? "Rechnung" : "Sonstiges", reason: "Test" })) };
      },
      analyze: async (id) => {
        calls.push(`analyze:${id}`);
      },
    });
    await service.scan();
    await service.idle();
    const repo = new SqliteMailRepository(db);
    const relevance = async (uid: number) => (await repo.attachments(`acc/inbox#1:${uid}`)).map((a) => [a.filename, a.relevance, a.analysisStatus]).sort();
    expect(await relevance(1)).toEqual([["AGB.pdf", "irrelevant", "skipped"], ["Prospekt_09.pdf", "irrelevant", "skipped"], ["Rechnung_1.pdf", "central", "pending"]]);
    // KI sah die AGB nie; zentrale Anhänge mit Text werden zusammengefasst
    expect(calls).toContain("Rechnung_1.pdf,Prospekt_09.pdf");
    expect(calls).toContain("analyze:acc/inbox#1:1/a0");

    // „Trotzdem lesen“ mit „merken“: alle Prospekte dieses Absenders folgen
    await service.decide("acc/inbox#1:1/a2", "read", true);
    expect((await repo.attachments("acc/inbox#1:2"))[0]?.relevance).toBe("central");
    expect(await service.rules()).toMatchObject([{ sender: "rechnung@shop.example", decision: "read" }]);
    expect(calls).toContain("analyze:acc/inbox#1:1/a2");

    // Verschieben: neue ID, Relevanz und Prüfsumme bleiben
    writer.relocateMessage("acc/inbox#1:1", { newId: "acc/archive#1:7", mailboxId: "acc/archive", uid: 7 });
    expect((await repo.attachments("acc/archive#1:7")).map((a) => [a.filename, a.relevance, a.sha256 ?? null]).sort()).toEqual([["AGB.pdf", "irrelevant", "f".repeat(64)], ["Prospekt_09.pdf", "central", null], ["Rechnung_1.pdf", "central", null]]);
  });
});
