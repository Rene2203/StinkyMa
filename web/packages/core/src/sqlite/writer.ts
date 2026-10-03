import type Database from "better-sqlite3";
import type { Account, EmailAddress, Mailbox, MessageCategory } from "../models.js";
import { accountFromRow, mailboxFromRow } from "./repository.js";

type Row = Record<string, unknown>;

export type PendingActionKind = "flag" | "move";

export interface PendingAction {
  id: number;
  accountId: string;
  messageId: string;
  kind: PendingActionKind;
  payload: Record<string, unknown>;
  attempts: number;
  lastError: string | null;
}

export interface DraftRow {
  id: string;
  accountId: string;
  mail: string;
  messageId: string;
  serverUid: number | null;
  serverMailboxId: string | null;
  deleted: number;
}

export interface OutboxRow {
  id: string;
  accountId: string;
  mail: string;
  raw: Buffer;
  messageId: string;
  sentAt: string | null;
  attempts: number;
}

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
  /** Abmelde-Angabe als JSON; '' = keine */
  listUnsubscribe?: string | null;
  attachments: { filename: string; mimeType: string; size: number; contentId: string | null; isInline: boolean; sha256?: string | null; riskFlags?: number }[];
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
             subject, date, snippet, bodyText, bodyHTML, flags, hasAttachments, category, listUnsubscribe)
           VALUES (@id, @accountId, @mailboxId, @uid, @messageId, @threadId, @fromName, @fromAddress, @to, @cc,
             @subject, @date, @snippet, @bodyText, @bodyHtml, @flags, @hasAttachments, @category, @listUnsubscribe)`,
        )
        .run({
          ...m,
          category: m.category ?? null,
          listUnsubscribe: m.listUnsubscribe ?? null,
          fromName: m.from.name ?? null,
          fromAddress: m.from.address,
          to: JSON.stringify(m.to),
          cc: JSON.stringify(m.cc),
          hasAttachments: m.attachments.some((a) => !a.isInline) ? 1 : 0,
        });
      if (inserted.changes === 0) return;
      const insertAttachment = this.db.prepare(
        `INSERT INTO attachment (id, messageId, filename, mimeType, size, isInline, contentId, sha256, riskFlags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      m.attachments.forEach((a, i) =>
        insertAttachment.run(`${m.id}/a${i}`, m.id, a.filename, a.mimeType, a.size, a.isInline ? 1 : 0, a.contentId, a.sha256 ?? null, a.riskFlags ?? 0),
      );
    });
  }

  /** Seitenzahl bzw. „gesperrt“ (passwortgeschütztes PDF), beim Textlesen festgestellt. */
  setAttachmentMeta(attachmentId: string, meta: { pageCount?: number | null; encrypted?: boolean }): void {
    if (meta.pageCount !== undefined) this.db.prepare("UPDATE attachment SET pageCount = ? WHERE id = ?").run(meta.pageCount, attachmentId);
    if (meta.encrypted) this.db.prepare("UPDATE attachment SET isEncrypted = 1, analysisStatus = 'locked' WHERE id = ?").run(attachmentId);
  }

  /** Text eines Anhangs für die Suche (vorhandener Text wird ersetzt). */
  setAttachmentText(attachmentId: string, text: string, source: string): void {
    this.db
      .prepare(
        `INSERT INTO attachmentText (attachmentId, text, source) VALUES (?, ?, ?)
         ON CONFLICT(attachmentId) DO UPDATE SET text = excluded.text, source = excluded.source`,
      )
      .run(attachmentId, text, source);
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

  /**
   * Zeitraum verkürzt: lokale Mails des Kontos vor `sinceIso` entfernen (auf dem Server bleiben sie). Entwürfe und Mails
   * mit noch nicht übertragenen Änderungen bleiben. Gibt die Anzahl zurück.
   */
  pruneOlderThan(accountId: string, sinceIso: string): number {
    let removed = 0;
    this.transaction(() => {
      removed = this.db
        .prepare(
          `DELETE FROM message WHERE accountId = ? AND date < ?
             AND mailboxId NOT IN (SELECT id FROM mailbox WHERE role = 'drafts')
             AND id NOT IN (SELECT messageId FROM pendingAction)`,
        )
        .run(accountId, sinceIso).changes;
      if (removed) this.deleteOrphanThreads();
    });
    return removed;
  }

  /** Nach einem Verschieben auf dem Server: Mail in den Zielordner mit neuer UID umhängen. */
  relocateMessage(id: string, target: { newId: string; mailboxId: string; uid: number | null }): void {
    this.transaction(() => {
      // Die neue ID ist aus Ordner + UID abgeleitet; Anhänge hängen per Fremdschlüssel an der alten ID.
      const row = this.db.prepare("SELECT * FROM message WHERE id = ?").get(id) as Row | undefined;
      if (!row) return;
      // Wartende Aktionen folgen der Mail auf ihre neue ID.
      this.db.prepare("UPDATE pendingAction SET messageId = ? WHERE messageId = ?").run(target.newId, id);
      this.db.prepare("UPDATE draft SET messageId = ? WHERE messageId = ?").run(target.newId, id);
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
      // Was per Fremdschlüssel an der Mail hängt, würde beim Löschen mitgelöscht – vorher sichern, danach umhängen.
      const attachmentTexts = this.db.prepare("SELECT * FROM attachmentText WHERE attachmentId IN (SELECT id FROM attachment WHERE messageId = ?)").all(id) as Row[];
      const analyses = this.db.prepare("SELECT * FROM attachmentAnalysis WHERE attachmentId IN (SELECT id FROM attachment WHERE messageId = ?)").all(id) as Row[];
      const actions = this.db.prepare("SELECT * FROM messageAction WHERE messageId = ?").all(id) as Row[];
      const scan = this.db.prepare("SELECT * FROM messageActionScan WHERE messageId = ?").get(id) as Row | undefined;
      const reminderIds = (this.db.prepare("SELECT id FROM reminder WHERE messageId = ?").all(id) as { id: string }[]).map((r) => r.id);
      const subscriptionMails = this.db.prepare("SELECT * FROM subscriptionMail WHERE messageId = ?").all(id) as Row[];
      const subscriptionScan = this.db.prepare("SELECT * FROM subscriptionScan WHERE messageId = ?").get(id) as Row | undefined;
      const subscriptionIds = (this.db.prepare("SELECT id FROM subscription WHERE sourceMessageId = ?").all(id) as { id: string }[]).map((r) => r.id);
      const receiptScan = this.db.prepare("SELECT * FROM receiptScan WHERE messageId = ?").get(id) as Row | undefined;
      const promiseScan = this.db.prepare("SELECT * FROM promiseScan WHERE messageId = ?").get(id) as Row | undefined;
      const embeddings = this.db.prepare("SELECT * FROM embedding WHERE messageId = ?").all(id) as Row[];
      const embeddingScan = this.db.prepare("SELECT * FROM embeddingScan WHERE messageId = ?").get(id) as Row | undefined;
      const eventIds = (this.db.prepare("SELECT id FROM behaviorEvent WHERE messageId = ?").all(id) as { id: number }[]).map((r) => r.id);
      this.db.prepare("DELETE FROM message WHERE id = ?").run(id);
      const columns = Object.keys(row).map((c) => `"${c}"`).join(", ");
      const params = Object.keys(row).map((c) => `@${c}`).join(", ");
      this.db.prepare(`INSERT INTO message (${columns}) VALUES (${params})`).run({
        ...row, id: target.newId, mailboxId: target.mailboxId, uid: target.uid,
      });
      // Alle Spalten mitnehmen (Prüfsumme, Relevanz, Status, Risiko …) – nur ID und Mail ändern sich
      const newAttachmentId = new Map<string, string>();
      attachments.forEach((a, i) => {
        const next: Row = { ...a, id: `${target.newId}/a${i}`, messageId: target.newId };
        const keys = Object.keys(next);
        this.db.prepare(`INSERT INTO attachment (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map((k) => `@${k}`).join(", ")})`).run(next);
        newAttachmentId.set(String(a.id), `${target.newId}/a${i}`);
      });
      const reinsert = (table: string, rows: Row[], change: (row: Row) => Row) => {
        for (const row of rows) {
          const next = change(row);
          const keys = Object.keys(next);
          this.db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map((k) => `@${k}`).join(", ")})`).run(next);
        }
      };
      reinsert("attachmentText", attachmentTexts.filter((r) => newAttachmentId.has(String(r.attachmentId))), (r) => ({ ...r, attachmentId: newAttachmentId.get(String(r.attachmentId)) }));
      reinsert("attachmentAnalysis", analyses.filter((r) => newAttachmentId.has(String(r.attachmentId))), (r) => ({ ...r, attachmentId: newAttachmentId.get(String(r.attachmentId)) }));
      reinsert("messageAction", actions, (r) => ({ ...r, messageId: target.newId }));
      if (scan) reinsert("messageActionScan", [scan], (r) => ({ ...r, messageId: target.newId }));
      for (const reminderId of reminderIds) this.db.prepare("UPDATE reminder SET messageId = ? WHERE id = ?").run(target.newId, reminderId);
      reinsert("subscriptionMail", subscriptionMails, (r) => ({ ...r, messageId: target.newId }));
      if (subscriptionScan) reinsert("subscriptionScan", [subscriptionScan], (r) => ({ ...r, messageId: target.newId }));
      for (const subscriptionId of subscriptionIds) this.db.prepare("UPDATE subscription SET sourceMessageId = ? WHERE id = ?").run(target.newId, subscriptionId);
      if (receiptScan) reinsert("receiptScan", [receiptScan], (r) => ({ ...r, messageId: target.newId }));
      this.db.prepare("UPDATE receipt SET messageId = ? WHERE messageId = ?").run(target.newId, id);
      if (promiseScan) reinsert("promiseScan", [promiseScan], (r) => ({ ...r, messageId: target.newId }));
      reinsert("embedding", embeddings, (r) => ({ ...r, messageId: target.newId }));
      if (embeddingScan) reinsert("embeddingScan", [embeddingScan], (r) => ({ ...r, messageId: target.newId }));
      this.db.prepare("UPDATE promise SET messageId = ? WHERE messageId = ?").run(target.newId, id);
      for (const eventId of eventIds) this.db.prepare("UPDATE behaviorEvent SET messageId = ? WHERE id = ?").run(target.newId, eventId);
      this.db.prepare("UPDATE promise SET followUpMessageId = ? WHERE followUpMessageId = ?").run(target.newId, id);
    });
  }

  // --- Warteschlange für Server-Aktionen ---

  enqueueAction(action: { accountId: string; messageId: string; kind: PendingActionKind; payload: unknown; createdAt: string }): void {
    this.db
      .prepare("INSERT INTO pendingAction (accountId, messageId, kind, payload, createdAt) VALUES (?, ?, ?, ?, ?)")
      .run(action.accountId, action.messageId, action.kind, JSON.stringify(action.payload), action.createdAt);
  }

  /** Liegt für diese Mail noch eine Änderung in der Warteschlange (noch nicht beim Server)? */
  hasPendingAction(accountId: string, messageId: string): boolean {
    return this.db.prepare("SELECT 1 FROM pendingAction WHERE accountId = ? AND messageId = ? LIMIT 1").get(accountId, messageId) !== undefined;
  }

  pendingActions(accountId: string): PendingAction[] {
    return (this.db.prepare("SELECT * FROM pendingAction WHERE accountId = ? ORDER BY id").all(accountId) as Row[]).map((r) => ({
      id: Number(r.id),
      accountId: String(r.accountId),
      messageId: String(r.messageId),
      kind: String(r.kind) as PendingActionKind,
      payload: JSON.parse(String(r.payload)) as Record<string, unknown>,
      attempts: Number(r.attempts),
      lastError: (r.lastError as string | null) ?? null,
    }));
  }

  pendingActionCount(accountId?: string): number {
    const row = (accountId
      ? this.db.prepare("SELECT COUNT(*) AS n FROM pendingAction WHERE accountId = ?").get(accountId)
      : this.db.prepare("SELECT COUNT(*) AS n FROM pendingAction").get()) as { n: number };
    return row.n;
  }

  completeAction(id: number): void {
    this.db.prepare("DELETE FROM pendingAction WHERE id = ?").run(id);
  }

  failAction(id: number, error: string): void {
    this.db.prepare("UPDATE pendingAction SET attempts = attempts + 1, lastError = ? WHERE id = ?").run(error, id);
  }

  /** Lokal sofort verschieben; die UID im Zielordner kennt erst der Server (bis dahin `NULL`). */
  moveLocally(messageId: string, mailboxId: string): void {
    this.db.prepare("UPDATE message SET mailboxId = ?, uid = NULL WHERE id = ?").run(mailboxId, messageId);
  }

  messageLocation(id: string): { accountId: string; mailboxId: string; uid: number | null; flags: number } | null {
    return (this.db.prepare("SELECT accountId, mailboxId, uid, flags FROM message WHERE id = ?").get(id) as
      | { accountId: string; mailboxId: string; uid: number | null; flags: number }
      | undefined) ?? null;
  }

  private deleteOrphanThreads(): void {
    this.db.prepare("DELETE FROM thread WHERE id NOT IN (SELECT DISTINCT threadId FROM message)").run();
  }

  // --- Entwürfe (Server-Abgleich) ---

  /** Entwürfe, die zum Server müssen (geändert oder gelöscht). */
  pendingDrafts(accountId: string): DraftRow[] {
    return this.db
      .prepare("SELECT id, accountId, mail, messageId, serverUid, serverMailboxId, deleted FROM draft WHERE accountId = ? AND (dirty = 1 OR deleted = 1) ORDER BY updatedAt")
      .all(accountId) as DraftRow[];
  }

  draftRevision(id: string): string | null {
    return (this.db.prepare("SELECT updatedAt FROM draft WHERE id = ?").get(id) as { updatedAt: string } | undefined)?.updatedAt ?? null;
  }

  /** Nach dem Hochladen: neue Server-Kopie merken – aber nur, wenn inzwischen nicht weiter geschrieben wurde. */
  markDraftUploaded(id: string, revision: string, server: { uid: number | null; mailboxId: string }): void {
    this.db
      .prepare("UPDATE draft SET serverUid = ?, serverMailboxId = ?, dirty = CASE WHEN updatedAt = ? THEN 0 ELSE 1 END WHERE id = ?")
      .run(server.uid, server.mailboxId, revision, id);
  }

  unlinkDraftMessage(id: string): void {
    this.db.prepare("UPDATE draft SET messageId = '' WHERE id = ?").run(id);
  }

  draftAccount(id: string): string | null {
    return (this.db.prepare("SELECT accountId FROM draft WHERE id = ?").get(id) as { accountId: string } | undefined)?.accountId ?? null;
  }

  removeDraftRow(id: string): void {
    this.db.prepare("DELETE FROM draft WHERE id = ?").run(id);
  }

  // --- Postausgang ---

  enqueueOutgoing(row: { id: string; accountId: string; mail: string; raw: Buffer; messageId: string; createdAt: string }): void {
    this.db
      .prepare("INSERT INTO outbox (id, accountId, mail, raw, messageId, createdAt) VALUES (@id, @accountId, @mail, @raw, @messageId, @createdAt)")
      .run(row);
  }

  /** Was noch zu tun ist: nicht gesendete (ohne endgültig abgelehnte) und gesendete, die noch in „Gesendet“ müssen. */
  pendingOutgoing(accountId: string): OutboxRow[] {
    return this.db
      .prepare("SELECT id, accountId, mail, raw, messageId, sentAt, attempts FROM outbox WHERE accountId = ? AND failed = 0 ORDER BY createdAt")
      .all(accountId) as OutboxRow[];
  }

  outgoingCount(accountId?: string): number {
    const row = accountId
      ? this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE accountId = ? AND failed = 0").get(accountId)
      : this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE failed = 0").get();
    return (row as { n: number }).n;
  }

  markOutgoingSent(id: string, sentAt: string): void {
    this.db.prepare("UPDATE outbox SET sentAt = ?, attempts = 0, lastError = NULL WHERE id = ?").run(sentAt, id);
  }

  noteOutgoingError(id: string, error: string, options: { failed?: boolean; countAttempt?: boolean } = {}): void {
    this.db
      .prepare("UPDATE outbox SET lastError = ?, failed = ?, attempts = attempts + ? WHERE id = ?")
      .run(error, options.failed ? 1 : 0, options.countAttempt ? 1 : 0, id);
  }

  completeOutgoing(id: string): void {
    this.db.prepare("DELETE FROM outbox WHERE id = ?").run(id);
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
