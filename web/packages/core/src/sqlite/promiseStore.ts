import type Database from "better-sqlite3";
import type { PromiseDirection, PromiseFinding } from "../ai/promises.js";
import type { EmailAddress, MessageCategory } from "../models.js";
import type { PromiseStatus, StoredPromise } from "../promises.js";
import { archiveDuplicate } from "./repository.js";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const reminderKey = (id: string) => `prom:${id}`;

export interface PromiseCandidate {
  id: string;
  accountId: string;
  threadId: string;
  direction: PromiseDirection;
  from: EmailAddress;
  to: EmailAddress[];
  subject: string;
  body: string;
  date: string;
  category: MessageCategory | null;
}

function parseAddresses(value: unknown): EmailAddress[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? (parsed as EmailAddress[]) : [];
  } catch {
    return [];
  }
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 50);

/** Speicher für den Versprechen-Tracker (W7.3). */
export class PromiseStore {
  constructor(
    private readonly db: Database.Database,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  /** Ungeprüfte Mails: gesendete (eigene Zusagen) und eingegangene (fremde Zusagen), neueste zuerst. */
  candidates(limit: number, options: { recheckRules?: boolean } = {}): PromiseCandidate[] {
    const rows = this.db
      .prepare(
        `SELECT message.id, message.accountId, message.threadId, message.fromName, message.fromAddress, message."to" AS recipients,
                message.subject, message.date, message.category, mailbox.role, substr(COALESCE(message.bodyText, message.snippet), 1, 4000) AS body
         FROM message JOIN mailbox ON mailbox.id = message.mailboxId
         LEFT JOIN promiseScan s ON s.messageId = message.id
         WHERE mailbox.role IN ('sent', 'inbox', 'archive', 'custom') AND NOT ${archiveDuplicate}
           AND (s.messageId IS NULL ${options.recheckRules ? "OR s.origin = 'rules'" : ""})
         ORDER BY message.date DESC LIMIT ?`,
      )
      .all(limit) as Row[];
    return rows.map((r) => ({
      id: String(r.id), accountId: String(r.accountId), threadId: String(r.threadId),
      direction: r.role === "sent" ? "mine" : "theirs",
      from: { name: str(r.fromName), address: String(r.fromAddress) }, to: parseAddresses(r.recipients),
      subject: String(r.subject), body: String(r.body ?? ""), date: String(r.date), category: str(r.category) as MessageCategory | null,
    }));
  }

  markScanned(messageIds: string[], origin: string, promptVersion: number, at: string): void {
    const stmt = this.db.prepare(
      `INSERT INTO promiseScan (messageId, origin, promptVersion, scannedAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(messageId) DO UPDATE SET origin = excluded.origin, promptVersion = excluded.promptVersion, scannedAt = excluded.scannedAt`,
    );
    this.db.transaction(() => {
      for (const id of messageIds) stmt.run(id, origin, promptVersion, at);
    })();
  }

  resetScans(): void {
    this.db.prepare("DELETE FROM promiseScan").run();
  }

  /**
   * Funde einer Mail übernehmen: offene, automatisch erkannte Zusagen der Mail werden ersetzt; was der Nutzer schon
   * erledigt oder ausgeblendet hat, bleibt (und kommt nicht doppelt wieder). Gibt die IDs neuer Zusagen zurück.
   */
  apply(findings: PromiseFinding[], mail: PromiseCandidate, origin: StoredPromise["origin"], defaultDays: number, now: string): string[] {
    const counterpart = mail.direction === "mine" ? (mail.to[0] ?? { name: null, address: "" }) : mail.from;
    const kept = this.db.prepare("SELECT quote FROM promise WHERE messageId = ? AND status != 'open'").all(mail.id) as Row[];
    const created: string[] = [];
    this.db.transaction(() => {
      // Offene Zusagen dieser Mail neu (z. B. Modell nach Regeln) – Erinnerungen mit weg
      const old = this.db.prepare("SELECT id FROM promise WHERE messageId = ? AND status = 'open'").all(mail.id) as Row[];
      for (const row of old) this.cancelReminder(String(row.id));
      this.db.prepare("DELETE FROM promise WHERE messageId = ? AND status = 'open'").run(mail.id);
      for (const finding of findings) {
        if (kept.some((k) => normalize(String(k.quote)) === normalize(finding.quote))) continue;
        const base = new Date(mail.date);
        const fallback = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + defaultDays)).toISOString().slice(0, 10);
        const id = this.newId();
        this.db
          .prepare(
            `INSERT INTO promise (id, accountId, messageId, threadId, direction, counterpartName, counterpartAddress, text, quote, dueDate, dueStated, status,
               followUpMessageId, origin, mailSubject, mailDate, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?, ?, ?, ?)`,
          )
          .run(id, mail.accountId, mail.id, mail.threadId, mail.direction, counterpart.name, counterpart.address, finding.text, finding.quote,
            finding.dueDate ?? fallback, finding.dueDate ? 1 : 0, origin, mail.subject, mail.date, now, now);
        created.push(id);
      }
    })();
    return created;
  }

  /**
   * Folge-Mails erkennen: Eigene Zusage → spätere eigene (gesendete) Mail im Verlauf an dieselbe Person; fremde Zusage →
   * spätere Mail dieser Person im Verlauf. Dann schlägt die App „erledigt“ vor.
   */
  updateFollowUps(): void {
    const open = this.db.prepare("SELECT id, threadId, direction, counterpartAddress, mailDate FROM promise WHERE status = 'open'").all() as Row[];
    const mine = this.db.prepare(
      `SELECT message.id FROM message JOIN mailbox ON mailbox.id = message.mailboxId
       WHERE message.threadId = ? AND mailbox.role = 'sent' AND message.date > ? AND instr(lower(message."to"), lower(?)) > 0 ORDER BY message.date LIMIT 1`,
    );
    const theirs = this.db.prepare(
      `SELECT message.id FROM message WHERE message.threadId = ? AND lower(message.fromAddress) = lower(?) AND message.date > ? ORDER BY message.date LIMIT 1`,
    );
    const set = this.db.prepare("UPDATE promise SET followUpMessageId = ? WHERE id = ?");
    this.db.transaction(() => {
      for (const p of open) {
        const row = (p.direction === "mine" ? mine.get(p.threadId, p.mailDate, p.counterpartAddress) : theirs.get(p.threadId, p.counterpartAddress, p.mailDate)) as Row | undefined;
        set.run(row ? String(row.id) : null, p.id);
      }
    })();
  }

  #fromRow(r: Row): StoredPromise {
    return {
      id: String(r.id), accountId: String(r.accountId), messageId: str(r.liveMessageId), threadId: String(r.threadId),
      direction: String(r.direction) as StoredPromise["direction"], counterpart: { name: str(r.counterpartName), address: String(r.counterpartAddress) },
      text: String(r.text), quote: String(r.quote), dueDate: String(r.dueDate), dueStated: Number(r.dueStated) !== 0,
      status: String(r.status) as PromiseStatus,
      followUp: r.followUpId ? { messageId: String(r.followUpId), date: String(r.followUpDate), subject: String(r.followUpSubject) } : null,
      origin: String(r.origin) as StoredPromise["origin"], mailSubject: String(r.mailSubject), mailDate: String(r.mailDate),
      reminder: r.reminderId ? { id: String(r.reminderId), dueDate: String(r.reminderDue) } : null,
    };
  }

  #select(where: string) {
    return `SELECT promise.*, m.id AS liveMessageId, f.id AS followUpId, f.date AS followUpDate, f.subject AS followUpSubject,
                   r.id AS reminderId, r.dueDate AS reminderDue
            FROM promise
            LEFT JOIN message m ON m.id = promise.messageId
            LEFT JOIN message f ON f.id = promise.followUpMessageId
            LEFT JOIN reminder r ON r.actionId = 'prom:' || promise.id AND r.status = 'pending'
            WHERE ${where}`;
  }

  /** Offene zuerst (nach Frist), dann Erledigtes der letzten 30 Tage; Ausgeblendetes nicht. */
  list(sinceDone: string): StoredPromise[] {
    return (
      this.db
        .prepare(`${this.#select("promise.status = 'open' OR (promise.status = 'done' AND promise.updatedAt >= ?)")} ORDER BY CASE promise.status WHEN 'open' THEN 0 ELSE 1 END, promise.dueDate`)
        .all(sinceDone) as Row[]
    ).map((r) => this.#fromRow(r));
  }

  get(id: string): StoredPromise | null {
    const row = this.db.prepare(this.#select("promise.id = ?")).get(id) as Row | undefined;
    return row ? this.#fromRow(row) : null;
  }

  setStatus(id: string, status: PromiseStatus, now: string): void {
    this.db.prepare("UPDATE promise SET status = ?, updatedAt = ? WHERE id = ?").run(status, now, id);
    if (status !== "open") this.cancelReminder(id);
  }

  setDueDate(id: string, dueDate: string, now: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("Bitte ein gültiges Datum eingeben.");
    this.db.prepare("UPDATE promise SET dueDate = ?, dueStated = 1, origin = 'user', updatedAt = ? WHERE id = ?").run(dueDate, now, id);
  }

  addReminder(id: string, dueIso: string, text: string): void {
    const promise = this.get(id);
    if (!promise) throw new Error("Diese Zusage gibt es nicht mehr.");
    this.cancelReminder(id);
    this.db
      .prepare("INSERT INTO reminder (id, messageId, dueDate, text, actionId, status) VALUES (?, ?, ?, ?, ?, 'pending')")
      .run(this.newId(), promise.messageId, dueIso, text, reminderKey(id));
  }

  cancelReminder(id: string): void {
    this.db.prepare("UPDATE reminder SET status = 'cancelled' WHERE actionId = ? AND status = 'pending'").run(reminderKey(id));
  }
}
