import type Database from "better-sqlite3";
import type { ResultOrigin } from "../ai/tasks.js";
import type { Message, MessageCategory } from "../models.js";
import { messageFromRow } from "./repository.js";

type Row = Record<string, unknown>;

/** Gespeicherte Zusammenfassung einer Konversation. */
export interface StoredSummary {
  threadId: string;
  summary: string;
  openPoints: string[];
  waitingOn: "me" | "others" | "nobody";
  modelId: string;
  privacyClass: string;
  promptVersion: number;
  lastMessageDate: string;
  messageCount: number;
  createdAt: string;
}

/** KI-Ergebnisse in der Datenbank (Migration v9). */
export class AIResultStore {
  constructor(private readonly db: Database.Database) {}

  /** Mails im Posteingang ohne Kategorie, neueste zuerst (seit `sinceIso`). */
  uncategorized(limit: number, sinceIso: string): Message[] {
    return (
      this.db
        .prepare(
          `SELECT message.* FROM message JOIN mailbox ON mailbox.id = message.mailboxId
           WHERE message.category IS NULL AND mailbox.role = 'inbox' AND message.date >= ?
           ORDER BY message.date DESC LIMIT ?`,
        )
        .all(sinceIso, limit) as Row[]
    ).map(messageFromRow);
  }

  uncategorizedCount(sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM message JOIN mailbox ON mailbox.id = message.mailboxId
         WHERE message.category IS NULL AND mailbox.role = 'inbox' AND message.date >= ?`,
      )
      .get(sinceIso) as { n: number };
    return row.n;
  }

  setCategory(messageId: string, category: MessageCategory, origin: ResultOrigin | "user"): void {
    this.db.prepare("UPDATE message SET category = ?, categoryOrigin = ? WHERE id = ?").run(category, origin, messageId);
  }

  attachmentNames(messageId: string): string[] {
    return (this.db.prepare("SELECT filename FROM attachment WHERE messageId = ? AND isInline = 0 ORDER BY id").all(messageId) as { filename: string }[]).map((r) => r.filename);
  }

  summary(threadId: string): StoredSummary | null {
    const row = this.db.prepare("SELECT * FROM threadSummary WHERE threadId = ?").get(threadId) as Row | undefined;
    if (!row) return null;
    let openPoints: string[] = [];
    try {
      const parsed = JSON.parse(String(row.openPoints)) as unknown;
      if (Array.isArray(parsed)) openPoints = parsed.filter((p): p is string => typeof p === "string");
    } catch {
      openPoints = [];
    }
    const waitingOn = row.waitingOn === "me" || row.waitingOn === "others" ? row.waitingOn : "nobody";
    return {
      threadId,
      summary: String(row.summary),
      openPoints,
      waitingOn,
      modelId: String(row.modelId),
      privacyClass: String(row.privacyClass),
      promptVersion: Number(row.promptVersion),
      lastMessageDate: String(row.lastMessageDate),
      messageCount: Number(row.messageCount),
      createdAt: String(row.createdAt),
    };
  }

  saveSummary(summary: StoredSummary): void {
    this.db
      .prepare(
        `INSERT INTO threadSummary (threadId, summary, openPoints, waitingOn, modelId, privacyClass, promptVersion, lastMessageDate, messageCount, createdAt)
         VALUES (@threadId, @summary, @openPoints, @waitingOn, @modelId, @privacyClass, @promptVersion, @lastMessageDate, @messageCount, @createdAt)
         ON CONFLICT(threadId) DO UPDATE SET summary = excluded.summary, openPoints = excluded.openPoints, waitingOn = excluded.waitingOn,
           modelId = excluded.modelId, privacyClass = excluded.privacyClass, promptVersion = excluded.promptVersion,
           lastMessageDate = excluded.lastMessageDate, messageCount = excluded.messageCount, createdAt = excluded.createdAt`,
      )
      .run({ ...summary, openPoints: JSON.stringify(summary.openPoints) });
  }
}
