import type Database from "better-sqlite3";
import { archiveDuplicate } from "./repository.js";

type Row = Record<string, unknown>;

export interface EmbeddingCandidate {
  id: string;
  accountId: string;
  subject: string;
  body: string;
  attachments: { filename: string; text: string }[];
}

export interface StoredChunk {
  messageId: string;
  chunkIndex: number;
  source: string;
  text: string;
  vector: Float32Array;
}

export interface MailInfo {
  id: string;
  accountId: string;
  subject: string;
  fromName: string | null;
  fromAddress: string;
  to: string;
  date: string;
  body: string;
}

/** Welche Mails zählen: Posteingang, Archiv, eigene Ordner, Gesendet – ohne doppelte Archivkopien */
const searchable = `mailbox.role IN ('inbox', 'archive', 'custom', 'sent') AND NOT ${archiveDuplicate}`;

function senderCondition(sender: string | undefined): { sql: string; params: string[] } {
  if (!sender) return { sql: "", params: [] };
  return { sql: `AND (lower(message.fromAddress) = lower(?) OR instr(lower(message."to"), lower(?)) > 0)`, params: [sender, sender] };
}

/** Speicher für „Frag dein Postfach“: Textstücke mit Vektoren, Volltext-Treffer, Mail-Infos für Quellen. */
export class EmbeddingStore {
  constructor(private readonly db: Database.Database) {}

  /** Noch nicht mit diesem Modell indexierte Mails, neueste zuerst. */
  pending(limit: number, modelId: string): EmbeddingCandidate[] {
    const rows = this.db
      .prepare(
        `SELECT message.id, message.accountId, message.subject, substr(COALESCE(message.bodyText, message.snippet), 1, 6000) AS body
         FROM message JOIN mailbox ON mailbox.id = message.mailboxId
         LEFT JOIN embeddingScan s ON s.messageId = message.id AND s.modelId = ?
         WHERE ${searchable} AND s.messageId IS NULL
         ORDER BY message.date DESC LIMIT ?`,
      )
      .all(modelId, limit) as Row[];
    const attachments = this.db.prepare(
      `SELECT attachment.filename, substr(attachmentText.text, 1, 4000) AS text FROM attachment
       JOIN attachmentText ON attachmentText.attachmentId = attachment.id WHERE attachment.messageId = ?`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      accountId: String(r.accountId),
      subject: String(r.subject ?? ""),
      body: String(r.body ?? ""),
      attachments: (attachments.all(r.id) as Row[]).map((a) => ({ filename: String(a.filename), text: String(a.text ?? "") })),
    }));
  }

  save(messageId: string, chunks: { source: string; text: string; vector: Float32Array }[], modelId: string, at: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM embedding WHERE messageId = ?").run(messageId);
      const insert = this.db.prepare("INSERT INTO embedding (messageId, chunkIndex, vector, text, source, modelId) VALUES (?, ?, ?, ?, ?, ?)");
      chunks.forEach((c, i) => insert.run(messageId, i, Buffer.from(c.vector.buffer, c.vector.byteOffset, c.vector.byteLength), c.text, c.source, modelId));
      this.db
        .prepare("INSERT INTO embeddingScan (messageId, modelId, indexedAt) VALUES (?, ?, ?) ON CONFLICT(messageId) DO UPDATE SET modelId = excluded.modelId, indexedAt = excluded.indexedAt")
        .run(messageId, modelId, at);
    })();
  }

  counts(modelId: string): { indexed: number; total: number } {
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM message JOIN mailbox ON mailbox.id = message.mailboxId WHERE ${searchable}`).get() as { n: number }).n;
    const indexed = (this.db.prepare("SELECT COUNT(*) AS n FROM embeddingScan WHERE modelId = ?").get(modelId) as { n: number }).n;
    return { indexed: Math.min(indexed, total), total };
  }

  /** Alle Vektoren eines Modells (für die Suche im Speicher; ein paar zehn MB auch bei großen Postfächern). */
  chunks(modelId: string): StoredChunk[] {
    return (this.db.prepare("SELECT messageId, chunkIndex, source, text, vector FROM embedding WHERE modelId = ?").all(modelId) as Row[]).map((r) => {
      const buffer = r.vector as Buffer;
      return {
        messageId: String(r.messageId),
        chunkIndex: Number(r.chunkIndex),
        source: String(r.source),
        text: String(r.text),
        vector: new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)),
      };
    });
  }

  /** Volltext-Treffer (beste zuerst): Mailtext und Anhänge, ODER-verknüpft. */
  keywordHits(ftsQuery: string, limit: number, sender?: string): string[] {
    if (!ftsQuery) return [];
    const who = senderCondition(sender);
    try {
      const mails = this.db
        .prepare(
          `SELECT message.id, bm25(messageFTS) AS rank FROM messageFTS JOIN message ON message.rowid = messageFTS.rowid
           JOIN mailbox ON mailbox.id = message.mailboxId
           WHERE messageFTS MATCH ? AND ${searchable} ${who.sql} ORDER BY rank LIMIT ?`,
        )
        .all(ftsQuery, ...who.params, limit) as Row[];
      const files = this.db
        .prepare(
          `SELECT message.id, bm25(attachmentFTS) AS rank FROM attachmentFTS
           JOIN attachmentText ON attachmentText.rowid = attachmentFTS.rowid
           JOIN attachment ON attachment.id = attachmentText.attachmentId
           JOIN message ON message.id = attachment.messageId JOIN mailbox ON mailbox.id = message.mailboxId
           WHERE attachmentFTS MATCH ? AND ${searchable} ${who.sql} ORDER BY rank LIMIT ?`,
        )
        .all(ftsQuery, ...who.params, limit) as Row[];
      return [...mails, ...files].sort((a, b) => Number(a.rank) - Number(b.rank)).map((r) => String(r.id)).filter((id, i, all) => all.indexOf(id) === i);
    } catch {
      return []; // ungültige Anfrage für FTS5 – dann eben nur nach Bedeutung
    }
  }

  /** Mails, die zur Absenderbeschränkung passen (für die Suche nach Bedeutung im Steckbrief) */
  idsForSender(sender: string): Set<string> {
    const who = senderCondition(sender);
    return new Set((this.db.prepare(`SELECT message.id FROM message JOIN mailbox ON mailbox.id = message.mailboxId WHERE ${searchable} ${who.sql}`).all(...who.params) as Row[]).map((r) => String(r.id)));
  }

  mails(ids: string[]): MailInfo[] {
    if (ids.length === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT id, accountId, subject, fromName, fromAddress, "to", date, substr(COALESCE(bodyText, snippet), 1, 4000) AS body FROM message WHERE id IN (${ids.map(() => "?").join(",")})`,
      )
      .all(...ids) as Row[];
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    return ids.flatMap((id) => {
      const r = byId.get(id);
      return r
        ? [{ id, accountId: String(r.accountId), subject: String(r.subject ?? ""), fromName: r.fromName ? String(r.fromName) : null, fromAddress: String(r.fromAddress), to: String(r.to ?? ""), date: String(r.date), body: String(r.body ?? "") }]
        : [];
    });
  }

  clear(): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM embedding").run();
      this.db.prepare("DELETE FROM embeddingScan").run();
    })();
  }
}
