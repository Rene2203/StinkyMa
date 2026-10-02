import { describe, expect, it } from "vitest";
import { normalizeUserCategory, parseUserCategory, senderMatches, userCategoryPrompt, type Account, type UserCategory } from "../src/index.js";
import { UserCategoryService } from "../src/llm/index.js";
import { MailWriter, openDatabase, SqliteMailRepository, UserCategoryStore } from "../src/sqlite/index.js";

// Testdaten erfunden.
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
  writer.upsertMailbox({ id: "acc/trash", accountId: "acc", name: "Trash", role: "trash" });
  let uid = 0;
  const add = (address: string, subject: string, mailbox = "acc/inbox") => {
    uid += 1;
    const id = `${mailbox}#1:${uid}`;
    writer.insertMessage({
      id, accountId: "acc", mailboxId: mailbox, uid, messageId: `<c${uid}@example.test>`, threadId: `t${uid}`, threadSubject: subject,
      from: { name: null, address }, to: [], cc: [], subject, date: `2026-09-${String(10 + uid).padStart(2, "0")}T08:00:00.000Z`,
      snippet: subject, bodyText: subject, bodyHtml: null, flags: 0, category: "newsletter", attachments: [],
    });
    return id;
  };
  let ids = 0;
  const store = new UserCategoryStore(db, () => `cat-${++ids}`);
  const repository = new SqliteMailRepository(db);
  const inCategory = async (category: string) => (await repository.messages({ kind: "category", category }, 100)).map((m) => m.subject).sort();
  return { db, add, store, repository, inCategory };
}

const gaming = { name: "Gaming", description: "Spiele, Spiele-Shops, Mods", senders: [] as string[], color: "green" as const };

describe("Eigene Kategorien: Grundlagen", () => {
  it("bereinigt Eingaben, erkennt Absender und Domains samt Subdomains", () => {
    expect(normalizeUserCategory({ ...gaming, name: "  Gaming  ", senders: ["@SteamPowered.com", "x", "news@verein.example"] })).toMatchObject({
      name: "Gaming", senders: ["steampowered.com", "news@verein.example"],
    });
    expect(() => normalizeUserCategory({ ...gaming, name: " " })).toThrow();
    expect(senderMatches("noreply@store.steampowered.com", ["steampowered.com"])).toBe(true);
    expect(senderMatches("noreply@notsteampowered.com", ["steampowered.com"])).toBe(false);
    expect(senderMatches("News@Verein.example", ["news@verein.example"])).toBe(true);
  });

  it("Modell-Antwort: Name → ID, „keine“, Unbrauchbares", () => {
    const categories: UserCategory[] = [{ id: "g", name: "Gaming", description: "", senders: [], color: "green", sortOrder: 0 }];
    expect(parseUserCategory('{"kategorie": "gaming"}', categories)).toBe("g");
    expect(parseUserCategory('{"kategorie": "keine"}', categories)).toBe("none");
    expect(parseUserCategory('{"kategorie": "Sport"}', categories)).toBeNull();
    expect(parseUserCategory("kaputt", categories)).toBeNull();
    expect(userCategoryPrompt("Mail", categories)[0]?.content).toContain("- Gaming");
  });
});

describe("Eigene Kategorien: Zuordnung", () => {
  it("Absenderliste sofort (ohne KI), Bereich zeigt Posteingang, nicht Papierkorb; Ungelesene je Kategorie", async () => {
    const { add, inCategory, store } = setup();
    add("noreply@store.steampowered.com", "Sale");
    add("noreply@steampowered.com", "Alt", "acc/trash");
    add("info@bank.example", "Kontoauszug");
    const service = new UserCategoryService({ store });
    const saved = await service.save({ ...gaming, senders: ["steampowered.com"] });
    expect(await inCategory(`u:${saved.id}`)).toEqual(["Sale"]);
    expect(await inCategory("newsletter")).toEqual(["Kontoauszug", "Sale"]);
    const view = await service.list();
    expect(view.unread[`u:${saved.id}`]).toBe(1);
    expect(view.unread.newsletter).toBe(2);
  });

  it("von Hand gesetzt und gemerkt: andere Mails des Absenders folgen; Absenderliste überschreibt nichts davon", async () => {
    const { add, inCategory, store } = setup();
    const first = add("hello@nexusmods.example", "Premium");
    add("hello@nexusmods.example", "Mod-Update");
    const service = new UserCategoryService({ store });
    const g = await service.save(gaming);
    const other = await service.save({ ...gaming, name: "Sonstiges", senders: ["nexusmods.example"] });
    expect(await inCategory(`u:${other.id}`)).toEqual(["Mod-Update", "Premium"]);
    expect(await service.assign(first, g.id, true)).toEqual({ changed: 1 });
    expect(await inCategory(`u:${g.id}`)).toEqual(["Mod-Update", "Premium"]);
    // Neue Mail desselben Absenders: gelernt geht vor Absenderliste
    add("hello@nexusmods.example", "Rechnung");
    await service.refresh();
    expect(await inCategory(`u:${g.id}`)).toEqual(["Mod-Update", "Premium", "Rechnung"]);
    // Löschen: Zuordnung fällt weg, Mails bleiben
    await service.remove(g.id);
    expect(await inCategory(`u:${g.id}`)).toEqual([]);
    expect(await inCategory("newsletter")).toHaveLength(3);
  });

  it("Modell im Hintergrund: ordnet zu, prüft nach Änderung der Kategorien neu, lässt Handarbeit in Ruhe", async () => {
    const { add, inCategory, store } = setup();
    add("shop@spielwelt.example", "Neues Spiel");
    const manual = add("lena@mailbox.example", "Spieleabend?");
    add("info@bank.example", "Kontoauszug");
    const seen: string[] = [];
    const service = new UserCategoryService({
      store,
      classify: async (message, categories) => {
        seen.push(message.subject);
        const hit = /spiel/i.test(message.subject) ? categories.find((c) => c.name === "Gaming") : undefined;
        return { categoryId: hit?.id ?? null, origin: "onDevice", durationMs: 1 };
      },
    });
    const g = await service.save(gaming);
    await service.assign(manual, null, false); // „keine“ von Hand
    await service.idle();
    expect(await inCategory(`u:${g.id}`)).toEqual(["Neues Spiel"]);
    expect(seen.sort()).toEqual(["Kontoauszug", "Neues Spiel", "Spieleabend?"]);
    seen.length = 0;
    await service.refresh();
    await service.idle();
    expect(seen).toEqual([]); // nichts Neues
    await service.save({ ...gaming, id: g.id, description: "Spiele und Mods" });
    await service.idle();
    expect(seen.sort()).toEqual(["Kontoauszug", "Neues Spiel"]); // von Hand gesetzte Mail nicht
    expect(await inCategory(`u:${g.id}`)).toEqual(["Neues Spiel"]);
  });

  it("doppelte Namen werden abgelehnt", async () => {
    const { store } = setup();
    const service = new UserCategoryService({ store });
    await service.save(gaming);
    await expect(service.save({ ...gaming, name: "gaming" })).rejects.toThrow(/gibt es schon/);
  });
});
