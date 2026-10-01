import type Database from "better-sqlite3";
import type { MockDataSet } from "../mockData.js";

/** Schreibt einen Datensatz (z. B. die Mock-Daten) in eine leere Datenbank. Gibt `false` zurück, wenn schon Konten da sind. */
export function seedIfEmpty(db: Database.Database, data: MockDataSet): boolean {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM account").get() as { n: number };
  if (n > 0) return false;

  const insertAccount = db.prepare(
    `INSERT INTO account (id, email, displayName, provider, username, imapHost, imapPort, imapSecurity, smtpHost, smtpPort,
       smtpSecurity, authType, color, aiCloudAllowed, sortOrder, lastSyncAt, syncError)
     VALUES (@id, @email, @displayName, @provider, @username, @imapHost, @imapPort, @imapSecurity, @smtpHost, @smtpPort,
       @smtpSecurity, @authType, @color, @aiCloudAllowed, @sortOrder, @lastSyncAt, @syncError)`,
  );
  const insertMailbox = db.prepare(
    `INSERT INTO mailbox (id, accountId, name, role, uidValidity, highestModSeq)
     VALUES (@id, @accountId, @name, @role, @uidValidity, @highestModSeq)`,
  );
  const insertThread = db.prepare(
    `INSERT INTO thread (id, subject, participants, lastDate, summary, summaryUpdatedAt)
     VALUES (@id, @subject, @participants, @lastDate, @summary, @summaryUpdatedAt)`,
  );
  const insertMessage = db.prepare(
    `INSERT INTO message (id, accountId, mailboxId, uid, messageId, threadId, fromName, fromAddress, "to", cc, subject, date,
       snippet, bodyText, bodyHTML, flags, hasAttachments, category, priorityScore, snoozedUntil, listUnsubscribe)
     VALUES (@id, @accountId, @mailboxId, @uid, @messageId, @threadId, @fromName, @fromAddress, @to, @cc, @subject, @date,
       @snippet, @bodyText, @bodyHtml, @flags, @hasAttachments, @category, @priorityScore, @snoozedUntil, @listUnsubscribe)`,
  );
  const insertAttachment = db.prepare(
    `INSERT INTO attachment (id, messageId, filename, mimeType, size, localPath, sha256, isInline, contentId, pageCount,
       isEncrypted, relevance, relevanceReason, documentType, analysisStatus, riskFlags)
     VALUES (@id, @messageId, @filename, @mimeType, @size, @localPath, @sha256, @isInline, @contentId, @pageCount,
       @isEncrypted, @relevance, @relevanceReason, @documentType, @analysisStatus, @riskFlags)`,
  );

  db.transaction(() => {
    for (const a of data.accounts) {
      insertAccount.run({ lastSyncAt: null, syncError: null, ...a, aiCloudAllowed: a.aiCloudAllowed ? 1 : 0 });
    }
    for (const m of data.mailboxes) insertMailbox.run({ uidValidity: null, highestModSeq: null, ...m });
    for (const t of data.threads) {
      insertThread.run({ summary: null, summaryUpdatedAt: null, ...t, participants: JSON.stringify(t.participants) });
    }
    for (const m of data.messages) {
      insertMessage.run({
        uid: null, messageId: null, bodyText: null, bodyHtml: null, category: null, priorityScore: null, snoozedUntil: null,
        ...m,
        fromName: m.from.name ?? null, fromAddress: m.from.address,
        to: JSON.stringify(m.to), cc: JSON.stringify(m.cc), hasAttachments: m.hasAttachments ? 1 : 0,
        listUnsubscribe: demoListUnsubscribe(m.category ?? null, m.from.address),
      });
    }
    for (const a of data.attachments) {
      insertAttachment.run({
        localPath: null, sha256: null, contentId: null, pageCount: null, relevance: null, relevanceReason: null, documentType: null,
        ...a,
        isInline: a.isInline ? 1 : 0, isEncrypted: a.isEncrypted ? 1 : 0,
      });
    }
  })();
  return true;
}

/** Beispiel-Newsletter bieten eine Ein-Klick-Abmeldung an (wird bei Beispielkonten nur vermerkt, nie gesendet). */
function demoListUnsubscribe(category: string | null, address: string): string {
  if (category !== "newsletter") return "";
  const domain = address.split("@")[1] ?? "newsletter.example";
  const url = `https://${domain}/abmelden`;
  // Ein Beispiel nur mit Abmelde-Seite (öffnet im Fenster in der App)
  if (domain.startsWith("tech-briefing")) return JSON.stringify({ oneClickUrl: null, url, mailto: null });
  return JSON.stringify({ oneClickUrl: url, url, mailto: { address: `abmelden@${domain}`, subject: "unsubscribe", body: "unsubscribe" } });
}
