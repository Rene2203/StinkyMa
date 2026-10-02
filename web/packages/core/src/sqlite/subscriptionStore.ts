import type Database from "better-sqlite3";
import { lastCancelDay, type SubscriptionFinding } from "../ai/subscriptions.js";
import { registeredDomain } from "../cleanup.js";
import type { EmailAddress, MessageCategory } from "../models.js";
import { amountToCents, type StoredSubscription, type SubscriptionEdit, type SubscriptionStatus } from "../subscriptions.js";
import { archiveDuplicate } from "./repository.js";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Kandidat für die Abo-Suche: eine noch nicht geprüfte Mail. */
export interface SubscriptionCandidate {
  id: string;
  accountId: string;
  from: EmailAddress;
  subject: string;
  body: string;
  date: string;
  category: MessageCategory | null;
}

const reminderKey = (id: string) => `sub:${id}`;

function fromRow(r: Row): StoredSubscription {
  let notice: StoredSubscription["notice"] = null;
  try {
    notice = r.notice ? (JSON.parse(String(r.notice)) as StoredSubscription["notice"]) : null;
  } catch {
    notice = null;
  }
  return {
    id: String(r.id),
    accountId: String(r.accountId),
    providerKey: String(r.providerKey),
    provider: String(r.provider),
    kind: String(r.kind) as StoredSubscription["kind"],
    amount: str(r.amount),
    amountCents: r.amountCents === null || r.amountCents === undefined ? null : Number(r.amountCents),
    interval: str(r.interval) as StoredSubscription["interval"],
    startDate: str(r.startDate),
    minTermMonths: r.minTermMonths === null || r.minTermMonths === undefined ? null : Number(r.minTermMonths),
    trialEnd: str(r.trialEnd),
    termEnd: str(r.termEnd),
    renewalDate: str(r.renewalDate),
    cancelBy: str(r.cancelBy),
    notice,
    lastCancelDay: str(r.lastCancelDay),
    status: String(r.status) as SubscriptionStatus,
    sourceMessageId: str(r.sourceMessageId),
    lastMailDate: String(r.lastMailDate),
    quote: String(r.quote),
    origin: String(r.origin) as StoredSubscription["origin"],
    userEdited: Number(r.userEdited) !== 0,
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
    reminder: r.reminderId ? { id: String(r.reminderId), dueDate: String(r.reminderDue) } : null,
  };
}

/** Speicher für Verträge & Abos (W7.1). */
export class SubscriptionStore {
  constructor(
    private readonly db: Database.Database,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  /** Noch nicht geprüfte Mails (Posteingang, Archiv, eigene Ordner), neueste zuerst. `promptVersion`: ältere Prüfungen mit Regeln gelten als offen, wenn jetzt ein Modell da ist. */
  candidates(limit: number, options: { recheckRules?: boolean } = {}): SubscriptionCandidate[] {
    const rows = this.db
      .prepare(
        `SELECT message.id, message.accountId, message.fromName, message.fromAddress, message.subject, message.date, message.category,
                substr(COALESCE(message.bodyText, message.snippet), 1, 4000) AS body
         FROM message JOIN mailbox ON mailbox.id = message.mailboxId
         LEFT JOIN subscriptionScan s ON s.messageId = message.id
         WHERE mailbox.role IN ('inbox', 'archive', 'custom') AND NOT ${archiveDuplicate}
           AND (s.messageId IS NULL ${options.recheckRules ? "OR s.origin = 'rules'" : ""})
         ORDER BY message.date DESC LIMIT ?`,
      )
      .all(limit) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      accountId: String(r.accountId),
      from: { name: str(r.fromName), address: String(r.fromAddress) },
      subject: String(r.subject),
      body: String(r.body ?? ""),
      date: String(r.date),
      category: str(r.category) as MessageCategory | null,
    }));
  }

  markScanned(messageIds: string[], origin: string, promptVersion: number, at: string): void {
    const stmt = this.db.prepare(
      `INSERT INTO subscriptionScan (messageId, origin, promptVersion, scannedAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(messageId) DO UPDATE SET origin = excluded.origin, promptVersion = excluded.promptVersion, scannedAt = excluded.scannedAt`,
    );
    this.db.transaction(() => {
      for (const id of messageIds) stmt.run(id, origin, promptVersion, at);
    })();
  }

  /**
   * Fund übernehmen: ein Eintrag je Konto und Anbieter (Absender-Domain). Neuere Mails überschreiben, ältere füllen nur
   * Lücken. Vom Nutzer geänderte Einträge bekommen nur noch den Status „gekündigt“. Gibt die ID zurück.
   */
  apply(finding: SubscriptionFinding, mail: { id: string; accountId: string; fromAddress: string; date: string }, origin: StoredSubscription["origin"], now: string): string {
    const providerKey = registeredDomain(mail.fromAddress) || mail.fromAddress.toLowerCase();
    const existing = this.db.prepare("SELECT * FROM subscription WHERE accountId = ? AND providerKey = ?").get(mail.accountId, providerKey) as Row | undefined;
    if (!existing) {
      const id = this.newId();
      this.db
        .prepare(
          `INSERT INTO subscription (id, accountId, providerKey, provider, kind, amount, amountCents, interval, startDate, minTermMonths, trialEnd, termEnd,
             renewalDate, cancelBy, notice, lastCancelDay, status, sourceMessageId, lastMailDate, quote, origin, userEdited, createdAt, updatedAt)
           VALUES (@id, @accountId, @providerKey, @provider, @kind, @amount, @amountCents, @interval, @startDate, @minTermMonths, @trialEnd, @termEnd,
             @renewalDate, @cancelBy, @notice, @lastCancelDay, @status, @sourceMessageId, @lastMailDate, @quote, @origin, 0, @now, @now)`,
        )
        .run({
          id, accountId: mail.accountId, providerKey, ...this.#fields(finding), status: finding.cancelled ? "cancelled" : "active",
          sourceMessageId: mail.id, lastMailDate: mail.date, origin, now,
        });
      return id;
    }
    const current = fromRow(existing);
    const newer = mail.date >= current.lastMailDate;
    if (current.userEdited) {
      if (newer && finding.cancelled) this.db.prepare("UPDATE subscription SET status = 'cancelled', lastMailDate = ?, updatedAt = ? WHERE id = ?").run(mail.date, now, current.id);
      return current.id;
    }
    const pick = <T>(fromMail: T | null, stored: T | null): T | null => (newer ? (fromMail ?? stored) : (stored ?? fromMail));
    const merged: SubscriptionFinding = {
      // Nach der Probezeit (neuere Mail ohne „Probe“) ist es ein normales Abo
      kind: newer ? finding.kind : current.kind,
      provider: current.provider,
      amount: pick(finding.amount, current.amount),
      interval: pick(finding.interval, current.interval),
      startDate: pick(finding.startDate, current.startDate),
      minTermMonths: pick(finding.minTermMonths, current.minTermMonths),
      trialEnd: newer && finding.kind !== "trial" ? null : pick(finding.trialEnd, current.trialEnd),
      termEnd: pick(finding.termEnd, current.termEnd),
      renewalDate: pick(finding.renewalDate, current.renewalDate),
      cancelBy: pick(finding.cancelBy, current.cancelBy),
      notice: pick(finding.notice, current.notice),
      cancelled: newer ? finding.cancelled || current.status === "cancelled" : current.status === "cancelled",
      quote: newer ? finding.quote : current.quote,
    };
    this.db
      .prepare(
        `UPDATE subscription SET kind = @kind, amount = @amount, amountCents = @amountCents, interval = @interval, startDate = @startDate,
           minTermMonths = @minTermMonths, trialEnd = @trialEnd, termEnd = @termEnd, renewalDate = @renewalDate, cancelBy = @cancelBy, notice = @notice,
           lastCancelDay = @lastCancelDay, quote = @quote, status = @status, sourceMessageId = @sourceMessageId, lastMailDate = @lastMailDate,
           origin = @origin, updatedAt = @now
         WHERE id = @id`,
      )
      .run({
        id: current.id, ...this.#fields(merged), provider: undefined,
        status: current.status === "dismissed" ? "dismissed" : merged.cancelled ? "cancelled" : "active",
        sourceMessageId: newer ? mail.id : current.sourceMessageId, lastMailDate: newer ? mail.date : current.lastMailDate,
        origin: newer ? origin : current.origin, now,
      });
    return current.id;
  }

  #fields(f: SubscriptionFinding) {
    return {
      provider: f.provider,
      kind: f.kind,
      amount: f.amount,
      amountCents: amountToCents(f.amount),
      interval: f.interval,
      startDate: f.startDate,
      minTermMonths: f.minTermMonths,
      trialEnd: f.trialEnd,
      termEnd: f.termEnd,
      renewalDate: f.renewalDate,
      cancelBy: f.cancelBy,
      notice: f.notice ? JSON.stringify(f.notice) : null,
      lastCancelDay: lastCancelDay(f),
      quote: f.quote,
    };
  }

  /** Laut Modell kein Abo: Eintrag löschen, wenn er nur auf dieser Mail beruht und per Regel entstand (nicht vom Nutzer). */
  removeIfOnlyFrom(messageId: string): void {
    this.db.prepare("DELETE FROM subscription WHERE sourceMessageId = ? AND origin = 'rules' AND userEdited = 0 AND createdAt = updatedAt").run(messageId);
  }

  list(): StoredSubscription[] {
    return (
      this.db
        .prepare(
          `SELECT subscription.*, r.id AS reminderId, r.dueDate AS reminderDue FROM subscription
           LEFT JOIN reminder r ON r.actionId = 'sub:' || subscription.id AND r.status = 'pending'
           ORDER BY CASE subscription.status WHEN 'active' THEN 0 WHEN 'cancelled' THEN 1 ELSE 2 END,
                    COALESCE(subscription.lastCancelDay, '9999'), subscription.provider`,
        )
        .all() as Row[]
    ).map(fromRow);
  }

  get(id: string): StoredSubscription | null {
    const row = this.db
      .prepare(
        `SELECT subscription.*, r.id AS reminderId, r.dueDate AS reminderDue FROM subscription
         LEFT JOIN reminder r ON r.actionId = 'sub:' || subscription.id AND r.status = 'pending' WHERE subscription.id = ?`,
      )
      .get(id) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  /** Von Hand korrigieren – danach überschreiben neue Mails die Angaben nicht mehr. */
  update(id: string, edit: SubscriptionEdit, now: string): void {
    const current = this.get(id);
    if (!current) throw new Error("Diesen Eintrag gibt es nicht mehr.");
    const amount = edit.amount !== undefined ? edit.amount : current.amount;
    this.db
      .prepare(
        `UPDATE subscription SET provider = ?, kind = ?, amount = ?, amountCents = ?, interval = ?, lastCancelDay = ?, userEdited = 1, origin = 'user', updatedAt = ? WHERE id = ?`,
      )
      .run(
        (edit.provider ?? current.provider).trim().slice(0, 60) || current.provider,
        edit.kind ?? current.kind,
        amount,
        amountToCents(amount),
        edit.interval !== undefined ? edit.interval : current.interval,
        edit.lastCancelDay !== undefined ? edit.lastCancelDay : current.lastCancelDay,
        now,
        id,
      );
  }

  setStatus(id: string, status: SubscriptionStatus, now: string): void {
    this.db.prepare("UPDATE subscription SET status = ?, updatedAt = ? WHERE id = ?").run(status, now, id);
    if (status !== "active") this.cancelReminder(id);
  }

  /** Erinnerung (ersetzt eine vorhandene). Fällig wird sie über die gemeinsame Erinnerungs-Tabelle (wie bei „Zu tun“). */
  addReminder(id: string, dueDate: string, text: string): void {
    const sub = this.get(id);
    if (!sub) throw new Error("Diesen Eintrag gibt es nicht mehr.");
    this.cancelReminder(id);
    this.db
      .prepare("INSERT INTO reminder (id, messageId, dueDate, text, actionId, status) VALUES (?, ?, ?, ?, ?, 'pending')")
      .run(this.newId(), sub.sourceMessageId, dueDate, text, reminderKey(id));
  }

  cancelReminder(id: string): void {
    this.db.prepare("UPDATE reminder SET status = 'cancelled' WHERE actionId = ? AND status = 'pending'").run(reminderKey(id));
  }
}
