import {
  MessageFlag,
  groupRuleFrom,
  type CleanupApi,
  type StoredSubscription,
  type SubscriptionEdit,
  type SubscriptionsApi,
  type SubscriptionStatus,
  type SubscriptionsView,
  type UserCategoriesApi,
  type ReceiptsApi,
  type ReceiptsView,
  type ReceiptEdit,
  type ReceiptStatus,
  type StoredReceipt,
  type UserCategoriesView,
  type UserCategory,
  type UserCategoryInput,
  type CleanupGroup,
  type CleanupGroupBy,
  type CleanupMail,
  type UnsubscribeResult,
  type UnsubscribeView,
  isFlagged,
  isRead,
  scopeKey,
  type Account,
  type AccountSettings,
  type AccountsApi,
  type AttachmentFiles,
  type PreviewKind,
  previewKind,
  type AppSettings,
  type AppSettingsApi,
  type AIApi,
  type MailRule,
  type RuleDefinition,
  type RulePreview,
  type RulesApi,
  type OAuthProviderId,
  type AISettings,
  type AIStatus,
  type SummaryView,
  type AttachmentReadingView,
  type MessageActionsView,
  type ReplyDraftsView,
  type DigestView,
  type MessageCategory,
  type AIImage,
  type Attachment,
  type Mailbox,
  type MailRepository,
  type Message,
  type MessageFlagName,
  type MessageScope,
  type ComposeDraft,
  type EmailAddress,
  type ComposeLabels,
  type ComposeMode,
  type OutboxItem,
  type OutgoingMail,
  isDemoAccount,
  prepareCompose,
  joinGreeting,
} from "@stinkyma/core";

// Zustand des Drei-Spalten-Layouts – Gegenstück zu MailboxBrowserModel (Swift). Ohne React testbar.

export type SidebarItemKind =
  | { type: "unifiedInbox" }
  | { type: "unread" }
  | { type: "flagged" }
  | { type: "screener" }
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
  /** Ergebnisse der Volltextsuche (Datenbank); `null`, solange nicht gesucht wird. */
  searchResults: Message[] | null;
  /** Suche in allen Ordnern (Standard) oder nur im gewählten. */
  searchAllFolders: boolean;
  thread: Message[];
  attachmentsByMessageId: Record<string, Attachment[]>;
  error: string | null;
  /** Läuft gerade ein Abgleich mit den Mailservern? */
  syncing: boolean;
  /** Zeitpunkt des letzten abgeschlossenen Abgleichs (ISO-8601). */
  lastSyncAt: string | null;
  /** Fortschritt beim Laden vieler Mails (z. B. nach längerem Zeitraum); sonst null. */
  syncProgress: { accountId: string; mailbox: string; done: number; total: number } | null;
  /** Wie viele Mails die Liste zeigt (wächst mit „Ältere Mails anzeigen“); 0 = eine Seite. */
  messageLimit: number;
  /** Gibt es im Bereich mehr Mails, als die Liste zeigt? */
  hasMoreMessages: boolean;
  /** Absender (Adressen/Domains), deren externe Inhalte sofort geladen werden. */
  remoteContentExceptions: string[];
  /** Offener Optionen-Dialog, ggf. mit vorgeschlagener Ausnahme (z. B. Domain der geöffneten Mail). */
  options: { suggestion: string } | null;
  /** Offener Composer mit seiner Vorbelegung. */
  compose: ComposeDraft | null;
  /** Mails im Postausgang (noch nicht gesendet). */
  outbox: OutboxItem[];
  /** Anhang, der gerade vom Server geholt wird (Öffnen/Speichern). */
  attachmentBusy: string | null;
  /** Offene Vorschau eines Anhangs in der App. */
  preview: { attachmentId: string; filename: string; kind: PreviewKind } | null;
  /** Einstellungen der App (nur Windows-App) und welche es auf dieser Plattform gibt. */
  appSettings: AppSettings | null;
  appSettingsAvailable: Partial<Record<keyof AppSettings, boolean>>;
  /** KI-Status (nur Windows-App): Modelle, Download, Einordnung. */
  ai: AIStatus | null;
  /** Zusammenfassung der geöffneten Konversation. */
  summary: SummaryState | null;
  /** „Mit KI lesen“ für den Anhang in der Vorschau. */
  reading: ReadingState | null;
  /** Anbieter mit Anmeldung per Browser (App-Registrierung hinterlegt). */
  oauthProviders: OAuthProviderId[];
  /** Erkannte Termine, Fristen, To-dos, Zahlungen der geöffneten Mail. */
  actions: MessageActionsView | null;
  /** Regeln in normaler Sprache (nur Windows-App); null = nicht verfügbar. */
  rules: RulesState | null;
  /** Antwortvorschläge zur geöffneten Mail (nur auf Klick). */
  replies: RepliesState | null;
  /** Rückmeldung nach einer Korrektur der Einordnung (geöffnete Mail). */
  categoryNote: { messageId: string; address: string; category: MessageCategory | null; remembered: boolean; changed: number } | null;
  /** Gelernte Absender (Optionen → KI). */
  learnedSenders: { address: string; category: MessageCategory; learnedAt: string }[];
  /** Tagesüberblick (Dialog); null = geschlossen. */
  digest: { view: DigestView | null; busy: boolean; error: string | null } | null;
  /** Aufräumen (Dialog); null = geschlossen. */
  cleanup: CleanupState | null;
  /** Abbestellen je Mail (geöffnete Mail, gewählte Gruppe beim Aufräumen) */
  unsubscribes: Record<string, UnsubscribeState>;
  /** Offene fremde Seite im Fenster innerhalb der App; null = zu */
  webPanel: WebPanelState | null;
  /** Was die beiden rechten Spalten zeigen: Mails oder „Abos & Verträge“ */
  panel: "mail" | "subscriptions" | "receipts";
  /** Verträge & Abos (W7.1) */
  subscriptions: { view: SubscriptionsView | null; selectedId: string | null; busy: boolean; error: string | null } | null;
  /** Eigene Kategorien (Seitenleiste); null = nicht verfügbar oder noch nicht geladen */
  userCategories: UserCategoriesView | null;
  /** Dialog „Kategorie anlegen/bearbeiten“; `category` null = neu */
  categoryDialog: { category: UserCategory | null; busy: boolean; error: string | null } | null;
  /** Belegordner (W7.2): gewähltes Jahr (null = alle), Kategorie-Filter, Auswahl, Export-Ergebnis */
  receipts: {
    view: ReceiptsView | null;
    year: number | null;
    category: string | null;
    selectedId: string | null;
    busy: boolean;
    error: string | null;
    exported: { count: number; missingFiles: number } | null;
  } | null;
  /** Rückmeldung nach eigener Zuordnung (geöffnete Mail) */
  userCategoryNote: { messageId: string; categoryId: string | null; remembered: boolean; changed: number } | null;
}

/** Fremde Seite in einem Fenster innerhalb der App (Windows-App: abgeschottete Webansicht im Main-Prozess). */
export interface WebPanelHost {
  open(url: string): Promise<unknown>;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  close(): Promise<unknown>;
  openExternal(url: string): Promise<unknown>;
  subscribe(callback: (state: WebPanelState | null) => void): () => void;
}

export interface WebPanelState {
  url: string;
  title: string;
  loading: boolean;
  error: string | null;
}

export interface UnsubscribeState {
  view: UnsubscribeView | null;
  busy: boolean;
  error: string | null;
  result: UnsubscribeResult | null;
}

export interface CleanupState {
  groupBy: CleanupGroupBy;
  accountId: string | null;
  groups: CleanupGroup[] | null;
  busy: boolean;
  error: string | null;
  /** Gewählte Gruppe mit ihren Mails */
  group: { key: string; mails: CleanupMail[] | null; busy: boolean } | null;
  /** Vom Nutzer umgeschaltete Häkchen (Mail-ID → ausgewählt); sonst gilt: ungeschützt = ausgewählt */
  overrides: Record<string, boolean>;
  /** Rückmeldung nach dem Löschen bzw. nach „KI prüfen“ */
  note: { kind: "trashed"; count: number; key: string; rule: boolean } | { kind: "checking"; count: number } | null;
}

/** Ist diese Mail zum Löschen ausgewählt? Standard: alles außer Geschütztem. */
export function cleanupSelected(state: CleanupState, mail: CleanupMail): boolean {
  return state.overrides[mail.id] ?? !mail.protect;
}

export interface RepliesState {
  messageId: string;
  view: ReplyDraftsView | null;
  busy: boolean;
  error: string | null;
}

export interface RulesState {
  list: MailRule[];
  folders: string[];
  /** Regel in Arbeit (neu oder geändert), mit Vorschau. */
  draft: RuleDraft | null;
}

export interface RuleDraft {
  id?: string;
  text: string;
  accountId: string | null;
  preview: RulePreview | null;
  busy: boolean;
  error: string | null;
}

export interface ReadingState {
  attachmentId: string;
  view: AttachmentReadingView | null;
  busy: boolean;
  error: string | null;
}

export interface SummaryState {
  threadId: string;
  view: SummaryView | null;
  busy: boolean;
  error: string | null;
}

export const initialState: BrowserState = {
  sections: [],
  accountsById: {},
  selectedScope: { kind: "unifiedInbox" },
  messages: [],
  selectedMessageId: null,
  searchText: "",
  searchResults: null,
  searchAllFolders: true,
  thread: [],
  attachmentsByMessageId: {},
  error: null,
  syncing: false,
  lastSyncAt: null,
  syncProgress: null,
  messageLimit: 0,
  hasMoreMessages: false,
  remoteContentExceptions: [],
  options: null,
  compose: null,
  outbox: [],
  attachmentBusy: null,
  preview: null,
  appSettings: null,
  appSettingsAvailable: {},
  ai: null,
  summary: null,
  reading: null,
  oauthProviders: [],
  actions: null,
  rules: null,
  replies: null,
  digest: null,
  categoryNote: null,
  learnedSenders: [],
  cleanup: null,
  unsubscribes: {},
  webPanel: null,
  panel: "mail",
  subscriptions: null,
  userCategories: null,
  receipts: null,
  categoryDialog: null,
  userCategoryNote: null,
};

// --- Abgeleitete Werte ---

/** Die Liste in der Mitte: Suchergebnisse, solange gesucht wird, sonst der gewählte Ordner. */
export function visibleMessages(state: BrowserState): Message[] {
  return state.searchResults ?? state.messages;
}

export function isSearching(state: BrowserState): boolean {
  return state.searchText.trim() !== "";
}

export function selectedMessage(state: BrowserState): Message | null {
  const id = state.selectedMessageId;
  if (!id) return null;
  return (
    state.messages.find((m) => m.id === id) ??
    state.searchResults?.find((m) => m.id === id) ??
    state.thread.find((m) => m.id === id) ??
    null
  );
}

/** Zeigt die Liste Mails aus mehreren Konten? Dann kennzeichnet die UI das Konto farbig. */
export function showsAccountIndicator(state: BrowserState): boolean {
  const acrossFolders = state.selectedScope.kind !== "mailbox" || (state.searchResults !== null && state.searchAllFolders);
  return acrossFolders && Object.keys(state.accountsById).length > 1;
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
  #searchRequest = 0;
  #searchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Wartezeit nach der letzten Eingabe, bevor gesucht wird (in Tests 0). */
  searchDelayMs = 200;
  #threadRequest = 0;

  readonly #accounts: AccountsApi | undefined;
  readonly #files: AttachmentFiles | undefined;
  readonly #settings: AppSettingsApi | undefined;
  readonly #ai: AIApi | undefined;
  readonly #rules: RulesApi | undefined;
  readonly #cleanup: CleanupApi | undefined;
  readonly #webPanel: WebPanelHost | undefined;
  readonly #subscriptions: SubscriptionsApi | undefined;
  readonly #categories: UserCategoriesApi | undefined;
  readonly #receipts: ReceiptsApi | undefined;

  constructor(
    repository: MailRepository,
    options: { pageSize?: number; accounts?: AccountsApi; files?: AttachmentFiles; settings?: AppSettingsApi; ai?: AIApi; rules?: RulesApi; cleanup?: CleanupApi; webPanel?: WebPanelHost; subscriptions?: SubscriptionsApi; categories?: UserCategoriesApi; receipts?: ReceiptsApi } = {},
  ) {
    this.#repository = repository;
    this.pageSize = options.pageSize ?? 500;
    this.#accounts = options.accounts;
    this.#files = options.files;
    this.#settings = options.settings;
    this.#ai = options.ai;
    this.#rules = options.rules;
    this.#cleanup = options.cleanup;
    this.#webPanel = options.webPanel;
    this.#subscriptions = options.subscriptions;
    this.#categories = options.categories;
    this.#receipts = options.receipts;
  }

  // --- Belegordner (W7.2) ---

  get canReceipts(): boolean {
    return Boolean(this.#receipts);
  }

  #patchReceipts(patch: Partial<NonNullable<BrowserState["receipts"]>>): void {
    const current = this.#state.receipts ?? { view: null, year: new Date().getFullYear(), category: null, selectedId: null, busy: false, error: null, exported: null };
    this.#set({ receipts: { ...current, ...patch } });
  }

  /** Belegordner öffnen: sofort anzeigen, dann neue Mails durchsuchen (Regeln sofort, KI im Hintergrund). */
  async openReceipts(): Promise<void> {
    if (!this.#receipts) return;
    this.#set({ panel: "receipts" });
    this.#patchReceipts({ busy: true, error: null, exported: null });
    await this.#loadReceipts();
    await this.scanReceipts(false);
  }

  async scanReceipts(recheck: boolean): Promise<void> {
    const api = this.#receipts;
    if (!api) return;
    this.#patchReceipts({ busy: true });
    try {
      await api.scan({ recheck });
      this.#patchReceipts({ error: null });
    } catch (e) {
      this.#patchReceipts({ error: messageOf(e) });
    }
    await this.#loadReceipts();
  }

  async #loadReceipts(): Promise<void> {
    const api = this.#receipts;
    if (!api) return;
    const current = this.#state.receipts;
    let year = current?.year ?? new Date().getFullYear();
    try {
      let view = await api.list(year);
      // Im gewählten Jahr nichts, aber in anderen: das neueste Jahr mit Belegen zeigen
      if (view.items.length === 0 && year !== null && view.years.length > 0 && !view.years.includes(year) && !current?.view) {
        year = view.years[0] ?? year;
        view = await api.list(year);
      }
      const selectedId = this.#state.receipts?.selectedId;
      const filter = this.#state.receipts?.category ?? null;
      const visible = view.items.filter((r) => filter === null || (r.category ?? "") === filter);
      this.#patchReceipts({ view, year, busy: false, selectedId: selectedId && view.items.some((r) => r.id === selectedId) ? selectedId : visible[0]?.id ?? null });
    } catch (e) {
      this.#patchReceipts({ busy: false, error: messageOf(e) });
    }
  }

  async selectReceiptYear(year: number | null): Promise<void> {
    this.#patchReceipts({ year, selectedId: null, category: null, exported: null });
    await this.#loadReceipts();
  }

  selectReceiptCategory(category: string | null): void {
    this.#patchReceipts({ category });
  }

  selectReceipt(id: string): void {
    this.#patchReceipts({ selectedId: id });
  }

  closeReceipts(): void {
    this.#set({ panel: "mail" });
  }

  async #receiptAction(action: (api: ReceiptsApi) => Promise<unknown>): Promise<void> {
    const api = this.#receipts;
    if (!api) return;
    try {
      await action(api);
      this.#patchReceipts({ error: null });
    } catch (e) {
      this.#patchReceipts({ error: messageOf(e) });
    }
    await this.#loadReceipts();
  }

  updateReceipt(id: string, edit: ReceiptEdit): Promise<void> {
    return this.#receiptAction((api) => api.update(id, edit));
  }

  setReceiptStatus(id: string, status: ReceiptStatus): Promise<void> {
    return this.#receiptAction((api) => api.setStatus(id, status));
  }

  addReceiptCategory(name: string): Promise<void> {
    return this.#receiptAction((api) => api.addCategory(name));
  }

  removeReceiptCategory(name: string): Promise<void> {
    return this.#receiptAction((api) => api.removeCategory(name));
  }

  remindReceipt(id: string, daysBefore: number): Promise<void> {
    return this.#receiptAction((api) => api.remind(id, daysBefore));
  }

  cancelReceiptReminder(id: string): Promise<void> {
    return this.#receiptAction((api) => api.cancelReminder(id));
  }

  async exportReceipts(): Promise<void> {
    const api = this.#receipts;
    if (!api) return;
    this.#patchReceipts({ busy: true, exported: null });
    try {
      const result = await api.export(this.#state.receipts?.year ?? null);
      this.#patchReceipts({ busy: false, error: null, exported: result.saved ? { count: result.count, missingFiles: result.missingFiles } : null });
    } catch (e) {
      this.#patchReceipts({ busy: false, error: messageOf(e) });
    }
  }

  /** „Als Beleg übernehmen“: Mail übernehmen und im Belegordner zeigen. */
  async markAsReceipt(messageId: string): Promise<void> {
    const api = this.#receipts;
    if (!api) return;
    this.#set({ panel: "receipts" });
    this.#patchReceipts({ busy: true, error: null, exported: null, category: null });
    try {
      const receipt = await api.addFromMail(messageId);
      this.#patchReceipts({ year: Number(receipt.date.slice(0, 4)), selectedId: receipt.id });
    } catch (e) {
      this.#patchReceipts({ error: messageOf(e) });
    }
    await this.#loadReceipts();
  }

  async openReceiptMail(receipt: StoredReceipt): Promise<void> {
    if (!receipt.messageId) return;
    this.#set({ panel: "mail" });
    await this.openMessage(receipt.messageId);
  }

  // --- Eigene Kategorien ---

  get canUserCategories(): boolean {
    return Boolean(this.#categories);
  }

  async loadUserCategories(): Promise<void> {
    const api = this.#categories;
    if (!api) return;
    await this.#guard(async () => this.#set({ userCategories: await api.list() }));
  }

  openCategoryDialog(category: UserCategory | null = null): void {
    this.#set({ categoryDialog: { category, busy: false, error: null } });
  }

  closeCategoryDialog(): void {
    this.#set({ categoryDialog: null });
  }

  async saveUserCategory(input: UserCategoryInput): Promise<void> {
    const api = this.#categories;
    const dialog = this.#state.categoryDialog;
    if (!api || !dialog) return;
    this.#set({ categoryDialog: { ...dialog, busy: true, error: null } });
    try {
      const saved = await api.save(input);
      this.#set({ categoryDialog: null });
      await this.loadUserCategories();
      // Neu angelegt: gleich anzeigen, was schon dazugehört
      if (!dialog.category) await this.selectScope({ kind: "category", category: `u:${saved.id}` });
      else await this.reload();
    } catch (e) {
      this.#set({ categoryDialog: { ...dialog, busy: false, error: messageOf(e) } });
    }
  }

  async removeUserCategory(id: string): Promise<void> {
    const api = this.#categories;
    if (!api) return;
    await this.#guard(async () => {
      await api.remove(id);
      this.#set({ categoryDialog: null });
      if (this.#state.selectedScope.kind === "category" && this.#state.selectedScope.category === `u:${id}`) await this.selectScope({ kind: "unifiedInbox" });
      await this.reload();
    });
  }

  /** Eigene Kategorie einer Mail von Hand setzen (`null`: keine). */
  async assignUserCategory(messageId: string, categoryId: string | null, remember: boolean): Promise<void> {
    const api = this.#categories;
    if (!api) return;
    await this.#guard(async () => {
      const { changed } = await api.assign(messageId, categoryId, remember);
      this.#set({ userCategoryNote: { messageId, categoryId, remembered: remember, changed } });
      await this.reload();
    });
  }

  closeUserCategoryNote(): void {
    this.#set({ userCategoryNote: null });
  }

  // --- Verträge & Abos (W7.1) ---

  get canSubscriptions(): boolean {
    return Boolean(this.#subscriptions);
  }

  /** Ansicht „Abos & Verträge“ öffnen: sofort anzeigen, dann neue Mails durchsuchen (Regeln sofort, KI im Hintergrund). */
  async openSubscriptions(): Promise<void> {
    const api = this.#subscriptions;
    if (!api) return;
    this.#set({ panel: "subscriptions", subscriptions: { view: this.#state.subscriptions?.view ?? null, selectedId: this.#state.subscriptions?.selectedId ?? null, busy: true, error: null } });
    await this.#loadSubscriptions();
    await this.scanSubscriptions();
  }

  /** Von Hand durchsuchen; `recheck`: auch schon geprüfte Mails neu prüfen (mit KI, falls bereit). */
  async scanSubscriptions(recheck = false): Promise<void> {
    const api = this.#subscriptions;
    if (!api) return;
    this.#patchSubscriptions({ busy: true });
    try {
      await api.scan({ recheck });
      this.#patchSubscriptions({ error: null });
    } catch (e) {
      this.#patchSubscriptions({ error: messageOf(e) });
    }
    await this.#loadSubscriptions();
  }

  /** „Das ist ein Abo“: Mail übernehmen und den Eintrag in „Abos & Verträge“ zeigen. */
  async markAsSubscription(messageId: string): Promise<void> {
    const api = this.#subscriptions;
    if (!api) return;
    this.#set({ panel: "subscriptions", subscriptions: { view: this.#state.subscriptions?.view ?? null, selectedId: null, busy: true, error: null } });
    try {
      const sub = await api.addFromMail(messageId);
      this.#patchSubscriptions({ selectedId: sub.id, error: null });
    } catch (e) {
      this.#patchSubscriptions({ error: messageOf(e) });
    }
    await this.#loadSubscriptions();
  }

  mergeSubscriptions(targetId: string, sourceId: string): Promise<void> {
    return this.#subscriptionAction((api) => api.merge(targetId, sourceId));
  }

  closeSubscriptions(): void {
    this.#set({ panel: "mail" });
  }

  #patchSubscriptions(patch: Partial<NonNullable<BrowserState["subscriptions"]>>): void {
    const current = this.#state.subscriptions ?? { view: null, selectedId: null, busy: false, error: null };
    this.#set({ subscriptions: { ...current, ...patch } });
  }

  async #loadSubscriptions(): Promise<void> {
    const api = this.#subscriptions;
    if (!api) return;
    try {
      const view = await api.list();
      const selectedId = this.#state.subscriptions?.selectedId;
      this.#patchSubscriptions({ view, busy: false, selectedId: selectedId && view.items.some((s) => s.id === selectedId) ? selectedId : view.items[0]?.id ?? null });
    } catch (e) {
      this.#patchSubscriptions({ busy: false, error: messageOf(e) });
    }
  }

  selectSubscription(id: string): void {
    this.#patchSubscriptions({ selectedId: id });
  }

  async #subscriptionAction(action: (api: SubscriptionsApi) => Promise<unknown>): Promise<void> {
    const api = this.#subscriptions;
    if (!api) return;
    try {
      await action(api);
      this.#patchSubscriptions({ error: null });
    } catch (e) {
      this.#patchSubscriptions({ error: messageOf(e) });
    }
    await this.#loadSubscriptions();
  }

  updateSubscription(id: string, edit: SubscriptionEdit): Promise<void> {
    return this.#subscriptionAction((api) => api.update(id, edit));
  }

  setSubscriptionStatus(id: string, status: SubscriptionStatus): Promise<void> {
    return this.#subscriptionAction((api) => api.setStatus(id, status));
  }

  remindSubscription(id: string, daysBefore: number): Promise<void> {
    return this.#subscriptionAction((api) => api.remind(id, daysBefore));
  }

  cancelSubscriptionReminder(id: string): Promise<void> {
    return this.#subscriptionAction((api) => api.cancelReminder(id));
  }

  /** Quell-Mail eines Eintrags öffnen (zurück zur Mail-Ansicht). */
  async openSubscriptionMail(sub: StoredSubscription, messageId = sub.sourceMessageId): Promise<void> {
    if (!messageId) return;
    this.#set({ panel: "mail" });
    await this.openMessage(messageId);
  }

  // --- Fremde Seite im Fenster innerhalb der App ---

  get webPanelHost(): WebPanelHost | undefined {
    return this.#webPanel;
  }

  /** Öffnet die Seite im Fenster in der App. `false`: geht hier nicht (z. B. im Browser) – dann extern öffnen. */
  async openWebPanel(url: string): Promise<boolean> {
    const host = this.#webPanel;
    if (!host) return false;
    this.#set({ webPanel: { url, title: "", loading: true, error: null } });
    try {
      await host.open(url);
    } catch (e) {
      this.#set({ webPanel: { url, title: "", loading: false, error: messageOf(e) } });
    }
    return true;
  }

  /** Meldung aus dem Main-Prozess (Titel, Laden, Fehler). */
  updateWebPanel(state: WebPanelState | null): void {
    if (this.#state.webPanel) this.#set({ webPanel: state });
  }

  async closeWebPanel(): Promise<void> {
    this.#set({ webPanel: null });
    await this.#webPanel?.close();
  }

  async openWebPanelExternally(): Promise<void> {
    const url = this.#state.webPanel?.url;
    if (url && this.#webPanel) await this.#webPanel.openExternal(url);
    await this.closeWebPanel();
  }

  // --- Abbestellen ---

  #setUnsubscribe(messageId: string, patch: Partial<UnsubscribeState>): void {
    const current = this.#state.unsubscribes[messageId] ?? { view: null, busy: false, error: null, result: null };
    this.#set({ unsubscribes: { ...this.#state.unsubscribes, [messageId]: { ...current, ...patch } } });
  }

  /** Bietet die Mail eine Abmeldung an? (holt die Angabe bei älteren Mails einmal vom Server) */
  async loadUnsubscribe(messageId: string): Promise<void> {
    const api = this.#cleanup;
    if (!api || this.#state.unsubscribes[messageId]?.view) return;
    try {
      const view = await api.unsubscribeInfo(messageId);
      this.#setUnsubscribe(messageId, { view });
    } catch {
      // Ohne Angabe gibt es eben keinen Knopf – kein Fehlerbanner
    }
  }

  /** Abbestellen – nur auf Klick. Bei „web“ öffnet die Oberfläche die zurückgegebene Seite. */
  async unsubscribe(messageId: string): Promise<UnsubscribeResult | null> {
    const api = this.#cleanup;
    if (!api) return null;
    this.#setUnsubscribe(messageId, { busy: true, error: null });
    try {
      const result = await api.unsubscribe(messageId);
      const view = await api.unsubscribeInfo(messageId);
      this.#setUnsubscribe(messageId, { busy: false, result, view });
      return result;
    } catch (e) {
      this.#setUnsubscribe(messageId, { busy: false, error: messageOf(e) });
      return null;
    }
  }

  /** Aufräumen direkt für einen Absender öffnen (z. B. nach dem Abbestellen). */
  async openCleanupFor(address: string): Promise<void> {
    await this.openCleanup();
    await this.selectCleanupGroup(address.toLowerCase());
  }

  // --- Aufräumen ---

  get canCleanup(): boolean {
    return Boolean(this.#cleanup);
  }

  /** Gibt es Regeln (für „künftige Mails auch löschen“)? */
  get canUseRules(): boolean {
    return Boolean(this.#rules);
  }

  async openCleanup(): Promise<void> {
    if (!this.#cleanup) return;
    this.#set({ cleanup: { groupBy: "address", accountId: null, groups: null, busy: true, error: null, group: null, overrides: {}, note: null } });
    await this.#loadCleanupGroups();
  }

  closeCleanup(): void {
    this.#set({ cleanup: null });
  }

  async setCleanupView(patch: { groupBy?: CleanupGroupBy; accountId?: string | null }): Promise<void> {
    const current = this.#state.cleanup;
    if (!current) return;
    this.#set({ cleanup: { ...current, ...patch, groups: null, busy: true, group: null, overrides: {}, note: null } });
    await this.#loadCleanupGroups();
  }

  async #loadCleanupGroups(): Promise<void> {
    const api = this.#cleanup;
    const current = this.#state.cleanup;
    if (!api || !current) return;
    try {
      const groups = await api.groups({ accountId: current.accountId, groupBy: current.groupBy, limit: 200, minCount: 2 });
      const now = this.#state.cleanup;
      if (!now || now.groupBy !== current.groupBy || now.accountId !== current.accountId) return; // überholt
      this.#set({ cleanup: { ...now, groups, busy: false, error: null } });
    } catch (e) {
      const now = this.#state.cleanup;
      if (now) this.#set({ cleanup: { ...now, busy: false, error: messageOf(e) } });
    }
  }

  async selectCleanupGroup(key: string): Promise<void> {
    const current = this.#state.cleanup;
    if (!current) return;
    this.#set({ cleanup: { ...current, group: { key, mails: null, busy: true }, overrides: {}, note: null } });
    await this.#loadCleanupMails();
  }

  async #loadCleanupMails(): Promise<void> {
    const api = this.#cleanup;
    const current = this.#state.cleanup;
    if (!api || !current?.group) return;
    const key = current.group.key;
    try {
      const mails = await api.groupMails(key, current.groupBy, current.accountId, 20_000);
      const now = this.#state.cleanup;
      if (!now?.group || now.group.key !== key) return;
      this.#set({ cleanup: { ...now, group: { key, mails, busy: false } } });
      if (mails[0]) void this.loadUnsubscribe(mails[0].id);
    } catch (e) {
      const now = this.#state.cleanup;
      if (now?.group) this.#set({ cleanup: { ...now, group: { ...now.group, busy: false }, error: messageOf(e) } });
    }
  }

  toggleCleanupMail(id: string, selected: boolean): void {
    const current = this.#state.cleanup;
    if (current) this.#set({ cleanup: { ...current, overrides: { ...current.overrides, [id]: selected } } });
  }

  /** Alle (auch geschützte) an- oder abwählen; `null` = zurück zum Vorschlag. */
  setCleanupAll(selected: boolean | null): void {
    const current = this.#state.cleanup;
    if (!current?.group?.mails) return;
    const overrides = selected === null ? {} : Object.fromEntries(current.group.mails.map((m) => [m.id, selected]));
    this.#set({ cleanup: { ...current, overrides } });
  }

  /** Ausgewählte Mails der Gruppe in den Papierkorb – nur auf Klick. Optional Regel für künftige Mails. */
  async trashCleanupSelection(alsoFuture: boolean): Promise<void> {
    const api = this.#cleanup;
    const current = this.#state.cleanup;
    if (!api || !current?.group?.mails) return;
    const ids = current.group.mails.filter((m) => cleanupSelected(current, m)).map((m) => m.id);
    if (!ids.length) return;
    const key = current.group.key;
    try {
      await api.trash(ids);
      let rule = false;
      if (alsoFuture && this.#rules) {
        await this.#rules.save(
          {
            text: `Mails von ${key} in den Papierkorb`,
            accountId: current.accountId,
            definition: { from: groupRuleFrom(key, current.groupBy), subject: [], category: null, hasAttachment: false, move: "trash", folder: null, markRead: false, flag: false },
          },
          false,
        );
        rule = true;
      }
      const now = this.#state.cleanup;
      if (now) this.#set({ cleanup: { ...now, group: null, overrides: {}, note: { kind: "trashed", count: ids.length, key, rule }, busy: true } });
      await Promise.all([this.#loadCleanupGroups(), this.loadSidebar(), this.loadMessages(), rule ? this.loadRules() : Promise.resolve()]);
    } catch (e) {
      const now = this.#state.cleanup;
      if (now) this.#set({ cleanup: { ...now, error: messageOf(e) } });
    }
  }

  /** Noch nicht eingeordnete Mails der Gruppe von der KI einordnen lassen (läuft im Hintergrund). */
  async checkCleanupGroup(): Promise<void> {
    const api = this.#cleanup;
    const current = this.#state.cleanup;
    if (!api || !current?.group) return;
    try {
      const { queued } = await api.check(current.group.key, current.groupBy, current.accountId);
      const now = this.#state.cleanup;
      if (now) this.#set({ cleanup: { ...now, note: { kind: "checking", count: queued } } });
    } catch (e) {
      const now = this.#state.cleanup;
      if (now) this.#set({ cleanup: { ...now, error: messageOf(e) } });
    }
  }

  // --- Regeln in normaler Sprache (W6.4) ---

  async loadRules(): Promise<void> {
    const api = this.#rules;
    if (!api) return;
    await this.#guard(async () => {
      const [list, folders] = await Promise.all([api.list(), api.folders(null)]);
      this.#set({ rules: { list, folders, draft: this.#state.rules?.draft ?? null } });
    });
  }

  #setDraft(draft: RuleDraft | null): void {
    const rules = this.#state.rules ?? { list: [], folders: [], draft: null };
    this.#set({ rules: { ...rules, draft } });
  }

  /** Text → Regel mit Vorschau (Modell, falls bereit; sonst einfache Regeln). Speichert noch nichts. */
  async interpretRule(text: string, accountId: string | null): Promise<void> {
    const api = this.#rules;
    if (!api || !text.trim()) return;
    this.#setDraft({ text, accountId, preview: null, busy: true, error: null });
    try {
      const preview = await api.interpret(text, accountId);
      this.#setDraft({ text, accountId, preview, busy: false, error: null });
    } catch (error) {
      this.#setDraft({ text, accountId, preview: null, busy: false, error: messageOf(error) });
    }
  }

  /** Von Hand geändert: neu prüfen und Vorschau aktualisieren. */
  async changeRuleDraft(definition: RuleDefinition, accountId?: string | null): Promise<void> {
    const api = this.#rules;
    const draft = this.#state.rules?.draft;
    if (!api || !draft) return;
    const account = accountId === undefined ? draft.accountId : accountId;
    const preview = await api.preview(definition, account).catch(() => null);
    const current = this.#state.rules?.draft;
    if (!current || current.text !== draft.text) return; // inzwischen verworfen oder neu
    // Herkunft bleibt sichtbar („vom Modell gelesen“) – geändert hat dann der Nutzer
    this.#setDraft({ ...current, accountId: account, preview: preview ? { ...preview, origin: current.preview?.origin ?? null } : current.preview });
  }

  editRule(rule: MailRule): void {
    this.#setDraft({ id: rule.id, text: rule.text, accountId: rule.accountId, preview: null, busy: true, error: null });
    void this.changeRuleDraft(rule.definition, rule.accountId).then(() => {
      const draft = this.#state.rules?.draft;
      if (draft?.id === rule.id) this.#setDraft({ ...draft, busy: false });
    });
  }

  cancelRuleDraft(): void {
    this.#setDraft(null);
  }

  async saveRuleDraft(applyToExisting: boolean): Promise<boolean> {
    const api = this.#rules;
    const draft = this.#state.rules?.draft;
    if (!api || !draft?.preview) return false;
    this.#setDraft({ ...draft, busy: true, error: null });
    try {
      await api.save({ ...(draft.id ? { id: draft.id } : {}), text: draft.text, accountId: draft.accountId, definition: draft.preview.definition }, applyToExisting);
      this.#setDraft(null);
      await this.loadRules();
      if (applyToExisting) await Promise.all([this.loadSidebar(), this.loadMessages()]);
      return true;
    } catch (error) {
      this.#setDraft({ ...draft, busy: false, error: messageOf(error) });
      return false;
    }
  }

  async setRuleEnabled(id: string, enabled: boolean): Promise<void> {
    const api = this.#rules;
    if (!api) return;
    await this.#guard(() => api.setEnabled(id, enabled));
    await this.loadRules();
  }

  async removeRule(id: string): Promise<void> {
    const api = this.#rules;
    if (!api) return;
    await this.#guard(() => api.remove(id));
    await this.loadRules();
  }

  // --- KI ---

  /** Neuer Status vom KI-Dienst (Download-Fortschritt, Einordnung, Einstellungen). */
  setAIStatus(status: AIStatus): void {
    const wasReady = this.#state.ai?.ready ?? false;
    this.#set({ ai: status });
    if (!wasReady && status.ready) void this.#loadCachedSummary();
  }

  async #loadAI(): Promise<void> {
    const ai = this.#ai;
    if (!ai) return;
    await this.#guard(async () => this.setAIStatus(await ai.status()));
  }

  async updateAI(patch: Partial<AISettings>): Promise<void> {
    const ai = this.#ai;
    if (!ai) return;
    await this.#guard(async () => this.setAIStatus(await ai.update(patch)));
  }

  /** Download starten; Fortschritt und Fehler kommen über den Status (Fehler stehen in den Optionen, nicht im Banner). */
  async downloadModel(modelId: string): Promise<void> {
    const ai = this.#ai;
    if (!ai) return;
    try {
      await ai.download(modelId);
    } catch {
      // steht in status.error
    }
    await this.#loadAI();
  }

  async cancelModelDownload(): Promise<void> {
    await this.#ai?.cancelDownload();
  }

  async deleteModel(modelId: string): Promise<void> {
    const ai = this.#ai;
    if (!ai) return;
    await this.#guard(() => ai.deleteModel(modelId));
    await this.#loadAI();
  }

  /** Konversation der geöffneten Mail zusammenfassen – nur auf Klick. Fehler erscheinen in der Karte. */
  async summarize(): Promise<void> {
    const ai = this.#ai;
    const message = selectedMessage(this.#state);
    if (!ai || !message || this.#state.summary?.busy) return;
    const threadId = message.threadId;
    this.#set({ summary: { threadId, view: this.#state.summary?.threadId === threadId ? this.#state.summary.view : null, busy: true, error: null } });
    try {
      const view = await ai.summarize(threadId);
      if (this.#state.summary?.threadId === threadId) this.#set({ summary: { threadId, view, busy: false, error: null } });
    } catch (e) {
      const error = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e);
      if (this.#state.summary?.threadId === threadId) this.#set({ summary: { threadId, view: this.#state.summary.view, busy: false, error } });
    }
  }

  /** Einordnung von Hand korrigieren (W6-Nachtrag „KI beibringen“). */
  async setMessageCategory(messageId: string, category: MessageCategory | null, remember: boolean): Promise<void> {
    const ai = this.#ai;
    const message = this.#find(messageId);
    if (!ai || !message) return;
    await this.#guard(async () => {
      const { changed } = await ai.setCategory(messageId, category, remember);
      this.#set({ categoryNote: { messageId, address: message.from.address, category, remembered: remember, changed } });
      await this.reload();
      if (remember) await this.loadLearnedSenders();
    });
  }

  closeCategoryNote(): void {
    this.#set({ categoryNote: null });
  }

  async loadLearnedSenders(): Promise<void> {
    const ai = this.#ai;
    if (!ai) return;
    await this.#guard(async () => this.#set({ learnedSenders: await ai.learnedSenders() }));
  }

  async forgetSender(address: string): Promise<void> {
    const ai = this.#ai;
    if (!ai) return;
    await this.#guard(() => ai.forgetSender(address));
    await this.loadLearnedSenders();
  }

  /** Nach einem KI-Fehler: weiter einordnen. */
  async resumeAI(): Promise<void> {
    const ai = this.#ai;
    if (!ai) return;
    await this.#guard(async () => this.setAIStatus(await ai.resume()));
  }

  /** Gibt es den Tagesüberblick (nur Windows-App)? */
  get canShowDigest(): boolean {
    return !!this.#ai;
  }

  /** Tagesüberblick öffnen (W6.6) – ohne Modell, sofort. */
  async openDigest(): Promise<void> {
    const ai = this.#ai;
    if (!ai) return;
    this.#set({ digest: { view: this.#state.digest?.view ?? null, busy: true, error: null } });
    try {
      const view = await ai.dailyDigest();
      if (this.#state.digest) this.#set({ digest: { view, busy: false, error: null } });
    } catch (e) {
      if (this.#state.digest) this.#set({ digest: { view: null, busy: false, error: messageOf(e) } });
    }
  }

  closeDigest(): void {
    this.#set({ digest: null });
  }

  /** Mail aus dem Überblick öffnen. */
  async openFromDigest(messageId: string): Promise<void> {
    this.#set({ digest: null });
    await this.openMessage(messageId);
  }

  /** Antwortvorschläge zur geöffneten Mail (W6.5) – nur auf Klick, mit dem lokalen Modell. */
  async loadReplyDrafts(): Promise<void> {
    const ai = this.#ai;
    const message = selectedMessage(this.#state);
    if (!ai || !message || this.#state.replies?.busy) return;
    const messageId = message.id;
    this.#set({ replies: { messageId, view: null, busy: true, error: null } });
    try {
      const view = await ai.replyDrafts(messageId);
      if (this.#state.replies?.messageId === messageId) this.#set({ replies: { messageId, view, busy: false, error: null } });
    } catch (e) {
      if (this.#state.replies?.messageId === messageId) this.#set({ replies: { messageId, view: null, busy: false, error: messageOf(e) } });
    }
  }

  closeReplyDrafts(): void {
    this.#set({ replies: null });
  }

  /** Vorschlag übernehmen: öffnet „Antworten“ mit Anrede und Text – verschickt wird erst, wenn der Nutzer sendet. */
  useReplyDraft(index: number, labels: ComposeLabels): void {
    const view = this.#state.replies?.view;
    const reply = view?.replies[index];
    if (!view || !reply || selectedMessage(this.#state)?.id !== view.messageId) return;
    this.openCompose("reply", labels, joinGreeting(view.greeting, reply.text));
  }

  /** Bild-Baustein und Bild-Laufzeit laden (Fehler stehen im Status, nicht im Banner). */
  async downloadVision(): Promise<void> {
    const ai = this.#ai;
    if (!ai) return;
    try {
      await ai.downloadVision();
    } catch {
      // steht in status.error
    }
    await this.#loadAI();
  }

  /** Kann der Anhang in der Vorschau mit KI gelesen werden (Modell bereit, Bilder eingeschaltet)? */
  get canReadAttachments(): boolean {
    const ai = this.#state.ai;
    return !!ai?.ready && ai.settings.vision && ai.vision.state === "ready";
  }

  /**
   * Anhang in der Vorschau mit KI lesen – nur auf Klick. Für PDFs schickt die Oberfläche die gerenderten Seiten mit.
   * Fehler erscheinen in der Karte.
   */
  async readAttachmentWithAI(pageImages?: AIImage[]): Promise<void> {
    const ai = this.#ai;
    const attachmentId = this.#state.preview?.attachmentId;
    if (!ai || !attachmentId || this.#state.reading?.busy) return;
    const previous = this.#state.reading?.attachmentId === attachmentId ? this.#state.reading.view : null;
    this.#set({ reading: { attachmentId, view: previous, busy: true, error: null } });
    try {
      const view = await ai.readAttachment(attachmentId, pageImages);
      if (this.#state.reading?.attachmentId === attachmentId) this.#set({ reading: { attachmentId, view, busy: false, error: null } });
    } catch (e) {
      const error = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e);
      if (this.#state.reading?.attachmentId === attachmentId) this.#set({ reading: { attachmentId, view: previous, busy: false, error } });
    }
  }

  async #loadCachedReading(attachmentId: string): Promise<void> {
    const ai = this.#ai;
    if (!ai) return;
    try {
      const view = await ai.attachmentReading(attachmentId);
      if (view && this.#state.preview?.attachmentId === attachmentId && !this.#state.reading?.busy) {
        this.#set({ reading: { attachmentId, view, busy: false, error: null } });
      }
    } catch {
      // Zusatz – Fehler hier nicht melden
    }
  }

  // --- Türsteher ---

  /** Liste um eine Seite ältere Mails verlängern. */
  async loadMoreMessages(): Promise<void> {
    this.#set({ messageLimit: Math.max(this.#state.messageLimit, this.pageSize) + this.pageSize });
    await this.loadMessages();
  }

  /** Zeitraum eines Kontos (Tage; null = Standard, 0 = alle). Längerer Zeitraum lädt sofort im Hintergrund nach. */
  async setSyncDays(accountId: string, days: number | null): Promise<void> {
    await this.#guard(() => this.#repository.setSyncDays(accountId, days));
    await Promise.all([this.loadSidebar(), this.loadMessages(), this.#loadSyncStatus()]);
  }

  async setScreener(accountId: string, enabled: boolean): Promise<void> {
    await this.#guard(() => this.#repository.setScreener(accountId, enabled));
    await this.loadSidebar();
    if (!enabled && this.#state.selectedScope.kind === "screener" && !Object.values(this.#state.accountsById).some((a) => a.screener)) {
      await this.selectScope({ kind: "unifiedInbox" });
    } else await this.loadMessages();
  }

  /** Absender der geöffneten Mail erlauben oder blockieren; danach die nächste wartende Mail zeigen. */
  async decideSender(address: string, decision: "allow" | "block"): Promise<void> {
    const list = visibleMessages(this.#state);
    const index = list.findIndex((m) => m.id === this.#state.selectedMessageId);
    await this.#guard(() => this.#repository.decideSender(address, decision));
    await Promise.all([this.loadSidebar(), this.loadMessages()]);
    const next = visibleMessages(this.#state)[Math.max(0, Math.min(index, visibleMessages(this.#state).length - 1))];
    if (this.#state.selectedScope.kind === "screener") await this.selectMessage(next?.id ?? null);
  }

  // --- Aktionen (Termine, Fristen, Zahlungen) ---

  async #loadActions(messageId: string): Promise<void> {
    const ai = this.#ai;
    if (!ai) return;
    try {
      const view = await ai.messageActions(messageId);
      if (this.#state.selectedMessageId === messageId) this.#set({ actions: view });
    } catch {
      // Zusatz – Fehler hier nicht melden
    }
  }

  async #changeAction(change: (ai: AIApi) => Promise<void>): Promise<void> {
    const ai = this.#ai;
    const messageId = this.#state.actions?.messageId;
    if (!ai || !messageId) return;
    await this.#guard(() => change(ai));
    await this.#loadActions(messageId);
  }

  setActionStatus(actionId: string, status: "open" | "done" | "dismissed"): Promise<void> {
    return this.#changeAction((ai) => ai.setActionStatus(actionId, status));
  }

  remind(actionId: string, due: Date): Promise<void> {
    return this.#changeAction((ai) => ai.remind(actionId, due.toISOString()));
  }

  cancelReminder(reminderId: string): Promise<void> {
    return this.#changeAction((ai) => ai.cancelReminder(reminderId));
  }

  addToCalendar(actionId: string): Promise<void> {
    return this.#changeAction((ai) => ai.addToCalendar(actionId));
  }

  closeSummary(): void {
    this.#set({ summary: null });
  }

  /** Gespeicherte Zusammenfassung der geöffneten Konversation anzeigen (rechnet nichts neu). */
  async #loadCachedSummary(): Promise<void> {
    const ai = this.#ai;
    const message = selectedMessage(this.#state);
    if (!ai || !message || !this.#state.ai?.ready) return;
    const threadId = message.threadId;
    if (this.#state.summary?.threadId === threadId && this.#state.summary.busy) return;
    try {
      const view = await ai.cachedSummary(threadId);
      const current = selectedMessage(this.#state);
      if (current?.threadId !== threadId || this.#state.summary?.busy) return;
      this.#set({ summary: view ? { threadId, view, busy: false, error: null } : null });
    } catch {
      // Zusammenfassung ist Zusatz – Fehler hier nicht melden
    }
  }

  /** App-Einstellungen ändern (sofort sichtbar, Fehler ins Banner). */
  async updateAppSettings(patch: Partial<AppSettings>): Promise<void> {
    const settings = this.#settings;
    if (!settings) return;
    const previous = this.#state.appSettings;
    if (previous) this.#set({ appSettings: { ...previous, ...patch } });
    await this.#guard(async () => {
      this.#set({ appSettings: await settings.update(patch) });
    });
    if ("oauthClients" in patch) await this.#loadOAuthProviders();
  }

  async #loadAppSettings(): Promise<void> {
    const settings = this.#settings;
    if (!settings) return;
    await this.#guard(async () => {
      const [appSettings, appSettingsAvailable] = await Promise.all([settings.get(), settings.available()]);
      this.#set({ appSettings, appSettingsAvailable });
    });
  }

  /** Können Anhänge geöffnet/gespeichert werden (Windows-App)? */
  get canOpenAttachments(): boolean {
    return this.#files !== undefined;
  }

  /** Vorschau in der App (PDF, Bild, Text); andere Formate öffnen im Standardprogramm. */
  async showAttachment(attachment: { id: string; filename: string; mimeType: string }): Promise<void> {
    const kind = previewKind(attachment.filename, attachment.mimeType);
    if (kind && this.#files) {
      this.#set({ preview: { attachmentId: attachment.id, filename: attachment.filename, kind }, reading: null });
      void this.#loadCachedReading(attachment.id);
    } else await this.openAttachment(attachment.id);
  }

  closePreview(): void {
    this.#set({ preview: null, reading: null });
  }

  /** Inhalt für die Vorschau (Fehler an den Vorschau-Dialog, nicht ins Banner). */
  readAttachment(id: string): Promise<{ filename: string; mimeType: string; contentBase64: string }> {
    if (!this.#files) return Promise.reject(new Error("Vorschau ist hier nicht verfügbar."));
    return this.#files.read(id);
  }

  openAttachment(id: string): Promise<void> {
    return this.#withAttachment(id, (files) => files.open(id));
  }

  saveAttachment(id: string): Promise<void> {
    return this.#withAttachment(id, async (files) => {
      await files.save(id);
    });
  }

  async #withAttachment(id: string, action: (files: AttachmentFiles) => Promise<void>): Promise<void> {
    const files = this.#files;
    if (!files || this.#state.attachmentBusy) return;
    this.#set({ attachmentBusy: id });
    try {
      await this.#guard(() => action(files));
    } finally {
      this.#set({ attachmentBusy: null });
    }
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
    await Promise.all([
      this.loadSidebar(),
      this.loadMessages(),
      this.#loadSyncStatus(),
      this.#loadRemoteContentExceptions(),
      this.#loadAppSettings(),
      this.#loadAI(),
      this.#loadOAuthProviders(),
      this.loadUserCategories(),
    ]);
  }

  /** Nach Änderungen von außen (Abgleich, andere Fenster): alles neu laden, Auswahl behalten, nichts als gelesen markieren. */
  async reload(): Promise<void> {
    await Promise.all([
      this.loadSidebar(),
      this.loadMessages(),
      this.#loadSyncStatus(),
      isSearching(this.#state) ? this.runSearch() : Promise.resolve(),
      // Aufräumen offen: Schutz der gewählten Gruppe auffrischen (z. B. nach KI-Einordnung)
      this.#state.cleanup?.group?.mails ? this.#loadCleanupMails() : Promise.resolve(),
      this.#state.panel === "subscriptions" ? this.#loadSubscriptions() : Promise.resolve(),
      this.#state.panel === "receipts" ? this.#loadReceipts() : Promise.resolve(),
      this.loadUserCategories(),
    ]);
    const selected = this.#state.selectedMessageId;
    const message = selected ? this.#find(selected) : undefined;
    if (!message) return;
    const request = ++this.#threadRequest;
    await this.#guard(async () => {
      const thread = await this.#repository.thread(message.threadId);
      if (request === this.#threadRequest) this.#set({ thread: thread.length ? thread : [message] });
    });
    await Promise.all([this.#loadCachedSummary(), this.#loadActions(message.id)]);
  }

  // --- Schreiben ---

  /**
   * Öffnet den Composer. Antworten/Weiterleiten beziehen sich auf die geöffnete Mail; ohne geöffnete Mail
   * gibt es nur „Neue E-Mail“. `labels` kommen aus der Oberfläche (Sprache des Zitat-Kopfs).
   */
  openCompose(mode: ComposeMode, labels: ComposeLabels, replyText?: string): void {
    const state = this.#state;
    const original = selectedMessage(state);
    if (mode !== "new" && !original) return;
    const account = this.#composeAccount(original);
    if (!account) {
      this.#set({ error: "Bitte zuerst ein Konto hinzufügen." });
      return;
    }
    const ownAddresses = Object.values(state.accountsById).map((a) => a.email);
    const thread = original ? threadFor(state, original) : [];
    const attachments = original ? (state.attachmentsByMessageId[original.id] ?? []) : [];
    this.#set({
      compose: prepareCompose(mode, { account, original, thread, ownAddresses, labels, signatureHtml: account.signatureHtml, attachments, ...(replyText ? { replyText } : {}) }),
    });
  }

  closeCompose(): void {
    this.#set({ compose: null });
  }

  /** Senden – Fehler (z. B. kein Empfänger) gehen an den Composer, nicht ins Banner. */
  async send(mail: OutgoingMail): Promise<void> {
    await this.#repository.send(mail);
    this.#set({ compose: null });
    await Promise.all([this.loadSidebar(), this.loadMessages()]);
    // Beantwortete Mail: Pfeil-Symbol aktualisieren
    if (mail.answeredMessageId) {
      const updated = await this.#repository.message(mail.answeredMessageId);
      if (updated) {
        const replace = (list: Message[]) => list.map((m) => (m.id === updated.id ? updated : m));
        this.#set({ messages: replace(this.#state.messages), thread: replace(this.#state.thread) });
      }
    }
  }

  /** Signatur eines Kontos speichern (Fehler an den Dialog). */
  async setSignature(accountId: string, html: string | null): Promise<void> {
    await this.#repository.setSignature(accountId, html);
    await this.loadSidebar();
  }

  /** Adressvorschläge für die Empfängerfelder (Fehler → keine Vorschläge, nie ein Banner). */
  async suggestAddresses(query: string): Promise<EmailAddress[]> {
    try {
      return await this.#repository.suggestAddresses(query, 8);
    } catch {
      return [];
    }
  }

  /** Speichert den Entwurf (lokal sofort, Server gebündelt) und gibt seine ID zurück. */
  saveDraft(draftId: string | null, draft: ComposeDraft): Promise<string> {
    return this.#repository.saveDraft(draftId, draft);
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.#guard(() => this.#repository.deleteDraft(draftId));
    await Promise.all([this.loadSidebar(), this.loadMessages()]);
  }

  /** Öffnet eine Mail aus „Entwürfe“ im Composer. */
  async editDraft(messageId: string): Promise<void> {
    await this.#guard(async () => {
      const draft = await this.#repository.openDraft(messageId);
      if (draft) this.#set({ compose: draft });
    });
  }

  /** Entwurf aus der Liste löschen (auch einen vom Server/anderen Gerät). */
  async deleteDraftMessage(messageId: string): Promise<void> {
    await this.#guard(async () => {
      const draft = await this.#repository.openDraft(messageId);
      if (draft?.draftId) await this.#repository.deleteDraft(draft.draftId);
    });
    await Promise.all([this.loadSidebar(), this.loadMessages()]);
  }

  /** Liegt die Mail im Ordner „Entwürfe“? */
  isDraft(message: Message): boolean {
    const box = this.#state.sections
      .flatMap((section) => section.items)
      .find((i) => i.kind.type === "mailbox" && i.kind.mailbox.id === message.mailboxId);
    return box?.kind.type === "mailbox" && box.kind.mailbox.role === "drafts";
  }

  /** Holt eine Mail aus dem Postausgang zurück in den Composer (z. B. nach einem Fehler). */
  async reopenOutgoing(id: string): Promise<void> {
    await this.#guard(async () => {
      const mail = await this.#repository.reopenOutgoing(id);
      await this.loadSidebar();
      if (mail) this.#set({ compose: { ...mail, mode: mail.inReplyTo ? "reply" : "new" } });
    });
  }

  #composeAccount(original: Message | null): Account | undefined {
    const accounts = Object.values(this.#state.accountsById);
    if (original) return this.#state.accountsById[original.accountId];
    const scope = this.#state.selectedScope;
    if (scope.kind === "mailbox") {
      const box = this.#state.sections
        .flatMap((section) => section.items)
        .find((i) => i.kind.type === "mailbox" && i.kind.mailbox.id === scope.mailboxId);
      const owner = box?.kind.type === "mailbox" ? this.#state.accountsById[box.kind.mailbox.accountId] : undefined;
      if (owner) return owner;
    }
    const sorted = [...accounts].sort((a, b) => a.sortOrder - b.sortOrder);
    return sorted.find((a) => !isDemoAccount(a)) ?? sorted[0];
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
  async addAccount(settings: AccountSettings, password: string, removeDemoAccounts: boolean, screener = false): Promise<Account> {
    if (!this.#accounts) throw new Error("Kontoverwaltung ist hier nicht verfügbar.");
    const account = await this.#accounts.addAccount(settings, password, { removeDemoAccounts, screener });
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

  async #loadOAuthProviders(): Promise<void> {
    if (!this.#accounts) return;
    await this.#guard(async () => this.#set({ oauthProviders: await this.#accounts!.oauthProviders() }));
  }

  /** Konto per Anmeldung im Browser. Fehler an den Dialog (nicht als Banner). */
  async addOAuthAccount(provider: OAuthProviderId, removeDemoAccounts: boolean, screener = false): Promise<Account> {
    if (!this.#accounts) throw new Error("Kontoverwaltung ist hier nicht verfügbar.");
    const account = await this.#accounts.addOAuthAccount(provider, { removeDemoAccounts, screener });
    await this.selectScope({ kind: "unifiedInbox" });
    await this.reload();
    return account;
  }

  /** Abgelaufene Anmeldung erneuern (öffnet den Browser). */
  async reauthorize(accountId: string): Promise<void> {
    if (!this.#accounts) return;
    await this.#guard(() => this.#accounts!.reauthorize(accountId));
    await this.reload();
  }

  async #loadSyncStatus(): Promise<void> {
    if (!this.#accounts) return;
    await this.#guard(async () => {
      const status = await this.#accounts!.syncStatus();
      this.#set({ syncing: status.running, lastSyncAt: status.lastRunAt, syncProgress: status.progress ?? null });
    });
  }

  /** Seitenleiste mit einem einzigen Aufruf (Konten, Ordner, Zähler) – wichtig für Tempo über IPC/HTTP. */
  async loadSidebar(): Promise<void> {
    await this.#guard(async () => {
      const { accounts, mailboxesByAccount, counts, outbox } = await this.#repository.overview();
      const smart: [SidebarItemKind, MessageScope, number][] = [
        [{ type: "unifiedInbox" }, { kind: "unifiedInbox" }, counts.unifiedInbox],
        [{ type: "unread" }, { kind: "unread" }, counts.unread],
        [{ type: "flagged" }, { kind: "flagged" }, counts.flagged],
      ];
      // Türsteher: eigener Bereich, sobald er bei einem Konto an ist (Zähler = wartende Mails)
      if (accounts.some((a) => a.screener)) smart.push([{ type: "screener" }, { kind: "screener" }, counts.screener]);
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
      this.#set({ sections, accountsById: Object.fromEntries(accounts.map((a) => [a.id, a])), outbox });
    });
  }

  async loadMessages(): Promise<void> {
    const request = ++this.#messagesRequest;
    const scope = this.#state.selectedScope;
    await this.#guard(async () => {
      const limit = Math.max(this.#state.messageLimit, this.pageSize);
      let messages = await this.#repository.messages(scope, limit);
      if (request !== this.#messagesRequest) return; // überholt
      const hasMoreMessages = messages.length >= limit;
      const selected = this.#state.selectedMessageId;
      // In „Ungelesen“/„Markiert“ bleibt die geöffnete Mail stehen, auch wenn sie nicht mehr dazugehört
      // (gerade gelesen) – sonst verschwindet sie beim Öffnen. Sie geht erst beim Wechsel der Auswahl.
      const kept = this.#state.messages.find((m) => m.id === selected);
      if (kept && (scope.kind === "unread" || scope.kind === "flagged") && !messages.some((m) => m.id === selected)) {
        messages = [...messages, kept].sort((a, b) => b.date.localeCompare(a.date));
      }
      // Auswahl bleibt, solange die Mail noch in der Liste oder in den Suchergebnissen steht.
      const keepSelection = selected !== null && (messages.some((m) => m.id === selected) || Boolean(this.#state.searchResults?.some((m) => m.id === selected)));
      this.#set({ messages, hasMoreMessages, ...(keepSelection ? {} : { selectedMessageId: null, thread: [], attachmentsByMessageId: {}, summary: null, actions: null, replies: null }) });
    });
  }

  async selectScope(scope: MessageScope): Promise<void> {
    if (scopeKey(scope) === scopeKey(this.#state.selectedScope)) {
      if (this.#state.panel !== "mail") this.#set({ panel: "mail" });
      return;
    }
    // Ordnerwechsel beendet eine Suche in allen Ordnern; „nur in diesem Ordner“ sucht im neuen Ordner weiter.
    const keepSearch = isSearching(this.#state) && !this.#state.searchAllFolders;
    this.#set({
      panel: "mail",
      selectedScope: scope, messageLimit: 0, hasMoreMessages: false, selectedMessageId: null, thread: [], attachmentsByMessageId: {}, summary: null, actions: null, replies: null,
      ...(keepSearch ? {} : { searchText: "", searchResults: null }),
    });
    await Promise.all([this.loadMessages(), keepSearch ? this.runSearch() : Promise.resolve()]);
  }

  /** Suchtext ändern – gesucht wird kurz nach der letzten Eingabe (nicht bei jedem Tastendruck). */
  setSearchText(searchText: string): void {
    this.#set({ searchText });
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    if (!searchText.trim()) {
      this.#searchRequest++;
      this.#set({ searchResults: null });
      return;
    }
    this.#searchTimer = setTimeout(() => void this.runSearch(), this.searchDelayMs);
  }

  setSearchAllFolders(all: boolean): void {
    this.#set({ searchAllFolders: all });
    if (isSearching(this.#state)) void this.runSearch();
  }

  /** Sucht in der Datenbank (Volltext). Ältere, überholte Anfragen werden verworfen. */
  async runSearch(): Promise<void> {
    if (this.#searchTimer) clearTimeout(this.#searchTimer);
    this.#searchTimer = null;
    const text = this.#state.searchText;
    if (!text.trim()) return;
    const request = ++this.#searchRequest;
    const scope = this.#state.searchAllFolders ? null : this.#state.selectedScope;
    await this.#guard(async () => {
      const results = await this.#repository.search(text, { scope, limit: 300 });
      if (request === this.#searchRequest) this.#set({ searchResults: results });
    });
  }

  /** Öffnet eine Mail: lädt die Konversation und markiert die Mail als gelesen. */
  async selectMessage(id: string | null): Promise<void> {
    const request = ++this.#threadRequest;
    this.#set({ selectedMessageId: id });
    if (id === null) {
      this.#set({ thread: [], attachmentsByMessageId: {}, summary: null, actions: null, replies: null });
      return;
    }
    const message = this.#find(id);
    if (!message) return;
    if (this.#state.summary && this.#state.summary.threadId !== message.threadId) this.#set({ summary: null });
    if (this.#state.actions?.messageId !== id) this.#set({ actions: null });
    if (this.#state.replies && this.#state.replies.messageId !== id) this.#set({ replies: null });
    if (this.#state.categoryNote && this.#state.categoryNote.messageId !== id) this.#set({ categoryNote: null });
    if (this.#state.userCategoryNote && this.#state.userCategoryNote.messageId !== id) this.#set({ userCategoryNote: null });
    void this.#loadCachedSummary();
    void this.#loadActions(id);
    void this.loadUnsubscribe(id);
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

  /** Öffnet eine bestimmte Mail (z. B. aus einer Benachrichtigung): Posteingang zeigen, Mail auswählen. */
  async openMessage(id: string): Promise<void> {
    this.#set({ searchText: "", searchResults: null });
    if (this.#state.selectedScope.kind !== "unifiedInbox") await this.selectScope({ kind: "unifiedInbox" });
    else await this.loadMessages();
    await this.selectMessage(id);
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
    const keep = (list: Message[]) => list.filter((m) => !ids.includes(m.id));
    this.#set({ messages: keep(this.#state.messages), searchResults: this.#state.searchResults && keep(this.#state.searchResults) });
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
    this.#set({
      messages: apply(this.#state.messages),
      thread: apply(this.#state.thread),
      searchResults: this.#state.searchResults && apply(this.#state.searchResults),
    });
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
    return (
      this.#state.messages.find((m) => m.id === id) ??
      this.#state.searchResults?.find((m) => m.id === id) ??
      this.#state.thread.find((m) => m.id === id)
    );
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

/** Fehlertext ohne Electron-Vorspann („Error invoking remote method …“). */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error);
}
