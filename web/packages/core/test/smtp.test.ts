import { describe, expect, it } from "vitest";
import { buildMessage, classifySmtpError, MailConnectionError, SmtpRejectedError } from "../src/mail/index.js";

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
