import type Database from "better-sqlite3";
import { medianHours, type ContactProfile, type ContactsApi } from "../contacts.js";
import { registeredDomain } from "../cleanup.js";

type Row = Record<string, unknown>;

/** Absender-Steckbrief aus vorhandenen Daten (Mails, Zusagen, Aktionen, Belege, Abos) – ohne KI. */
export class ContactStore implements ContactsApi {
  constructor(private readonly db: Database.Database) {}

  async profile(rawAddress: string): Promise<ContactProfile> {
    const address = rawAddress.trim().toLowerCase();
    if (!address.includes("@")) throw new Error("Ungültige Adresse.");
    const domain = registeredDomain(address) || address.split("@")[1] || address;
    const db = this.db;
    // Mails von ihr (nicht Papierkorb/Spam) und von mir an sie (Gesendet)
    const mine = `mailbox.role = 'sent' AND instr(lower(message."to"), ?) > 0`;
    const theirs = `lower(message.fromAddress) = ? AND mailbox.role NOT IN ('trash', 'spam', 'sent', 'drafts')`;
    const count = (where: string) =>
      (db.prepare(`SELECT COUNT(*) AS n, MIN(message.date) AS first, MAX(message.date) AS last FROM message JOIN mailbox ON mailbox.id = message.mailboxId WHERE ${where}`).get(address) as Row);
    const r = count(theirs);
    const s = count(mine);
    const name = (db.prepare("SELECT fromName FROM message WHERE lower(fromAddress) = ? AND fromName IS NOT NULL ORDER BY date DESC LIMIT 1").get(address) as Row | undefined)?.fromName;

    // Antwortzeiten im selben Verlauf (letzte 300 Mails mit ihr)
    const rows = db
      .prepare(
        `SELECT message.threadId, message.date, CASE WHEN mailbox.role = 'sent' THEN 1 ELSE 0 END AS fromMe FROM message JOIN mailbox ON mailbox.id = message.mailboxId
         WHERE (${theirs}) OR (${mine}) ORDER BY message.date DESC LIMIT 300`,
      )
      .all(address, address) as Row[];
    const byThread = new Map<string, { date: number; fromMe: boolean }[]>();
    for (const row of rows) {
      const list = byThread.get(String(row.threadId)) ?? [];
      list.push({ date: new Date(String(row.date)).getTime(), fromMe: Number(row.fromMe) === 1 });
      byThread.set(String(row.threadId), list);
    }
    const iReply: number[] = [];
    const theyReply: number[] = [];
    for (const list of byThread.values()) {
      list.sort((a, b) => a.date - b.date);
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1]!;
        const cur = list[i]!;
        if (prev.fromMe === cur.fromMe) continue;
        (cur.fromMe ? iReply : theyReply).push(cur.date - prev.date);
      }
    }

    const recent = (
      db
        .prepare(
          `SELECT message.threadId, message.id, message.subject, message.date, CASE WHEN mailbox.role = 'sent' THEN 1 ELSE 0 END AS fromMe
           FROM message JOIN mailbox ON mailbox.id = message.mailboxId WHERE (${theirs}) OR (${mine}) ORDER BY message.date DESC LIMIT 40`,
        )
        .all(address, address) as Row[]
    )
      .filter((row, i, all) => all.findIndex((x) => x.threadId === row.threadId) === i)
      .slice(0, 5)
      .map((row) => ({ threadId: String(row.threadId), messageId: String(row.id), subject: String(row.subject ?? ""), date: String(row.date), fromMe: Number(row.fromMe) === 1 }));

    const promises = (
      db.prepare("SELECT id, direction, text, dueDate FROM promise WHERE status = 'open' AND lower(counterpartAddress) = ? ORDER BY dueDate").all(address) as Row[]
    ).map((p) => ({ id: String(p.id), direction: String(p.direction) as "mine" | "theirs", text: String(p.text), dueDate: String(p.dueDate) }));

    const actions = (
      db
        .prepare(
          `SELECT a.id, a.type, a.title, a.date, a.messageId FROM messageAction a JOIN message ON message.id = a.messageId
           WHERE a.status = 'open' AND lower(message.fromAddress) = ? ORDER BY COALESCE(a.date, '9999') LIMIT 10`,
        )
        .all(address) as Row[]
    ).map((a) => ({ id: String(a.id), type: String(a.type), title: String(a.title), date: a.date ? String(a.date) : null, messageId: String(a.messageId) }));

    // Belege: Mails dieses Absenders oder gleicher Händlername
    const receiptRow = db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(grossCents), 0) AS cents FROM receipt
         WHERE status = 'active' AND (lower(mailFrom) LIKE '%' || ? || '%' OR messageId IN (SELECT id FROM message WHERE lower(fromAddress) = ?))`,
      )
      .get(`<${address}>`, address) as Row;

    const sub = db
      .prepare("SELECT provider, amount, interval FROM subscription WHERE status = 'active' AND (providerKey = ? OR instr(aliases, ?) > 0) ORDER BY updatedAt DESC LIMIT 1")
      .get(domain, domain) as Row | undefined;
    const usual = db
      .prepare("SELECT category, COUNT(*) AS n FROM message WHERE lower(fromAddress) = ? AND category IS NOT NULL GROUP BY category ORDER BY n DESC LIMIT 1")
      .get(address) as Row | undefined;
    const own = db
      .prepare("SELECT userCategory.name FROM senderUserCategory JOIN userCategory ON userCategory.id = senderUserCategory.categoryId WHERE senderUserCategory.address = ?")
      .get(address) as Row | undefined;

    return {
      address,
      name: name ? String(name) : null,
      domain,
      received: Number(r.n),
      sent: Number(s.n),
      firstContact: [r.first, s.first].filter(Boolean).map(String).sort()[0] ?? null,
      lastContact: [r.last, s.last].filter(Boolean).map(String).sort().at(-1) ?? null,
      theyReplyHours: medianHours(theyReply),
      iReplyHours: medianHours(iReply),
      recent,
      promises,
      actions,
      receipts: { count: Number(receiptRow.n), totalCents: Number(receiptRow.cents) },
      subscription: sub ? { provider: String(sub.provider), amount: sub.amount ? String(sub.amount) : null, interval: sub.interval ? String(sub.interval) : null } : null,
      usualCategory: usual ? String(usual.category) : null,
      ownCategory: own ? String(own.name) : null,
    };
  }
}
