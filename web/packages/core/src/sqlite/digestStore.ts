import type Database from "better-sqlite3";
import type { ActionType } from "../ai/actions.js";
import type { DigestAction, DigestMail } from "../digest.js";
import { MessageFlag, type MessageCategory } from "../models.js";
import { archiveDuplicate, screenedOut } from "./repository.js";

type Row = Record<string, unknown>;

const mailFromRow = (r: Row): DigestMail => ({
  messageId: String(r.id),
  from: { name: r.fromName ? String(r.fromName) : null, address: String(r.fromAddress) },
  subject: String(r.subject),
  date: String(r.date),
  category: r.category ? (String(r.category) as MessageCategory) : null,
});

/** Abfragen für den Tagesüberblick (W6.6). Nur Posteingang, ohne vom Türsteher Zurückgehaltenes. */
export class DigestStore {
  constructor(private readonly db: Database.Database) {}

  /** Ungelesene Posteingangs-Mails seit `sinceIso` (neueste zuerst). */
  unreadInbox(sinceIso: string, limit: number): DigestMail[] {
    return (
      this.db
        .prepare(
          `SELECT message.id, message.fromName, message.fromAddress, message.subject, message.date, message.category
           FROM message JOIN mailbox ON mailbox.id = message.mailboxId
           WHERE mailbox.role = 'inbox' AND (message.flags & ?) = 0 AND message.date >= ? AND NOT ${screenedOut}
           ORDER BY message.date DESC LIMIT ?`,
        )
        .all(MessageFlag.seen, sinceIso, limit) as Row[]
    ).map(mailFromRow);
  }

  /** Posteingangs-Mails seit `sinceIso`, für die noch keine Aktionen gesucht wurden (für die schnelle Regel-Suche). */
  unscannedInbox(sinceIso: string, limit: number): { id: string; subject: string; body: string; date: string; category: MessageCategory | null }[] {
    return (
      this.db
        .prepare(
          `SELECT message.id, message.subject, COALESCE(message.bodyText, message.snippet) AS body, message.date, message.category
           FROM message JOIN mailbox ON mailbox.id = message.mailboxId
           WHERE mailbox.role = 'inbox' AND message.date >= ? AND NOT ${screenedOut}
             AND NOT EXISTS (SELECT 1 FROM messageActionScan s WHERE s.messageId = message.id)
           ORDER BY message.date DESC LIMIT ?`,
        )
        .all(sinceIso, limit) as Row[]
    ).map((r) => ({ id: String(r.id), subject: String(r.subject), body: String(r.body ?? ""), date: String(r.date), category: r.category ? (String(r.category) as MessageCategory) : null }));
  }

  /** Offene Aktionen mit Datum zwischen `fromDay` und `toDay` (YYYY-MM-DD), nur aus Posteingang/Archiv/eigenen Ordnern. */
  openActions(fromDay: string, toDay: string, today: string, limit: number): DigestAction[] {
    return (
      this.db
        .prepare(
          `SELECT a.id AS actionId, a.messageId, a.type, a.title, a.date, a.time, a.amount, message.subject, message.fromName, message.fromAddress
           FROM messageAction a JOIN message ON message.id = a.messageId JOIN mailbox ON mailbox.id = message.mailboxId
           WHERE a.status = 'open' AND a.date >= ? AND a.date <= ? AND mailbox.role IN ('inbox', 'archive', 'custom') AND NOT ${screenedOut}
           ORDER BY a.date, a.time LIMIT ?`,
        )
        .all(fromDay, toDay, limit) as Row[]
    ).map((r) => ({
      actionId: String(r.actionId),
      messageId: String(r.messageId),
      type: String(r.type) as ActionType,
      title: String(r.title),
      date: String(r.date),
      time: r.time ? String(r.time) : null,
      amount: r.amount ? String(r.amount) : null,
      subject: String(r.subject),
      from: { name: r.fromName ? String(r.fromName) : null, address: String(r.fromAddress) },
      overdue: String(r.date) < today,
    }));
  }

  /**
   * Konversationen, in denen laut gespeicherter Zusammenfassung der Nutzer dran ist – nur wenn die Zusammenfassung zum
   * letzten Stand passt (keine neuere Mail) und die letzte Mail im Posteingang liegt und jünger als `sinceIso` ist.
   */
  waitingOnMe(sinceIso: string, limit: number): DigestMail[] {
    return (
      this.db
        .prepare(
          `SELECT message.id, message.fromName, message.fromAddress, message.subject, message.date, message.category
           FROM threadSummary s
           JOIN message ON message.id = (SELECT m.id FROM message m WHERE m.threadId = s.threadId ORDER BY m.date DESC LIMIT 1)
           JOIN mailbox ON mailbox.id = message.mailboxId
           WHERE s.waitingOn = 'me' AND message.date <= s.lastMessageDate AND message.date >= ? AND mailbox.role = 'inbox' AND NOT ${screenedOut}
           ORDER BY message.date DESC LIMIT ?`,
        )
        .all(sinceIso, limit) as Row[]
    ).map(mailFromRow);
  }

  flaggedCount(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM message JOIN mailbox ON mailbox.id = message.mailboxId
         WHERE mailbox.role NOT IN ('trash', 'spam') AND (message.flags & ?) <> 0 AND NOT ${archiveDuplicate}`,
      )
      .get(MessageFlag.flagged) as { n: number };
    return row.n;
  }
}
