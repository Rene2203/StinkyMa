import { describe, expect, it } from "vitest";
import {
  forwardSubject,
  parseAddressList,
  formatAddressList,
  prepareCompose,
  quoteText,
  replySubject,
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
