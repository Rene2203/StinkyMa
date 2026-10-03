import type Database from "better-sqlite3";
import type { ReceiptFinding } from "../ai/receipts.js";
import type { EmailAddress, MessageCategory } from "../models.js";
import type { ReceiptEdit, ReceiptStatus, StoredReceipt } from "../receipts.js";
import { archiveDuplicate } from "./repository.js";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const reminderKey = (id: string) => `rcpt:${id}`;

/** Kandidat für die Belegsuche */
export interface ReceiptCandidate {
  id: string;
  accountId: string;
  from: EmailAddress;
  subject: string;
  body: string;
  date: string;
  category: MessageCategory | null;
  attachmentText: string;
}

const candidateColumns = `message.id, message.accountId, message.fromName, message.fromAddress, message.subject, message.date, message.category,
  substr(COALESCE(message.bodyText, message.snippet), 1, 4000) AS body,
  (SELECT substr(group_concat(t.text, char(10)), 1, 4000) FROM attachmentText t JOIN attachment a ON a.id = t.attachmentId
   WHERE a.messageId = message.id AND coalesce(a.relevance, '') <> 'irrelevant') AS attachmentText`;

function candidateFromRow(r: Row): ReceiptCandidate {
  return {
    id: String(r.id), accountId: String(r.accountId), from: { name: str(r.fromName), address: String(r.fromAddress) },
    subject: String(r.subject), body: String(r.body ?? ""), date: String(r.date), category: str(r.category) as MessageCategory | null,
    attachmentText: String(r.attachmentText ?? ""),
  };
}

function reviewOf(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Vergleichsschlüssel für Händler (gelernte Kategorie): Kleinbuchstaben, ohne Rechtsform und Satzzeichen */
export function merchantKey(merchant: string): string {
  return merchant.toLowerCase().replace(/\b(gmbh|ag|kg|e\.?\s?v\.?|ug|inc|ltd|llc|se)\b/g, "").replace(/[^a-z0-9äöüß]/g, "");
}

/** Speicher für den Belegordner (W7.2). */
export class ReceiptStore {
  constructor(
    private readonly db: Database.Database,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  /** Noch nicht geprüfte Mails (Posteingang, Archiv, eigene Ordner), neueste zuerst. */
  candidates(limit: number, options: { recheckRules?: boolean } = {}): ReceiptCandidate[] {
    return (
      this.db
        .prepare(
          `SELECT ${candidateColumns}
           FROM message JOIN mailbox ON mailbox.id = message.mailboxId
           LEFT JOIN receiptScan s ON s.messageId = message.id
           WHERE mailbox.role IN ('inbox', 'archive', 'custom') AND NOT ${archiveDuplicate}
             AND (s.messageId IS NULL ${options.recheckRules ? "OR s.origin = 'rules'" : ""})
           ORDER BY message.date DESC LIMIT ?`,
        )
        .all(limit) as Row[]
    ).map(candidateFromRow);
  }

  candidate(messageId: string): ReceiptCandidate | null {
    const row = this.db.prepare(`SELECT ${candidateColumns} FROM message WHERE message.id = ?`).get(messageId) as Row | undefined;
    return row ? candidateFromRow(row) : null;
  }

  markScanned(messageIds: string[], origin: string, promptVersion: number, at: string): void {
    const stmt = this.db.prepare(
      `INSERT INTO receiptScan (messageId, origin, promptVersion, scannedAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(messageId) DO UPDATE SET origin = excluded.origin, promptVersion = excluded.promptVersion, scannedAt = excluded.scannedAt`,
    );
    this.db.transaction(() => {
      for (const id of messageIds) stmt.run(id, origin, promptVersion, at);
    })();
  }

  resetScans(): void {
    this.db.prepare("DELETE FROM receiptScan WHERE origin != 'user'").run();
  }

  /** Gelernte Kategorie des Händlers (vom Nutzer gesetzt) */
  learnedCategory(merchant: string): string | null {
    const row = this.db.prepare("SELECT category FROM receiptMerchantCategory WHERE merchantKey = ?").get(merchantKey(merchant)) as Row | undefined;
    return row ? String(row.category) : null;
  }

  /**
   * Fund übernehmen (ein Beleg je Mail). Vom Nutzer geänderte Belege bleiben, wie sie sind; ein neuer Fund für dieselbe
   * Mail (z. B. Modell nach Regeln) ersetzt den alten. Gibt die ID zurück.
   */
  apply(finding: ReceiptFinding, mail: { id: string; accountId: string; from: EmailAddress; subject: string; date: string }, origin: StoredReceipt["origin"], now: string): string {
    const existing = this.db.prepare("SELECT id, userEdited, status FROM receipt WHERE messageId = ?").get(mail.id) as Row | undefined;
    const category = this.learnedCategory(finding.merchant) ?? finding.category;
    const fields = {
      merchant: finding.merchant, date: finding.date, grossCents: finding.grossCents, netCents: finding.netCents, vatCents: finding.vatCents,
      invoiceNumber: finding.invoiceNumber, dueDate: finding.dueDate, category, quote: finding.quote, review: JSON.stringify(finding.review), origin, now,
    };
    if (existing) {
      if (Number(existing.userEdited) !== 0) return String(existing.id);
      this.db
        .prepare(
          `UPDATE receipt SET merchant = @merchant, date = @date, grossCents = @grossCents, netCents = @netCents, vatCents = @vatCents,
             invoiceNumber = @invoiceNumber, dueDate = @dueDate, category = @category, quote = @quote, review = @review, origin = @origin, updatedAt = @now
           WHERE id = @id`,
        )
        .run({ ...fields, id: existing.id });
      return String(existing.id);
    }
    const id = this.newId();
    this.db
      .prepare(
        `INSERT INTO receipt (id, accountId, messageId, merchant, date, grossCents, netCents, vatCents, currency, invoiceNumber, dueDate, category, quote, review,
           status, origin, userEdited, mailSubject, mailFrom, mailDate, createdAt, updatedAt)
         VALUES (@id, @accountId, @messageId, @merchant, @date, @grossCents, @netCents, @vatCents, 'EUR', @invoiceNumber, @dueDate, @category, @quote, @review,
           'active', @origin, 0, @mailSubject, @mailFrom, @mailDate, @now, @now)`,
      )
      .run({
        ...fields, id, accountId: mail.accountId, messageId: mail.id, mailSubject: mail.subject,
        mailFrom: mail.from.name ? `${mail.from.name} <${mail.from.address}>` : mail.from.address, mailDate: mail.date,
      });
    return id;
  }

  /** Laut Modell kein Beleg: nur per Regel angelegte, unveränderte Belege dieser Mail entfernen. */
  removeIfRulesOnly(messageId: string): void {
    this.db.prepare("DELETE FROM receipt WHERE messageId = ? AND origin = 'rules' AND userEdited = 0").run(messageId);
  }

  #fromRow(r: Row): StoredReceipt {
    const messageId = str(r.messageId);
    const attachments = messageId
      ? (
          this.db
            .prepare(
              `SELECT id, filename FROM attachment WHERE messageId = ? AND isInline = 0
               AND (lower(filename) LIKE '%.pdf' OR mimeType = 'application/pdf' OR mimeType LIKE 'image/%') ORDER BY filename`,
            )
            .all(messageId) as Row[]
        )
          .map((a) => ({ id: String(a.id), filename: String(a.filename) }))
          // AGB, Datenschutz, Widerruf sind keine Belege (kommen oft mit der Rechnung)
          .filter((a) => !/(agb|datenschutz|widerruf|terms|conditions|privacy|nutzungsbedingungen)/i.test(a.filename))
      : [];
    return {
      id: String(r.id), accountId: String(r.accountId), messageId, merchant: String(r.merchant), date: String(r.date),
      grossCents: num(r.grossCents), netCents: num(r.netCents), vatCents: num(r.vatCents), currency: String(r.currency),
      invoiceNumber: str(r.invoiceNumber), dueDate: str(r.dueDate), category: str(r.category), quote: String(r.quote ?? ""),
      review: reviewOf(r.review), status: String(r.status) as ReceiptStatus, origin: String(r.origin) as StoredReceipt["origin"],
      userEdited: Number(r.userEdited) !== 0, mailSubject: String(r.mailSubject), mailFrom: String(r.mailFrom), mailDate: String(r.mailDate),
      attachments, reminder: r.reminderId ? { id: String(r.reminderId), dueDate: String(r.reminderDue) } : null,
    };
  }

  /** Belege eines Jahres (null = alle), neueste zuerst; Mail weg → messageId null. */
  list(year: number | null): StoredReceipt[] {
    return (
      this.db
        .prepare(
          `SELECT receipt.*, CASE WHEN EXISTS (SELECT 1 FROM message WHERE message.id = receipt.messageId) THEN receipt.messageId END AS messageId,
                  r.id AS reminderId, r.dueDate AS reminderDue
           FROM receipt LEFT JOIN reminder r ON r.actionId = 'rcpt:' || receipt.id AND r.status = 'pending'
           WHERE (? IS NULL OR substr(receipt.date, 1, 4) = ?) ORDER BY receipt.date DESC, receipt.merchant`,
        )
        .all(year, year === null ? null : String(year)) as Row[]
    ).map((r) => this.#fromRow(r));
  }

  get(id: string): StoredReceipt | null {
    const row = this.db
      .prepare(
        `SELECT receipt.*, CASE WHEN EXISTS (SELECT 1 FROM message WHERE message.id = receipt.messageId) THEN receipt.messageId END AS messageId,
                r.id AS reminderId, r.dueDate AS reminderDue
         FROM receipt LEFT JOIN reminder r ON r.actionId = 'rcpt:' || receipt.id AND r.status = 'pending' WHERE receipt.id = ?`,
      )
      .get(id) as Row | undefined;
    return row ? this.#fromRow(row) : null;
  }

  years(): number[] {
    return (this.db.prepare("SELECT DISTINCT substr(date, 1, 4) AS y FROM receipt ORDER BY y DESC").all() as Row[]).map((r) => Number(r.y)).filter((y) => y > 1900);
  }

  /** Von Hand ändern – danach überschreiben neue Funde nichts mehr. Prüfhinweise fallen weg (der Nutzer hat geprüft). */
  update(id: string, edit: ReceiptEdit, now: string): void {
    const current = this.get(id);
    if (!current) throw new Error("Diesen Beleg gibt es nicht mehr.");
    const pick = <K extends keyof ReceiptEdit>(key: K, fallback: unknown) => (edit[key] !== undefined ? edit[key] : fallback);
    const merchant = String(pick("merchant", current.merchant)).trim().slice(0, 80) || current.merchant;
    const date = String(pick("date", current.date));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Bitte ein gültiges Datum eingeben.");
    const category = pick("category", current.category) as string | null;
    this.db
      .prepare(
        `UPDATE receipt SET merchant = ?, date = ?, grossCents = ?, netCents = ?, vatCents = ?, invoiceNumber = ?, dueDate = ?, category = ?,
           review = '[]', userEdited = 1, origin = 'user', updatedAt = ? WHERE id = ?`,
      )
      .run(merchant, date, pick("grossCents", current.grossCents), pick("netCents", current.netCents), pick("vatCents", current.vatCents),
        pick("invoiceNumber", current.invoiceNumber), pick("dueDate", current.dueDate), category, now, id);
    if (edit.rememberCategory && category) {
      this.db
        .prepare("INSERT INTO receiptMerchantCategory (merchantKey, category, learnedAt) VALUES (?, ?, ?) ON CONFLICT(merchantKey) DO UPDATE SET category = excluded.category, learnedAt = excluded.learnedAt")
        .run(merchantKey(merchant), category, now);
      // Andere, nicht von Hand geänderte Belege desselben Händlers folgen
      const others = this.db.prepare("SELECT id, merchant FROM receipt WHERE userEdited = 0 AND id != ?").all(id) as Row[];
      const key = merchantKey(merchant);
      const stmt = this.db.prepare("UPDATE receipt SET category = ?, updatedAt = ? WHERE id = ?");
      for (const other of others) if (merchantKey(String(other.merchant)) === key) stmt.run(category, now, other.id);
    }
  }

  setStatus(id: string, status: ReceiptStatus, now: string): void {
    this.db.prepare("UPDATE receipt SET status = ?, updatedAt = ? WHERE id = ?").run(status, now, id);
    if (status !== "active") this.cancelReminder(id);
  }

  categories(): string[] {
    return (this.db.prepare("SELECT name FROM receiptCategory ORDER BY sortOrder, name").all() as Row[]).map((r) => String(r.name));
  }

  addCategory(name: string): void {
    const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!clean) throw new Error("Bitte einen Namen eingeben.");
    if (this.categories().some((c) => c.toLowerCase() === clean.toLowerCase())) throw new Error("Diese Kategorie gibt es schon.");
    const order = (this.db.prepare("SELECT COALESCE(MAX(sortOrder), -1) + 1 AS n FROM receiptCategory").get() as { n: number }).n;
    this.db.prepare("INSERT INTO receiptCategory (name, sortOrder) VALUES (?, ?)").run(clean, order);
  }

  /** Kategorie entfernen: Belege behalten ihren Betrag, verlieren nur die Kategorie. */
  removeCategory(name: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM receiptCategory WHERE name = ?").run(name);
      this.db.prepare("UPDATE receipt SET category = NULL WHERE category = ?").run(name);
      this.db.prepare("DELETE FROM receiptMerchantCategory WHERE category = ?").run(name);
    })();
  }

  addReminder(id: string, dueDate: string, text: string): void {
    const receipt = this.get(id);
    if (!receipt) throw new Error("Diesen Beleg gibt es nicht mehr.");
    this.cancelReminder(id);
    this.db
      .prepare("INSERT INTO reminder (id, messageId, dueDate, text, actionId, status) VALUES (?, ?, ?, ?, ?, 'pending')")
      .run(this.newId(), receipt.messageId, dueDate, text, reminderKey(id));
  }

  cancelReminder(id: string): void {
    this.db.prepare("UPDATE reminder SET status = 'cancelled' WHERE actionId = ? AND status = 'pending'").run(reminderKey(id));
  }
}
