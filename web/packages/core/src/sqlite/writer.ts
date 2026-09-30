import type Database from "better-sqlite3";
import type { Account, EmailAddress, Mailbox, MessageCategory } from "../models.js";
import { accountFromRow, mailboxFromRow } from "./repository.js";

type Row = Record<string, unknown>;

export interface NewMessage {
  id: string;
  accountId: string;
  mailboxId: string;
  uid: number;
  messageId: string | null;
  threadId: string;
  threadSubject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  date: string;
  snippet: string;
  bodyText: string | null;
  bodyHtml: string | null;
  flags: number;
  category?: MessageCategory | null;
  attachments: { filename: string; mimeType: string; size: number; contentId: string | null; isInline: boolean }[];
}

/** Schreibzugriffe für den Abgleich mit dem Mailserver. Alles synchron (better-sqlite3), Aufrufer bündelt in Transaktionen. */
export class MailWriter {
  constructor(private readonly db: Database.Database) {}

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // --- Konten ---

  account(id: string): Account | null {
    const row = this.db.prepare("SELECT * FROM account WHERE id = ?").get(id) as Row | undefined;
    return row ? accountFromRow(row) : null;
  }

  insertAccount(account: Account): void {
    this.db
      .prepare(
        `INSERT INTO account (id, email, displayName, provider, username, imapHost, imapPort, imapSecurity, smtpHost, smtpPort,
           smtpSecurity, authType, color, aiCloudAllowed, sortOrder, lastSyncAt, syncError)
         VALUES (@id, @email, @displayName, @provider, @username, @imapHost, @imapPort, @imapSecurity, @smtpHost, @smtpPort,
           @smtpSecurity, @authType, @color, @aiCloudAllowed, @sortOrder, @lastSyncAt, @syncError)`,
      )
      .run({ lastSyncAt: null, syncError: null, ...account, aiCloudAllowed: account.aiCloudAllowed ? 1 : 0 });
  }

  /** Löscht ein Konto samt Ordnern, Mails und Anhängen; verwaiste Threads werden aufgeräumt. */
  deleteAccount(id: string): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM account WHERE id = ?").run(id);
      this.deleteOrphanThreads();
    });
  }

  setSyncStatus(accountId: string, status: { lastSyncAt?: string; syncError: string | null }): void {
    if (status.lastSyncAt) {
      this.db.prepare("UPDATE account SET lastSyncAt = ?, syncError = ? WHERE id = ?").run(status.lastSyncAt, status.syncError, accountId);
    } else {
      this.db.prepare("UPDATE account SET syncError = ? WHERE id = ?").run(status.syncError, accountId);
    }
  }

  nextSortOrder(): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(sortOrder), -1) + 1 AS n FROM account").get() as { n: number };
    return row.n;
  }

  usedColors(): string[] {
    return (this.db.prepare("SELECT color FROM account").all() as { color: string }[]).map((r) => r.color);
  }

  // --- Ordner ---

  mailboxes(accountId: string): Mailbox[] {
    return (this.db.prepare("SELECT * FROM mailbox WHERE accountId = ?").all(accountId) as Row[]).map(mailboxFromRow);
  }

  upsertMailbox(mailbox: Mailbox): void {
    this.db
      .prepare(
        `INSERT INTO mailbox (id, accountId, name, role, uidValidity, highestModSeq)
         VALUES (@id, @accountId, @name, @role, @uidValidity, @highestModSeq)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role`,
      )
      .run({ uidValidity: null, highestModSeq: null, ...mailbox });
  }

  deleteMailbox(id: string): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM mailbox WHERE id = ?").run(id);
      this.deleteOrphanThreads();
    });
  }

  /** Neue UIDVALIDITY: alle lokalen Mails dieses Ordners sind ungültig (RFC 3501). */
  resetMailbox(id: string, uidValidity: number): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM message WHERE mailboxId = ?").run(id);
      this.db.prepare("UPDATE mailbox SET uidValidity = ?, highestModSeq = NULL WHERE id = ?").run(uidValidity, id);
      this.deleteOrphanThreads();
    });
  }

  // --- Mails ---

  /** UID → Flags aller lokal bekannten Mails eines Ordners. */
  knownMessages(mailboxId: string): Map<number, { id: string; flags: number; date: string }> {
    const rows = this.db.prepare("SELECT id, uid, flags, date FROM message WHERE mailboxId = ? AND uid IS NOT NULL").all(mailboxId) as {
      id: string; uid: number; flags: number; date: string;
    }[];
    return new Map(rows.map((r) => [r.uid, { id: r.id, flags: r.flags, date: r.date }]));
  }

  insertMessage(m: NewMessage): void {
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO thread (id, subject, participants, lastDate) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET lastDate = MAX(lastDate, excluded.lastDate)`,
        )
        .run(m.threadId, m.threadSubject, JSON.stringify(uniqueAddresses([m.from, ...m.to])), m.date);
      const inserted = this.db
        .prepare(
          `INSERT OR IGNORE INTO message (id, accountId, mailboxId, uid, messageId, threadId, fromName, fromAddress, "to", cc,
             subject, date, snippet, bodyText, bodyHTML, flags, hasAttachments, category)
           VALUES (@id, @accountId, @mailboxId, @uid, @messageId, @threadId, @fromName, @fromAddress, @to, @cc,
             @subject, @date, @snippet, @bodyText, @bodyHtml, @flags, @hasAttachments, @category)`,
        )
        .run({
          ...m,
          category: m.category ?? null,
          fromName: m.from.name ?? null,
          fromAddress: m.from.address,
          to: JSON.stringify(m.to),
          cc: JSON.stringify(m.cc),
          hasAttachments: m.attachments.some((a) => !a.isInline) ? 1 : 0,
        });
      if (inserted.changes === 0) return;
      const insertAttachment = this.db.prepare(
        `INSERT INTO attachment (id, messageId, filename, mimeType, size, isInline, contentId)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      m.attachments.forEach((a, i) =>
        insertAttachment.run(`${m.id}/a${i}`, m.id, a.filename, a.mimeType, a.size, a.isInline ? 1 : 0, a.contentId),
      );
    });
  }

  updateFlags(messageId: string, flags: number): void {
    this.db.prepare("UPDATE message SET flags = ? WHERE id = ?").run(flags, messageId);
  }

  deleteMessages(ids: string[]): void {
    if (ids.length === 0) return;
    this.transaction(() => {
      const del = this.db.prepare("DELETE FROM message WHERE id = ?");
      for (const id of ids) del.run(id);
      this.deleteOrphanThreads();
    });
  }

  /** Nach einem Verschieben auf dem Server: Mail in den Zielordner mit neuer UID umhängen. */
  relocateMessage(id: string, target: { newId: string; mailboxId: string; uid: number | null }): void {
    this.transaction(() => {
      // Die neue ID ist aus Ordner + UID abgeleitet; Anhänge hängen per Fremdschlüssel an der alten ID.
      const row = this.db.prepare("SELECT * FROM message WHERE id = ?").get(id) as Row | undefined;
      if (!row) return;
      if (target.newId === id) {
        this.db.prepare("UPDATE message SET mailboxId = ?, uid = ? WHERE id = ?").run(target.mailboxId, target.uid, id);
        return;
      }
      const existing = this.db.prepare("SELECT 1 FROM message WHERE id = ?").get(target.newId);
      if (existing) {
        // Zielordner wurde schon abgeglichen – alte Kopie entfernen.
        this.db.prepare("DELETE FROM message WHERE id = ?").run(id);
        return;
      }
      const attachments = this.db.prepare("SELECT * FROM attachment WHERE messageId = ?").all(id) as Row[];
      this.db.prepare("DELETE FROM message WHERE id = ?").run(id);
      const columns = Object.keys(row).map((c) => `"${c}"`).join(", ");
      const params = Object.keys(row).map((c) => `@${c}`).join(", ");
      this.db.prepare(`INSERT INTO message (${columns}) VALUES (${params})`).run({
        ...row, id: target.newId, mailboxId: target.mailboxId, uid: target.uid,
      });
      const insertAttachment = this.db.prepare(
        `INSERT INTO attachment (id, messageId, filename, mimeType, size, isInline, contentId, pageCount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      attachments.forEach((a, i) =>
        insertAttachment.run(`${target.newId}/a${i}`, target.newId, a.filename, a.mimeType, a.size, a.isInline, a.contentId, a.pageCount),
      );
    });
  }

  messageLocation(id: string): { accountId: string; mailboxId: string; uid: number | null; flags: number } | null {
    return (this.db.prepare("SELECT accountId, mailboxId, uid, flags FROM message WHERE id = ?").get(id) as
      | { accountId: string; mailboxId: string; uid: number | null; flags: number }
      | undefined) ?? null;
  }

  private deleteOrphanThreads(): void {
    this.db.prepare("DELETE FROM thread WHERE id NOT IN (SELECT DISTINCT threadId FROM message)").run();
  }
}

function uniqueAddresses(list: EmailAddress[]): EmailAddress[] {
  const seen = new Set<string>();
  return list.filter((a) => {
    const key = a.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
