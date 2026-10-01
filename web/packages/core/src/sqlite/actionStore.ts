import type Database from "better-sqlite3";
import type { ActionType, MailAction } from "../ai/actions.js";
import type { ResultOrigin } from "../ai/tasks.js";

type Row = Record<string, unknown>;

export type ActionStatus = "open" | "done" | "dismissed";

export interface StoredAction extends MailAction {
  id: string;
  messageId: string;
  status: ActionStatus;
  origin: ResultOrigin;
  createdAt: string;
}

export interface StoredReminder {
  id: string;
  messageId: string | null;
  actionId: string | null;
  /** ISO-8601 (UTC) */
  dueDate: string;
  text: string;
  status: "pending" | "fired" | "cancelled";
}

const actionFromRow = (r: Row): StoredAction => ({
  id: String(r.id),
  messageId: String(r.messageId),
  type: String(r.type) as ActionType,
  title: String(r.title),
  date: r.date ? String(r.date) : null,
  time: r.time ? String(r.time) : null,
  amount: r.amount ? String(r.amount) : null,
  quote: String(r.quote),
  status: String(r.status) as ActionStatus,
  origin: String(r.origin) as ResultOrigin,
  createdAt: String(r.createdAt),
});

const reminderFromRow = (r: Row): StoredReminder => ({
  id: String(r.id),
  messageId: r.messageId ? String(r.messageId) : null,
  actionId: r.actionId ? String(r.actionId) : null,
  dueDate: String(r.dueDate),
  text: String(r.text),
  status: String(r.status) as StoredReminder["status"],
});

/** Erkannte Aktionen und Erinnerungen (Migration v10). */
export class ActionStore {
  constructor(
    private readonly db: Database.Database,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  scan(messageId: string): { origin: string; promptVersion: number } | null {
    const row = this.db.prepare("SELECT origin, promptVersion FROM messageActionScan WHERE messageId = ?").get(messageId) as { origin: string; promptVersion: number } | undefined;
    return row ?? null;
  }

  /**
   * Ergebnis einer Untersuchung speichern. Offene Aktionen einer früheren Untersuchung werden ersetzt; was der Nutzer
   * schon erledigt oder verworfen hat, bleibt (und wird nicht erneut vorgeschlagen).
   */
  saveScan(messageId: string, actions: MailAction[], scan: { origin: ResultOrigin; promptVersion: number; at: string }): StoredAction[] {
    this.db.transaction(() => {
      const kept = this.db.prepare("SELECT type, date, time, amount FROM messageAction WHERE messageId = ? AND status != 'open'").all(messageId) as Row[];
      const keyOf = (a: { type?: unknown; date?: unknown; time?: unknown; amount?: unknown }) => `${a.type}|${a.date ?? ""}|${a.time ?? ""}|${a.amount ?? ""}`;
      const done = new Set(kept.map(keyOf));
      this.db.prepare("DELETE FROM messageAction WHERE messageId = ? AND status = 'open' AND id NOT IN (SELECT actionId FROM reminder WHERE actionId IS NOT NULL AND status = 'pending')").run(messageId);
      const existing = new Set((this.db.prepare("SELECT type, date, time, amount FROM messageAction WHERE messageId = ?").all(messageId) as Row[]).map(keyOf));
      const insert = this.db.prepare(
        `INSERT INTO messageAction (id, messageId, type, title, date, time, amount, quote, status, origin, createdAt)
         VALUES (@id, @messageId, @type, @title, @date, @time, @amount, @quote, 'open', @origin, @createdAt)`,
      );
      for (const action of actions) {
        if (done.has(keyOf(action)) || existing.has(keyOf(action))) continue;
        insert.run({ id: this.newId(), messageId, ...action, origin: scan.origin, createdAt: scan.at });
      }
      this.db
        .prepare(
          `INSERT INTO messageActionScan (messageId, origin, promptVersion, scannedAt) VALUES (?, ?, ?, ?)
           ON CONFLICT(messageId) DO UPDATE SET origin = excluded.origin, promptVersion = excluded.promptVersion, scannedAt = excluded.scannedAt`,
        )
        .run(messageId, scan.origin, scan.promptVersion, scan.at);
    })();
    return this.actions(messageId);
  }

  actions(messageId: string): StoredAction[] {
    return (this.db.prepare("SELECT * FROM messageAction WHERE messageId = ? ORDER BY date IS NULL, date, time, createdAt").all(messageId) as Row[]).map(actionFromRow);
  }

  action(id: string): StoredAction | null {
    const row = this.db.prepare("SELECT * FROM messageAction WHERE id = ?").get(id) as Row | undefined;
    return row ? actionFromRow(row) : null;
  }

  setStatus(id: string, status: ActionStatus): void {
    this.db.prepare("UPDATE messageAction SET status = ? WHERE id = ?").run(status, id);
    if (status !== "open") this.db.prepare("UPDATE reminder SET status = 'cancelled' WHERE actionId = ? AND status = 'pending'").run(id);
  }

  /** Offene Aktionen mit Datum ab `fromDate` (für Tages-Digest und „Fällig“). */
  openActions(fromDate: string, limit: number): (StoredAction & { subject: string; fromName: string | null; fromAddress: string })[] {
    return (
      this.db
        .prepare(
          `SELECT messageAction.*, message.subject AS subject, message.fromName AS fromName, message.fromAddress AS fromAddress
           FROM messageAction JOIN message ON message.id = messageAction.messageId
           WHERE messageAction.status = 'open' AND messageAction.date >= ? ORDER BY messageAction.date, messageAction.time LIMIT ?`,
        )
        .all(fromDate, limit) as Row[]
    ).map((r) => ({ ...actionFromRow(r), subject: String(r.subject), fromName: r.fromName ? String(r.fromName) : null, fromAddress: String(r.fromAddress) }));
  }

  /** Mailbox-Rolle der Mail (Aktionen nur für empfangene Mails). */
  mailboxRole(messageId: string): string | null {
    const row = this.db.prepare("SELECT mailbox.role AS role FROM message JOIN mailbox ON mailbox.id = message.mailboxId WHERE message.id = ?").get(messageId) as { role: string } | undefined;
    return row?.role ?? null;
  }

  // --- Erinnerungen ---

  addReminder(reminder: Omit<StoredReminder, "id" | "status">): StoredReminder {
    const id = this.newId();
    this.db.prepare("INSERT INTO reminder (id, messageId, actionId, dueDate, text, status) VALUES (?, ?, ?, ?, ?, 'pending')").run(id, reminder.messageId, reminder.actionId, reminder.dueDate, reminder.text);
    return { ...reminder, id, status: "pending" };
  }

  reminders(options: { status?: StoredReminder["status"] } = {}): StoredReminder[] {
    const rows = options.status
      ? this.db.prepare("SELECT * FROM reminder WHERE status = ? ORDER BY dueDate").all(options.status)
      : this.db.prepare("SELECT * FROM reminder ORDER BY dueDate").all();
    return (rows as Row[]).map(reminderFromRow);
  }

  remindersForMessage(messageId: string): StoredReminder[] {
    return (this.db.prepare("SELECT * FROM reminder WHERE messageId = ? AND status = 'pending' ORDER BY dueDate").all(messageId) as Row[]).map(reminderFromRow);
  }

  /** Fällige Erinnerungen werden als „gemeldet“ markiert und zurückgegeben (jede genau einmal). */
  takeDueReminders(nowIso: string): StoredReminder[] {
    return this.db.transaction(() => {
      const due = (this.db.prepare("SELECT * FROM reminder WHERE status = 'pending' AND dueDate <= ? ORDER BY dueDate").all(nowIso) as Row[]).map(reminderFromRow);
      const mark = this.db.prepare("UPDATE reminder SET status = 'fired' WHERE id = ?");
      for (const reminder of due) mark.run(reminder.id);
      return due;
    })();
  }

  cancelReminder(id: string): void {
    this.db.prepare("UPDATE reminder SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(id);
  }
}
