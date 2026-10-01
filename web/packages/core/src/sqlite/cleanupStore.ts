import type Database from "better-sqlite3";
import { groupKey, protectReason, type CleanupGroup, type CleanupGroupBy, type CleanupGroupsQuery, type CleanupMail } from "../cleanup.js";
import { MessageFlag, type MessageCategory } from "../models.js";
import type { UnsubscribeMethod } from "../unsubscribe.js";
import { archiveDuplicate } from "./repository.js";

type Row = Record<string, unknown>;

/** Ordner, in denen aufgeräumt wird. Papierkorb, Spam, Gesendet und Entwürfe bleiben außen vor. */
const cleanupWhere = `mailbox.role IN ('inbox', 'archive', 'custom') AND NOT ${archiveDuplicate}`;

const columns = `message.id, message.accountId, message.fromName, message.fromAddress, message.subject, message.date, message.flags,
  message.category, message.hasAttachments, substr(COALESCE(message.bodyText, message.snippet), 1, 3000) AS body,
  EXISTS (SELECT 1 FROM messageAction a WHERE a.messageId = message.id AND a.status = 'open') AS openAction`;

function mailFromRow(r: Row): CleanupMail {
  const flags = Number(r.flags);
  const category = r.category ? (String(r.category) as MessageCategory) : null;
  return {
    id: String(r.id),
    accountId: String(r.accountId),
    from: { name: r.fromName ? String(r.fromName) : null, address: String(r.fromAddress) },
    subject: String(r.subject),
    date: String(r.date),
    unread: (flags & MessageFlag.seen) === 0,
    category,
    protect: protectReason({
      subject: String(r.subject),
      body: String(r.body ?? ""),
      category,
      flagged: (flags & MessageFlag.flagged) !== 0,
      answered: (flags & MessageFlag.answered) !== 0,
      hasAttachments: Number(r.hasAttachments) !== 0,
      hasOpenAction: Number(r.openAction) !== 0,
    }),
  };
}

/** Abfragen für das Aufräumen. Läuft in einem Durchgang über die Mails (auch bei zehntausenden ohne alles im Speicher). */
export class CleanupStore {
  constructor(private readonly db: Database.Database) {}

  groups(query: CleanupGroupsQuery): CleanupGroup[] {
    const groups = new Map<string, CleanupGroup & { names: Map<string, number>; addressSet: Set<string> }>();
    const rows = this.db
      .prepare(`SELECT ${columns} FROM message JOIN mailbox ON mailbox.id = message.mailboxId WHERE ${cleanupWhere} AND (@accountId IS NULL OR message.accountId = @accountId)`)
      .iterate({ accountId: query.accountId }) as IterableIterator<Row>;
    for (const row of rows) {
      const mail = mailFromRow(row);
      const key = groupKey(mail.from.address, query.groupBy);
      if (!key) continue;
      let group = groups.get(key);
      if (!group) {
        group = { key, groupBy: query.groupBy, name: null, count: 0, unread: 0, protectedCount: 0, uncategorized: 0, newest: mail.date, oldest: mail.date, addresses: 0, names: new Map(), addressSet: new Set() };
        groups.set(key, group);
      }
      group.count += 1;
      if (mail.unread) group.unread += 1;
      if (mail.protect) group.protectedCount += 1;
      if (!mail.category) group.uncategorized += 1;
      if (mail.date > group.newest) group.newest = mail.date;
      if (mail.date < group.oldest) group.oldest = mail.date;
      group.addressSet.add(mail.from.address.toLowerCase());
      const name = mail.from.name?.trim();
      if (name) group.names.set(name, (group.names.get(name) ?? 0) + 1);
    }
    return [...groups.values()]
      .filter((g) => g.count >= (query.minCount ?? 1))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, query.limit)
      .map(({ names, addressSet, ...group }) => ({
        ...group,
        addresses: addressSet.size,
        name: [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      }));
  }

  groupMails(key: string, groupBy: CleanupGroupBy, accountId: string | null, limit: number): CleanupMail[] {
    const k = key.toLowerCase();
    const match = groupBy === "address" ? "lower(message.fromAddress) = @k" : "(lower(message.fromAddress) LIKE '%@' || @k OR lower(message.fromAddress) LIKE '%.' || @k)";
    const rows = this.db
      .prepare(
        `SELECT ${columns} FROM message JOIN mailbox ON mailbox.id = message.mailboxId
         WHERE ${cleanupWhere} AND ${match} AND (@accountId IS NULL OR message.accountId = @accountId)
         ORDER BY message.date DESC`,
      )
      .all({ k, accountId }) as Row[];
    // LIKE trifft auch fremde Domains mit gleicher Endung („shop.co.uk“ bei „co.uk“) – genau prüfen
    return rows.map(mailFromRow).filter((m) => groupKey(m.from.address, groupBy) === k).slice(0, limit);
  }

  /** Abmelde-Angabe einer Mail: `raw` null = noch nicht gelesen, '' = keine. */
  unsubscribeSource(messageId: string): { accountId: string; sender: string; category: MessageCategory | null; raw: string | null } | null {
    const row = this.db.prepare("SELECT accountId, fromAddress, category, listUnsubscribe FROM message WHERE id = ?").get(messageId) as Row | undefined;
    if (!row) return null;
    return {
      accountId: String(row.accountId),
      sender: String(row.fromAddress).toLowerCase(),
      category: row.category ? (String(row.category) as MessageCategory) : null,
      raw: row.listUnsubscribe === null || row.listUnsubscribe === undefined ? null : String(row.listUnsubscribe),
    };
  }

  setListUnsubscribe(messageId: string, json: string): void {
    this.db.prepare("UPDATE message SET listUnsubscribe = ? WHERE id = ?").run(json, messageId);
  }

  unsubscribed(address: string): { method: UnsubscribeMethod; at: string } | null {
    const row = this.db.prepare("SELECT method, requestedAt FROM unsubscribed WHERE address = ?").get(address.toLowerCase()) as Row | undefined;
    return row ? { method: String(row.method) as UnsubscribeMethod, at: String(row.requestedAt) } : null;
  }

  markUnsubscribed(address: string, method: UnsubscribeMethod, at: string): void {
    this.db
      .prepare("INSERT INTO unsubscribed (address, method, requestedAt) VALUES (?, ?, ?) ON CONFLICT(address) DO UPDATE SET method = excluded.method, requestedAt = excluded.requestedAt")
      .run(address.toLowerCase(), method, at);
  }
}
