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
  setFlag(flag: MessageFlagName, enabled: boolean, messageIds: string[]): Promise<void>;
  /** Verschiebt in den Ordner mit dieser Rolle im jeweiligen Konto; ohne solchen Ordner bleibt die Mail, wo sie ist. */
  move(messageIds: string[], role: MailboxRole): Promise<void>;
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
  "setFlag",
  "move",
] as const satisfies readonly (keyof MailRepository)[];

export type MailRepositoryMethod = (typeof mailRepositoryMethods)[number];
