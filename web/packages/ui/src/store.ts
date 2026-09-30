import {
  MessageFlag,
  displayName,
  isFlagged,
  isRead,
  scopeKey,
  type Account,
  type AccountSettings,
  type AccountsApi,
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
  /** Läuft gerade ein Abgleich mit den Mailservern? */
  syncing: boolean;
  /** Zeitpunkt des letzten abgeschlossenen Abgleichs (ISO-8601). */
  lastSyncAt: string | null;
  /** Absender (Adressen/Domains), deren externe Inhalte sofort geladen werden. */
  remoteContentExceptions: string[];
  /** Offener Optionen-Dialog, ggf. mit vorgeschlagener Ausnahme (z. B. Domain der geöffneten Mail). */
  options: { suggestion: string } | null;
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
  syncing: false,
  lastSyncAt: null,
  remoteContentExceptions: [],
  options: null,
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

  readonly #accounts: AccountsApi | undefined;

  constructor(repository: MailRepository, options: { pageSize?: number; accounts?: AccountsApi } = {}) {
    this.#repository = repository;
    this.pageSize = options.pageSize ?? 500;
    this.#accounts = options.accounts;
  }

  /** Kann die Oberfläche Konten verwalten (Windows-App) oder nur anzeigen (Browser-Vorschau)? */
  get canManageAccounts(): boolean {
    return this.#accounts !== undefined;
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
    await Promise.all([this.loadSidebar(), this.loadMessages(), this.#loadSyncStatus(), this.#loadRemoteContentExceptions()]);
  }

  /** Nach Änderungen von außen (Abgleich, andere Fenster): alles neu laden, Auswahl behalten, nichts als gelesen markieren. */
  async reload(): Promise<void> {
    await Promise.all([this.loadSidebar(), this.loadMessages(), this.#loadSyncStatus()]);
    const selected = this.#state.selectedMessageId;
    const message = selected ? this.#state.messages.find((m) => m.id === selected) : undefined;
    if (!message) return;
    const request = ++this.#threadRequest;
    await this.#guard(async () => {
      const thread = await this.#repository.thread(message.threadId);
      if (request === this.#threadRequest) this.#set({ thread: thread.length ? thread : [message] });
    });
  }

  // --- Optionen ---

  openOptions(suggestion = ""): void {
    this.#set({ options: { suggestion } });
  }

  closeOptions(): void {
    this.#set({ options: null });
  }

  /** Fügt eine Ausnahme hinzu. Fehler (ungültige Eingabe) gehen an den Dialog, nicht ins Banner. */
  async addRemoteContentException(input: string): Promise<string> {
    const exception = await this.#repository.addRemoteContentException(input);
    await this.#loadRemoteContentExceptions();
    return exception;
  }

  async removeRemoteContentException(exception: string): Promise<void> {
    // Sofort aus der Liste nehmen, dann speichern.
    this.#set({ remoteContentExceptions: this.#state.remoteContentExceptions.filter((e) => e !== exception) });
    await this.#guard(() => this.#repository.removeRemoteContentException(exception));
    await this.#loadRemoteContentExceptions();
  }

  async #loadRemoteContentExceptions(): Promise<void> {
    await this.#guard(async () => {
      this.#set({ remoteContentExceptions: await this.#repository.remoteContentExceptions() });
    });
  }

  // --- Konten & Abgleich ---

  async syncNow(): Promise<void> {
    if (!this.#accounts) return;
    this.#set({ syncing: true });
    await this.#guard(() => this.#accounts!.syncNow());
    await this.reload();
  }

  async testConnection(settings: AccountSettings, password: string) {
    if (!this.#accounts) throw new Error("Kontoverwaltung ist hier nicht verfügbar.");
    return this.#accounts.testConnection(settings, password);
  }

  /** Richtet ein Konto ein. Fehler werden an den Dialog weitergegeben (nicht als Banner). */
  async addAccount(settings: AccountSettings, password: string, removeDemoAccounts: boolean): Promise<Account> {
    if (!this.#accounts) throw new Error("Kontoverwaltung ist hier nicht verfügbar.");
    const account = await this.#accounts.addAccount(settings, password, { removeDemoAccounts });
    await this.selectScope({ kind: "unifiedInbox" });
    await this.reload();
    return account;
  }

  async removeAccount(accountId: string): Promise<void> {
    if (!this.#accounts) return;
    await this.#guard(() => this.#accounts!.removeAccount(accountId));
    if (this.#state.selectedScope.kind === "mailbox" && this.#state.selectedScope.mailboxId.startsWith(accountId)) {
      await this.selectScope({ kind: "unifiedInbox" });
    }
    await this.reload();
  }

  async #loadSyncStatus(): Promise<void> {
    if (!this.#accounts) return;
    await this.#guard(async () => {
      const status = await this.#accounts!.syncStatus();
      this.#set({ syncing: status.running, lastSyncAt: status.lastRunAt });
    });
  }

  /** Seitenleiste mit einem einzigen Aufruf (Konten, Ordner, Zähler) – wichtig für Tempo über IPC/HTTP. */
  async loadSidebar(): Promise<void> {
    await this.#guard(async () => {
      const { accounts, mailboxesByAccount, counts } = await this.#repository.overview();
      const smart: [SidebarItemKind, MessageScope, number][] = [
        [{ type: "unifiedInbox" }, { kind: "unifiedInbox" }, counts.unifiedInbox],
        [{ type: "unread" }, { kind: "unread" }, counts.unread],
        [{ type: "flagged" }, { kind: "flagged" }, counts.flagged],
      ];
      const sections: SidebarSection[] = [
        { id: "smart", account: null, items: smart.map(([kind, scope, unreadCount]) => ({ kind, scope, unreadCount })) },
        ...accounts.map((account) => ({
          id: `account-${account.id}`,
          account,
          items: (mailboxesByAccount[account.id] ?? []).map((mailbox): SidebarItem => ({
            kind: { type: "mailbox", mailbox },
            scope: { kind: "mailbox", mailboxId: mailbox.id },
            unreadCount: counts.mailboxes[mailbox.id] ?? 0,
          })),
        })),
      ];
      this.#set({ sections, accountsById: Object.fromEntries(accounts.map((a) => [a.id, a])) });
    });
  }

  async loadMessages(): Promise<void> {
    const request = ++this.#messagesRequest;
    const scope = this.#state.selectedScope;
    await this.#guard(async () => {
      let messages = await this.#repository.messages(scope, this.pageSize);
      if (request !== this.#messagesRequest) return; // überholt
      const selected = this.#state.selectedMessageId;
      // In „Ungelesen“/„Markiert“ bleibt die geöffnete Mail stehen, auch wenn sie nicht mehr dazugehört
      // (gerade gelesen) – sonst verschwindet sie beim Öffnen. Sie geht erst beim Wechsel der Auswahl.
      const kept = this.#state.messages.find((m) => m.id === selected);
      if (kept && (scope.kind === "unread" || scope.kind === "flagged") && !messages.some((m) => m.id === selected)) {
        messages = [...messages, kept].sort((a, b) => b.date.localeCompare(a.date));
      }
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
    const selected = this.#state.selectedMessageId;
    // Sofort aus der Liste nehmen – nicht auf Datenbank oder Server warten.
    this.#set({ messages: this.#state.messages.filter((m) => !ids.includes(m.id)) });
    if (selected !== null && ids.includes(selected)) void this.selectMessage(next);
    await this.#guard(async () => {
      await this.#repository.move(ids, role);
      await Promise.all([this.loadMessages(), this.loadSidebar()]);
    });
  }

  async #setFlag(flag: MessageFlagName, enabled: boolean, ids: string[]): Promise<void> {
    const bit = MessageFlag[flag];
    const apply = (list: Message[]) =>
      list.map((m) => (ids.includes(m.id) ? { ...m, flags: enabled ? m.flags | bit : m.flags & ~bit } : m));
    // Sofort anzeigen (auch die Zähler), dann speichern. Aus „Ungelesen“/„Markiert“ verschwinden Mails
    // erst beim nächsten Laden, damit die Liste beim Lesen nicht unter dem Mauszeiger wegspringt.
    const before = this.#state.messages.concat(this.#state.thread).filter((m) => ids.includes(m.id));
    this.#set({ messages: apply(this.#state.messages), thread: apply(this.#state.thread) });
    if (flag === "seen") this.#adjustUnreadCounts(before, enabled);
    await this.#repository.setFlag(flag, enabled, ids);
    await this.loadSidebar();
  }

  /** Zähler in der Seitenleiste sofort anpassen, bevor die Datenbank antwortet. */
  #adjustUnreadCounts(messages: Message[], markRead: boolean): void {
    const unique = new Map(messages.map((m) => [m.id, m]));
    let sections = this.#state.sections;
    for (const m of unique.values()) {
      if (isRead(m) === markRead) continue; // ändert sich nichts
      const delta = markRead ? -1 : 1;
      const box = sections.flatMap((s) => s.items).find((i) => i.kind.type === "mailbox" && i.kind.mailbox.id === m.mailboxId);
      const role = box && box.kind.type === "mailbox" ? box.kind.mailbox.role : null;
      sections = sections.map((section) => ({
        ...section,
        items: section.items.map((item) => {
          const hit =
            (item.kind.type === "mailbox" && item.kind.mailbox.id === m.mailboxId) ||
            ((item.kind.type === "unifiedInbox" || item.kind.type === "unread") && role === "inbox") ||
            (item.kind.type === "flagged" && isFlagged(m) && role !== "trash");
          return hit ? { ...item, unreadCount: Math.max(0, item.unreadCount + delta) } : item;
        }),
      }));
    }
    this.#set({ sections });
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
