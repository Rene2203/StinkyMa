import type Database from "better-sqlite3";
import type { PersonalApi, PersonalOverview, ReplyStyle } from "../personal.js";
import { addressForm } from "../ai/replies.js";
import { analyzeRecipient, analyzeStyle } from "../style.js";
import type { PriorityStore } from "./priorityStore.js";

type Row = Record<string, unknown>;

/** Stilprofil aus gesendeten Mails und Transparenz-Seite (W8.4). Rechnet jedes Mal frisch – es wird nichts zusätzlich gespeichert. */
export class PersonalStore implements PersonalApi {
  constructor(
    private readonly db: Database.Database,
    private readonly priority: PriorityStore,
  ) {}

  #sentBodies(limit: number, to?: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT message.bodyText FROM message JOIN mailbox ON mailbox.id = message.mailboxId
         WHERE mailbox.role = 'sent' AND message.bodyText IS NOT NULL ${to ? `AND instr(lower(message."to"), ?) > 0` : ""}
         ORDER BY message.date DESC LIMIT ?`,
      )
      .all(...(to ? [to, limit] : [limit])) as Row[];
    return rows.map((r) => String(r.bodyText));
  }

  #recipient(address: string) {
    return analyzeRecipient(address, this.#sentBodies(20, address.toLowerCase()), (text) => addressForm(text));
  }

  /** Stil für eine Antwort an `address` */
  replyStyle(address: string): ReplyStyle {
    const recipient = this.#recipient(address);
    return { profile: analyzeStyle(this.#sentBodies(200)), recipient: recipient.mails > 0 ? recipient : null };
  }

  async overview(): Promise<PersonalOverview> {
    const top = this.db
      .prepare(
        `SELECT lower(json_extract(r.value, '$.address')) AS address, COUNT(*) AS n
         FROM message JOIN mailbox ON mailbox.id = message.mailboxId, json_each(message."to") AS r
         WHERE mailbox.role = 'sent' GROUP BY 1 ORDER BY n DESC LIMIT 10`,
      )
      .all() as Row[];
    return {
      style: analyzeStyle(this.#sentBodies(200)),
      recipients: top.filter((r) => r.address).map((r) => this.#recipient(String(r.address))),
      senders: this.priority.topSenders(25),
      events: this.priority.eventCounts(),
    };
  }

  async setSenderPriority(address: string, value: 1 | -1 | null): Promise<void> {
    if (!address.includes("@")) throw new Error("Ungültige Adresse.");
    if (value !== 1 && value !== -1 && value !== null) throw new Error("Ungültiger Wert.");
    this.priority.setUserPriority(address, value);
  }

  async forget(): Promise<void> {
    this.priority.forgetAll();
    this.priority.recompute();
  }
}
