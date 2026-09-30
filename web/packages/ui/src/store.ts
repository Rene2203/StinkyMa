import {
  MessageFlag,
  displayName,
  isFlagged,
  isRead,
  scopeKey,
  type Account,
  type Attachment,
  type Mailbox,
  type MailRepository,
  type Message,
  type MessageFlagName,
  type MessageScope,
} from "@stinkyma/core";

// Zustand des Drei-Spalten-Layouts – Gegenstück zu MailboxBrowserModel (Swift). Ohne React testbar.

export type SidebarItemKind =
  | { type: "unifiedInbox" }
  | { type: "unread" }
  | { type: "flagged" }
  | { type: "mailbox"; mailbox: Mailbox };

export interface SidebarItem {
  kind: SidebarItemKind;
  scope: MessageScope;
  unreadCount: number;
}

export interface SidebarSection {
  id: string;
  account: Account | null;
  items: SidebarItem[];
}

export interface BrowserState {
  sections: SidebarSection[];
  accountsById: Record<string, Account>;
  selectedScope: MessageScope;
  messages: Message[];
  selectedMessageId: string | null;
  searchText: string;
  thread: Message[];
  attachmentsByMessageId: Record<string, Attachment[]>;
  error: string | null;
}

export const initialState: BrowserState = {
  sections: [],
  accountsById: {},
  selectedScope: { kind: "unifiedInbox" },
  messages: [],
  selectedMessageId: null,
  searchText: "",
  thread: [],
  attachmentsByMessageId: {},
  error: null,
};

// --- Abgeleitete Werte ---

export function visibleMessages(state: BrowserState): Message[] {
  const query = state.searchText.trim().toLocaleLowerCase();
  if (!query) return state.messages;
  return state.messages.filter((m) =>
    [m.subject, displayName(m.from), m.from.address, m.snippet].some((field) => field.toLocaleLowerCase().includes(query)),
  );
}

export function selectedMessage(state: BrowserState): Message | null {
  const id = state.selectedMessageId;
  if (!id) return null;
  return state.messages.find((m) => m.id === id) ?? state.thread.find((m) => m.id === id) ?? null;
}

/** Zeigt die Liste Mails aus mehreren Konten? Dann kennzeichnet die UI das Konto farbig. */
export function showsAccountIndicator(state: BrowserState): boolean {
  return state.selectedScope.kind !== "mailbox" && Object.keys(state.accountsById).length > 1;
}

export function sidebarItem(state: BrowserState, scope: MessageScope): SidebarItem | undefined {
  const key = scopeKey(scope);
  return state.sections.flatMap((s) => s.items).find((i) => scopeKey(i.scope) === key);
}

/** Die geladene Konversation – oder die Mail allein, solange die Konversation noch lädt. */
export function threadFor(state: BrowserState, message: Message): Message[] {
  return state.thread.some((m) => m.id === message.id) ? state.thread : [message];
}

// --- Store ---

type Listener = () => void;

export class BrowserStore {
  #state: BrowserState = initialState;
  readonly #listeners = new Set<Listener>();
  readonly #repository: MailRepository;
  readonly pageSize: number;
  #messagesRequest = 0;
  #threadRequest = 0;

  constructor(repository: MailRepository, pageSize = 500) {
    this.#repository = repository;
    this.pageSize = pageSize;
  }

  getState = (): BrowserState => this.#state;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #set(patch: Partial<BrowserState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  // --- Laden ---

  async start(): Promise<void> {
    await Promise.all([this.loadSidebar(), this.loadMessages()]);
  }

  async loadSidebar(): Promise<void> {
    await this.#guard(async () => {
      const repo = this.#repository;
      const accounts = await repo.accounts();
      const smartScopes: [SidebarItemKind, MessageScope][] = [
        [{ type: "unifiedInbox" }, { kind: "unifiedInbox" }],
        [{ type: "unread" }, { kind: "unread" }],
        [{ type: "flagged" }, { kind: "flagged" }],
      ];
      const sections: SidebarSection[] = [
        {
          id: "smart",
          account: null,
          items: await Promise.all(
            smartScopes.map(async ([kind, scope]) => ({ kind, scope, unreadCount: await repo.unreadCount(scope) })),
          ),
        },
      ];
      for (const account of accounts) {
        const mailboxes = await repo.mailboxes(account.id);
        const items = await Promise.all(
          mailboxes.map(async (mailbox): Promise<SidebarItem> => {
            const scope: MessageScope = { kind: "mailbox", mailboxId: mailbox.id };
            return { kind: { type: "mailbox", mailbox }, scope, unreadCount: await repo.unreadCount(scope) };
          }),
        );
        sections.push({ id: `account-${account.id}`, account, items });
      }
      this.#set({ sections, accountsById: Object.fromEntries(accounts.map((a) => [a.id, a])) });
    });
  }

  async loadMessages(): Promise<void> {
    const request = ++this.#messagesRequest;
    const scope = this.#state.selectedScope;
    await this.#guard(async () => {
      const messages = await this.#repository.messages(scope, this.pageSize);
      if (request !== this.#messagesRequest) return; // überholt
      const selected = this.#state.selectedMessageId;
      const keepSelection = selected !== null && messages.some((m) => m.id === selected);
      this.#set({ messages, ...(keepSelection ? {} : { selectedMessageId: null, thread: [], attachmentsByMessageId: {} }) });
    });
  }

  async selectScope(scope: MessageScope): Promise<void> {
    if (scopeKey(scope) === scopeKey(this.#state.selectedScope)) return;
    this.#set({ selectedScope: scope, selectedMessageId: null, thread: [], attachmentsByMessageId: {} });
    await this.loadMessages();
  }

  setSearchText(searchText: string): void {
    this.#set({ searchText });
  }

  /** Öffnet eine Mail: lädt die Konversation und markiert die Mail als gelesen. */
  async selectMessage(id: string | null): Promise<void> {
    const request = ++this.#threadRequest;
    this.#set({ selectedMessageId: id });
    if (id === null) {
      this.#set({ thread: [], attachmentsByMessageId: {} });
      return;
    }
    const message = this.#state.messages.find((m) => m.id === id);
    if (!message) return;
    await this.#guard(async () => {
      const thread = await this.#repository.thread(message.threadId);
      const attachmentsByMessageId: Record<string, Attachment[]> = {};
      for (const m of thread) {
        if (m.hasAttachments) attachmentsByMessageId[m.id] = await this.#repository.attachments(m.id);
      }
      if (request !== this.#threadRequest) return;
      this.#set({ thread: thread.length ? thread : [message], attachmentsByMessageId });
      if (!isRead(message)) await this.#setFlag("seen", true, [message.id]);
    });
  }

  /** Nächste (+1) oder vorherige (−1) Mail der sichtbaren Liste auswählen. */
  async moveSelection(step: 1 | -1): Promise<void> {
    const list = visibleMessages(this.#state);
    if (list.length === 0) return;
    const index = list.findIndex((m) => m.id === this.#state.selectedMessageId);
    const next = index === -1 ? (step === 1 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, index + step));
    const target = list[next];
    if (target && target.id !== this.#state.selectedMessageId) await this.selectMessage(target.id);
  }

  // --- Aktionen ---

  async toggleRead(id: string): Promise<void> {
    const message = this.#find(id);
    if (message) await this.#guard(() => this.#setFlag("seen", !isRead(message), [id]));
  }

  async toggleFlag(id: string): Promise<void> {
    const message = this.#find(id);
    if (message) await this.#guard(() => this.#setFlag("flagged", !isFlagged(message), [id]));
  }

  archive(ids: string[]): Promise<void> {
    return this.#move(ids, "archive");
  }

  /** Verschiebt in den Papierkorb. Endgültiges Löschen gibt es nur als eigene, bestätigte Aktion. */
  moveToTrash(ids: string[]): Promise<void> {
    return this.#move(ids, "trash");
  }

  dismissError(): void {
    this.#set({ error: null });
  }

  // --- Hilfen ---

  async #move(ids: string[], role: "archive" | "trash"): Promise<void> {
    if (ids.length === 0) return;
    const next = this.#selectionAfterRemoving(ids);
    await this.#guard(async () => {
      await this.#repository.move(ids, role);
      const selected = this.#state.selectedMessageId;
      await this.loadMessages();
      if (selected !== null && ids.includes(selected)) await this.selectMessage(next);
      await this.loadSidebar();
    });
  }

  async #setFlag(flag: MessageFlagName, enabled: boolean, ids: string[]): Promise<void> {
    await this.#repository.setFlag(flag, enabled, ids);
    const bit = MessageFlag[flag];
    const apply = (list: Message[]) =>
      list.map((m) => (ids.includes(m.id) ? { ...m, flags: enabled ? m.flags | bit : m.flags & ~bit } : m));
    // Aus „Ungelesen“ bzw. „Markiert“ verschwinden Mails erst beim nächsten Laden,
    // damit die Liste beim Lesen nicht unter dem Mauszeiger wegspringt.
    this.#set({ messages: apply(this.#state.messages), thread: apply(this.#state.thread) });
    await this.loadSidebar();
  }

  #find(id: string): Message | undefined {
    return this.#state.messages.find((m) => m.id === id) ?? this.#state.thread.find((m) => m.id === id);
  }

  /** Nächste sinnvolle Auswahl, wenn Mails verschwinden: die folgende, sonst die vorherige. */
  #selectionAfterRemoving(removed: string[]): string | null {
    const list = visibleMessages(this.#state);
    const selected = this.#state.selectedMessageId;
    const index = list.findIndex((m) => m.id === selected);
    if (selected === null || !removed.includes(selected) || index === -1) return selected;
    const after = list.slice(index).find((m) => !removed.includes(m.id));
    const before = list.slice(0, index).reverse().find((m) => !removed.includes(m.id));
    return (after ?? before)?.id ?? null;
  }

  async #guard(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      // Keine Mail-Inhalte loggen; nur die Fehlermeldung für die Anzeige merken.
      this.#set({ error: error instanceof Error ? error.message : String(error) });
    }
  }
}
