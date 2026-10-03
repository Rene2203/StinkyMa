import type Database from "better-sqlite3";
import type { MessageCategory } from "../models.js";
import { messagePriority, type BehaviorType, type SenderStats } from "../priority.js";

type Row = Record<string, unknown>;

const emptyStats = (): SenderStats => ({ received: 0, opened: 0, replied: 0, flagged: 0, trashedUnread: 0, sentTo: 0, userPriority: null });

/**
 * Verhaltens-Log und Wichtigkeit je Mail (W8.3). Tabellen `behaviorEvent`, `senderProfile` gibt es seit v1.
 * Der Absender steht im Ereignis selbst (`metadata.from`) – die Mail kann später verschoben oder gelöscht werden.
 */
export class PriorityStore {
  constructor(private readonly db: Database.Database) {}

  record(type: BehaviorType, messageIds: string[], at: string): string[] {
    const insert = this.db.prepare("INSERT INTO behaviorEvent (messageId, type, timestamp, metadata) VALUES (?, ?, ?, ?)");
    const senders = new Set<string>();
    this.db.transaction(() => {
      for (const id of messageIds) {
        const row = this.db.prepare("SELECT fromAddress, flags FROM message WHERE id = ?").get(id) as Row | undefined;
        if (!row) continue;
        const from = String(row.fromAddress).toLowerCase();
        // Gelöscht, ohne gelesen zu sein? (Bit 1 = gelesen)
        const unread = (Number(row.flags) & 1) === 0;
        insert.run(id, type, at, JSON.stringify(type === "trash" && unread ? { from, unread: true } : { from }));
        senders.add(from);
      }
    })();
    return [...senders];
  }

  /** Kennzahlen je Absender – gebündelt in wenigen Abfragen (für viele Absender auf einmal). */
  #allStats(only?: Set<string>): Map<string, SenderStats> {
    const map = new Map<string, SenderStats>();
    const get = (address: unknown): SenderStats | null => {
      const key = String(address ?? "").toLowerCase();
      if (!key || (only && !only.has(key))) return null;
      let stats = map.get(key);
      if (!stats) {
        stats = emptyStats();
        map.set(key, stats);
      }
      return stats;
    };
    for (const r of this.db
      .prepare(
        `SELECT lower(message.fromAddress) AS a, COUNT(*) AS n FROM message JOIN mailbox ON mailbox.id = message.mailboxId
         WHERE mailbox.role IN ('inbox', 'archive', 'custom') GROUP BY 1`,
      )
      .all() as Row[]) {
      const s = get(r.a);
      if (s) s.received = Number(r.n);
    }
    for (const r of this.db
      .prepare(
        `SELECT json_extract(metadata, '$.from') AS a, type, COUNT(DISTINCT COALESCE(messageId, id)) AS n,
                SUM(CASE WHEN json_extract(metadata, '$.unread') THEN 1 ELSE 0 END) AS unread
         FROM behaviorEvent WHERE json_valid(metadata) GROUP BY 1, 2`,
      )
      .all() as Row[]) {
      const s = get(r.a);
      if (!s) continue;
      const n = Number(r.n);
      if (r.type === "open") s.opened = n;
      else if (r.type === "reply") s.replied = n;
      else if (r.type === "flag") s.flagged = n;
      else if (r.type === "trash") s.trashedUnread = Number(r.unread);
    }
    for (const r of this.db
      .prepare(
        `SELECT lower(json_extract(r.value, '$.address')) AS a, COUNT(*) AS n
         FROM message JOIN mailbox ON mailbox.id = message.mailboxId, json_each(message."to") AS r
         WHERE mailbox.role = 'sent' GROUP BY 1`,
      )
      .all() as Row[]) {
      const s = get(r.a);
      if (s) s.sentTo = Number(r.n);
    }
    for (const r of this.db.prepare("SELECT address, userPriority FROM senderProfile WHERE userPriority IS NOT NULL").all() as Row[]) {
      const s = get(r.address);
      const up = Number(r.userPriority);
      if (s) s.userPriority = up === 1 ? 1 : up === -1 ? -1 : null;
    }
    return map;
  }

  stats(address: string): SenderStats {
    const key = address.toLowerCase();
    return this.#allStats(new Set([key])).get(key) ?? emptyStats();
  }

  /** Wichtigkeit neu rechnen: für bestimmte Absender (alle ihre Mails) oder die neuesten Posteingangs-Mails. */
  recompute(options: { senders?: string[]; limit?: number } = {}): number {
    const senders = options.senders?.map((a) => a.toLowerCase());
    const rows = senders
      ? senders.flatMap((a) => this.db.prepare("SELECT id, fromAddress, category FROM message WHERE fromAddress = ? COLLATE NOCASE").all(a) as Row[])
      : (this.db
          .prepare(
            `SELECT message.id, message.fromAddress, message.category FROM message JOIN mailbox ON mailbox.id = message.mailboxId
             WHERE mailbox.role IN ('inbox', 'archive', 'custom') ORDER BY message.date DESC LIMIT ?`,
          )
          .all(options.limit ?? 3000) as Row[]);
    const stats = this.#allStats(senders ? new Set(senders) : undefined);
    const update = this.db.prepare("UPDATE message SET priorityScore = ? WHERE id = ?");
    this.db.transaction(() => {
      for (const row of rows) {
        const s = stats.get(String(row.fromAddress).toLowerCase()) ?? emptyStats();
        update.run(messagePriority(row.category as MessageCategory | null, s), row.id);
      }
    })();
    return rows.length;
  }

  /** „Immer wichtig“ (1), „nie wichtig“ (-1) oder zurücksetzen (null) */
  setUserPriority(address: string, value: 1 | -1 | null): void {
    const key = address.trim().toLowerCase();
    const domain = key.split("@")[1] ?? key;
    this.db
      .prepare("INSERT INTO senderProfile (address, domain, userPriority) VALUES (?, ?, ?) ON CONFLICT(address) DO UPDATE SET userPriority = excluded.userPriority")
      .run(key, domain, value);
    this.recompute({ senders: [key] });
  }

  /** Für die Transparenz-Seite: Absender mit den meisten Mails samt Kennzahlen */
  topSenders(limit: number): { address: string; name: string | null; stats: SenderStats; score: number }[] {
    const rows = this.db
      .prepare(
        `SELECT lower(message.fromAddress) AS address, MAX(message.fromName) AS name, AVG(message.priorityScore) AS score, COUNT(*) AS n
         FROM message JOIN mailbox ON mailbox.id = message.mailboxId WHERE mailbox.role IN ('inbox', 'archive', 'custom')
         GROUP BY lower(message.fromAddress) ORDER BY n DESC LIMIT ?`,
      )
      .all(limit) as Row[];
    const stats = this.#allStats(new Set(rows.map((r) => String(r.address))));
    return rows.map((r) => ({
      address: String(r.address),
      name: r.name ? String(r.name) : null,
      stats: stats.get(String(r.address)) ?? emptyStats(),
      score: Math.round(Number(r.score ?? 0) * 100) / 100,
    }));
  }

  eventCounts(): Record<BehaviorType, number> {
    const out: Record<BehaviorType, number> = { open: 0, reply: 0, flag: 0, archive: 0, trash: 0 };
    for (const row of this.db.prepare("SELECT type, COUNT(*) AS n FROM behaviorEvent GROUP BY type").all() as Row[]) {
      if (String(row.type) in out) out[String(row.type) as BehaviorType] = Number(row.n);
    }
    return out;
  }

  /** Alles Gelernte vergessen (Verhalten und Festlegungen) */
  forgetAll(): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM behaviorEvent").run();
      this.db.prepare("UPDATE senderProfile SET userPriority = NULL").run();
      this.db.prepare("UPDATE message SET priorityScore = NULL").run();
    })();
  }
}
