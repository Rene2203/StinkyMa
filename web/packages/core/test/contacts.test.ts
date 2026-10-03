import { describe, expect, it } from "vitest";
import { medianHours, type Account } from "../src/index.js";
import { ContactStore, MailWriter, openDatabase } from "../src/sqlite/index.js";

// Testdaten erfunden.
describe("Absender-Steckbrief", () => {
  it("zählt Mails in beide Richtungen, Antwortzeiten, letzte Gespräche, offene Zusagen", async () => {
    const db = openDatabase(":memory:");
    const writer = new MailWriter(db);
    const account: Account = {
      id: "acc", email: "anna@example.test", displayName: "Anna", provider: "imap", username: "anna@example.test",
      imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
      authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0,
    };
    writer.insertAccount(account);
    writer.upsertMailbox({ id: "acc/inbox", accountId: "acc", name: "INBOX", role: "inbox" });
    writer.upsertMailbox({ id: "acc/sent", accountId: "acc", name: "Sent", role: "sent" });
    const thomas = { name: "Thomas Krüger", address: "Thomas@Agentur.example" };
    const anna = { name: "Anna", address: "anna@example.test" };
    let uid = 0;
    const add = (box: "inbox" | "sent", thread: string, subject: string, date: string) => {
      uid++;
      writer.insertMessage({
        id: `acc/${box}#1:${uid}`, accountId: "acc", mailboxId: `acc/${box}`, uid, messageId: `<c${uid}@example.test>`, threadId: thread, threadSubject: subject,
        from: box === "sent" ? anna : thomas, to: [box === "sent" ? thomas : anna], cc: [], subject, date, snippet: "", bodyText: "Text", bodyHtml: null, flags: 0, category: "work", attachments: [],
      });
    };
    add("inbox", "t1", "Angebot", "2026-09-01T08:00:00.000Z");
    add("sent", "t1", "Re: Angebot", "2026-09-01T10:00:00.000Z"); // ich: 2 h
    add("inbox", "t1", "Re: Angebot", "2026-09-02T10:00:00.000Z"); // er: 24 h
    add("sent", "t1", "Re: Angebot", "2026-09-02T14:00:00.000Z"); // ich: 4 h
    add("inbox", "t2", "Vertrag", "2026-09-20T08:00:00.000Z");
    db.prepare(
      `INSERT INTO promise (id, accountId, messageId, threadId, direction, counterpartName, counterpartAddress, text, quote, dueDate, dueStated, status, origin, mailSubject, mailDate, createdAt, updatedAt)
       VALUES ('p1', 'acc', NULL, 't2', 'theirs', 'Thomas', 'thomas@agentur.example', 'Vertrag schicken', 'q', '2026-10-05', 1, 'open', 'rules', 'Vertrag', '2026-09-20', 'x', 'x')`,
    ).run();
    const profile = await new ContactStore(db).profile("thomas@agentur.example");
    expect(profile).toMatchObject({
      name: "Thomas Krüger", domain: "agentur.example", received: 3, sent: 2, firstContact: "2026-09-01T08:00:00.000Z", lastContact: "2026-09-20T08:00:00.000Z",
      iReplyHours: 3, theyReplyHours: null, usualCategory: "work",
    });
    expect(profile.recent.map((r) => r.subject)).toEqual(["Vertrag", "Re: Angebot"]);
    expect(profile.promises).toEqual([{ id: "p1", direction: "theirs", text: "Vertrag schicken", dueDate: "2026-10-05" }]);
    expect(medianHours([3_600_000, 7_200_000, 36_000_000])).toBe(2);
  });
});
