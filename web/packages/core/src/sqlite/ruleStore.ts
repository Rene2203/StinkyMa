import type Database from "better-sqlite3";
import type { MessageCategory } from "../models.js";
import { emptyRule, type MailRule, type RuleDefinition } from "../rules.js";

type Row = Record<string, unknown>;

/** Was eine Regel von einer Mail braucht (ohne Inhalt). */
export interface RuleCandidate {
  id: string;
  accountId: string;
  from: { name: string | null; address: string };
  subject: string;
  date: string;
  category: MessageCategory | null;
  hasAttachments: boolean;
}

function parseDefinition(json: string): RuleDefinition {
  try {
    return { ...emptyRule, ...(JSON.parse(json) as Partial<RuleDefinition>) };
  } catch {
    return { ...emptyRule };
  }
}

const ruleFromRow = (r: Row): MailRule => ({
  id: String(r.id),
  text: String(r.text),
  accountId: r.accountId ? String(r.accountId) : null,
  definition: parseDefinition(String(r.definition)),
  enabled: Number(r.enabled) === 1,
  createdAt: String(r.createdAt),
});

const candidateFromRow = (r: Row): RuleCandidate => ({
  id: String(r.id),
  accountId: String(r.accountId),
  from: { name: r.fromName ? String(r.fromName) : null, address: String(r.fromAddress) },
  subject: String(r.subject),
  date: String(r.date),
  category: r.category ? (String(r.category) as MessageCategory) : null,
  hasAttachments: Number(r.hasAttachments) === 1,
});

const candidateColumns = "m.id, m.accountId, m.fromName, m.fromAddress, m.subject, m.date, m.category, m.hasAttachments";

/** Regeln (W6.4) und die Warteschlange neu angekommener Mails. */
export class RuleStore {
  constructor(private readonly db: Database.Database) {}

  list(): MailRule[] {
    return (this.db.prepare("SELECT * FROM mailRule ORDER BY createdAt, id").all() as Row[]).map(ruleFromRow);
  }

  get(id: string): MailRule | null {
    const row = this.db.prepare("SELECT * FROM mailRule WHERE id = ?").get(id) as Row | undefined;
    return row ? ruleFromRow(row) : null;
  }

  insert(rule: MailRule): void {
    this.db
      .prepare("INSERT INTO mailRule (id, text, accountId, definition, enabled, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
      .run(rule.id, rule.text, rule.accountId, JSON.stringify(rule.definition), rule.enabled ? 1 : 0, rule.createdAt);
  }

  update(id: string, patch: Partial<Pick<MailRule, "text" | "accountId" | "definition" | "enabled">>): void {
    const current = this.get(id);
    if (!current) return;
    const next = { ...current, ...patch };
    this.db
      .prepare("UPDATE mailRule SET text = ?, accountId = ?, definition = ?, enabled = ? WHERE id = ?")
      .run(next.text, next.accountId, JSON.stringify(next.definition), next.enabled ? 1 : 0, id);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM mailRule WHERE id = ?").run(id);
  }

  /** Namen eigener Ordner (für Regeln „in den Ordner …“), über alle echten Konten, ohne Doppelte. */
  folders(accountId: string | null): string[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT name FROM mailbox WHERE role = 'custom' ${accountId ? "AND accountId = ?" : ""} ORDER BY name COLLATE NOCASE`)
      .all(...(accountId ? [accountId] : [])) as { name: string }[];
    return rows.map((r) => r.name);
  }

  /** Eigener Ordner eines Kontos mit diesem Namen (Groß-/Kleinschreibung egal). */
  folderId(accountId: string, name: string): string | null {
    const row = this.db.prepare("SELECT id FROM mailbox WHERE accountId = ? AND role = 'custom' AND name = ? COLLATE NOCASE").get(accountId, name) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /** Posteingangs-Mails (neueste zuerst) – für die Vorschau „trifft auf … zu“ und „auch auf vorhandene anwenden“. */
  inboxCandidates(accountId: string | null, limit: number): RuleCandidate[] {
    return (
      this.db
        .prepare(
          `SELECT ${candidateColumns} FROM message m JOIN mailbox b ON b.id = m.mailboxId
           WHERE b.role = 'inbox' ${accountId ? "AND m.accountId = ?" : ""} ORDER BY m.date DESC LIMIT ?`,
        )
        .all(...(accountId ? [accountId, limit] : [limit])) as Row[]
    ).map(candidateFromRow);
  }

  enqueue(messageIds: string[], at: string): void {
    const insert = this.db.prepare("INSERT OR IGNORE INTO ruleQueue (messageId, queuedAt) SELECT id, ? FROM message WHERE id = ?");
    this.db.transaction(() => {
      for (const id of messageIds) insert.run(at, id);
    })();
  }

  /** Wartende Mails, die noch im Posteingang liegen (verschobene fallen per Fremdschlüssel/Ordner heraus). */
  queued(limit = 200): (RuleCandidate & { queuedAt: string })[] {
    const rows = this.db
      .prepare(
        `SELECT ${candidateColumns}, q.queuedAt, b.role FROM ruleQueue q JOIN message m ON m.id = q.messageId JOIN mailbox b ON b.id = m.mailboxId
         ORDER BY q.queuedAt LIMIT ?`,
      )
      .all(limit) as Row[];
    const notInbox = rows.filter((r) => r.role !== "inbox").map((r) => String(r.id));
    if (notInbox.length) this.dequeue(notInbox);
    return rows.filter((r) => r.role === "inbox").map((r) => ({ ...candidateFromRow(r), queuedAt: String(r.queuedAt) }));
  }

  dequeue(messageIds: string[]): void {
    const remove = this.db.prepare("DELETE FROM ruleQueue WHERE messageId = ?");
    this.db.transaction(() => {
      for (const id of messageIds) remove.run(id);
    })();
  }
}
