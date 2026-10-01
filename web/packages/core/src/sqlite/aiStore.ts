import type Database from "better-sqlite3";
import type { DocumentType } from "../ai/prompts.js";
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

/** Gespeichertes Leseergebnis eines Anhangs (Tabelle attachmentAnalysis). */
export interface StoredReading {
  attachmentId: string;
  documentType: DocumentType;
  title: string;
  summary: string;
  text: string;
  modelId: string;
  privacyClass: string;
  analyzedAt: string;
  durationMs: number;
}

/** Quelle im Suchindex für Text, den die KI aus Bildern gelesen hat. */
export const visionTextSource = "vision";

/** KI-Ergebnisse in der Datenbank (Migration v9; Anhang-Lesen in der Tabelle attachmentAnalysis aus v1). */
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

  /** Konto, Dateiname und Typ eines Anhangs (für Freigabe-Prüfung und Anzeige). */
  attachmentInfo(attachmentId: string): { accountId: string; filename: string; mimeType: string } | null {
    const row = this.db
      .prepare("SELECT message.accountId AS accountId, attachment.filename AS filename, attachment.mimeType AS mimeType FROM attachment JOIN message ON message.id = attachment.messageId WHERE attachment.id = ?")
      .get(attachmentId) as { accountId: string; filename: string; mimeType: string } | undefined;
    return row ?? null;
  }

  reading(attachmentId: string): StoredReading | null {
    const row = this.db.prepare("SELECT * FROM attachmentAnalysis WHERE attachmentId = ?").get(attachmentId) as Row | undefined;
    if (!row) return null;
    let extracted: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(String(row.extractedJSON ?? "{}")) as unknown;
      if (parsed && typeof parsed === "object") extracted = parsed as Record<string, unknown>;
    } catch {
      extracted = {};
    }
    return {
      attachmentId,
      documentType: (typeof extracted.documentType === "string" ? extracted.documentType : "other") as DocumentType,
      title: typeof extracted.title === "string" ? extracted.title : "",
      summary: String(row.summary ?? ""),
      text: typeof extracted.text === "string" ? extracted.text : "",
      modelId: String(row.modelId),
      privacyClass: String(row.privacyClass),
      analyzedAt: String(row.analyzedAt),
      durationMs: typeof extracted.durationMs === "number" ? extracted.durationMs : 0,
    };
  }

  /**
   * Speichert das Leseergebnis und macht den Text durchsuchbar. Text, den die App selbst aus einem PDF gelesen hat,
   * bleibt im Suchindex (er ist genauer); Bilder und Scans ohne Textebene bekommen den KI-Text.
   */
  saveReading(reading: StoredReading): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO attachmentAnalysis (attachmentId, summary, extractedJSON, modelId, privacyClass, analyzedAt)
           VALUES (@attachmentId, @summary, @extractedJSON, @modelId, @privacyClass, @analyzedAt)
           ON CONFLICT(attachmentId) DO UPDATE SET summary = excluded.summary, extractedJSON = excluded.extractedJSON,
             modelId = excluded.modelId, privacyClass = excluded.privacyClass, analyzedAt = excluded.analyzedAt`,
        )
        .run({
          attachmentId: reading.attachmentId,
          summary: reading.summary,
          extractedJSON: JSON.stringify({ documentType: reading.documentType, title: reading.title, text: reading.text, durationMs: reading.durationMs }),
          modelId: reading.modelId,
          privacyClass: reading.privacyClass,
          analyzedAt: reading.analyzedAt,
        });
      const existing = this.db.prepare("SELECT source, length(trim(text)) AS n FROM attachmentText WHERE attachmentId = ?").get(reading.attachmentId) as { source: string; n: number } | undefined;
      if (existing && existing.source !== visionTextSource && existing.n > 0) return;
      const searchable = [reading.title, reading.summary, reading.text].filter((part) => part.trim()).join("\n");
      this.db
        .prepare(
          `INSERT INTO attachmentText (attachmentId, text, source) VALUES (?, ?, ?)
           ON CONFLICT(attachmentId) DO UPDATE SET text = excluded.text, source = excluded.source`,
        )
        .run(reading.attachmentId, searchable, visionTextSource);
    })();
  }
}
