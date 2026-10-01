import { describe, expect, it } from "vitest";
import { headerValue, parseListUnsubscribe, unsubscribeMethod, type Account } from "../src/index.js";
import { CleanupService, parseMessage } from "../src/mail/index.js";
import { CleanupStore, MailWriter, openDatabase } from "../src/sqlite/index.js";

describe("Abmelde-Angabe (List-Unsubscribe)", () => {
  it("Ein-Klick nur mit https und List-Unsubscribe-Post", () => {
    const info = parseListUnsubscribe("<mailto:leave@news.example?subject=Abmelden>, <https://news.example/u?id=42>", "List-Unsubscribe=One-Click");
    expect(info).toEqual({
      oneClickUrl: "https://news.example/u?id=42",
      url: "https://news.example/u?id=42",
      mailto: { address: "leave@news.example", subject: "Abmelden", body: "unsubscribe" },
    });
    expect(unsubscribeMethod(info)).toBe("oneClick");
    expect(unsubscribeMethod(parseListUnsubscribe("<https://news.example/u>", null))).toBe("web");
    expect(unsubscribeMethod(parseListUnsubscribe("<https://news.example/u>, <mailto:a@news.example>", null))).toBe("mail");
  });

  it("verwirft Unsicheres: http, Zugangsdaten in der Adresse, mehrere Empfänger, Kopfzeilen-Tricks", () => {
    expect(parseListUnsubscribe("<http://news.example/u>", "List-Unsubscribe=One-Click")).toBeNull();
    expect(parseListUnsubscribe("<https://user:pw@news.example/u>", null)).toBeNull();
    expect(parseListUnsubscribe("<javascript:alert(1)>", null)).toBeNull();
    expect(parseListUnsubscribe("<mailto:a@x.example,b@y.example>", null)).toBeNull();
    const tricky = parseListUnsubscribe("<mailto:leave@news.example?subject=a%0D%0ABcc:%20all@x.example>", null);
    expect(tricky?.mailto?.subject).not.toMatch(/[\r\n]/);
    expect(parseListUnsubscribe(null, null)).toBeNull();
    expect(parseListUnsubscribe("kaputt", null)).toBeNull();
  });

  it("liest die Kopfzeilen aus einer Rohmail (auch umgebrochen)", async () => {
    const raw = [
      "From: Shop <news@shop.example>",
      "To: anna@example.test",
      "Subject: Angebote",
      "List-Unsubscribe: <mailto:leave@shop.example>,",
      " <https://shop.example/abmelden?u=1>",
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hallo",
    ].join("\r\n");
    const parsed = await parseMessage(raw);
    expect(parsed.listUnsubscribe?.oneClickUrl).toBe("https://shop.example/abmelden?u=1");
    expect((await parseMessage(raw.replace(/List-Unsubscribe[^\n]*\n( [^\n]*\n)?/g, ""))).listUnsubscribe).toBeNull();
    expect(headerValue("List-Unsubscribe: <a>\r\n <b>\r\nX: y", "List-Unsubscribe")).toBe("<a> <b>");
  });
});

function setup(accountId = "acc") {
  const db = openDatabase(":memory:");
  const writer = new MailWriter(db);
  const account: Account = {
    id: accountId, email: "anna@example.test", displayName: "Anna", provider: "imap", username: "anna@example.test",
    imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
    authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0,
  };
  writer.insertAccount(account);
  writer.upsertMailbox({ id: `${accountId}/inbox`, accountId, name: "INBOX", role: "inbox" });
  let uid = 0;
  const add = (listUnsubscribe: string | null, category: "newsletter" | "spam_suspect" | null = "newsletter") => {
    uid += 1;
    const id = `${accountId}/inbox#1:${uid}`;
    writer.insertMessage({
      id, accountId, mailboxId: `${accountId}/inbox`, uid, messageId: `<n${uid}@shop.example>`, threadId: `t${uid}`, threadSubject: "Angebote",
      from: { name: "Shop", address: "News@Shop.example" }, to: [], cc: [], subject: "Angebote", date: "2026-09-20T10:00:00.000Z",
      snippet: "", bodyText: "", bodyHtml: null, flags: 0, category, attachments: [], listUnsubscribe,
    });
    return id;
  };
  return { db, add, store: new CleanupStore(db) };
}

const oneClick = JSON.stringify({ oneClickUrl: "https://shop.example/u", url: "https://shop.example/u", mailto: null });

describe("Abbestellen (Dienst)", () => {
  it("Ein-Klick: POST an den Anbieter, danach für den Absender vermerkt", async () => {
    const { add, store } = setup();
    const id = add(oneClick);
    const posted: string[] = [];
    const service = new CleanupService(store, { move: async () => undefined }, { postOneClick: async (url) => (posted.push(url), 200), now: () => new Date("2026-10-01T12:00:00Z") });
    const before = await service.unsubscribeInfo(id);
    expect(before).toMatchObject({ sender: "news@shop.example", method: "oneClick", done: null, suspicious: false });
    expect(posted).toEqual([]); // nichts ohne Klick
    expect(await service.unsubscribe(id)).toEqual({ method: "oneClick" });
    expect(posted).toEqual(["https://shop.example/u"]);
    expect((await service.unsubscribeInfo(add(oneClick))).done).toEqual({ method: "oneClick", at: "2026-10-01T12:00:00.000Z" });
  });

  it("Anbieter lehnt ab oder ist nicht erreichbar: verständlicher Fehler, nichts vermerkt", async () => {
    const { add, store } = setup();
    const id = add(oneClick);
    const rejected = new CleanupService(store, { move: async () => undefined }, { postOneClick: async () => 404 });
    await expect(rejected.unsubscribe(id)).rejects.toThrow(/abgelehnt \(Status 404\)/);
    const offline = new CleanupService(store, { move: async () => undefined }, { postOneClick: async () => { throw new Error("ENOTFOUND"); } });
    await expect(offline.unsubscribe(id)).rejects.toThrow(/nicht erreichbar/);
    expect((await rejected.unsubscribeInfo(id)).done).toBeNull();
  });

  it("Abmelde-Mail über das Konto; Webseite wird nur zurückgegeben; ohne Angabe kein Abbestellen", async () => {
    const { add, store } = setup();
    const sent: [string, string][] = [];
    const service = new CleanupService(store, { move: async () => undefined, sendUnsubscribeMail: async (accountId, mailto) => void sent.push([accountId, mailto.address]) });
    const mailId = add(JSON.stringify({ oneClickUrl: null, url: null, mailto: { address: "leave@shop.example", subject: "unsubscribe", body: "unsubscribe" } }));
    expect(await service.unsubscribe(mailId)).toEqual({ method: "mail" });
    expect(sent).toEqual([["acc", "leave@shop.example"]]);
    const webId = add(JSON.stringify({ oneClickUrl: null, url: "https://shop.example/abmelden", mailto: null }));
    expect(await service.unsubscribe(webId)).toEqual({ method: "web", url: "https://shop.example/abmelden" });
    await expect(service.unsubscribe(add(""))).rejects.toThrow(/keine Abmeldung/);
    expect((await service.unsubscribeInfo(add(oneClick, "spam_suspect"))).suspicious).toBe(true);
  });

  it("ältere Mails: Angabe einmal vom Server holen und merken", async () => {
    const { add, store, db } = setup();
    const id = add(null);
    let fetched = 0;
    const service = new CleanupService(store, {
      move: async () => undefined,
      fetchListUnsubscribe: async () => (fetched++, { header: "<https://shop.example/u>", post: "List-Unsubscribe=One-Click" }),
    });
    expect((await service.unsubscribeInfo(id)).method).toBe("oneClick");
    expect((await service.unsubscribeInfo(id)).method).toBe("oneClick");
    expect(fetched).toBe(1);
    expect((db.prepare("SELECT listUnsubscribe FROM message WHERE id = ?").get(id) as { listUnsubscribe: string }).listUnsubscribe).toContain("shop.example/u");
  });

  it("Beispielkonten: wird nur vermerkt – kein Netz, keine Mail", async () => {
    const { add, store } = setup("mock-demo");
    const id = add(oneClick);
    const service = new CleanupService(store, { move: async () => undefined }, { postOneClick: async () => { throw new Error("darf nicht aufgerufen werden"); } });
    expect(await service.unsubscribe(id)).toEqual({ method: "oneClick" });
  });
});
