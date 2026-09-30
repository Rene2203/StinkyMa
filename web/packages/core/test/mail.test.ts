import { describe, expect, it } from "vitest";
import { sampleReply } from "./fixtures.js";
import { assignUniqueRoles, baseSubject, detectProvider, guessSettings, mailboxRole, normalizeIds, parseMessage, snippetFromText, threadIdFor } from "../src/mail/index.js";

describe("Anbieter erkennen", () => {
  it("kennt iCloud mit app-spezifischem Passwort", () => {
    const p = detectProvider("Anna@ICLOUD.com")!;
    expect(p.provider).toBe("icloud");
    expect(p.imap).toEqual({ host: "imap.mail.me.com", port: 993, security: "tls" });
    expect(p.smtp).toEqual({ host: "smtp.mail.me.com", port: 587, security: "starttls" });
    expect(p.auth).toBe("app-password");
    expect(detectProvider("x@me.com")?.provider).toBe("icloud");
  });

  it("Outlook braucht OAuth (ab W3)", () => {
    expect(detectProvider("x@hotmail.de")?.auth).toBe("oauth-required");
  });

  it("unbekannte Domain: kein Treffer, aber ein Vorschlag", () => {
    expect(detectProvider("a@beispiel-firma.example")).toBeNull();
    expect(guessSettings("a@beispiel-firma.example")?.imap.host).toBe("imap.beispiel-firma.example");
    expect(guessSettings("kaputt")).toBeNull();
  });
});

describe("Ordnerrollen", () => {
  it.each([
    ["INBOX", "/", null, "inbox"],
    ["Sent Messages", "/", null, "sent"],
    ["Gesendete Objekte", "/", null, "sent"],
    ["[Gmail]/Alle Nachrichten", "/", null, "archive"],
    ["Papierkorb", ".", null, "trash"],
    ["Irgendwas", "/", "\\Junk", "spam"],
    ["Finanzen", "/", null, "custom"],
  ] as const)("%s → %s", (path, delimiter, special, role) => {
    expect(mailboxRole(path, delimiter, special)).toBe(role);
  });

  it("vergibt jede Rolle nur einmal, SPECIAL-USE zuerst", () => {
    const result = assignUniqueRoles([
      { path: "Archiv", role: "archive" as const, specialUse: false },
      { path: "Archive", role: "archive" as const, specialUse: true },
    ]);
    expect(result.find((f) => f.path === "Archive")?.role).toBe("archive");
    expect(result.find((f) => f.path === "Archiv")?.role).toBe("custom");
  });
});

describe("Konversationen", () => {
  it("Antwort und Ursprungsmail landen im selben Thread", () => {
    const root = threadIdFor("acc", { messageId: "<a@x>" }, "f1");
    const reply = threadIdFor("acc", { messageId: "<b@x>", inReplyTo: "<a@x>", references: "<a@x>" }, "f2");
    const replyToReply = threadIdFor("acc", { messageId: "<c@x>", inReplyTo: "<b@x>", references: ["<a@x>", "<b@x>"] }, "f3");
    expect(reply).toBe(root);
    expect(replyToReply).toBe(root);
    expect(threadIdFor("other", { messageId: "<a@x>" }, "f1")).not.toBe(root);
  });

  it("ohne Kopfzeilen eigener Thread", () => {
    expect(threadIdFor("acc", {}, "f1")).not.toBe(threadIdFor("acc", {}, "f2"));
  });

  it("normalisiert IDs", () => {
    expect(normalizeIds("<A@X> <b@y>")).toEqual(["<a@x>", "<b@y>"]);
    expect(normalizeIds(null)).toEqual([]);
  });

  it("Betreff ohne Präfixe", () => {
    expect(baseSubject("AW: Re: WG: Angebot")).toBe("Angebot");
    expect(baseSubject("Re[2]: Frage")).toBe("Frage");
    expect(baseSubject("Re:")).toBe("Re:");
  });
});


describe("MIME", () => {
  it("liest Kopf, Text, HTML und Anhänge", async () => {
    const m = await parseMessage(sampleReply);
    expect(m.subject).toBe("Grüße aus München");
    expect(m.from).toEqual({ name: "Petra Schulz", address: "p.schulz@moebelhaus.example" });
    expect(m.to[0]?.address).toBe("anna@example.test");
    expect(m.messageId).toBe("<m1@moebelhaus.example>");
    expect(m.references).toEqual(["<m0@example.test>"]);
    expect(m.date).toBe("2026-09-29T08:00:00.000Z");
    expect(m.bodyHtml).toContain("<b>Angebot</b>");
    expect(m.snippet).toBe("Hallo Anna, anbei das Angebot.");
    expect(m.attachments).toEqual([
      { filename: "Angebot.pdf", mimeType: "application/pdf", size: 13, contentId: null, isInline: false },
    ]);
  });

  it("Vorschau ohne Zitate und Signatur", () => {
    expect(snippetFromText("Danke!\n\nOn Mon, Anna wrote:\n> alt")).toBe("Danke!");
    expect(snippetFromText("Kurz.\n-- \nAnna Beispiel\nTel. 123")).toBe("Kurz.");
  });

  it("nur HTML: Vorschau aus dem HTML-Text", async () => {
    const m = await parseMessage("From: a@x.example\r\nSubject: Nur HTML\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<h1>Hallo</h1><p>Welt</p>");
    expect(m.bodyHtml).toContain("<h1>");
    expect(m.snippet).toContain("Hallo");
  });
});
