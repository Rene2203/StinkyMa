import type Database from "better-sqlite3";
import { MessageFlag, type Message } from "../models.js";
import { userCategoryColors, type UserCategory, type UserCategoryColor, type UserCategoryInput } from "../userCategories.js";
import { archiveDuplicate, messageFromRow, screenedOut } from "./repository.js";

type Row = Record<string, unknown>;

/** Mails, die zu einer Kategorie zählen können (wie der Bereich „Kategorie“) */
const categoryMails = `mailbox.role IN ('inbox', 'archive', 'custom') AND NOT ${archiveDuplicate} AND NOT ${screenedOut}`;
/** Von Hand gesetzt – daran ändert nichts Automatisches etwas */
const manual = "COALESCE(message.userCategoryOrigin, '') = 'user'";

function fromRow(r: Row): UserCategory {
  let senders: string[] = [];
  try {
    const parsed = JSON.parse(String(r.senders ?? "[]")) as unknown;
    senders = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    senders = [];
  }
  const color = String(r.color) as UserCategoryColor;
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description ?? ""),
    senders,
    color: userCategoryColors.includes(color) ? color : "blue",
    sortOrder: Number(r.sortOrder),
  };
}

/** Speicher für eigene Kategorien und ihre Zuordnung zu Mails. */
export class UserCategoryStore {
  constructor(
    private readonly db: Database.Database,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  categories(): UserCategory[] {
    return (this.db.prepare("SELECT * FROM userCategory ORDER BY sortOrder, name").all() as Row[]).map(fromRow);
  }

  /** Stand der Kategorien: ändert sich mit jedem Anlegen, Ändern, Löschen (dann prüft das Modell neu). */
  version(): string {
    const rows = this.db.prepare("SELECT id, updatedAt FROM userCategory ORDER BY id").all() as Row[];
    let hash = 5381;
    for (const ch of rows.map((r) => `${String(r.id)}@${String(r.updatedAt)}`).join("|")) hash = ((hash * 33) ^ ch.charCodeAt(0)) >>> 0;
    return `${rows.length}:${hash.toString(36)}`;
  }

  save(input: UserCategoryInput, now: string): UserCategory {
    const existing = input.id ? (this.db.prepare("SELECT * FROM userCategory WHERE id = ?").get(input.id) as Row | undefined) : undefined;
    const duplicate = this.db.prepare("SELECT id FROM userCategory WHERE lower(name) = lower(?) AND id != ?").get(input.name, input.id ?? "") as Row | undefined;
    if (duplicate) throw new Error("Eine Kategorie mit diesem Namen gibt es schon.");
    const id = existing ? String(existing.id) : this.newId();
    if (existing) {
      this.db
        .prepare("UPDATE userCategory SET name = ?, description = ?, senders = ?, color = ?, updatedAt = ? WHERE id = ?")
        .run(input.name, input.description, JSON.stringify(input.senders), input.color, now, id);
    } else {
      const order = (this.db.prepare("SELECT COALESCE(MAX(sortOrder), -1) + 1 AS n FROM userCategory").get() as { n: number }).n;
      this.db
        .prepare("INSERT INTO userCategory (id, name, description, senders, color, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, input.name, input.description, JSON.stringify(input.senders), input.color, order, now, now);
    }
    return fromRow(this.db.prepare("SELECT * FROM userCategory WHERE id = ?").get(id) as Row);
  }

  remove(id: string): void {
    this.db.transaction(() => {
      this.db.prepare("UPDATE message SET userCategory = NULL, userCategoryOrigin = NULL, userCategoryChecked = NULL WHERE userCategory = ?").run(id);
      this.db.prepare("DELETE FROM userCategory WHERE id = ?").run(id);
    })();
  }

  message(id: string): Message | null {
    const row = this.db.prepare("SELECT * FROM message WHERE id = ?").get(id) as Row | undefined;
    return row ? messageFromRow(row) : null;
  }

  /** Von Hand zuordnen (auch „keine“). */
  assign(messageId: string, categoryId: string | null): void {
    this.db.prepare("UPDATE message SET userCategory = ?, userCategoryOrigin = 'user' WHERE id = ?").run(categoryId, messageId);
  }

  /** Absender merken; seine anderen Mails (nicht von Hand gesetzt) folgen. Gibt zurück, wie viele sich geändert haben. */
  learn(address: string, categoryId: string, exceptMessageId: string, now: string): number {
    const key = address.trim().toLowerCase();
    this.db
      .prepare("INSERT INTO senderUserCategory (address, categoryId, learnedAt) VALUES (?, ?, ?) ON CONFLICT(address) DO UPDATE SET categoryId = excluded.categoryId, learnedAt = excluded.learnedAt")
      .run(key, categoryId, now);
    return this.db
      .prepare(
        `UPDATE message SET userCategory = ?, userCategoryOrigin = 'learned'
         WHERE lower(fromAddress) = ? AND id != ? AND NOT ${manual} AND COALESCE(userCategory, '') != ?`,
      )
      .run(categoryId, key, exceptMessageId, categoryId).changes;
  }

  forget(address: string): void {
    this.db.prepare("DELETE FROM senderUserCategory WHERE address = ?").run(address.trim().toLowerCase());
  }

  /**
   * Gelernte Absender und Absenderlisten auf alle Mails anwenden (ohne KI, schnell). Was vorher nur deshalb zugeordnet
   * war und jetzt nicht mehr passt, wird wieder offen (das Modell prüft es dann).
   */
  applyRules(): void {
    const categories = this.categories();
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE message SET userCategory = NULL, userCategoryOrigin = NULL, userCategoryChecked = NULL WHERE userCategoryOrigin IN ('learned', 'senders')")
        .run();
      for (const category of categories) {
        for (const sender of category.senders) {
          const condition = sender.includes("@") ? "lower(fromAddress) = ?" : "(lower(fromAddress) LIKE '%@' || ? OR lower(fromAddress) LIKE '%.' || ?)";
          this.db
            .prepare(`UPDATE message SET userCategory = ?, userCategoryOrigin = 'senders' WHERE ${condition} AND NOT ${manual} AND userCategoryOrigin IS NOT 'senders'`)
            .run(category.id, ...(sender.includes("@") ? [sender] : [sender, sender]));
        }
      }
      // Gelernt (von Hand für den Absender gewählt) geht vor Absenderlisten
      this.db
        .prepare(
          `UPDATE message SET userCategory = (SELECT categoryId FROM senderUserCategory s WHERE s.address = lower(message.fromAddress)), userCategoryOrigin = 'learned'
           WHERE lower(fromAddress) IN (SELECT address FROM senderUserCategory) AND NOT ${manual}`,
        )
        .run();
    })();
  }

  /** Noch nicht gegen den aktuellen Stand geprüfte Mails (neueste zuerst) – fürs Modell. */
  pending(limit: number, version: string): Message[] {
    return (
      this.db
        .prepare(
          `SELECT message.* FROM message JOIN mailbox ON mailbox.id = message.mailboxId
           WHERE ${categoryMails} AND COALESCE(message.userCategoryOrigin, '') NOT IN ('user', 'learned', 'senders')
             AND COALESCE(message.userCategoryChecked, '') != ?
           ORDER BY message.date DESC LIMIT ?`,
        )
        .all(version, limit) as Row[]
    ).map(messageFromRow);
  }

  /** Ergebnis des Modells speichern (außer der Nutzer hat inzwischen selbst zugeordnet). */
  setFromModel(messageId: string, categoryId: string | null, origin: string, version: string): void {
    this.db
      .prepare(`UPDATE message SET userCategory = ?, userCategoryOrigin = ?, userCategoryChecked = ? WHERE id = ? AND COALESCE(userCategoryOrigin, '') NOT IN ('user', 'learned', 'senders')`)
      .run(categoryId, origin, version, messageId);
  }

  /** Ungelesene Mails je Kategorie (feste und eigene `u:<id>`). */
  unread(): Record<string, number> {
    const result: Record<string, number> = {};
    const query = (column: string, prefix: string) => {
      const rows = this.db
        .prepare(
          `SELECT ${column} AS key, COUNT(*) AS n FROM message JOIN mailbox ON mailbox.id = message.mailboxId
           WHERE ${categoryMails} AND (message.flags & ${MessageFlag.seen}) = 0 AND ${column} IS NOT NULL GROUP BY ${column}`,
        )
        .all() as Row[];
      for (const r of rows) result[`${prefix}${String(r.key)}`] = Number(r.n);
    };
    query("message.category", "");
    query("message.userCategory", "u:");
    return result;
  }
}
