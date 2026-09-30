import { randomUUID } from "node:crypto";
import { ImapFlow } from "imapflow";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockData, InMemorySecretStore, isDemoAccount, isRead, SecretKeys } from "../src/index.js";
import { MailService, type AccountSettings } from "../src/mail/index.js";
import { MailWriter, openDatabase, seedIfEmpty, SqliteMailRepository } from "../src/sqlite/index.js";
import { sampleReply } from "./fixtures.js";

// Läuft gegen einen lokalen GreenMail-Testserver (nie gegen echte Konten):
//   java -Dgreenmail.setup.test.all -Dgreenmail.auth.disabled -jar greenmail-standalone.jar
//   GREENMAIL_IMAP_PORT=3143 npx vitest run
// Ohne GREENMAIL_IMAP_PORT werden diese Tests übersprungen (z. B. in der Windows-CI).
const port = Number(process.env.GREENMAIL_IMAP_PORT ?? 0);
const host = process.env.GREENMAIL_HOST ?? "127.0.0.1";

const now = new Date("2026-09-30T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

function rfc822(opts: { from: string; subject: string; date: Date; messageId: string; body: string; inReplyTo?: string }): string {
  return [
    `From: ${opts.from}`,
    "To: Anna Beispiel <anna@example.test>",
    `Subject: ${opts.subject}`,
    `Date: ${opts.date.toUTCString()}`,
    `Message-ID: ${opts.messageId}`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`, `References: ${opts.inReplyTo}`] : []),
    "Content-Type: text/plain; charset=utf-8",
    "",
    opts.body,
    "",
  ].join("\r\n");
}

describe.skipIf(!port)("IMAP-Abgleich gegen GreenMail", () => {
  let user: string;
  let admin: ImapFlow;
  let service: MailService;
  let repository: SqliteMailRepository;
  let secrets: InMemorySecretStore;
  let changes = 0;
  let db: ReturnType<typeof openDatabase>;

  const settings = (): AccountSettings => ({
    email: user, displayName: "Test", provider: "imap", username: user,
    imapHost: host, imapPort: port, imapSecurity: "none",
    smtpHost: host, smtpPort: 3025, smtpSecurity: "none",
  });

  beforeEach(async () => {
    user = `anna-${randomUUID().slice(0, 8)}@example.test`;
    admin = new ImapFlow({ host, port, secure: false, doSTARTTLS: false, auth: { user, pass: "geheim" }, logger: false });
    await admin.connect();
    await admin.mailboxCreate("Archiv");
    await admin.mailboxCreate("Papierkorb");
    const inbox = "INBOX";
    await admin.append(inbox, rfc822({ from: "Anna Beispiel <anna@example.test>", subject: "Angebot?", date: daysAgo(3), messageId: "<m0@example.test>", body: "Kannst du mir das Angebot schicken?" }), [], daysAgo(3));
    await admin.append(inbox, sampleReply, [], daysAgo(1));
    await admin.append(inbox, rfc822({ from: "Newsletter <news@shop.example>", subject: "Wochenangebote", date: daysAgo(2), messageId: "<n1@shop.example>", body: "Alles reduziert." }), ["\\Seen"], daysAgo(2));
    await admin.append(inbox, rfc822({ from: "Alt <alt@example.test>", subject: "Uralt", date: daysAgo(90), messageId: "<old@example.test>", body: "Sehr alt." }), [], daysAgo(90));

    db = openDatabase(":memory:");
    seedIfEmpty(db, createMockData(now));
    repository = new SqliteMailRepository(db);
    secrets = new InMemorySecretStore();
    changes = 0;
    service = new MailService(repository, new MailWriter(db), secrets, { now: () => now, onChange: () => { changes += 1; } });
  });

  afterEach(async () => {
    service.dispose();
    await admin.logout().catch(() => admin.close());
  });

  async function serverFlags(subject: string, mailbox = "INBOX"): Promise<string[] | undefined> {
    await admin.mailboxOpen(mailbox);
    for await (const msg of admin.fetch("1:*", { flags: true, envelope: true })) {
      if (msg.envelope?.subject === subject) return [...(msg.flags ?? [])];
    }
    return undefined;
  }

  async function addAndSync() {
    const account = await service.addAccount(settings(), "geheim", { removeDemoAccounts: true });
    await service.syncNow();
    return account;
  }

  it("Konto hinzufügen: Passwort sicher gespeichert, Beispielkonten entfernt", async () => {
    const account = await addAndSync();
    const accounts = await service.accounts();
    expect(accounts.map((a) => a.id)).toEqual([account.id]);
    expect(accounts.some(isDemoAccount)).toBe(false);
    expect(await secrets.get(SecretKeys.accountPassword(account.id))).toBe("geheim");
    expect(accounts[0]?.lastSyncAt).toBe(now.toISOString());
    expect(accounts[0]?.syncError).toBeNull();
    expect(changes).toBeGreaterThan(0);
  });

  it("gleicht Ordner, Mails der letzten 30 Tage und Konversationen ab", async () => {
    const account = await addAndSync();
    const boxes = await service.mailboxes(account.id);
    expect(boxes.map((b) => b.role).sort()).toEqual(["archive", "inbox", "trash"]);

    const inbox = await service.messages({ kind: "unifiedInbox" }, 100);
    expect(inbox.map((m) => m.subject).sort()).toEqual(["Angebot?", "Grüße aus München", "Wochenangebote"]);
    expect(inbox.some((m) => m.subject === "Uralt")).toBe(false);

    const reply = inbox.find((m) => m.subject === "Grüße aus München")!;
    expect(reply.hasAttachments).toBe(true);
    expect(reply.bodyHtml).toContain("<b>Angebot</b>");
    expect((await service.attachments(reply.id)).map((a) => a.filename)).toEqual(["Angebot.pdf"]);
    const thread = await service.thread(reply.threadId);
    expect(thread.map((m) => m.subject)).toEqual(["Angebot?", "Grüße aus München"]);

    expect(isRead(inbox.find((m) => m.subject === "Wochenangebote")!)).toBe(true);
    expect(await service.unreadCount({ kind: "unifiedInbox" })).toBe(2);
  });

  it("zweiter Abgleich holt nichts doppelt und übernimmt Änderungen vom Server", async () => {
    const account = await addAndSync();
    const first = await service.messages({ kind: "unifiedInbox" }, 100);

    // Auf dem Server: eine Mail gelesen, eine gelöscht, eine neue
    await admin.mailboxOpen("INBOX");
    const all = await admin.search({ all: true }, { uid: true });
    const uids = (all || []).sort((a, b) => a - b);
    await admin.messageFlagsAdd(String(uids[0]), ["\\Seen"], { uid: true });
    await admin.messageDelete(String(uids[2]), { uid: true });
    await admin.append("INBOX", rfc822({ from: "Neu <neu@example.test>", subject: "Neu", date: daysAgo(0), messageId: "<neu@example.test>", body: "Hallo" }), [], daysAgo(0));

    const result = await service.syncAccountNow(account.id);
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.flagsChanged).toBe(1);
    const second = await service.messages({ kind: "unifiedInbox" }, 100);
    expect(second).toHaveLength(first.length); // −1 gelöscht, +1 neu
    expect(second.some((m) => m.subject === "Neu")).toBe(true);
  });

  it("Aktionen wirken sofort lokal und gehen über die Warteschlange zum Server", async () => {
    await addAndSync();
    const inbox = await service.messages({ kind: "unifiedInbox" }, 100);
    const target = inbox.find((m) => m.subject === "Grüße aus München")!;

    // Sofort lokal – ohne auf den Server zu warten
    await service.setFlag("seen", true, [target.id]);
    expect(isRead((await service.message(target.id))!)).toBe(true);
    expect((await service.overview()).counts.unifiedInbox).toBe(1);

    await service.move([target.id], "archive");
    const archivedLocal = await service.messages({ kind: "mailbox", mailboxId: `${target.accountId}/Archiv` }, 100);
    expect(archivedLocal.map((m) => m.subject)).toEqual(["Grüße aus München"]);
    expect((await service.messages({ kind: "unifiedInbox" }, 100)).some((m) => m.subject === "Grüße aus München")).toBe(false);

    // Dann auf dem Server
    await service.flushNow(target.accountId);
    expect(service.pendingChanges()).toBe(0);
    expect(await serverFlags("Grüße aus München", "Archiv")).toContain("\\Seen");
    const status = await admin.status("Archiv", { messages: true });
    expect(status && status.messages).toBe(1);

    // Nach erneutem Abgleich keine Dubletten, Anhänge bleiben
    await service.syncAccountNow(target.accountId);
    const archived = await service.messages({ kind: "mailbox", mailboxId: `${target.accountId}/Archiv` }, 100);
    expect(archived).toHaveLength(1);
    expect((await service.attachments(archived[0]!.id)).map((a) => a.filename)).toEqual(["Angebot.pdf"]);
  });

  it("offline: Änderungen bleiben in der Warteschlange und werden später übertragen", async () => {
    const account = await addAndSync();
    const inbox = await service.messages({ kind: "unifiedInbox" }, 100);
    const target = inbox.find((m) => m.subject === "Angebot?")!;

    // Server „weg“: offene Verbindung schließen, Port ins Leere zeigen lassen
    service.dispose();
    db.prepare("UPDATE account SET imapPort = 1 WHERE id = ?").run(account.id);
    service = new MailService(repository, new MailWriter(db), secrets, { now: () => now });

    await service.setFlag("flagged", true, [target.id]);
    expect(service.pendingChanges(account.id)).toBe(1);
    await expect(service.syncAccountNow(account.id)).rejects.toThrow();
    expect(service.pendingChanges(account.id)).toBe(1); // nichts verloren
    expect((await service.message(target.id))?.flags).toBe(target.flags | 4); // lokal weiterhin markiert

    // Server wieder da: der nächste Abruf überträgt zuerst die Warteschlange
    db.prepare("UPDATE account SET imapPort = ? WHERE id = ?").run(port, account.id);
    await service.syncAccountNow(account.id);
    expect(service.pendingChanges(account.id)).toBe(0);
    expect(await serverFlags("Angebot?")).toContain("\\Flagged");
    expect((await service.accounts())[0]?.syncError).toBeNull();
  });

  it("Warteschlange überlebt einen Neustart der App", async () => {
    const account = await addAndSync();
    const target = (await service.messages({ kind: "unifiedInbox" }, 100)).find((m) => m.subject === "Angebot?")!;
    service.dispose(); // App beendet, bevor übertragen wurde
    const restarted = new MailService(repository, new MailWriter(db), secrets, { now: () => now });
    // Aktion direkt in die Warteschlange (wie vor dem Beenden gespeichert)
    await restarted.setFlag("seen", true, [target.id]);
    restarted.dispose();
    const again = new MailService(repository, new MailWriter(db), secrets, { now: () => now });
    expect(again.pendingChanges(account.id)).toBe(1);
    await again.syncNow();
    expect(again.pendingChanges(account.id)).toBe(0);
    expect(await serverFlags("Angebot?")).toContain("\\Seen");
    again.dispose();
    service = again;
  });

  it("Konto entfernen löscht Mails und Passwort", async () => {
    const account = await addAndSync();
    await service.removeAccount(account.id);
    expect(await service.accounts()).toEqual([]);
    expect(await secrets.get(SecretKeys.accountPassword(account.id))).toBeNull();
    expect(await service.messages({ kind: "unifiedInbox" }, 100)).toEqual([]);
  });

  it("verständliche Fehlermeldung, wenn der Server nicht erreichbar ist", async () => {
    const result = await service.testConnection({ ...settings(), imapPort: 1 }, "geheim");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("abgelehnt") });
    await expect(service.addAccount({ ...settings(), imapPort: 1 }, "geheim", { removeDemoAccounts: true })).rejects.toThrow(/abgelehnt/);
    expect((await service.accounts()).every(isDemoAccount)).toBe(true); // nichts verändert
  });
});
