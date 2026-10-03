import type { Account, Attachment, EmailAddress, Mailbox, MailboxRole, Message, MessageFlagName, MessageScope } from "./models.js";
import { importantThreshold } from "./priority.js";
import { MessageFlag, mailboxRoleRank } from "./models.js";
import type { MailOverview, MailRepository, UnreadCounts } from "./repository.js";
import type { MockDataSet } from "./mockData.js";
import { requireRemoteContentException } from "./remoteContent.js";
import { foldText, isEmptySearch, parseSearchQuery } from "./search.js";
import { normalizeSignature, draftFromMessage, localDraftMessage, localSentMessage, rankContacts, type ComposeDraft, type ContactUsage, type OutgoingMail } from "./compose.js";

/** `MailRepository` im Arbeitsspeicher – für UI-Tests und Vorschauen, ohne Datenbank. */
export class InMemoryMailRepository implements MailRepository {
  readonly #data: MockDataSet;
  readonly #remoteContentExceptions = new Set<string>();
  /** Entwurf-ID → gespeicherte Eingaben und lokale Mail-ID. */
  readonly #drafts = new Map<string, { draft: ComposeDraft; messageId: string }>();
  /** Türsteher: Entscheidungen je Absender (klein geschrieben). */
  readonly #senderDecisions = new Map<string, "allow" | "block">();

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
    const counts: UnreadCounts = { unifiedInbox: 0, unread: 0, flagged: 0, mailboxes: {}, screener: 0, important: 0 };
    for (const m of this.#data.messages) {
      const role = this.#roleOf(m.mailboxId);
      if (role === "inbox" && this.#pending(m)) counts.screener += 1;
      if (this.#screenedOut(m)) continue;
      if ((m.flags & MessageFlag.seen) !== 0) continue;
      counts.mailboxes[m.mailboxId] = (counts.mailboxes[m.mailboxId] ?? 0) + 1;
      if (role === "inbox") {
        counts.unifiedInbox += 1;
        counts.unread += 1;
        if ((m.priorityScore ?? 0) >= importantThreshold) counts.important = (counts.important ?? 0) + 1;
      }
      if (role !== "trash" && (m.flags & MessageFlag.flagged) !== 0 && !this.#isArchiveDuplicate(m)) counts.flagged += 1;
    }
    return { accounts, mailboxesByAccount, counts, outbox: [] };
  }

  async setSyncDays(accountId: string, days: number | null): Promise<void> {
    const account = this.#data.accounts.find((a) => a.id === accountId);
    if (account) account.syncDays = days;
  }

  async setScreener(accountId: string, enabled: boolean): Promise<void> {
    const account = this.#data.accounts.find((a) => a.id === accountId);
    if (!account) return;
    account.screener = enabled;
    if (!enabled) return;
    const known = [account.email, ...this.#data.messages.filter((m) => m.accountId === accountId).flatMap((m) => (this.#roleOf(m.mailboxId) === "sent" ? m.to.map((r) => r.address) : [m.from.address]))];
    for (const address of known) if (!this.#senderDecisions.has(address.toLowerCase())) this.#senderDecisions.set(address.toLowerCase(), "allow");
  }

  async decideSender(address: string, decision: "allow" | "block"): Promise<void> {
    const normalized = address.trim().toLowerCase();
    if (!normalized.includes("@")) throw new Error("Ungültige Absenderadresse.");
    this.#senderDecisions.set(normalized, decision);
  }

  /** Türsteher an und Absender noch ohne Entscheidung */
  #pending(m: Message): boolean {
    const account = this.#data.accounts.find((a) => a.id === m.accountId);
    return !!account?.screener && !this.#senderDecisions.has(m.from.address.toLowerCase());
  }

  /** Posteingangs-Mail, die nicht im Posteingang erscheinen soll (wartend oder blockiert) */
  #screenedOut(m: Message): boolean {
    if (this.#roleOf(m.mailboxId) !== "inbox") return false;
    return this.#senderDecisions.get(m.from.address.toLowerCase()) === "block" || this.#pending(m);
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

  /** Ohne Server: Mail sofort in „Gesendet“ ablegen. */
  async send(mail: OutgoingMail): Promise<void> {
    const account = this.#data.accounts.find((a) => a.id === mail.accountId);
    const sent = this.#data.mailboxes.find((b) => b.accountId === mail.accountId && b.role === "sent");
    if (!account || !sent) throw new Error("Für dieses Konto gibt es keinen Ordner „Gesendet“.");
    const original = mail.answeredMessageId ? this.#data.messages.find((m) => m.id === mail.answeredMessageId) : undefined;
    const id = `local-${globalThis.crypto.randomUUID()}`;
    this.#data.messages.push(
      localSentMessage(mail, {
        id,
        mailboxId: sent.id,
        from: { name: account.displayName, address: account.email },
        threadId: original?.threadId ?? `thread-${id}`,
        date: new Date().toISOString(),
        messageId: `<${id}@stinkyma.local>`,
      }),
    );
    (mail.attachments ?? []).forEach((a, i) =>
      this.#data.attachments.push({
        id: `${id}/a${i}`, messageId: id, filename: a.filename, mimeType: a.mimeType, size: a.size,
        isInline: false, isEncrypted: false, analysisStatus: "pending", riskFlags: 0,
      }),
    );
    if (original) original.flags |= MessageFlag.answered;
    if (mail.draftId) await this.deleteDraft(mail.draftId);
  }

  async saveDraft(draftId: string | null, draft: ComposeDraft): Promise<string> {
    const account = this.#data.accounts.find((a) => a.id === draft.accountId);
    if (!account) throw new Error("Konto nicht gefunden.");
    const box = this.#data.mailboxes.find((b) => b.accountId === account.id && b.role === "drafts");
    const id = draftId ?? globalThis.crypto.randomUUID();
    const previous = this.#drafts.get(id);
    if (previous) this.#removeMessage(previous.messageId);
    const stored: ComposeDraft = { ...draft, draftId: id };
    const messageId = `local-draft-${id}`;
    if (box) {
      this.#data.messages.push(
        localDraftMessage(stored, { id: messageId, mailboxId: box.id, from: { name: account.displayName, address: account.email }, date: new Date().toISOString() }),
      );
    }
    this.#drafts.set(id, { draft: stored, messageId: box ? messageId : "" });
    return id;
  }

  async deleteDraft(draftId: string): Promise<void> {
    const entry = this.#drafts.get(draftId);
    if (!entry) return;
    this.#removeMessage(entry.messageId);
    this.#drafts.delete(draftId);
  }

  async openDraft(messageId: string): Promise<ComposeDraft | null> {
    for (const [id, entry] of this.#drafts) if (entry.messageId === messageId) return { ...entry.draft, draftId: id };
    const message = this.#data.messages.find((m) => m.id === messageId);
    if (!message || this.#roleOf(message.mailboxId) !== "drafts") return null;
    const id = globalThis.crypto.randomUUID();
    const draft: ComposeDraft = { ...draftFromMessage(message), draftId: id };
    this.#drafts.set(id, { draft, messageId });
    return draft;
  }

  async search(query: string, options: { scope?: MessageScope | null; limit: number }): Promise<Message[]> {
    const parsed = parseSearchQuery(query);
    if (isEmptySearch(parsed)) return [];
    // Wortanfang wie bei FTS5: Begriff muss am Anfang eines Wortes stehen
    const startsWord = (text: string, term: string) => foldText(text).split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(foldText(term)));
    const phraseIn = (text: string, term: string) => (term.includes(" ") ? foldText(text).includes(foldText(term)) : startsWord(text, term));
    const pool = options.scope
      ? this.#inScope(options.scope)
      : this.#data.messages.filter((m) => !["trash", "spam"].includes(this.#roleOf(m.mailboxId) ?? ""));
    return pool
      .filter((m) => !this.#isArchiveDuplicate(m))
      .filter((m) => {
        const all = [m.subject, m.from.name ?? "", m.from.address, m.snippet, m.bodyText ?? ""].join(" ");
        const sender = `${m.from.name ?? ""} ${m.from.address}`;
        return parsed.terms.every((t) => phraseIn(all, t)) && parsed.from.every((t) => phraseIn(sender, t));
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, options.limit);
  }

  async setSignature(accountId: string, html: string | null): Promise<void> {
    const account = this.#data.accounts.find((a) => a.id === accountId);
    if (account) account.signatureHtml = normalizeSignature(html);
  }

  async suggestAddresses(query: string, limit: number): Promise<EmailAddress[]> {
    const contacts = new Map<string, ContactUsage>();
    const note = (a: EmailAddress, date: string, sent: boolean) => {
      const key = a.address.toLowerCase();
      const c = contacts.get(key) ?? { address: key, name: null, sent: 0, received: 0, last: "" };
      if (sent) c.sent += 1;
      else c.received += 1;
      if (date >= c.last) {
        c.last = date;
        if (a.name) c.name = a.name;
      }
      contacts.set(key, c);
    };
    for (const m of this.#data.messages) {
      const role = this.#roleOf(m.mailboxId);
      if (role === "sent") for (const a of [...m.to, ...m.cc]) note(a, m.date, true);
      else if (role !== "drafts" && role !== "trash" && role !== "spam") note(m.from, m.date, false);
    }
    return rankContacts([...contacts.values()], { query, ownAddresses: this.#data.accounts.map((a) => a.email), limit });
  }

  #removeMessage(id: string): void {
    const index = this.#data.messages.findIndex((m) => m.id === id);
    if (index !== -1) this.#data.messages.splice(index, 1);
  }

  async reopenOutgoing(): Promise<OutgoingMail | null> {
    return null; // kein Postausgang ohne Server
  }

  /** Kopie im Archiv, die es auch in einem normalen Ordner gibt (Gmail „Alle Nachrichten“). */
  #isArchiveDuplicate(m: Message): boolean {
    if (this.#roleOf(m.mailboxId) !== "archive" || !m.messageId) return false;
    return this.#data.messages.some((other) => {
      const role = this.#roleOf(other.mailboxId);
      return other !== m && other.accountId === m.accountId && other.messageId === m.messageId && role !== "archive" && role !== "trash" && role !== "spam";
    });
  }

  #roleOf(mailboxId: string): MailboxRole | undefined {
    return this.#data.mailboxes.find((b) => b.id === mailboxId)?.role;
  }

  #inScope(scope: MessageScope): Message[] {
    return this.#data.messages.filter((m) => {
      const role = this.#roleOf(m.mailboxId);
      if (scope.kind === "screener") return role === "inbox" && this.#pending(m);
      if (this.#screenedOut(m)) return false;
      switch (scope.kind) {
        case "unifiedInbox":
          return role === "inbox";
        case "unread":
          return role === "inbox" && (m.flags & MessageFlag.seen) === 0;
        case "flagged":
          return role !== "trash" && (m.flags & MessageFlag.flagged) !== 0 && !this.#isArchiveDuplicate(m);
        case "mailbox":
          return m.mailboxId === scope.mailboxId;
        case "important":
          return role === "inbox" && (m.priorityScore ?? 0) >= importantThreshold;
        case "category": {
          if (role !== "inbox" && role !== "archive" && role !== "custom") return false;
          if (this.#isArchiveDuplicate(m)) return false;
          return scope.category.startsWith("u:") ? m.userCategory === scope.category.slice(2) : m.category === scope.category;
        }
      }
    });
  }
}
