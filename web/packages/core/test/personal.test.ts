import { describe, expect, it } from "vitest";
import { analyzeRecipient, analyzeStyle, messagePriority, ownText, senderEngagement, type Account, type SenderStats } from "../src/index.js";
import { addressForm, lengthHint, repliesPrompt, styledGreeting } from "../src/ai/replies.js";
import { MailWriter, openDatabase, PersonalStore, PriorityStore, SqliteMailRepository } from "../src/sqlite/index.js";

// Testdaten erfunden.
const none: SenderStats = { received: 0, opened: 0, replied: 0, flagged: 0, trashedUnread: 0, sentTo: 0, userPriority: null };

describe("Priorisierung (W8.3)", () => {
  it("rechnet Wichtigkeit aus Verhalten und Einordnung; Festlegungen gewinnen", () => {
    expect(senderEngagement(none)).toBeNull();
    const friend = { ...none, received: 10, opened: 10, replied: 6, sentTo: 4 };
    const ignored = { ...none, received: 10, opened: 1, trashedUnread: 8 };
    expect(messagePriority("personal", friend)).toBeGreaterThanOrEqual(0.6);
    expect(messagePriority("newsletter", ignored)).toBeLessThan(0.2);
    // Unbekannter Absender: nur die Einordnung zählt (neutral 0,35 für den Absender)
    expect(messagePriority("work", none)).toBeCloseTo(0.48, 2);
    expect(messagePriority("newsletter", { ...ignored, userPriority: 1 })).toBe(1);
    expect(messagePriority("personal", { ...friend, userPriority: -1 })).toBe(0);
    expect(messagePriority("spam_suspect", friend)).toBe(0);
  });

  it("protokolliert, rechnet neu, behält Ereignisse beim Verschieben und vergisst auf Wunsch", async () => {
    const db = openDatabase(":memory:");
    const writer = new MailWriter(db);
    const account: Account = {
      id: "acc", email: "anna@example.test", displayName: "Anna", provider: "imap", username: "anna@example.test",
      imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
      authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0,
    };
    writer.insertAccount(account);
    for (const role of ["inbox", "archive", "sent"] as const) writer.upsertMailbox({ id: `acc/${role}`, accountId: "acc", name: role, role });
    const lena = { name: "Lena Berg", address: "lena@freunde.example" };
    const shop = { name: "Shop Newsletter", address: "news@shop.example" };
    const anna = { name: "Anna", address: "anna@example.test" };
    let uid = 0;
    const add = (box: "inbox" | "sent", from: typeof lena, to: typeof lena, category: "personal" | "newsletter" | null, body = "Text") => {
      uid++;
      const id = `acc/${box}#1:${uid}`;
      writer.insertMessage({
        id, accountId: "acc", mailboxId: `acc/${box}`, uid, messageId: `<p${uid}@example.test>`, threadId: `t${uid}`, threadSubject: "S",
        from, to: [to], cc: [], subject: "S", date: `2026-09-${String(uid).padStart(2, "0")}T08:00:00.000Z`, snippet: "", bodyText: body, bodyHtml: null, flags: 0, category, attachments: [],
      });
      return id;
    };
    const fromLena = [add("inbox", lena, anna, "personal"), add("inbox", lena, anna, "personal"), add("inbox", lena, anna, "personal")];
    const fromShop = [add("inbox", shop, anna, "newsletter"), add("inbox", shop, anna, "newsletter"), add("inbox", shop, anna, "newsletter")];
    add("sent", anna, lena, null, "Liebe Lena, danke dir!\n\nKlar, ich komme gern.\n\nLiebe Grüße\nAnna\n\nAm 1.9. schrieb Lena:\n> Kommst du?");
    add("sent", anna, lena, null, "Liebe Lena,\nbis morgen 😊\nLG Anna");

    const priority = new PriorityStore(db);
    const at = "2026-09-30T10:00:00.000Z";
    for (const id of fromLena) priority.record("open", [id], at);
    priority.record("reply", [fromLena[0]!], at);
    expect(priority.record("trash", fromShop, at)).toEqual(["news@shop.example"]);
    priority.recompute();
    const repo = new SqliteMailRepository(db);
    const important = await repo.messages({ kind: "important" }, 50);
    expect(important.map((m) => m.from.address)).toEqual(["lena@freunde.example", "lena@freunde.example", "lena@freunde.example"]);
    expect((await repo.overview()).counts.important).toBe(3);

    // Verschieben ändert die ID – das Protokoll zieht mit
    writer.relocateMessage(fromLena[0]!, { newId: "acc/archive#1:99", mailboxId: "acc/archive", uid: 99 });
    expect(priority.stats("lena@freunde.example")).toMatchObject({ received: 3, opened: 3, replied: 1, sentTo: 2 });
    expect(priority.stats("news@shop.example")).toMatchObject({ received: 3, trashedUnread: 3 });

    const personal = new PersonalStore(db, priority);
    await personal.setSenderPriority("news@shop.example", 1);
    expect((await repo.messages({ kind: "important" }, 50)).filter((m) => m.from.address === "news@shop.example")).toHaveLength(3);

    const overview = await personal.overview();
    expect(overview.events).toEqual({ open: 3, reply: 1, flag: 0, archive: 0, trash: 3 });
    expect(overview.style).toMatchObject({ analyzed: 2, greeting: "Liebe/r" });
    expect(overview.recipients).toEqual([{ address: "lena@freunde.example", form: "du", greetingLine: "Liebe Lena,", mails: 2 }]);
    expect(overview.senders.find((s) => s.address === "news@shop.example")?.stats.userPriority).toBe(1);
    expect(personal.replyStyle("Lena@Freunde.example").recipient?.form).toBe("du");
    expect(personal.replyStyle("fremd@example.test").recipient).toBeNull();

    await personal.forget();
    expect((await personal.overview()).events).toEqual({ open: 0, reply: 0, flag: 0, archive: 0, trash: 0 });
    expect(priority.stats("news@shop.example").userPriority).toBeNull();
  });
});

describe("Stilprofil (W8.4)", () => {
  it("liest Anrede, Gruß, Länge ohne Zitat", () => {
    expect(ownText("Hi Tom,\nok!\n\nAm 2. Sept. schrieb Tom:\n> Frage\n> mehr")).toBe("Hi Tom,\nok!");
    const style = analyzeStyle([
      "Hi Tom,\npasst, bis dann!\nVG Anna",
      "Hi Sara,\nich schaue es mir an.\nVG\nAnna",
      "Sehr geehrte Frau Weber,\nanbei die Unterlagen.\nMit freundlichen Grüßen\nAnna Schmidt",
    ]);
    expect(style).toMatchObject({ analyzed: 3, greeting: "Hi", closing: "VG", medianWords: 9 });
    expect(style.exclamationRate).toBeCloseTo(1 / 3, 5);
    const recipient = analyzeRecipient("weber@amt.example", ["Sehr geehrte Frau Weber, vielen Dank für Ihre Nachricht.\nMit freundlichen Grüßen"], (t) => addressForm(t));
    expect(recipient).toMatchObject({ form: "Sie", greetingLine: "Sehr geehrte Frau Weber," });
  });

  it("fließt in Antwortvorschläge ein: Anrede je Person, eigene Anrede-Art, Länge", () => {
    const profile = { analyzed: 10, greeting: "Moin", closing: "LG", medianWords: 20, emojiRate: 0, exclamationRate: 0 };
    const tom = { name: "Tom Krause", address: "tom@example.test" };
    expect(styledGreeting(tom, "du", undefined)).toBe("Hallo Tom,");
    expect(styledGreeting(tom, "du", { profile, recipient: null })).toBe("Moin Tom,");
    expect(styledGreeting(tom, "Sie", { profile, recipient: null })).toBe("Guten Tag Tom Krause,");
    expect(styledGreeting(tom, "du", { profile, recipient: { address: tom.address, form: "du", greetingLine: "Lieber Tom", mails: 3 } })).toBe("Lieber Tom,");
    expect(lengthHint(20)).toContain("sehr kurze");
    expect(lengthHint(200)).toContain("ausführlich");
    // Ohne Stilprofil bleibt der gemessene Prompt unverändert
    expect(repliesPrompt("x", "du", null)[0]?.content).toContain("- Jede Antwort 1 bis 3 kurze Sätze, auf Deutsch");
  });
});
