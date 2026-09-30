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
import type { MailRepository } from "../repository.js";

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
    provider: str(r.provider) as Account["provider"], imapHost: str(r.imapHost), imapPort: num(r.imapPort),
    smtpHost: str(r.smtpHost), smtpPort: num(r.smtpPort), authType: str(r.authType) as Account["authType"],
    color: str(r.color) as Account["color"], aiCloudAllowed: bool(r.aiCloudAllowed), sortOrder: num(r.sortOrder),
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
export function scopeCondition(scope: MessageScope): { sql: string; params: unknown[] } {
  switch (scope.kind) {
    case "unifiedInbox":
      return { sql: "mailbox.role = ?", params: ["inbox"] };
    case "unread":
      return { sql: "mailbox.role = ? AND (message.flags & ?) = 0", params: ["inbox", MessageFlag.seen] };
    case "flagged":
      return { sql: "mailbox.role <> ? AND (message.flags & ?) <> 0", params: ["trash", MessageFlag.flagged] };
    case "mailbox":
      return { sql: "message.mailboxId = ?", params: [scope.mailboxId] };
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
}
