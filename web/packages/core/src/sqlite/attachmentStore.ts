import type Database from "better-sqlite3";
import { attachmentRuleKey, prefilterAttachment, type AttachmentDecision, type AttachmentRule } from "../attachments.js";
import type { RelevanceAttachment, RelevanceResult } from "../ai/attachmentRelevance.js";
import type { AttachmentRelevance } from "../models.js";

type Row = Record<string, unknown>;

export interface AttachmentMailCandidate {
  messageId: string;
  accountId: string;
  from: string;
  subject: string;
  body: string;
  attachments: (RelevanceAttachment & { sha256: string | null; origin: string | null })[];
}

/** Herkunft eines Relevanz-Urteils */
export type RelevanceOrigin = "prefilter" | "hash" | "rule" | "rules" | "onDevice" | "user";

/** Anhang-Relevanz (W9.1): Vorfilter, Regeln je Absender, Ergebnisse aus Regeln/KI. Spalten seit v1 bzw. v22. */
export class AttachmentStore {
  constructor(
    private readonly db: Database.Database,
    private readonly newId: () => string,
  ) {}

  /**
   * Stufe 0 für alle noch ungeprüften Anhänge: Vorfilter, gleiche Datei (Prüfsumme) schon beurteilt, Regel des Nutzers.
   * Gibt zurück, wie viele Anhänge so entschieden wurden.
   */
  prefilterPending(limit = 20_000): number {
    const rows = this.db
      .prepare(
        `SELECT attachment.*, lower(message.fromAddress) AS sender FROM attachment JOIN message ON message.id = attachment.messageId
         WHERE attachment.relevance IS NULL ORDER BY message.date DESC LIMIT ?`,
      )
      .all(limit) as Row[];
    const byHash = this.db.prepare(
      "SELECT relevance, relevanceReason, documentType FROM attachment WHERE sha256 = ? AND relevance IS NOT NULL AND relevanceOrigin IN ('onDevice', 'user', 'prefilter') LIMIT 1",
    );
    let decided = 0;
    this.db.transaction(() => {
      for (const row of rows) {
        const attachment = { filename: String(row.filename), mimeType: String(row.mimeType), size: Number(row.size), isInline: Number(row.isInline) === 1, contentId: row.contentId ? String(row.contentId) : null };
        const pre = prefilterAttachment(attachment);
        if (pre) {
          this.#set(String(row.id), pre.relevance, pre.documentType, pre.reason, "prefilter", 0);
          decided++;
          continue;
        }
        const rule = this.#ruleFor(String(row.sender), { filename: attachment.filename, documentType: row.documentType ? String(row.documentType) : null });
        if (rule) {
          this.#set(String(row.id), rule.decision === "read" ? "central" : "irrelevant", row.documentType ? String(row.documentType) : null, rule.decision === "read" ? "Von dir: immer lesen" : "Von dir: immer ignorieren", "rule", 0);
          decided++;
          continue;
        }
        const same = row.sha256 ? (byHash.get(String(row.sha256)) as Row | undefined) : undefined;
        if (same) {
          this.#set(String(row.id), same.relevance as AttachmentRelevance, same.documentType ? String(same.documentType) : null, `Gleiche Datei schon beurteilt: ${String(same.relevanceReason ?? "")}`, "hash", 0);
          decided++;
        }
      }
    })();
    return decided;
  }

  /** Mails mit Anhängen, die Regeln/KI noch beurteilen müssen (ohne Urteil oder nur nach Regeln). */
  candidates(limit: number, options: { includeRules?: boolean; version?: number } = {}): AttachmentMailCandidate[] {
    const where = options.includeRules
      ? "(attachment.relevance IS NULL OR (attachment.relevanceOrigin = 'rules') OR (attachment.relevanceOrigin = 'onDevice' AND coalesce(attachment.relevanceVersion, 0) < @version))"
      : "attachment.relevance IS NULL";
    const ids = this.db
      .prepare(
        `SELECT DISTINCT message.id, message.date FROM attachment JOIN message ON message.id = attachment.messageId
         JOIN mailbox ON mailbox.id = message.mailboxId
         WHERE ${where} AND mailbox.role NOT IN ('trash', 'spam') ORDER BY message.date DESC LIMIT @limit`,
      )
      .all({ limit, version: options.version ?? 0 }) as Row[];
    return ids.map((r) => this.candidate(String(r.id))).filter((c): c is AttachmentMailCandidate => c !== null && c.attachments.length > 0);
  }

  candidate(messageId: string): AttachmentMailCandidate | null {
    const m = this.db.prepare("SELECT id, accountId, fromName, fromAddress, subject, bodyText, snippet FROM message WHERE id = ?").get(messageId) as Row | undefined;
    if (!m) return null;
    const rows = this.db
      .prepare(
        `SELECT attachment.*, substr(attachmentText.text, 1, 600) AS snippet FROM attachment LEFT JOIN attachmentText ON attachmentText.attachmentId = attachment.id
         WHERE attachment.messageId = ? AND (attachment.relevanceOrigin IS NULL OR attachment.relevanceOrigin IN ('rules', 'onDevice')) ORDER BY attachment.id`,
      )
      .all(messageId) as Row[];
    return {
      messageId: String(m.id),
      accountId: String(m.accountId),
      from: m.fromName ? `${String(m.fromName)} <${String(m.fromAddress)}>` : String(m.fromAddress),
      subject: String(m.subject ?? ""),
      body: String(m.bodyText ?? m.snippet ?? ""),
      attachments: rows.map((r) => ({
        id: String(r.id), filename: String(r.filename), mimeType: String(r.mimeType), size: Number(r.size), pageCount: r.pageCount === null ? null : Number(r.pageCount),
        snippet: r.snippet ? String(r.snippet).replace(/\f/g, " ") : null, locked: Number(r.isEncrypted) === 1, sha256: r.sha256 ? String(r.sha256) : null, origin: r.relevanceOrigin ? String(r.relevanceOrigin) : null,
      })),
    };
  }

  save(results: RelevanceResult[], origin: "rules" | "onDevice", version: number): void {
    this.db.transaction(() => {
      for (const r of results) this.#set(r.id, r.relevance, r.documentType, r.reason, origin, version);
    })();
  }

  #set(id: string, relevance: AttachmentRelevance, documentType: string | null, reason: string, origin: RelevanceOrigin, version: number): void {
    // Gesperrte Anhänge bleiben „gesperrt“; Unwichtiges wird übersprungen; sonst wartet es auf die Tiefenanalyse
    this.db
      .prepare(
        `UPDATE attachment SET relevance = ?, documentType = coalesce(?, documentType), relevanceReason = ?, relevanceOrigin = ?, relevanceVersion = ?,
           analysisStatus = CASE WHEN analysisStatus IN ('locked', 'analyzed') THEN analysisStatus WHEN ? = 'irrelevant' THEN 'skipped' ELSE 'pending' END
         WHERE id = ?`,
      )
      .run(relevance, documentType, reason, origin, version, relevance, id);
  }

  #ruleFor(sender: string, attachment: { filename: string; documentType: string | null }): AttachmentRule | null {
    const key = attachmentRuleKey(attachment);
    const row = this.db.prepare("SELECT * FROM attachmentRule WHERE sender = ? AND match = ?").get(sender, key) as Row | undefined;
    return row ? ruleFromRow(row) : null;
  }

  /** „Trotzdem lesen“ / „unwichtig“ – auf Wunsch als Regel für diese Art von diesem Absender. Gibt die Regel zurück. */
  decide(attachmentId: string, decision: AttachmentDecision, remember: boolean, now: string): { sender: string; match: string } | null {
    const row = this.db
      .prepare("SELECT attachment.filename, attachment.documentType, lower(message.fromAddress) AS sender FROM attachment JOIN message ON message.id = attachment.messageId WHERE attachment.id = ?")
      .get(attachmentId) as Row | undefined;
    if (!row) throw new Error("Den Anhang gibt es nicht mehr.");
    this.#set(attachmentId, decision === "read" ? "central" : "irrelevant", null, decision === "read" ? "Von dir: lesen" : "Von dir: unwichtig", "user", 0);
    if (!remember) return null;
    const sender = String(row.sender);
    const match = attachmentRuleKey({ filename: String(row.filename), documentType: row.documentType ? String(row.documentType) : null });
    this.db
      .prepare("INSERT INTO attachmentRule (id, sender, match, decision, createdAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sender, match) DO UPDATE SET decision = excluded.decision")
      .run(this.newId(), sender, match, decision, now);
    // Andere, nicht vom Nutzer entschiedene Anhänge dieser Art vom selben Absender folgen
    const others = this.db
      .prepare(
        `SELECT attachment.id, attachment.filename, attachment.documentType FROM attachment JOIN message ON message.id = attachment.messageId
         WHERE lower(message.fromAddress) = ? AND attachment.id <> ? AND coalesce(attachment.relevanceOrigin, '') <> 'user'`,
      )
      .all(sender, attachmentId) as Row[];
    for (const o of others) {
      if (attachmentRuleKey({ filename: String(o.filename), documentType: o.documentType ? String(o.documentType) : null }) !== match) continue;
      this.#set(String(o.id), decision === "read" ? "central" : "irrelevant", null, decision === "read" ? "Von dir: immer lesen" : "Von dir: immer ignorieren", "rule", 0);
    }
    return { sender, match };
  }

  rules(): AttachmentRule[] {
    return (this.db.prepare("SELECT * FROM attachmentRule ORDER BY createdAt DESC").all() as Row[]).map(ruleFromRow);
  }

  removeRule(id: string): void {
    this.db.prepare("DELETE FROM attachmentRule WHERE id = ?").run(id);
  }

  /** „Alles neu prüfen“: Urteile aus Regeln, KI und Prüfsumme vergessen (Entscheidungen des Nutzers bleiben). */
  resetScans(): void {
    this.db.prepare("UPDATE attachment SET relevance = NULL, relevanceReason = NULL, relevanceOrigin = NULL, relevanceVersion = NULL WHERE coalesce(relevanceOrigin, '') NOT IN ('user', 'rule')").run();
  }

  /** Zentrale Anhänge mit Text, die noch keine Tiefenanalyse haben (W9.2) */
  pendingDeepAnalysis(limit: number): { id: string; messageId: string; accountId: string; filename: string; text: string }[] {
    return (
      this.db
        .prepare(
          `SELECT attachment.id, attachment.messageId, message.accountId, attachment.filename, attachmentText.text FROM attachment
           JOIN message ON message.id = attachment.messageId JOIN attachmentText ON attachmentText.attachmentId = attachment.id
           WHERE attachment.relevance = 'central' AND attachment.analysisStatus = 'pending'
             AND NOT EXISTS (SELECT 1 FROM attachmentAnalysis WHERE attachmentAnalysis.attachmentId = attachment.id)
           ORDER BY message.date DESC LIMIT ?`,
        )
        .all(limit) as Row[]
    ).map((r) => ({ id: String(r.id), messageId: String(r.messageId), accountId: String(r.accountId), filename: String(r.filename), text: String(r.text) }));
  }

  /** Absender und Mailtexte, in denen ein Passwort stehen könnte: Verlauf und Mails desselben Absenders ±3 Tage. */
  passwordContext(attachmentId: string): { sender: string; filename: string; mimeType: string; texts: string[] } | null {
    const row = this.db
      .prepare(
        `SELECT attachment.filename, attachment.mimeType, message.id AS messageId, message.threadId, message.date, lower(message.fromAddress) AS sender
         FROM attachment JOIN message ON message.id = attachment.messageId WHERE attachment.id = ?`,
      )
      .get(attachmentId) as Row | undefined;
    if (!row) return null;
    const date = new Date(String(row.date)).getTime();
    const from = new Date(date - 3 * 86_400_000).toISOString();
    const to = new Date(date + 3 * 86_400_000).toISOString();
    const texts = (
      this.db
        .prepare(
          `SELECT subject, substr(coalesce(bodyText, snippet), 1, 20000) AS body FROM message
           WHERE threadId = @thread OR (lower(fromAddress) = @sender AND date BETWEEN @from AND @to) ORDER BY date LIMIT 30`,
        )
        .all({ thread: row.threadId, sender: row.sender, from, to }) as Row[]
    ).map((m) => `${String(m.subject ?? "")}\n${String(m.body ?? "")}`);
    return { sender: String(row.sender), filename: String(row.filename), mimeType: String(row.mimeType), texts };
  }

  /** Entsperrt: Text für Suche und KI speichern (nur auf diesem Rechner), Status „wartet auf Analyse“. Datei bleibt verschlüsselt. */
  markUnlocked(attachmentId: string, text: string, pageCount: number): void {
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO attachmentText (attachmentId, text, source) VALUES (?, ?, 'pdf') ON CONFLICT(attachmentId) DO UPDATE SET text = excluded.text, source = excluded.source")
        .run(attachmentId, text);
      this.db.prepare("UPDATE attachment SET pageCount = ?, analysisStatus = 'pending', relevance = NULL, relevanceOrigin = NULL WHERE id = ?").run(pageCount, attachmentId);
    })();
  }

  setAnalysisStatus(attachmentId: string, status: "analyzed" | "failed" | "pending"): void {
    this.db.prepare("UPDATE attachment SET analysisStatus = ? WHERE id = ? AND analysisStatus <> 'locked'").run(status, attachmentId);
  }
}

function ruleFromRow(r: Row): AttachmentRule {
  return { id: String(r.id), sender: String(r.sender), match: String(r.match), decision: String(r.decision) === "read" ? "read" : "ignore", createdAt: String(r.createdAt) };
}
