import type Database from "better-sqlite3";
import type {
  Account,
  Attachment,
  EmailAddress,
  Mailbox,
  MailboxRole,
  Message,
  MessageCategory,
  MessageFlagName,
  MessageScope,
} from "../models.js";
import { MessageFlag, mailboxRoleRank } from "../models.js";
import type { MailOverview, MailRepository, UnreadCounts } from "../repository.js";
import { requireRemoteContentException } from "../remoteContent.js";
import { ftsExpression, ftsFromExpression, ftsTermsExpression, isEmptySearch, parseSearchQuery } from "../search.js";
import { normalizeSignature, draftFromMessage, formatAddressList, localDraftMessage, localSentMessage, rankContacts, type ComposeDraft, type ContactUsage, type OutgoingMail } from "../compose.js";
import type { OutboxItem } from "../repository.js";

type Row = Record<string, unknown>;

const str = (v: unknown) => v as string;
const optStr = (v: unknown) => (v ?? null) as string | null;
const num = (v: unknown) => Number(v);
const optNum = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown) => Number(v) !== 0;
const json = <T>(v: unknown) => JSON.parse(v as string) as T;

export function accountFromRow(r: Row): Account {
  return {
    id: str(r.id), email: str(r.email), displayName: str(r.displayName),
    provider: str(r.provider) as Account["provider"], username: str(r.username) || str(r.email),
    imapHost: str(r.imapHost), imapPort: num(r.imapPort), imapSecurity: str(r.imapSecurity) as Account["imapSecurity"],
    smtpHost: str(r.smtpHost), smtpPort: num(r.smtpPort), smtpSecurity: str(r.smtpSecurity) as Account["smtpSecurity"],
    authType: str(r.authType) as Account["authType"], color: str(r.color) as Account["color"],
    aiCloudAllowed: bool(r.aiCloudAllowed), sortOrder: num(r.sortOrder), screener: bool(r.screener),
    lastSyncAt: optStr(r.lastSyncAt), syncError: optStr(r.syncError), signatureHtml: optStr(r.signatureHtml),
  };
}

export function mailboxFromRow(r: Row): Mailbox {
  return {
    id: str(r.id), accountId: str(r.accountId), name: str(r.name), role: str(r.role) as MailboxRole,
    uidValidity: optNum(r.uidValidity), highestModSeq: optNum(r.highestModSeq),
  };
}

export function messageFromRow(r: Row): Message {
  return {
    id: str(r.id), accountId: str(r.accountId), mailboxId: str(r.mailboxId), uid: optNum(r.uid),
    messageId: optStr(r.messageId), threadId: str(r.threadId),
    from: { name: optStr(r.fromName), address: str(r.fromAddress) },
    to: json<EmailAddress[]>(r.to), cc: json<EmailAddress[]>(r.cc),
    subject: str(r.subject), date: str(r.date), snippet: str(r.snippet),
    bodyText: optStr(r.bodyText), bodyHtml: optStr(r.bodyHTML), flags: num(r.flags),
    hasAttachments: bool(r.hasAttachments), category: optStr(r.category) as MessageCategory | null,
    priorityScore: optNum(r.priorityScore), snoozedUntil: optStr(r.snoozedUntil),
  };
}

export function attachmentFromRow(r: Row): Attachment {
  return {
    id: str(r.id), messageId: str(r.messageId), filename: str(r.filename), mimeType: str(r.mimeType),
    size: num(r.size), localPath: optStr(r.localPath), sha256: optStr(r.sha256), isInline: bool(r.isInline),
    contentId: optStr(r.contentId), pageCount: optNum(r.pageCount), isEncrypted: bool(r.isEncrypted),
    relevance: optStr(r.relevance) as Attachment["relevance"], relevanceReason: optStr(r.relevanceReason),
    documentType: optStr(r.documentType), analysisStatus: str(r.analysisStatus) as Attachment["analysisStatus"],
    riskFlags: num(r.riskFlags),
  };
}

/** Bedingung auf `message` (verbunden mit `mailbox`) für einen Bereich. */
/**
 * Kopie im Archiv, die es auch in einem normalen Ordner gibt (Gmail: „Alle Nachrichten“ enthält jede Mail
 * des Posteingangs) – in „Markiert“ nur einmal zählen und zeigen.
 */
const archiveDuplicate = `(mailbox.role = 'archive' AND message.messageId IS NOT NULL AND EXISTS (
  SELECT 1 FROM message other JOIN mailbox otherBox ON otherBox.id = other.mailboxId
   WHERE other.messageId = message.messageId AND other.accountId = message.accountId
     AND otherBox.role NOT IN ('archive', 'trash', 'spam')))`;

/** Absender blockiert (gilt immer) */
const blockedSender = `EXISTS (SELECT 1 FROM senderDecision d WHERE d.address = lower(message.fromAddress) AND d.decision = 'block')`;
/** Türsteher des Kontos an und Absender noch nicht erlaubt (auch nicht blockiert) */
const pendingSender = `(SELECT screener FROM account WHERE account.id = message.accountId) = 1
  AND NOT EXISTS (SELECT 1 FROM senderDecision d WHERE d.address = lower(message.fromAddress))`;
/** Posteingangs-Mail, die (noch) nicht im Posteingang erscheinen soll */
export const screenedOut = `(mailbox.role = 'inbox' AND (${blockedSender} OR (${pendingSender})))`;

export function scopeCondition(scope: MessageScope): { sql: string; params: unknown[] } {
  switch (scope.kind) {
    case "unifiedInbox":
      return { sql: `mailbox.role = ? AND NOT ${screenedOut}`, params: ["inbox"] };
    case "unread":
      return { sql: `mailbox.role = ? AND (message.flags & ?) = 0 AND NOT ${screenedOut}`, params: ["inbox", MessageFlag.seen] };
    case "flagged":
      return { sql: `mailbox.role <> ? AND (message.flags & ?) <> 0 AND NOT ${archiveDuplicate} AND NOT ${screenedOut}`, params: ["trash", MessageFlag.flagged] };
    case "mailbox":
      return { sql: `message.mailboxId = ? AND NOT ${screenedOut}`, params: [scope.mailboxId] };
    case "screener":
      return { sql: `mailbox.role = ? AND ${pendingSender}`, params: ["inbox"] };
  }
}

const placeholders = (count: number) => `(${Array.from({ length: count }, () => "?").join(", ")})`;

/** `MailRepository` auf Basis von SQLite (better-sqlite3). */
export class SqliteMailRepository implements MailRepository {
  constructor(private readonly db: Database.Database) {}

  async accounts(): Promise<Account[]> {
    return (this.db.prepare("SELECT * FROM account ORDER BY sortOrder, email").all() as Row[]).map(accountFromRow);
  }

  async mailboxes(accountId: string): Promise<Mailbox[]> {
    return (this.db.prepare("SELECT * FROM mailbox WHERE accountId = ?").all(accountId) as Row[])
      .map(mailboxFromRow)
      .sort((a, b) => mailboxRoleRank[a.role] - mailboxRoleRank[b.role] || a.name.localeCompare(b.name));
  }

  async messages(scope: MessageScope, limit: number): Promise<Message[]> {
    const { sql, params } = scopeCondition(scope);
    const rows = this.db
      .prepare(`SELECT message.* FROM message JOIN mailbox ON mailbox.id = message.mailboxId WHERE ${sql} ORDER BY message.date DESC LIMIT ?`)
      .all(...params, limit) as Row[];
    return rows.map(messageFromRow);
  }

  async thread(threadId: string): Promise<Message[]> {
    return (this.db.prepare("SELECT * FROM message WHERE threadId = ? ORDER BY date").all(threadId) as Row[]).map(messageFromRow);
  }

  async message(id: string): Promise<Message | null> {
    const row = this.db.prepare("SELECT * FROM message WHERE id = ?").get(id) as Row | undefined;
    return row ? messageFromRow(row) : null;
  }

  async attachments(messageId: string): Promise<Attachment[]> {
    return (this.db.prepare("SELECT * FROM attachment WHERE messageId = ? ORDER BY filename").all(messageId) as Row[]).map(
      attachmentFromRow,
    );
  }

  async unreadCount(scope: MessageScope): Promise<number> {
    const { sql, params } = scopeCondition(scope);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM message JOIN mailbox ON mailbox.id = message.mailboxId WHERE ${sql} AND (message.flags & ?) = 0`)
      .get(...params, MessageFlag.seen) as { n: number };
    return row.n;
  }

  async overview(): Promise<MailOverview> {
    const accounts = await this.accounts();
    const allMailboxes = (this.db.prepare("SELECT * FROM mailbox").all() as Row[]).map(mailboxFromRow);
    const mailboxesByAccount: Record<string, Mailbox[]> = {};
    for (const account of accounts) {
      mailboxesByAccount[account.id] = allMailboxes
        .filter((m) => m.accountId === account.id)
        .sort((a, b) => mailboxRoleRank[a.role] - mailboxRoleRank[b.role] || a.name.localeCompare(b.name));
    }
    const rows = this.db
      .prepare(
        `SELECT message.mailboxId AS mailboxId, mailbox.role AS role,
                SUM(CASE WHEN (message.flags & @seen) = 0 AND NOT ${screenedOut} THEN 1 ELSE 0 END) AS unread,
                SUM(CASE WHEN (message.flags & @seen) = 0 AND (message.flags & @flagged) <> 0 AND NOT ${archiveDuplicate} AND NOT ${screenedOut} THEN 1 ELSE 0 END) AS flaggedUnread
         FROM message JOIN mailbox ON mailbox.id = message.mailboxId
         GROUP BY message.mailboxId`,
      )
      .all({ seen: MessageFlag.seen, flagged: MessageFlag.flagged }) as { mailboxId: string; role: string; unread: number; flaggedUnread: number }[];
    const screener = (this.db.prepare(`SELECT COUNT(*) AS n FROM message JOIN mailbox ON mailbox.id = message.mailboxId WHERE mailbox.role = 'inbox' AND ${pendingSender}`).get() as { n: number }).n;
    const counts: UnreadCounts = { unifiedInbox: 0, unread: 0, flagged: 0, mailboxes: {}, screener };
    for (const r of rows) {
      if (r.unread > 0) counts.mailboxes[r.mailboxId] = r.unread;
      if (r.role === "inbox") {
        counts.unifiedInbox += r.unread;
        counts.unread += r.unread;
      }
      if (r.role !== "trash") counts.flagged += r.flaggedUnread;
    }
    return { accounts, mailboxesByAccount, counts, outbox: this.outbox() };
  }

  async setScreener(accountId: string, enabled: boolean): Promise<void> {
    this.db.transaction(() => {
      this.db.prepare("UPDATE account SET screener = ? WHERE id = ?").run(enabled ? 1 : 0, accountId);
      if (!enabled) return;
      // Bisherige Absender, Empfänger eigener Mails und die eigene Adresse gelten als bekannt
      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT OR IGNORE INTO senderDecision (address, decision, decidedAt)
           SELECT DISTINCT lower(fromAddress), 'allow', ? FROM message WHERE accountId = ?
           UNION SELECT DISTINCT lower(json_extract(r.value, '$.address')), 'allow', ? FROM message JOIN mailbox ON mailbox.id = message.mailboxId, json_each(message."to") AS r
             WHERE message.accountId = ? AND mailbox.role = 'sent'
           UNION SELECT lower(email), 'allow', ? FROM account WHERE id = ?`,
        )
        .run(now, accountId, now, accountId, now, accountId);
    })();
  }

  async decideSender(address: string, decision: "allow" | "block"): Promise<void> {
    const normalized = address.trim().toLowerCase();
    if (!normalized.includes("@")) throw new Error("Ungültige Absenderadresse.");
    this.db
      .prepare(
        `INSERT INTO senderDecision (address, decision, decidedAt) VALUES (?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET decision = excluded.decision, decidedAt = excluded.decidedAt`,
      )
      .run(normalized, decision, new Date().toISOString());
  }

  /** Posteingangs-Mails eines Absenders (für „Blockieren“ → in den Spam-Ordner). */
  inboxMessageIdsFrom(address: string): string[] {
    return (
      this.db
        .prepare("SELECT message.id AS id FROM message JOIN mailbox ON mailbox.id = message.mailboxId WHERE mailbox.role = 'inbox' AND lower(message.fromAddress) = ?")
        .all(address.trim().toLowerCase()) as { id: string }[]
    ).map((r) => r.id);
  }

  /** Empfänger eigener Mails gelten als bekannt (nur wenn noch keine Entscheidung vorliegt). */
  allowRecipients(addresses: string[]): void {
    const insert = this.db.prepare("INSERT OR IGNORE INTO senderDecision (address, decision, decidedAt) VALUES (?, 'allow', ?)");
    const now = new Date().toISOString();
    for (const address of addresses) if (address.includes("@")) insert.run(address.trim().toLowerCase(), now);
  }

  async setFlag(flag: MessageFlagName, enabled: boolean, messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    const operation = enabled ? "flags | ?" : "flags & ~?";
    this.db
      .prepare(`UPDATE message SET flags = ${operation} WHERE id IN ${placeholders(messageIds.length)}`)
      .run(MessageFlag[flag], ...messageIds);
  }

  async move(messageIds: string[], role: MailboxRole): Promise<void> {
    if (messageIds.length === 0) return;
    this.db
      .prepare(
        `UPDATE message SET mailboxId = target.id
         FROM (SELECT id, accountId FROM mailbox WHERE role = ?) AS target
         WHERE target.accountId = message.accountId AND message.id IN ${placeholders(messageIds.length)}`,
      )
      .run(role, ...messageIds);
  }

  async remoteContentExceptions(): Promise<string[]> {
    return (this.db.prepare("SELECT pattern FROM remoteContentException ORDER BY pattern").all() as { pattern: string }[]).map(
      (r) => r.pattern,
    );
  }

  async addRemoteContentException(input: string): Promise<string> {
    const exception = requireRemoteContentException(input);
    this.db
      .prepare("INSERT OR IGNORE INTO remoteContentException (pattern, createdAt) VALUES (?, ?)")
      .run(exception, new Date().toISOString());
    return exception;
  }

  async removeRemoteContentException(exception: string): Promise<void> {
    this.db.prepare("DELETE FROM remoteContentException WHERE pattern = ?").run(exception);
  }

  /** Postausgang zur Anzeige: nur noch nicht gesendete Mails (bereits angenommene warten nur auf die Ablage). */
  outbox(): OutboxItem[] {
    const rows = this.db
      .prepare("SELECT id, accountId, mail, createdAt, lastError, failed FROM outbox WHERE sentAt IS NULL ORDER BY createdAt")
      .all() as { id: string; accountId: string; mail: string; createdAt: string; lastError: string | null; failed: number }[];
    return rows.map((r) => {
      const mail = JSON.parse(r.mail) as OutgoingMail;
      return {
        id: r.id,
        accountId: r.accountId,
        subject: mail.subject,
        to: formatAddressList([...mail.to, ...mail.cc, ...mail.bcc]),
        createdAt: r.createdAt,
        status: r.failed ? "failed" : "queued",
        error: r.lastError,
      };
    });
  }

  /** Ohne Server (Beispielkonten): Mail sofort lokal in „Gesendet“ ablegen. */
  async send(mail: OutgoingMail): Promise<void> {
    const account = (await this.accounts()).find((a) => a.id === mail.accountId);
    const sent = account ? (await this.mailboxes(account.id)).find((m) => m.role === "sent") : undefined;
    if (!account || !sent) throw new Error("Für dieses Konto gibt es keinen Ordner „Gesendet“.");
    const original = mail.answeredMessageId ? await this.message(mail.answeredMessageId) : null;
    const id = `local-${globalThis.crypto.randomUUID()}`;
    const message = localSentMessage(mail, {
      id,
      mailboxId: sent.id,
      from: { name: account.displayName, address: account.email },
      threadId: original?.threadId ?? `thread-${id}`,
      date: new Date().toISOString(),
      messageId: `<${id}@stinkyma.local>`,
    });
    this.db.transaction(() => {
      this.#insertLocalMessage(message, mail);
      if (original) this.db.prepare("UPDATE message SET flags = flags | ? WHERE id = ?").run(MessageFlag.answered, original.id);
    })();
    if (mail.draftId) await this.deleteDraft(mail.draftId);
  }

  /** Lokale Mail (ohne Server-UID) samt Anhang-Metadaten einfügen; eine vorhandene Zeile mit gleicher ID wird ersetzt. */
  #insertLocalMessage(message: Message, mail: OutgoingMail): void {
    this.db.prepare("DELETE FROM message WHERE id = ?").run(message.id);
    this.db
      .prepare(
        `INSERT INTO thread (id, subject, participants, lastDate) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET lastDate = MAX(lastDate, excluded.lastDate), subject = excluded.subject`,
      )
      .run(message.threadId, message.subject, JSON.stringify([message.from, ...message.to]), message.date);
    this.db
      .prepare(
        `INSERT INTO message (id, accountId, mailboxId, uid, messageId, threadId, fromName, fromAddress, "to", cc,
           subject, date, snippet, bodyText, bodyHTML, flags, hasAttachments)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id, message.accountId, message.mailboxId, message.messageId, message.threadId,
        message.from.name ?? null, message.from.address, JSON.stringify(message.to), JSON.stringify(message.cc),
        message.subject, message.date, message.snippet, message.bodyText, message.bodyHtml ?? null, message.flags,
        message.hasAttachments ? 1 : 0,
      );
    const insertAttachment = this.db.prepare(
      "INSERT INTO attachment (id, messageId, filename, mimeType, size, isInline, contentId) VALUES (?, ?, ?, ?, ?, 0, NULL)",
    );
    (mail.attachments ?? []).forEach((a, i) => insertAttachment.run(`${message.id}/a${i}`, message.id, a.filename, a.mimeType, a.size));
  }

  async setSignature(accountId: string, html: string | null): Promise<void> {
    this.db.prepare("UPDATE account SET signatureHtml = ? WHERE id = ?").run(normalizeSignature(html), accountId);
  }

  // --- Suche ---

  async search(query: string, options: { scope?: MessageScope | null; limit: number }): Promise<Message[]> {
    const parsed = parseSearchQuery(query);
    if (isEmptySearch(parsed)) return [];
    let nextParam = 0;
    const scope = options.scope ? scopeCondition(options.scope) : { sql: "mailbox.role NOT IN ('trash', 'spam')", params: [] };
    // Treffer im Mailtext ODER im Text eines Anhangs (dort gelten die freien Begriffe, der Absender kommt von der Mail).
    const attachmentHits =
      parsed.terms.length === 0
        ? ""
        : `UNION
           SELECT attachment.messageId FROM attachmentFTS
             JOIN attachmentText ON attachmentText.rowid = attachmentFTS.rowid
             JOIN attachment ON attachment.id = attachmentText.attachmentId
            WHERE attachmentFTS MATCH @terms
              ${parsed.from.length ? "AND attachment.messageId IN (SELECT message.id FROM messageFTS JOIN message ON message.rowid = messageFTS.rowid WHERE messageFTS MATCH @from)" : ""}`;
    const rows = this.db
      .prepare(
        `WITH hits AS (
           SELECT message.id AS id FROM messageFTS JOIN message ON message.rowid = messageFTS.rowid WHERE messageFTS MATCH @all
           ${attachmentHits}
         )
         SELECT message.* FROM message
           JOIN mailbox ON mailbox.id = message.mailboxId
          WHERE message.id IN (SELECT id FROM hits) AND ${scope.sql.replace(/\?/g, () => "@p" + nextParam++)} AND NOT ${archiveDuplicate}
          ORDER BY message.date DESC
          LIMIT @limit`,
      )
      .all({
        all: ftsExpression(parsed),
        terms: ftsTermsExpression(parsed),
        from: ftsFromExpression(parsed),
        limit: options.limit,
        ...Object.fromEntries(scope.params.map((value, i) => [`p${i}`, value])),
      }) as Row[];
    return rows.map(messageFromRow);
  }

  // --- Adressvorschläge ---

  async suggestAddresses(query: string, limit: number): Promise<EmailAddress[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = this.db
      .prepare(
        `WITH people AS (
           SELECT lower(message.fromAddress) AS address, message.fromName AS name, message.date AS date, 0 AS sent
             FROM message JOIN mailbox ON mailbox.id = message.mailboxId
            WHERE mailbox.role NOT IN ('sent', 'drafts', 'trash', 'spam')
           UNION ALL
           SELECT lower(json_extract(r.value, '$.address')), json_extract(r.value, '$.name'), message.date, 1
             FROM message JOIN mailbox ON mailbox.id = message.mailboxId, json_each(message."to") AS r
            WHERE mailbox.role = 'sent'
           UNION ALL
           SELECT lower(json_extract(r.value, '$.address')), json_extract(r.value, '$.name'), message.date, 1
             FROM message JOIN mailbox ON mailbox.id = message.mailboxId, json_each(message.cc) AS r
            WHERE mailbox.role = 'sent'
         )
         SELECT address, name, MAX(date) AS last, SUM(sent) AS sent, COUNT(*) - SUM(sent) AS received
           FROM people
          WHERE address LIKE @like ESCAPE '\\' OR lower(coalesce(name, '')) LIKE @like ESCAPE '\\'
          GROUP BY address
          ORDER BY SUM(sent) * 5 + COUNT(*) DESC
          LIMIT 200`,
      )
      .all({ like }) as ContactUsage[];
    const own = (await this.accounts()).map((a) => a.email);
    return rankContacts(rows, { query: q, ownAddresses: own, limit });
  }

  // --- Entwürfe ---

  async saveDraft(draftId: string | null, draft: ComposeDraft): Promise<string> {
    const account = (await this.accounts()).find((a) => a.id === draft.accountId);
    if (!account) throw new Error("Konto nicht gefunden.");
    const box = (await this.mailboxes(account.id)).find((m) => m.role === "drafts");
    const now = new Date().toISOString();
    const id = draftId ?? globalThis.crypto.randomUUID();
    const existing = this.db.prepare("SELECT accountId, messageId FROM draft WHERE id = ?").get(id) as { accountId: string; messageId: string } | undefined;
    const stored: ComposeDraft = { ...draft, draftId: id };
    this.db.transaction(() => {
      // Konto gewechselt: alte lokale Zeile weg (die Server-Kopie im alten Konto bleibt – selten, bewusst einfach)
      let messageId = existing?.accountId === account.id ? existing.messageId : "";
      if (existing && existing.accountId !== account.id && existing.messageId) {
        this.db.prepare("DELETE FROM message WHERE id = ?").run(existing.messageId);
      }
      if (box) {
        messageId ||= `local-draft-${id}`;
        this.#insertLocalMessage(
          localDraftMessage(stored, { id: messageId, mailboxId: box.id, from: { name: account.displayName, address: account.email }, date: now }),
          stored,
        );
      }
      if (existing) {
        this.db
          .prepare("UPDATE draft SET accountId = ?, mail = ?, messageId = ?, updatedAt = ?, dirty = 1 WHERE id = ?")
          .run(account.id, JSON.stringify(stored), messageId, now, id);
      } else {
        this.db
          .prepare("INSERT INTO draft (id, accountId, mail, messageId, updatedAt) VALUES (?, ?, ?, ?, ?)")
          .run(id, account.id, JSON.stringify(stored), messageId, now);
      }
    })();
    return id;
  }

  /** Löscht den Entwurf lokal; gibt es eine Server-Kopie, bleibt die Zeile als „gelöscht“, bis der Server folgt. */
  async deleteDraft(draftId: string): Promise<void> {
    this.db.transaction(() => {
      const row = this.db.prepare("SELECT messageId, serverUid FROM draft WHERE id = ?").get(draftId) as
        | { messageId: string; serverUid: number | null }
        | undefined;
      if (!row) return;
      if (row.messageId) this.db.prepare("DELETE FROM message WHERE id = ?").run(row.messageId);
      if (row.serverUid !== null) this.db.prepare("UPDATE draft SET deleted = 1, messageId = '' WHERE id = ?").run(draftId);
      else this.db.prepare("DELETE FROM draft WHERE id = ?").run(draftId);
    })();
  }

  async openDraft(messageId: string): Promise<ComposeDraft | null> {
    const row = this.db.prepare("SELECT id, mail FROM draft WHERE messageId = ? AND deleted = 0").get(messageId) as
      | { id: string; mail: string }
      | undefined;
    if (row) return { ...(JSON.parse(row.mail) as ComposeDraft), draftId: row.id };
    // Entwurf vom Server (z. B. auf dem iPhone angefangen): als Entwurf übernehmen, Server-Kopie merken.
    const message = await this.message(messageId);
    if (!message) return null;
    const box = (await this.mailboxes(message.accountId)).find((m) => m.id === message.mailboxId);
    if (box?.role !== "drafts") return null;
    const id = globalThis.crypto.randomUUID();
    const draft: ComposeDraft = { ...draftFromMessage(message), draftId: id };
    this.db
      .prepare("INSERT INTO draft (id, accountId, mail, messageId, serverUid, serverMailboxId, updatedAt, dirty) VALUES (?, ?, ?, ?, ?, ?, ?, 0)")
      .run(id, message.accountId, JSON.stringify(draft), message.id, message.uid ?? null, message.uid ? message.mailboxId : null, message.date);
    return draft;
  }

  /** Nimmt eine noch nicht angenommene Mail aus dem Postausgang und gibt die Composer-Eingaben zurück. */
  async reopenOutgoing(id: string): Promise<OutgoingMail | null> {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT mail FROM outbox WHERE id = ? AND sentAt IS NULL").get(id) as { mail: string } | undefined;
      if (!row) return null;
      this.db.prepare("DELETE FROM outbox WHERE id = ?").run(id);
      return JSON.parse(row.mail) as OutgoingMail;
    })();
  }
}
