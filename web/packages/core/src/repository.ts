import type { Account, Attachment, Mailbox, MailboxRole, Message, MessageFlagName, MessageScope } from "./models.js";

/**
 * Zugriff auf den lokalen Mail-Bestand. Die Oberfläche spricht nur mit dieser Schnittstelle –
 * in der Windows-App über IPC, später im Browser über HTTP. Gegenstück zu `MailRepository` (Swift).
 */
export interface MailRepository {
  accounts(): Promise<Account[]>;
  mailboxes(accountId: string): Promise<Mailbox[]>;
  /** Nachrichten eines Bereichs, neueste zuerst. */
  messages(scope: MessageScope, limit: number): Promise<Message[]>;
  /** Alle Nachrichten einer Konversation, älteste zuerst. */
  thread(threadId: string): Promise<Message[]>;
  message(id: string): Promise<Message | null>;
  attachments(messageId: string): Promise<Attachment[]>;
  unreadCount(scope: MessageScope): Promise<number>;
  /** Alles für die Seitenleiste in einem Aufruf: Konten, Ordner (sortiert) und Zähler ungelesener Mails. */
  overview(): Promise<MailOverview>;
  setFlag(flag: MessageFlagName, enabled: boolean, messageIds: string[]): Promise<void>;
  /** Verschiebt in den Ordner mit dieser Rolle im jeweiligen Konto; ohne solchen Ordner bleibt die Mail, wo sie ist. */
  move(messageIds: string[], role: MailboxRole): Promise<void>;
}

export interface UnreadCounts {
  unifiedInbox: number;
  unread: number;
  /** Ungelesene unter den markierten Mails (ohne Papierkorb). */
  flagged: number;
  /** Ungelesene pro Ordner (Mailbox-ID → Anzahl); fehlende Ordner haben 0. */
  mailboxes: Record<string, number>;
}

export interface MailOverview {
  accounts: Account[];
  /** Ordner pro Konto, in Anzeige-Reihenfolge. */
  mailboxesByAccount: Record<string, Mailbox[]>;
  counts: UnreadCounts;
}

/** Liste der Methoden – für IPC-/HTTP-Brücken, die Aufrufe weiterreichen. */
export const mailRepositoryMethods = [
  "accounts",
  "mailboxes",
  "messages",
  "thread",
  "message",
  "attachments",
  "unreadCount",
  "overview",
  "setFlag",
  "move",
] as const satisfies readonly (keyof MailRepository)[];

export type MailRepositoryMethod = (typeof mailRepositoryMethods)[number];
