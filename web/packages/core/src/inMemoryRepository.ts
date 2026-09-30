import type { Account, Attachment, Mailbox, MailboxRole, Message, MessageFlagName, MessageScope } from "./models.js";
import { MessageFlag, mailboxRoleRank } from "./models.js";
import type { MailOverview, MailRepository, UnreadCounts } from "./repository.js";
import type { MockDataSet } from "./mockData.js";
import { requireRemoteContentException } from "./remoteContent.js";

/** `MailRepository` im Arbeitsspeicher – für UI-Tests und Vorschauen, ohne Datenbank. */
export class InMemoryMailRepository implements MailRepository {
  readonly #data: MockDataSet;
  readonly #remoteContentExceptions = new Set<string>();

  constructor(data: MockDataSet) {
    this.#data = structuredClone(data);
  }

  async accounts(): Promise<Account[]> {
    return [...this.#data.accounts].sort((a, b) => a.sortOrder - b.sortOrder || a.email.localeCompare(b.email));
  }

  async mailboxes(accountId: string): Promise<Mailbox[]> {
    return this.#data.mailboxes
      .filter((m) => m.accountId === accountId)
      .sort((a, b) => mailboxRoleRank[a.role] - mailboxRoleRank[b.role] || a.name.localeCompare(b.name));
  }

  async messages(scope: MessageScope, limit: number): Promise<Message[]> {
    return this.#inScope(scope)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit)
      .map((m) => structuredClone(m));
  }

  async thread(threadId: string): Promise<Message[]> {
    return this.#data.messages
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((m) => structuredClone(m));
  }

  async message(id: string): Promise<Message | null> {
    const found = this.#data.messages.find((m) => m.id === id);
    return found ? structuredClone(found) : null;
  }

  async attachments(messageId: string): Promise<Attachment[]> {
    return this.#data.attachments
      .filter((a) => a.messageId === messageId)
      .sort((a, b) => a.filename.localeCompare(b.filename))
      .map((a) => structuredClone(a));
  }

  async unreadCount(scope: MessageScope): Promise<number> {
    return this.#inScope(scope).filter((m) => (m.flags & MessageFlag.seen) === 0).length;
  }

  async overview(): Promise<MailOverview> {
    const accounts = await this.accounts();
    const mailboxesByAccount: Record<string, Mailbox[]> = {};
    for (const account of accounts) mailboxesByAccount[account.id] = await this.mailboxes(account.id);
    const counts: UnreadCounts = { unifiedInbox: 0, unread: 0, flagged: 0, mailboxes: {} };
    for (const m of this.#data.messages) {
      if ((m.flags & MessageFlag.seen) !== 0) continue;
      const role = this.#roleOf(m.mailboxId);
      counts.mailboxes[m.mailboxId] = (counts.mailboxes[m.mailboxId] ?? 0) + 1;
      if (role === "inbox") {
        counts.unifiedInbox += 1;
        counts.unread += 1;
      }
      if (role !== "trash" && (m.flags & MessageFlag.flagged) !== 0) counts.flagged += 1;
    }
    return { accounts, mailboxesByAccount, counts };
  }

  async setFlag(flag: MessageFlagName, enabled: boolean, messageIds: string[]): Promise<void> {
    const bit = MessageFlag[flag];
    const ids = new Set(messageIds);
    for (const m of this.#data.messages) {
      if (ids.has(m.id)) m.flags = enabled ? m.flags | bit : m.flags & ~bit;
    }
  }

  async move(messageIds: string[], role: MailboxRole): Promise<void> {
    const ids = new Set(messageIds);
    for (const m of this.#data.messages) {
      if (!ids.has(m.id)) continue;
      const target = this.#data.mailboxes.find((b) => b.accountId === m.accountId && b.role === role);
      if (target) m.mailboxId = target.id;
    }
  }

  async remoteContentExceptions(): Promise<string[]> {
    return [...this.#remoteContentExceptions].sort();
  }

  async addRemoteContentException(input: string): Promise<string> {
    const exception = requireRemoteContentException(input);
    this.#remoteContentExceptions.add(exception);
    return exception;
  }

  async removeRemoteContentException(exception: string): Promise<void> {
    this.#remoteContentExceptions.delete(exception);
  }

  #roleOf(mailboxId: string): MailboxRole | undefined {
    return this.#data.mailboxes.find((b) => b.id === mailboxId)?.role;
  }

  #inScope(scope: MessageScope): Message[] {
    return this.#data.messages.filter((m) => {
      const role = this.#roleOf(m.mailboxId);
      switch (scope.kind) {
        case "unifiedInbox":
          return role === "inbox";
        case "unread":
          return role === "inbox" && (m.flags & MessageFlag.seen) === 0;
        case "flagged":
          return role !== "trash" && (m.flags & MessageFlag.flagged) !== 0;
        case "mailbox":
          return m.mailboxId === scope.mailboxId;
      }
    });
  }
}
