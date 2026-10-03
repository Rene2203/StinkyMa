import type Database from "better-sqlite3";
import { lastCancelDay, type SubscriptionFinding } from "../ai/subscriptions.js";
import { registeredDomain } from "../cleanup.js";
import type { EmailAddress, MessageCategory } from "../models.js";
import { amountToCents, isBillingDomain, providerSlug, sameProvider, type StoredSubscription, type SubscriptionEdit, type SubscriptionMailRef, type SubscriptionStatus } from "../subscriptions.js";
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
  /** Text aus PDF-/Text-Anhängen (z. B. die Rechnung als PDF), gekürzt */
  attachmentText: string;
}

const candidateColumns = `message.id, message.accountId, message.fromName, message.fromAddress, message.subject, message.date, message.category,
  substr(COALESCE(message.bodyText, message.snippet), 1, 4000) AS body,
  (SELECT substr(group_concat(t.text, char(10)), 1, 3000) FROM attachmentText t JOIN attachment a ON a.id = t.attachmentId
   WHERE a.messageId = message.id AND coalesce(a.relevance, '') <> 'irrelevant') AS attachmentText`;

function candidateFromRow(r: Row): SubscriptionCandidate {
  return {
    id: String(r.id),
    accountId: String(r.accountId),
    from: { name: str(r.fromName), address: String(r.fromAddress) },
    subject: String(r.subject),
    body: String(r.body ?? ""),
    date: String(r.date),
    category: str(r.category) as MessageCategory | null,
    attachmentText: String(r.attachmentText ?? ""),
  };
}

function aliasesOf(r: Row): string[] {
  try {
    const parsed = JSON.parse(String(r.aliases ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
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
    mails: [],
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
        `SELECT ${candidateColumns}
         FROM message JOIN mailbox ON mailbox.id = message.mailboxId
         LEFT JOIN subscriptionScan s ON s.messageId = message.id
         WHERE mailbox.role IN ('inbox', 'archive', 'custom') AND NOT ${archiveDuplicate}
           AND (s.messageId IS NULL ${options.recheckRules ? "OR s.origin = 'rules'" : ""})
         ORDER BY message.date DESC LIMIT ?`,
      )
      .all(limit) as Row[];
    return rows.map(candidateFromRow);
  }

  /** Eine bestimmte Mail (für „Das ist ein Abo“), egal ob schon geprüft. */
  candidate(messageId: string): SubscriptionCandidate | null {
    const row = this.db.prepare(`SELECT ${candidateColumns} FROM message WHERE message.id = ?`).get(messageId) as Row | undefined;
    return row ? candidateFromRow(row) : null;
  }

  /** Geprüft-Vermerke vergessen (alles neu prüfen). Von Hand zugeordnete Mails bleiben. */
  resetScans(): void {
    this.db.prepare("DELETE FROM subscriptionScan WHERE origin != 'user'").run();
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
    const id = this.#applyFinding(finding, mail, origin, now);
    this.db
      .prepare("INSERT OR REPLACE INTO subscriptionMail (subscriptionId, messageId, date, amount) VALUES (?, ?, ?, ?)")
      .run(id, mail.id, mail.date, finding.amount);
    return id;
  }

  /**
   * Passender Eintrag für einen Fund: gleicher Anbietername (auch über Konten und Domains hinweg, inkl. von Hand
   * zusammengeführter Namen), sonst gleiche Absender-Domain im selben Konto – außer bei Zahlungsdiensten.
   */
  #match(provider: string, providerKey: string, accountId: string): Row | undefined {
    const slug = providerSlug(provider);
    const rows = this.db.prepare("SELECT * FROM subscription ORDER BY createdAt").all() as Row[];
    const byName = rows.filter((r) => [providerSlug(String(r.provider)), ...aliasesOf(r)].some((known) => sameProvider(known, slug)));
    const named = byName.find((r) => r.accountId === accountId) ?? byName[0];
    if (named) return named;
    if (isBillingDomain(providerKey)) return undefined;
    return rows.find((r) => r.accountId === accountId && (r.providerKey === providerKey || aliasesOf(r).includes(providerKey)));
  }

  #applyFinding(finding: SubscriptionFinding, mail: { id: string; accountId: string; fromAddress: string; date: string }, origin: StoredSubscription["origin"], now: string): string {
    const providerKey = registeredDomain(mail.fromAddress) || mail.fromAddress.toLowerCase();
    const existing = this.#match(finding.provider, providerKey, mail.accountId);
    if (existing && existing.providerKey !== providerKey && !isBillingDomain(providerKey)) {
      this.#addAliases(String(existing.id), [providerKey]);
      // Zuerst nur über einen Zahlungsdienst bekannt: Name und Domain des Anbieters selbst übernehmen
      if (isBillingDomain(String(existing.providerKey)) && Number(existing.userEdited) === 0) {
        this.db.prepare("UPDATE subscription SET provider = ?, providerKey = ? WHERE id = ?").run(finding.provider, providerKey, existing.id);
        existing.provider = finding.provider;
        existing.providerKey = providerKey;
      }
    }
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
    this.db
      .prepare(
        `DELETE FROM subscription WHERE sourceMessageId = ? AND origin = 'rules' AND userEdited = 0 AND createdAt = updatedAt
           AND (SELECT count(*) FROM subscriptionMail m WHERE m.subscriptionId = subscription.id AND m.messageId != ?) = 0`,
      )
      .run(messageId, messageId);
    this.db.prepare("DELETE FROM subscriptionMail WHERE messageId = ? AND subscriptionId IN (SELECT id FROM subscription WHERE origin = 'rules' AND userEdited = 0)").run(messageId);
  }

  #addAliases(id: string, names: string[]): void {
    const row = this.db.prepare("SELECT aliases FROM subscription WHERE id = ?").get(id) as Row | undefined;
    if (!row) return;
    const merged = [...new Set([...aliasesOf(row), ...names.filter(Boolean)])];
    this.db.prepare("UPDATE subscription SET aliases = ? WHERE id = ?").run(JSON.stringify(merged), id);
  }

  /**
   * `sourceId` geht in `targetId` auf: Mails, Namen (für künftige Mails), fehlende Angaben und die Erinnerung
   * (falls das Ziel keine hat). Neuere Angaben gewinnen, außer das Ziel wurde von Hand korrigiert.
   */
  merge(targetId: string, sourceId: string, now: string): void {
    if (targetId === sourceId) return;
    const target = this.db.prepare("SELECT * FROM subscription WHERE id = ?").get(targetId) as Row | undefined;
    const source = this.db.prepare("SELECT * FROM subscription WHERE id = ?").get(sourceId) as Row | undefined;
    if (!target || !source) throw new Error("Diesen Eintrag gibt es nicht mehr.");
    this.db.transaction(() => {
      const t = fromRow(target);
      const src = fromRow(source);
      const sourceNewer = !t.userEdited && src.lastMailDate > t.lastMailDate;
      const pick = <T>(a: T | null, b: T | null): T | null => (sourceNewer ? (b ?? a) : (a ?? b));
      const fields = {
        amount: pick(t.amount, src.amount), interval: pick(t.interval, src.interval), startDate: pick(t.startDate, src.startDate),
        minTermMonths: pick(t.minTermMonths, src.minTermMonths), trialEnd: pick(t.trialEnd, src.trialEnd), termEnd: pick(t.termEnd, src.termEnd),
        renewalDate: pick(t.renewalDate, src.renewalDate), cancelBy: pick(t.cancelBy, src.cancelBy), notice: pick(t.notice, src.notice),
      };
      const computed = lastCancelDay({ ...fields, kind: t.kind, provider: t.provider, cancelled: t.status === "cancelled", quote: "" });
      this.db
        .prepare(
          `UPDATE subscription SET amount = @amount, amountCents = @amountCents, interval = @interval, startDate = @startDate, minTermMonths = @minTermMonths,
             trialEnd = @trialEnd, termEnd = @termEnd, renewalDate = @renewalDate, cancelBy = @cancelBy, notice = @notice, lastCancelDay = @lastCancelDay,
             quote = @quote, sourceMessageId = @sourceMessageId, lastMailDate = @lastMailDate, updatedAt = @now WHERE id = @id`,
        )
        .run({
          id: targetId, ...fields, amountCents: amountToCents(fields.amount), notice: fields.notice ? JSON.stringify(fields.notice) : null,
          lastCancelDay: t.userEdited ? t.lastCancelDay : computed ?? t.lastCancelDay ?? src.lastCancelDay,
          quote: sourceNewer ? src.quote : t.quote, sourceMessageId: sourceNewer ? src.sourceMessageId : t.sourceMessageId,
          lastMailDate: sourceNewer ? src.lastMailDate : t.lastMailDate, now,
        });
      this.db.prepare("INSERT OR IGNORE INTO subscriptionMail (subscriptionId, messageId, date, amount) SELECT ?, messageId, date, amount FROM subscriptionMail WHERE subscriptionId = ?").run(targetId, sourceId);
      this.#addAliases(targetId, [providerSlug(src.provider), src.providerKey, ...aliasesOf(source)]);
      const hasReminder = (sid: string) => this.db.prepare("SELECT 1 FROM reminder WHERE actionId = ? AND status = 'pending'").get(reminderKey(sid)) !== undefined;
      if (!hasReminder(targetId) && hasReminder(sourceId)) this.db.prepare("UPDATE reminder SET actionId = ? WHERE actionId = ? AND status = 'pending'").run(reminderKey(targetId), reminderKey(sourceId));
      else this.cancelReminder(sourceId);
      this.db.prepare("DELETE FROM subscription WHERE id = ?").run(sourceId);
    })();
  }

  /** Doppelte Einträge (gleicher Anbietername) zusammenführen – räumt Einträge aus der Zeit vor v17 auf. */
  mergeDuplicates(now: string): number {
    const rows = this.db.prepare("SELECT * FROM subscription ORDER BY createdAt").all() as Row[];
    const kept: Row[] = [];
    let merged = 0;
    for (const row of rows) {
      const slug = providerSlug(String(row.provider));
      const twin = kept.find((k) => [providerSlug(String(k.provider)), ...aliasesOf(k)].some((known) => sameProvider(known, slug)));
      if (twin && row.status !== "dismissed" && twin.status !== "dismissed") {
        this.merge(String(twin.id), String(row.id), now);
        merged++;
      } else kept.push(row);
    }
    return merged;
  }

  #mails(id: string): SubscriptionMailRef[] {
    return (
      this.db
        .prepare(
          `SELECT m.messageId, m.date, m.amount, message.subject FROM subscriptionMail m JOIN message ON message.id = m.messageId
           WHERE m.subscriptionId = ? ORDER BY m.date DESC`,
        )
        .all(id) as Row[]
    ).map((r) => ({ messageId: String(r.messageId), date: String(r.date), amount: str(r.amount), subject: String(r.subject) }));
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
    ).map((r) => ({ ...fromRow(r), mails: this.#mails(String(r.id)) }));
  }

  get(id: string): StoredSubscription | null {
    const row = this.db
      .prepare(
        `SELECT subscription.*, r.id AS reminderId, r.dueDate AS reminderDue FROM subscription
         LEFT JOIN reminder r ON r.actionId = 'sub:' || subscription.id AND r.status = 'pending' WHERE subscription.id = ?`,
      )
      .get(id) as Row | undefined;
    return row ? { ...fromRow(row), mails: this.#mails(String(row.id)) } : null;
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
