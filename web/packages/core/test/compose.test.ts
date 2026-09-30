import { describe, expect, it } from "vitest";
import {
  forwardSubject,
  parseAddressList,
  formatAddressList,
  prepareCompose,
  quoteText,
  replySubject,
  emailHtml,
  textToHtml,
  rankContacts,
  type ComposeLabels,
  type Message,
} from "../src/index.js";

const labels: ComposeLabels = {
  wrote: (m) => `${m.from.name} schrieb:`,
  forwardHeader: (m) => `-------- Weitergeleitete Nachricht --------\nVon: ${m.from.address}\nBetreff: ${m.subject}`,
};

const me = { id: "acc", email: "ich@example.test" };

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "m2",
    accountId: "acc",
    mailboxId: "acc/INBOX",
    messageId: "<m2@example.test>",
    threadId: "t",
    from: { name: "Anna", address: "anna@example.test" },
    to: [{ name: "Ich", address: "Ich@Example.test" }, { address: "bernd@example.test" }],
    cc: [{ address: "carl@example.test" }, { address: "anna@example.test" }],
    subject: "Grillen am Samstag",
    date: "2026-09-30T10:00:00.000Z",
    snippet: "Kommst du?",
    bodyText: "Kommst du?\n> alte Zeile\n",
    flags: 0,
    hasAttachments: false,
    ...overrides,
  };
}

describe("Betreff", () => {
  it("Re:/Fwd: nur einmal", () => {
    expect(replySubject("Grillen")).toBe("Re: Grillen");
    expect(replySubject("AW: Grillen")).toBe("AW: Grillen");
    expect(replySubject("re: Grillen")).toBe("re: Grillen");
    expect(forwardSubject("WG: Rechnung")).toBe("WG: Rechnung");
    expect(forwardSubject("Rechnung")).toBe("Fwd: Rechnung");
  });
});

describe("Zitieren", () => {
  it("setzt > vor jede Zeile, verschachtelt ohne Leerzeichen", () => {
    expect(quoteText("Hallo\n> alt\n\n")).toBe("> Hallo\n>> alt");
  });
});

describe("Antworten vorbereiten", () => {
  const thread = [
    message({ id: "m1", messageId: "<m1@example.test>", date: "2026-09-29T10:00:00.000Z" }),
    message(),
    message({ id: "m3", messageId: "<m3@example.test>", date: "2026-09-30T11:00:00.000Z" }),
  ];

  it("Antworten: an den Absender, Kette bis zur beantworteten Mail", () => {
    const draft = prepareCompose("reply", { account: me, original: message(), thread, labels });
    expect(draft.to).toEqual([{ name: "Anna", address: "anna@example.test" }]);
    expect(draft.cc).toEqual([]);
    expect(draft.subject).toBe("Re: Grillen am Samstag");
    expect(draft.inReplyTo).toBe("<m2@example.test>");
    expect(draft.references).toEqual(["<m1@example.test>", "<m2@example.test>"]);
    expect(draft.answeredMessageId).toBe("m2");
    expect(draft.bodyText).toBe("\n\nAnna schrieb:\n> Kommst du?\n>> alte Zeile\n");
  });

  it("Allen antworten: ohne mich selbst, ohne Doppelte", () => {
    const draft = prepareCompose("replyAll", { account: me, original: message(), thread, labels });
    expect(draft.to.map((a) => a.address)).toEqual(["anna@example.test", "bernd@example.test"]);
    expect(draft.cc.map((a) => a.address)).toEqual(["carl@example.test"]);
  });

  it("Antwort auf eigene Mail geht an deren Empfänger", () => {
    const own = message({ from: { name: "Ich", address: "ich@example.test" }, to: [{ address: "anna@example.test" }] });
    const draft = prepareCompose("reply", { account: me, original: own, labels });
    expect(draft.to.map((a) => a.address)).toEqual(["anna@example.test"]);
  });

  it("Weiterleiten: leere Empfänger, Kopf und Text, keine Antwort-Kopfzeilen", () => {
    const draft = prepareCompose("forward", { account: me, original: message(), labels });
    expect(draft.to).toEqual([]);
    expect(draft.subject).toBe("Fwd: Grillen am Samstag");
    expect(draft.bodyText).toContain("Weitergeleitete Nachricht");
    expect(draft.bodyText).toContain("Kommst du?");
    expect(draft.inReplyTo).toBeUndefined();
  });
});

describe("Empfängerzeile", () => {
  it("liest Namen, Kommas in Anführungszeichen, Semikolons und meldet Ungültiges", () => {
    const { addresses, invalid } = parseAddressList('Anna <anna@example.test>, "Müller, Carl" <carl@example.test>; bernd@example.test, quatsch, anna@example.test');
    expect(addresses).toEqual([
      { name: "Anna", address: "anna@example.test" },
      { name: "Müller, Carl", address: "carl@example.test" },
      { name: null, address: "bernd@example.test" },
    ]);
    expect(invalid).toEqual(["quatsch"]);
  });

  it("formatiert so, dass es wieder gelesen werden kann", () => {
    const list = [{ name: "Müller, Carl", address: "carl@example.test" }, { address: "b@example.test" }];
    expect(formatAddressList(list)).toBe('"Müller, Carl" <carl@example.test>, b@example.test');
    expect(parseAddressList(formatAddressList(list)).addresses.map((a) => a.address)).toEqual(["carl@example.test", "b@example.test"]);
  });
});

describe("HTML für formatierte Mails", () => {
  it("Antwort bringt das Zitat auch als HTML mit (maskiert)", () => {
    const draft = prepareCompose("reply", { account: me, original: message({ bodyText: "a < b & c\n> alt" }), labels });
    expect(draft.bodyHtml).toBe("<p></p><p></p><p>Anna schrieb:</p><blockquote><p>a &lt; b &amp; c</p><blockquote><p>alt</p></blockquote></blockquote>");
  });

  it("Text → Absätze, leere Zeilen bleiben", () => {
    expect(textToHtml("Hallo\n\n<Welt>")).toBe("<p>Hallo</p><p></p><p>&lt;Welt&gt;</p>");
  });

  it("versandfertig: Grundschrift, Absätze ohne Abstand, leere Zeilen sichtbar, Zitat mit Linie", () => {
    const html = emailHtml('<p>Hallo</p><p></p><p style="text-align: center">Mitte</p><blockquote><p>alt</p></blockquote><ul><li><p>Eins</p></li></ul>');
    expect(html).toContain("font-family:Arial, Helvetica, sans-serif;font-size:11pt");
    expect(html).toContain('<p style="margin:0">Hallo</p>');
    expect(html).toContain('<p style="margin:0"><br></p>');
    expect(html).toContain('<p style="margin:0;text-align: center">Mitte</p>');
    expect(html).toContain('<blockquote style="margin:0 0 0 0.8ex;border-left:2px solid #c8c8c8');
    expect(html).toContain('<ul style="margin:0;padding-left:1.6em">');
  });
});

describe("Adressvorschläge ordnen", () => {
  const contacts = [
    { address: "news@shop.example", name: "Shop Newsletter", sent: 0, received: 40, last: "2026-09-30" },
    { address: "jonas@example.test", name: "Jonas Weber", sent: 12, received: 3, last: "2026-09-01" },
    { address: "jo@example.test", name: null, sent: 0, received: 1, last: "2026-09-29" },
    { address: "ich@example.test", name: "Ich", sent: 99, received: 0, last: "2026-09-30" },
  ];
  it("wem man schreibt, steht vor Newslettern; eigene Adresse fehlt; Name und Adresse zählen", () => {
    expect(rankContacts(contacts, { query: "e", ownAddresses: ["Ich@example.test"], limit: 5 }).map((c) => c.address)).toEqual([
      "jonas@example.test", "news@shop.example", "jo@example.test",
    ]);
    expect(rankContacts(contacts, { query: "weber", ownAddresses: [], limit: 5 })).toEqual([{ name: "Jonas Weber", address: "jonas@example.test" }]);
    expect(rankContacts(contacts, { query: "  ", ownAddresses: [], limit: 5 })).toEqual([]);
    expect(rankContacts(contacts, { query: "o", ownAddresses: [], limit: 1 })).toHaveLength(1);
  });
});

describe("Signatur", () => {
  const sig = "<p><strong>Bernd</strong></p><p>Tel. 0123</p>";
  it("neue Mail: Signatur unter zwei leeren Zeilen", () => {
    const draft = prepareCompose("new", { account: me, labels, signatureHtml: sig });
    expect(draft.bodyHtml).toBe(`<p></p><p></p>${sig}`);
    expect(draft.bodyText).toBe("\n\nBernd\nTel. 0123");
  });

  it("Antwort: Signatur über dem Zitat; leere Signatur zählt nicht", () => {
    const draft = prepareCompose("reply", { account: me, original: message(), labels, signatureHtml: sig });
    expect(draft.bodyHtml).toBe(`<p></p><p></p>${sig}<p></p><p>Anna schrieb:</p><blockquote><p>Kommst du?</p><blockquote><p>alte Zeile</p></blockquote></blockquote>`);
    expect(draft.bodyText).toBe("\n\nBernd\nTel. 0123\n\nAnna schrieb:\n> Kommst du?\n>> alte Zeile\n");
    expect(prepareCompose("new", { account: me, labels, signatureHtml: "<p></p><p> </p>" }).bodyHtml).toBeUndefined();
  });
});

describe("Weiterleiten mit Original-Layout", () => {
  const html = '<html><head><style>p{color:red}</style></head><body><table><tr><td>Rechnung</td></tr></table></body></html>';
  const attachments = [
    { id: "m2/a0", messageId: "m2", filename: "Rechnung.pdf", mimeType: "application/pdf", size: 1200, isInline: false, isEncrypted: false, analysisStatus: "pending" as const, riskFlags: 0 },
    { id: "m2/a1", messageId: "m2", filename: "logo.png", mimeType: "image/png", size: 300, isInline: true, isEncrypted: false, analysisStatus: "pending" as const, riskFlags: 0 },
  ];

  it("HTML-Original bleibt außerhalb des Editors, Anhänge (ohne eingebettete Bilder) gehen mit", () => {
    const draft = prepareCompose("forward", { account: me, original: message({ bodyHtml: html }), labels, attachments });
    expect(draft.bodyHtml).not.toContain("<table>");
    expect(draft.forwardedHtml).toBe("<table><tr><td>Rechnung</td></tr></table>");
    expect(draft.forwardedText).toContain("Kommst du?");
    expect(draft.forwardAttachments).toEqual([{ id: "m2/a0", filename: "Rechnung.pdf", mimeType: "application/pdf", size: 1200 }]);
  });

  it("Textmail: Original kommt als Text in den Editor", () => {
    const draft = prepareCompose("forward", { account: me, original: message(), labels });
    expect(draft.forwardedHtml).toBeNull();
    expect(draft.bodyHtml).toContain("<p>Kommst du?</p>");
  });

  it("versandfertig: Original unter dem eigenen Text, nicht in der Grundschrift", () => {
    const out = emailHtml("<p>Siehe unten</p>", "<table><tr><td>Rechnung</td></tr></table>");
    expect(out).toMatch(/<div style="font-family:[^"]*"><p style="margin:0">Siehe unten<\/p><\/div><div><table>/);
  });
});

