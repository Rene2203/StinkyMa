import { describe, expect, it } from "vitest";
import { InMemorySecretStore, passwordCandidates, SecretKeys, type Account } from "../src/index.js";
import { extractAttachmentText, extractLockedPdfText } from "../src/mail/attachmentText.js";
import { AttachmentService } from "../src/llm/index.js";
import { AttachmentStore, MailWriter, openDatabase, SqliteMailRepository } from "../src/sqlite/index.js";

// Testdaten erfunden. Das PDF ist mit AES-128 verschlüsselt (Passwort „Kunde4711“), erzeugt mit pypdf.
const lockedPdf = Buffer.from("JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgMyAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKMyAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDIgMCBSCi9NZWRpYUJveCBbIDAgMCA2MTIgNzkyIF0KL0NvbnRlbnRzIDQgMCBSCi9SZXNvdXJjZXMgPDwKL0ZvbnQgPDwKL0YxIDUgMCBSCj4+Cj4+Cj4+CmVuZG9iago0IDAgb2JqCjw8Ci9MZW5ndGggOTYKPj4Kc3RyZWFtChhxd8hbfQ5tpLfY/oPM9bWz2jYj4BT1JxoSYs+Llh10iz8UAE53Dk2ZTBq+HNo1TbkeDrwhr9OKFTahBtziMf74ITf7OK7zCgHcM+L3VBmzegAMAcEHTkYJK7Vp8UHzEgplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwKL1R5cGUgL0ZvbnQKL1N1YnR5cGUgL1R5cGUxCi9CYXNlRm9udCAvSGVsdmV0aWNhCj4+CmVuZG9iago2IDAgb2JqCjw8Ci9WIDQKL1IgNAovTGVuZ3RoIDEyOAovUCA0Mjk0OTY3MjkyCi9GaWx0ZXIgL1N0YW5kYXJkCi9PIDw5YThiN2JlZGZjOTIwMjQ0NjBjOGUyMjlmOWZiZGM2ZjA3OWZjY2I4ZDFmNGMyYjMxM2ViYTMzN2UxZmQ3OWRiPgovVSA8ZTJjY2QyMWFjODVlMmMzZmUyNDkzY2U3NTc1MTIyOGQyOGJmNGU1ZTRlNzU4YTQxNjQwMDRlNTZmZmZhMDEwOD4KL0NGIDw8Ci9TdGRDRiA8PAovQXV0aEV2ZW50IC9Eb2NPcGVuCi9DRk0gL0FFU1YyCi9MZW5ndGggMTYKPj4KPj4KL1N0bUYgL1N0ZENGCi9TdHJGIC9TdGRDRgo+PgplbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAwMDEyMyAwMDAwMCBuIAowMDAwMDAwMjUxIDAwMDAwIG4gCjAwMDAwMDAzOTcgMDAwMDAgbiAKMDAwMDAwMDQ2NyAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDcKL1Jvb3QgMSAwIFIKL0lEIFsgPDM3NjQzMzM3MzU2NTM1MzkzNjYzNjI2MTM0Mzk2NTMyMzkzOTYzNjM2MzM5NjY2NjM4NjU2MTMyMzQ2NTM4NjI+IDwzNzY0MzMzNzM1NjUzNTM5MzY2MzYyNjEzNDM5NjUzMjM5Mzk2MzYzNjMzOTY2NjYzODY1NjEzMjM0NjUzODYyPiBdCi9FbmNyeXB0IDYgMCBSCj4+CnN0YXJ0eHJlZgo3NzQKJSVFT0YK", "base64");

describe("Passwortgeschützte PDFs (W9.3)", () => {
  it("erkennt die Sperre beim Abgleich und liest mit dem richtigen Passwort", async () => {
    expect(await extractAttachmentText({ filename: "Police.pdf", mimeType: "application/pdf", content: lockedPdf })).toEqual({ locked: true });
    expect(await extractLockedPdfText(lockedPdf, "falsch")).toBeNull();
    expect((await extractLockedPdfText(lockedPdf, "Kunde4711"))?.text).toContain("VS-777888");
  });

  it("findet Passwort-Kandidaten in Mails", () => {
    expect(passwordCandidates(["Das Passwort für das Dokument lautet: Kunde4711.", "Ihr Kennwort erhalten Sie gesondert."])).toEqual(["Kunde4711"]);
    expect(passwordCandidates(["Das PDF ist mit Ihrer Kundennummer geschützt. Kundennummer: 8812345"])).toEqual(["8812345"]);
    expect(passwordCandidates(["PIN\n  4711-AB"])).toEqual(["4711-AB"]);
    expect(passwordCandidates(["Anbei Ihre Rechnung."])).toEqual([]);
  });

  it("entsperrt mit dem Passwort aus einer zweiten Mail, merkt es auf Wunsch und nimmt es beim nächsten Mal", async () => {
    const db = openDatabase(":memory:");
    const writer = new MailWriter(db);
    const account: Account = {
      id: "acc", email: "anna@example.test", displayName: "Anna", provider: "imap", username: "anna@example.test",
      imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
      authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0,
    };
    writer.insertAccount(account);
    writer.upsertMailbox({ id: "acc/inbox", accountId: "acc", name: "INBOX", role: "inbox" });
    const insurer = { name: "Versicherung", address: "service@versicherung.example" };
    const add = (uid: number, subject: string, body: string, date: string, attachments: { filename: string; mimeType: string; size: number }[]) =>
      writer.insertMessage({
        id: `acc/inbox#1:${uid}`, accountId: "acc", mailboxId: "acc/inbox", uid, messageId: `<v${uid}@example.test>`, threadId: `t${uid}`, threadSubject: subject,
        from: insurer, to: [{ name: "Anna", address: "anna@example.test" }], cc: [], subject, date, snippet: "", bodyText: body, bodyHtml: null, flags: 0,
        attachments: attachments.map((a) => ({ ...a, contentId: null, isInline: false })),
      });
    add(1, "Ihre Police", "Anbei Ihr Versicherungsschein. Das Passwort erhalten Sie in einer gesonderten Nachricht.", "2026-10-01T08:00:00.000Z", [{ filename: "Police.pdf", mimeType: "application/pdf", size: lockedPdf.length }]);
    add(2, "Passwort zu Ihrer Police", "Das Passwort für das Dokument lautet: Kunde4711", "2026-10-01T08:05:00.000Z", []);
    add(3, "Nachtrag", "Anbei der Nachtrag zur Police.", "2026-10-20T08:00:00.000Z", [{ filename: "Nachtrag.pdf", mimeType: "application/pdf", size: lockedPdf.length }]);
    writer.setAttachmentMeta("acc/inbox#1:1/a0", { encrypted: true });
    writer.setAttachmentMeta("acc/inbox#1:3/a0", { encrypted: true });

    const secrets = new InMemorySecretStore();
    const service = new AttachmentService({
      store: new AttachmentStore(db, () => "id"),
      secrets,
      content: async () => lockedPdf,
      openWithPassword: (content, password) => extractLockedPdfText(Buffer.from(content), password),
    });
    expect(await service.unlock("acc/inbox#1:1/a0", { remember: true })).toEqual({ unlocked: true, source: "mail", tried: 1 });
    expect(await secrets.get(SecretKeys.attachmentPassword("service@versicherung.example"))).toBe("Kunde4711");
    const repo = new SqliteMailRepository(db);
    expect((await repo.attachments("acc/inbox#1:1"))[0]).toMatchObject({ analysisStatus: "pending", pageCount: 1, isEncrypted: true });
    expect(await repo.search("VS-777888", { limit: 10 })).toHaveLength(1);
    // Später, ohne Passwort-Mail im Zeitraum: das gemerkte Passwort passt
    expect(await service.unlock("acc/inbox#1:3/a0")).toEqual({ unlocked: true, source: "remembered", tried: 1 });
    // Falsches eingegebenes Passwort
    expect(await service.unlock("acc/inbox#1:3/a0", { password: "nein" })).toEqual({ unlocked: false, source: null, tried: 1 });
  });
});
