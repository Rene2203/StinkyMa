import { describe, expect, it } from "vitest";
import { buildMessage, classifySmtpError, extractAttachment, MailConnectionError, parseMessage, plainTextFromEditorHtml, SmtpRejectedError } from "../src/mail/index.js";

describe("MIME-Nachricht bauen", () => {
  it("Bcc nur im Umschlag, Antwort-Kopfzeilen gesetzt, Umlaute korrekt", async () => {
    const built = await buildMessage(
      {
        accountId: "a",
        to: [{ name: "Anna Beispiel", address: "anna@example.test" }],
        cc: [{ address: "carl@example.test" }],
        bcc: [{ address: "geheim@example.test" }],
        subject: "Re: Grüße aus Köln",
        bodyText: "Hallo Anna,\n\nschöne Grüße!\n",
        inReplyTo: "<m0@example.test>",
        references: ["<root@example.test>", "<m0@example.test>"],
      },
      { from: { name: "Bernd", address: "bernd@example.test" }, messageId: "<neu@example.test>", date: new Date("2026-09-30T12:00:00Z") },
    );
    const raw = built.raw.toString("utf8");
    expect(built.envelope.to).toEqual(["anna@example.test", "carl@example.test", "geheim@example.test"]);
    expect(raw).not.toContain("geheim@example.test");
    expect(raw).not.toMatch(/^bcc:/im);
    expect(raw).toMatch(/^In-Reply-To: <m0@example.test>/m);
    expect(raw).toMatch(/^References: <root@example.test> <m0@example.test>/m);
    expect(raw).toMatch(/^Message-ID: <neu@example.test>/im);
    expect(raw).toMatch(/^Subject: =\?UTF-8\?/m);
    expect(raw).not.toMatch(/X-Mailer: Nodemailer/i);
  });
});

describe("Formatierte Mail", () => {
  it("HTML und Nur-Text als multipart/alternative, Text aus dem HTML abgeleitet", async () => {
    const built = await buildMessage(
      {
        accountId: "a",
        to: [{ address: "anna@example.test" }],
        cc: [],
        bcc: [],
        subject: "Liste",
        bodyText: "wird ersetzt",
        bodyHtml: '<p>Hallo <strong>Anna</strong>,</p><ul><li><p>Eins</p></li><li><p>Zwei</p></li></ul><p><a href="https://shop.example/x">Shop</a></p>',
      },
      { from: { address: "bernd@example.test" }, messageId: "<f@example.test>", date: new Date("2026-09-30T12:00:00Z") },
    );
    const raw = built.raw.toString("utf8");
    expect(raw).toMatch(/Content-Type: multipart\/alternative/);
    expect(raw).toMatch(/Content-Type: text\/plain/);
    expect(raw).toMatch(/Content-Type: text\/html/);
    expect(raw).toContain("<strong>Anna</strong>");
    expect(raw).not.toContain("wird ersetzt");
  });

  it("Nur-Text: eine Zeile pro Absatz, Aufzählungszeichen, Link mit Adresse, Zitat mit >", () => {
    expect(
      plainTextFromEditorHtml('<p>Hallo</p><p></p><p>Zeile</p><ul><li><p>Eins</p></li></ul><ol><li><p>A</p></li></ol><blockquote><p>alt</p></blockquote><p><a href="https://x.example">Link</a></p>'),
    ).toBe("Hallo\n\nZeile\n • Eins\n 1. A\n> alt\nLink <https://x.example>\n");
  });
});

describe("Mail mit Anhang", () => {
  it("multipart/mixed mit Dateiname (auch mit Umlauten) und Inhalt", async () => {
    const built = await buildMessage(
      {
        accountId: "a",
        to: [{ address: "anna@example.test" }],
        cc: [],
        bcc: [],
        subject: "Anbei",
        bodyText: "Siehe Anhang.",
        attachments: [{ filename: "Übersicht.txt", mimeType: "text/plain", size: 5, contentBase64: Buffer.from("Hallo").toString("base64") }],
      },
      { from: { address: "bernd@example.test" }, messageId: "<att@example.test>", date: new Date("2026-09-30T12:00:00Z") },
    );
    const raw = built.raw.toString("utf8");
    expect(raw).toMatch(/Content-Type: multipart\/mixed/);
    // Beim Einlesen (wie beim Empfänger) kommen Name und Inhalt unverändert heraus
    const parsed = await parseMessage(built.raw);
    expect(parsed.attachments).toEqual([expect.objectContaining({ filename: "Übersicht.txt", mimeType: "text/plain", size: 5 })]);
    expect((await extractAttachment(built.raw, 0))?.content.toString("utf8")).toBe("Hallo");
  });
});

describe("SMTP-Fehler einordnen", () => {
  it("5xx = abgelehnt (nicht erneut senden)", () => {
    expect(classifySmtpError({ responseCode: 550, response: "550 5.1.1 User unknown" })).toBeInstanceOf(SmtpRejectedError);
    expect(classifySmtpError({ code: "EENVELOPE" })).toBeInstanceOf(SmtpRejectedError);
  });

  it("Netz, Zeitüberschreitung, 4xx, Anmeldung = später erneut versuchen", () => {
    for (const error of [{ code: "ECONNECTION" }, { code: "ETIMEDOUT" }, { responseCode: 451 }, { code: "EAUTH" }]) {
      expect(classifySmtpError(error)).toBeInstanceOf(MailConnectionError);
    }
  });
});
