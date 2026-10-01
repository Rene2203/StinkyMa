import { actionsPromptVersion, extractActions, ruleActions } from "../ai/actions.js";
import { cleanMailText } from "../ai/prepare.js";
import { calendarFileName, toICalendar } from "../calendar.js";
import type { ActionStatus, ActionStore, StoredAction } from "../sqlite/actionStore.js";
import { categorizeWindowDays, maxPageImageChars, normalizeAISettings, type ActionView, type MessageActionsView, type ReplyDraftsView, type AIApi, type AIModelInfo, type AISettings, type AIStatus, type AttachmentReadingView, type SummaryView } from "../ai/api.js";
import { modelCatalog, type CatalogModel } from "../ai/catalog.js";
import { promptVersions } from "../ai/prompts.js";
import { AIRouter, GrantPolicy } from "../ai/router.js";
import { interpretRule, interpretRuleWithRules, type RuleInterpretation } from "../ai/rules.js";
import { draftReplies } from "../ai/replies.js";
import { isDigestImportant, localDay, type DigestView } from "../digest.js";
import type { DigestStore } from "../sqlite/digestStore.js";
import { categorizeMessage, maxImagesPerReading, readDocumentImages, summarizeThread } from "../ai/tasks.js";
import { AIBlockedError, AINotConfiguredError, type AIImage, type AIProvider, type AIRequest } from "../ai/types.js";
import type { Message } from "../models.js";
import type { AIResultStore, StoredReading, StoredSummary } from "../sqlite/aiStore.js";
import { LlamaCppProvider } from "./llamaProvider.js";
import { LlamaServerProvider } from "./llamaServer.js";
import type { ModelStore } from "./modelStore.js";
import type { RuntimeStore } from "./runtimeStore.js";

// KI-Dienst der Windows-App (und später des Servers): verwaltet Modelle, Einstellungen, Zusammenfassungen und die
// Einordnung im Hintergrund. Alles läuft auf diesem Gerät; Mail-Inhalte erscheinen nie in Logs oder Fehlermeldungen.


export interface ManagedProvider extends AIProvider {
  unload(): Promise<void>;
  dispose(): Promise<void>;
}

export interface AIServiceOptions {
  store: ModelStore;
  results: AIResultStore;
  thread(threadId: string): Promise<Message[]>;
  ownAddresses(): Promise<string[]>;
  settings: { load(): unknown; save(settings: AISettings): void };
  ramGb: number;
  catalog?: readonly CatalogModel[];
  createProvider?: (model: CatalogModel, path: string, settings: AISettings) => ManagedProvider;
  /** Bild-Laufzeit (llama-server); fehlt sie, gibt es kein „Bilder verstehen“. */
  runtime?: RuntimeStore;
  /** Inhalt eines Anhangs (ggf. vom Mailserver geholt). */
  attachmentContent?: (attachmentId: string) => Promise<{ filename: string; mimeType: string; content: Uint8Array }>;
  createVisionProvider?: (model: CatalogModel, paths: { server: string; model: string; mmproj: string }, settings: AISettings) => ManagedProvider;
  /** Erkannte Aktionen und Erinnerungen (W6.1). */
  actions?: ActionStore;
  message?: (messageId: string) => Promise<Message | null>;
  /** Kalenderdatei mit dem Standardprogramm öffnen (Windows: Outlook/Kalender). */
  openCalendarFile?: (ics: string, filename: string) => Promise<void>;
  /** Aktionen einer Mail wurden im Hintergrund verfeinert (Modell) – Oberfläche neu laden. */
  onActionsUpdated?: (messageId: string) => void;
  /** Status hat sich geändert (Download-Fortschritt, Einstellungen, Einordnung). */
  onStatus?: (status: AIStatus) => void;
  /** Eine Mail hat eine Kategorie bekommen – Oberfläche neu laden. */
  onCategorized?: () => void;
  /** Abfragen für den Tagesüberblick (W6.6). */
  digest?: DigestStore;
  now?: () => Date;
}

export class AIService implements AIApi {
  #settings: AISettings;
  #provider: { key: string; provider: ManagedProvider } | null = null;
  #vision: { key: string; provider: ManagedProvider } | null = null;
  /** Welches Modell gerade im Speicher sein darf – Text- und Bild-Laufzeit nie gleichzeitig (schwache Rechner). */
  #active: ManagedProvider | null = null;
  #engine: Promise<unknown> = Promise.resolve();
  #download: { kind: "model" | "vision"; modelId: string; receivedBytes: number; totalBytes: number; controller: AbortController } | null = null;
  #categorizing: { remaining: number } | null = null;
  #categorizeRequested = false;
  #error: string | null = null;
  #lastProgressAt = 0;
  #disposed = false;
  readonly #catalog: readonly CatalogModel[];

  constructor(private readonly options: AIServiceOptions) {
    this.#settings = normalizeAISettings(options.settings.load());
    this.#catalog = options.catalog ?? modelCatalog;
    if (this.#settings.modelId && !this.#model(this.#settings.modelId)) this.#settings = { ...this.#settings, modelId: null };
  }

  #model(id: string): CatalogModel | undefined {
    return this.#catalog.find((m) => m.id === id);
  }

  async status(): Promise<AIStatus> {
    const models: AIModelInfo[] = [];
    let selectedInstalled = false;
    for (const model of this.#catalog) {
      const downloading = this.#download?.modelId === model.id ? this.#download : null;
      const stored = await this.options.store.status(model);
      const state = downloading ? "downloading" : stored.state;
      if (model.id === this.#settings.modelId && stored.state === "installed") selectedInstalled = true;
      models.push({
        id: model.id,
        name: model.name,
        family: model.family,
        paramsB: model.paramsB,
        sizeBytes: model.sizeBytes,
        minRamGb: model.minRamGb,
        capabilities: model.capabilities,
        note: model.note,
        recommended: model.recommended ?? false,
        fits: this.options.ramGb >= model.minRamGb,
        state,
        receivedBytes: downloading ? downloading.receivedBytes : stored.state === "partial" ? stored.receivedBytes : stored.state === "installed" ? model.sizeBytes : 0,
      });
    }
    return {
      settings: { ...this.#settings },
      models,
      ramGb: this.options.ramGb,
      ready: this.#settings.enabled && selectedInstalled,
      download: this.#download ? { kind: this.#download.kind, modelId: this.#download.modelId, receivedBytes: this.#download.receivedBytes, totalBytes: this.#download.totalBytes } : null,
      vision: await this.#visionStatus(),
      categorizing: this.#categorizing ? { ...this.#categorizing } : null,
      error: this.#error,
    };
  }

  async update(patch: Partial<AISettings>): Promise<AIStatus> {
    const next = normalizeAISettings({ ...this.#settings, ...patch });
    if (next.modelId && !this.#model(next.modelId)) throw new Error("Unbekanntes Modell.");
    const providerChanged = next.modelId !== this.#settings.modelId || next.useGpu !== this.#settings.useGpu || !next.enabled;
    this.#settings = next;
    this.options.settings.save(next);
    this.#error = null;
    if (providerChanged || !next.vision) {
      if (providerChanged) await this.#releaseProvider();
      await this.#releaseVision();
    }
    if (next.enabled && next.autoCategorize) this.categorizeInBackground();
    return this.#emit();
  }

  async download(modelId: string): Promise<void> {
    const model = this.#model(modelId);
    if (!model) throw new Error("Unbekanntes Modell.");
    if (this.#download) throw new Error("Es läuft bereits ein Download.");
    const controller = new AbortController();
    this.#download = { kind: "model", modelId, receivedBytes: 0, totalBytes: model.sizeBytes, controller };
    this.#error = null;
    await this.#emit();
    try {
      await this.options.store.download(model, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!this.#download) return;
          this.#download.receivedBytes = progress.receivedBytes;
          this.#download.totalBytes = progress.totalBytes;
          const now = Date.now();
          if (now - this.#lastProgressAt > 250) {
            this.#lastProgressAt = now;
            void this.#emit();
          }
        },
      });
      this.#download = null;
      // Erstes Modell: gleich verwenden
      if (!this.#settings.modelId) {
        await this.update({ modelId, enabled: true });
        return;
      }
    } catch (error) {
      this.#download = null;
      if (!controller.signal.aborted) {
        this.#error = error instanceof Error ? error.message : String(error);
        await this.#emit();
        throw error;
      }
    }
    await this.#emit();
  }

  async cancelDownload(): Promise<void> {
    this.#download?.controller.abort();
  }

  async deleteModel(modelId: string): Promise<void> {
    const model = this.#model(modelId);
    if (!model) throw new Error("Unbekanntes Modell.");
    if (this.#download?.modelId === modelId) this.#download.controller.abort();
    if (this.#settings.modelId === modelId) {
      await this.#releaseProvider();
      await this.#releaseVision();
      this.#settings = { ...this.#settings, modelId: null };
      this.options.settings.save(this.#settings);
    }
    await this.options.store.delete(model);
    await this.#emit();
  }

  async cachedSummary(threadId: string): Promise<SummaryView | null> {
    const stored = this.options.results.summary(threadId);
    if (!stored) return null;
    return this.#view(stored, await this.options.thread(threadId));
  }

  async summarize(threadId: string): Promise<SummaryView> {
    const thread = await this.options.thread(threadId);
    if (thread.length === 0) throw new Error("Die Konversation gibt es nicht mehr.");
    const { router, model } = await this.#router();
    const result = await summarizeThread(router, thread, { ownAddresses: await this.options.ownAddresses() });
    const last = thread.reduce((latest, m) => (m.date > latest ? m.date : latest), "");
    const stored: StoredSummary = {
      threadId,
      summary: result.summary,
      openPoints: result.openPoints,
      waitingOn: result.waitingOn,
      modelId: model.id,
      privacyClass: result.origin,
      promptVersion: promptVersions.summarize,
      lastMessageDate: last,
      messageCount: thread.length,
      createdAt: (this.options.now?.() ?? new Date()).toISOString(),
    };
    this.options.results.saveSummary(stored);
    return this.#view(stored, thread);
  }

  // --- Bilder und Scans ---

  async #visionStatus(): Promise<AIStatus["vision"]> {
    const model = this.#settings.modelId ? this.#model(this.#settings.modelId) : undefined;
    const runtime = this.options.runtime;
    if (!model?.vision || !runtime?.asset) return { state: "unavailable", missingBytes: 0 };
    if (this.#download?.kind === "vision") return { state: "downloading", missingBytes: this.#download.totalBytes - this.#download.receivedBytes };
    const stored = await this.options.store.status(model, { withVision: true });
    const visionMissing = stored.state === "installed" && stored.visionPath ? 0 : model.vision.sizeBytes;
    const runtimeMissing = (await runtime.serverPath()) ? 0 : runtime.sizeBytes;
    const missingBytes = visionMissing + runtimeMissing;
    return { state: missingBytes === 0 ? "ready" : "missing", missingBytes };
  }

  async downloadVision(): Promise<void> {
    const model = this.#settings.modelId ? this.#model(this.#settings.modelId) : undefined;
    const runtime = this.options.runtime;
    if (!model?.vision || !runtime?.asset) throw new Error("Das gewählte Modell oder dieses System kann keine Bilder lesen.");
    if (this.#download) throw new Error("Es läuft bereits ein Download.");
    const controller = new AbortController();
    const totalBytes = (await this.#visionStatus()).missingBytes;
    this.#download = { kind: "vision", modelId: model.id, receivedBytes: 0, totalBytes, controller };
    this.#error = null;
    await this.#emit();
    let done = 0;
    const progress = (received: number) => {
      if (!this.#download) return;
      this.#download.receivedBytes = Math.min(totalBytes, done + received);
      const now = Date.now();
      if (now - this.#lastProgressAt > 250) {
        this.#lastProgressAt = now;
        void this.#emit();
      }
    };
    try {
      const before = await this.options.store.status(model);
      const visionBefore = await this.options.store.status(model, { withVision: true });
      if (!(visionBefore.state === "installed" && visionBefore.visionPath)) {
        // Nur der Bild-Baustein fehlt (das Modell selbst ist schon da): Fortschritt ab der Modellgröße abziehen
        const offset = before.state === "installed" ? model.sizeBytes : 0;
        await this.options.store.download(model, { withVision: true, signal: controller.signal, onProgress: (p) => progress(Math.max(0, p.receivedBytes - offset)) });
        done += model.vision.sizeBytes;
      }
      if (!(await runtime.serverPath())) await runtime.download({ signal: controller.signal, onProgress: (p) => progress(p.receivedBytes) });
      this.#download = null;
      if (!this.#settings.vision) await this.update({ vision: true });
    } catch (error) {
      this.#download = null;
      if (!controller.signal.aborted) {
        this.#error = error instanceof Error ? error.message : String(error);
        await this.#emit();
        throw error;
      }
    }
    await this.#emit();
  }

  async attachmentReading(attachmentId: string): Promise<AttachmentReadingView | null> {
    const stored = this.options.results.reading(attachmentId);
    return stored ? this.#readingView(stored) : null;
  }

  async readAttachment(attachmentId: string, pageImages: AIImage[] = []): Promise<AttachmentReadingView> {
    const info = this.options.results.attachmentInfo(attachmentId);
    if (!info) throw new Error("Den Anhang gibt es nicht mehr.");
    const images = pageImages.length > 0 ? validatePageImages(pageImages) : await this.#attachmentImage(attachmentId);
    const { router, model } = await this.#visionRouter();
    const result = await readDocumentImages(router, images, { filename: info.filename, accountIds: [info.accountId] });
    const stored: StoredReading = {
      attachmentId,
      documentType: result.documentType,
      title: result.title,
      summary: result.summary,
      text: result.text,
      modelId: model.id,
      privacyClass: result.origin,
      analyzedAt: (this.options.now?.() ?? new Date()).toISOString(),
      durationMs: result.durationMs,
    };
    this.options.results.saveReading(stored);
    return this.#readingView(stored);
  }

  async #attachmentImage(attachmentId: string): Promise<AIImage[]> {
    if (!this.options.attachmentContent) throw new Error("Anhänge können hier nicht gelesen werden.");
    const { mimeType, filename, content } = await this.options.attachmentContent(attachmentId);
    const type = imageType(mimeType, filename);
    if (!type) throw new Error("Dieses Bildformat kann die KI nicht lesen (unterstützt: PNG, JPEG, WebP, GIF, BMP).");
    if (content.byteLength > 20 * 1024 * 1024) throw new Error("Das Bild ist zu groß für die KI (höchstens 20 MB).");
    return [{ mimeType: type, base64: Buffer.from(content).toString("base64") }];
  }

  #readingView(stored: StoredReading): AttachmentReadingView {
    return {
      attachmentId: stored.attachmentId,
      documentType: stored.documentType,
      title: stored.title,
      summary: stored.summary,
      text: stored.text,
      origin: stored.privacyClass === "ownServer" || stored.privacyClass === "cloud" ? stored.privacyClass : "onDevice",
      modelName: this.#model(stored.modelId)?.name ?? stored.modelId,
      createdAt: stored.analyzedAt,
      durationMs: stored.durationMs,
    };
  }

  async #visionRouter(): Promise<{ router: AIRouter; model: CatalogModel }> {
    if (!this.#settings.enabled) throw new AINotConfiguredError("Die KI ist ausgeschaltet (Optionen → KI).");
    const model = this.#settings.modelId ? this.#model(this.#settings.modelId) : undefined;
    if (!model) throw new AINotConfiguredError("Noch kein KI-Modell gewählt (Optionen → KI).");
    if (!this.#settings.vision) throw new AINotConfiguredError("„Bilder und Scans verstehen“ ist ausgeschaltet (Optionen → KI).");
    const stored = await this.options.store.status(model, { withVision: true });
    const server = await this.options.runtime?.serverPath();
    if (stored.state !== "installed" || !stored.visionPath || !server) {
      throw new AINotConfiguredError("Für Bilder fehlen noch Dateien – bitte in den Optionen → KI laden.");
    }
    const key = `${model.id}|${this.#settings.useGpu}`;
    if (this.#vision?.key !== key) {
      await this.#releaseVision();
      const paths = { server, model: stored.path, mmproj: stored.visionPath };
      const create =
        this.options.createVisionProvider ??
        ((m: CatalogModel, p: typeof paths, s: AISettings) =>
          new LlamaServerProvider({ id: m.id, displayName: m.name, serverPath: p.server, modelPath: p.model, mmprojPath: p.mmproj, gpu: s.useGpu }));
      this.#vision = { key, provider: create(model, paths, this.#settings) };
    }
    const provider = this.#exclusive(this.#vision.provider);
    return { router: new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() }), model };
  }

  /**
   * Hülle um einen Anbieter: Vor jedem Aufruf wird ein anderes geladenes Modell aus dem Speicher genommen, und alle
   * Aufrufe laufen nacheinander. So liegen Text- und Bildmodell nie gleichzeitig im Arbeitsspeicher.
   */
  #exclusive(provider: ManagedProvider): AIProvider {
    return {
      id: provider.id,
      displayName: provider.displayName,
      privacyClass: provider.privacyClass,
      contextWindow: provider.contextWindow,
      acceptsImages: provider.acceptsImages,
      generate: (request: AIRequest, signal?: AbortSignal) => {
        const run = this.#engine.then(async () => {
          if (this.#active && this.#active !== provider) await this.#active.unload();
          this.#active = provider;
          return provider.generate(request, signal);
        });
        this.#engine = run.catch(() => undefined);
        return run;
      },
    };
  }

  async #releaseVision(): Promise<void> {
    const current = this.#vision;
    this.#vision = null;
    if (current && this.#active === current.provider) this.#active = null;
    await current?.provider.dispose();
  }

  // --- Aktionen und Erinnerungen (W6.1) ---

  readonly #scanning = new Map<string, Promise<void>>();

  #actionStore(): ActionStore {
    if (!this.options.actions) throw new Error("Aktionen sind hier nicht verfügbar.");
    return this.options.actions;
  }

  #actionsView(messageId: string, origin: MessageActionsView["origin"]): MessageActionsView {
    const store = this.#actionStore();
    const reminders = store.remindersForMessage(messageId);
    const view = (a: StoredAction): ActionView => {
      const reminder = reminders.find((r) => r.actionId === a.id);
      return { ...a, reminder: reminder ? { id: reminder.id, dueDate: reminder.dueDate } : null };
    };
    return { messageId, actions: store.actions(messageId).filter((a) => a.status !== "dismissed").map(view), origin };
  }

  /**
   * Aktionen einer Mail – ohne Warten: beim ersten Öffnen sofort die Regel-Erkennung; steht ein Modell bereit, verfeinert
   * es im Hintergrund und meldet sich über `onActionsUpdated` (die Oberfläche lädt dann neu).
   */
  async messageActions(messageId: string): Promise<MessageActionsView> {
    const store = this.#actionStore();
    const scan = store.scan(messageId);
    if (scan && scan.promptVersion === actionsPromptVersion && scan.origin !== "rules") return this.#actionsView(messageId, scan.origin as MessageActionsView["origin"]);
    const message = await this.options.message?.(messageId);
    if (!message) return { messageId, actions: [], origin: null };
    const role = store.mailboxRole(messageId);
    // Nur empfangene Mails; Werbung und Verdächtiges nicht (dort will niemand „Termine“ aus Lockangeboten)
    if (role === "sent" || role === "drafts" || role === "trash" || role === "spam" || message.category === "newsletter" || message.category === "spam_suspect") {
      return { messageId, actions: [], origin: null };
    }
    if (!scan || scan.promptVersion !== actionsPromptVersion) {
      const actions = ruleActions(message.subject, cleanMailText(message.bodyText ?? message.snippet, 2000), new Date(message.date));
      store.saveScan(messageId, actions, { origin: "rules", promptVersion: actionsPromptVersion, at: (this.options.now?.() ?? new Date()).toISOString() });
    }
    if (await this.#modelReady()) void this.#refineActions(message);
    return this.#actionsView(messageId, "rules");
  }

  /** Modell-Erkennung im Hintergrund (je Mail höchstens einmal gleichzeitig). */
  #refineActions(message: Message): Promise<void> {
    const running = this.#scanning.get(message.id);
    if (running) return running;
    const work = (async () => {
      try {
        const { router } = await this.#router();
        const result = await extractActions(router, message);
        // Versagt das Modell zweimal, bleibt es bei den Regeln (schon gespeichert)
        if (result.origin === "rules") return;
        this.#actionStore().saveScan(message.id, result.actions, { origin: result.origin, promptVersion: actionsPromptVersion, at: (this.options.now?.() ?? new Date()).toISOString() });
        this.options.onActionsUpdated?.(message.id);
      } catch (error) {
        if (!(error instanceof AINotConfiguredError || error instanceof AIBlockedError)) {
          this.#error = error instanceof Error ? error.message : String(error);
        }
      }
    })();
    this.#scanning.set(message.id, work);
    void work.finally(() => this.#scanning.delete(message.id));
    return work;
  }

  /** Für Tests: wartet, bis laufende Hintergrund-Erkennungen fertig sind. */
  async settled(): Promise<void> {
    await Promise.all([...this.#scanning.values()]);
  }

  /**
   * Tagesüberblick (W6.6) – ohne Modell, sofort. Vorher werden neue Posteingangs-Mails, die noch niemand geöffnet hat,
   * schnell mit den Regeln nach Fristen/Terminen/Zahlungen durchsucht (das Modell verfeinert erst beim Öffnen).
   */
  async dailyDigest(): Promise<DigestView> {
    const digest = this.options.digest;
    if (!digest) throw new Error("Der Tagesüberblick ist hier nicht verfügbar.");
    const store = this.#actionStore();
    const now = this.options.now?.() ?? new Date();
    const day = 86_400_000;
    const since = new Date(now.getTime() - 2 * day).toISOString();
    for (const mail of digest.unscannedInbox(new Date(now.getTime() - 14 * day).toISOString(), 200)) {
      if (mail.category === "newsletter" || mail.category === "spam_suspect") continue;
      const actions = ruleActions(mail.subject, cleanMailText(mail.body, 2000), new Date(mail.date));
      store.saveScan(mail.id, actions, { origin: "rules", promptVersion: actionsPromptVersion, at: now.toISOString() });
    }
    const today = localDay(now);
    const unread = digest.unreadInbox(since, 200);
    const count = (category: string) => unread.filter((m) => m.category === category).length;
    return {
      day: today,
      due: digest.openActions(localDay(new Date(now.getTime() - 14 * day)), localDay(new Date(now.getTime() + 7 * day)), today, 20),
      important: unread.filter((m) => isDigestImportant(m.category)).slice(0, 15),
      waitingOnMe: digest.waitingOnMe(new Date(now.getTime() - 14 * day).toISOString(), 10),
      counts: { newsletter: count("newsletter"), notification: count("notification"), spamSuspect: count("spam_suspect"), flagged: digest.flaggedCount() },
    };
  }

  /** Antwortvorschläge (W6.5) – nur auf Klick, mit dem gewählten lokalen Modell. */
  async replyDrafts(messageId: string): Promise<ReplyDraftsView> {
    const message = await this.options.message?.(messageId);
    if (!message) throw new Error("Die Mail wurde nicht gefunden.");
    const { router, model } = await this.#router();
    const thread = await this.options.thread(message.threadId);
    const earlier = thread.filter((m) => m.id !== message.id && m.date <= message.date);
    const result = await draftReplies(router, message, { earlier });
    return { messageId, form: result.form, greeting: result.greeting, replies: result.replies, modelName: model.name, durationMs: result.durationMs };
  }

  /**
   * Regel aus normaler Sprache (W6.4): mit Modell, falls bereit – sonst (oder bei Fehlern) die einfachen Regeln.
   * Der Text stammt vom Nutzer, nicht aus Mails.
   */
  async interpretRule(text: string, folders: readonly string[], accountIds: string[]): Promise<RuleInterpretation> {
    if (!(await this.#modelReady()) || accountIds.length === 0) return interpretRuleWithRules(text, folders);
    try {
      const { router } = await this.#router();
      return await interpretRule(router, text, folders, accountIds);
    } catch (error) {
      if (!(error instanceof AINotConfiguredError || error instanceof AIBlockedError)) {
        this.#error = error instanceof Error ? error.message : String(error);
      }
      return interpretRuleWithRules(text, folders);
    }
  }

  async #modelReady(): Promise<boolean> {
    const model = this.#settings.enabled && this.#settings.modelId ? this.#model(this.#settings.modelId) : undefined;
    return !!model && (await this.options.store.status(model)).state === "installed";
  }

  async setActionStatus(actionId: string, status: ActionStatus): Promise<void> {
    if (status !== "open" && status !== "done" && status !== "dismissed") throw new Error("Ungültiger Status.");
    this.#actionStore().setStatus(actionId, status);
  }

  async remind(actionId: string, dueIso: string): Promise<void> {
    const store = this.#actionStore();
    const action = store.action(actionId);
    if (!action) throw new Error("Die Aktion gibt es nicht mehr.");
    const due = new Date(dueIso);
    if (Number.isNaN(due.getTime())) throw new Error("Ungültiger Zeitpunkt.");
    for (const existing of store.remindersForMessage(action.messageId).filter((r) => r.actionId === actionId)) store.cancelReminder(existing.id);
    store.addReminder({ messageId: action.messageId, actionId, dueDate: due.toISOString(), text: action.title });
  }

  async cancelReminder(reminderId: string): Promise<void> {
    this.#actionStore().cancelReminder(reminderId);
  }

  async addToCalendar(actionId: string): Promise<void> {
    const action = this.#actionStore().action(actionId);
    if (!action?.date) throw new Error("Für einen Kalendereintrag fehlt das Datum.");
    if (!this.options.openCalendarFile) throw new Error("Kalender ist hier nicht verfügbar.");
    const message = await this.options.message?.(action.messageId);
    const ics = toICalendar(
      {
        uid: `${action.id}@stinkyma`,
        title: action.type === "payment" ? `Zahlung: ${action.title}${action.amount ? ` (${action.amount})` : ""}` : action.type === "deadline" ? `Frist: ${action.title}` : action.title,
        date: action.date,
        time: action.type === "appointment" ? action.time : null,
        description: [action.quote, message ? `Aus der Mail „${message.subject}“` : ""].filter(Boolean).join("\n\n"),
        alarmMinutesBefore: action.type === "appointment" && action.time ? 60 : undefined,
      },
      this.options.now?.() ?? new Date(),
    );
    await this.options.openCalendarFile(ics, calendarFileName(action.title, action.date));
  }

  /** Fällige Erinnerungen (für Benachrichtigungen; jede genau einmal). */
  takeDueReminders(): { id: string; messageId: string | null; text: string }[] {
    if (!this.options.actions) return [];
    return this.options.actions.takeDueReminders((this.options.now?.() ?? new Date()).toISOString());
  }

  #view(stored: StoredSummary, thread: Message[]): SummaryView {
    const last = thread.reduce((latest, m) => (m.date > latest ? m.date : latest), "");
    return {
      threadId: stored.threadId,
      summary: stored.summary,
      openPoints: stored.openPoints,
      waitingOn: stored.waitingOn,
      origin: stored.privacyClass === "ownServer" || stored.privacyClass === "cloud" ? stored.privacyClass : "onDevice",
      modelName: this.#model(stored.modelId)?.name ?? stored.modelId,
      createdAt: stored.createdAt,
      stale: thread.length !== stored.messageCount || last !== stored.lastMessageDate,
    };
  }

  /**
   * Ordnet neue Mails im Hintergrund ein (nacheinander, eine nach der anderen). Mehrfachaufrufe während eines
   * Laufs führen zu genau einem weiteren Durchgang.
   */
  categorizeInBackground(): void {
    if (this.#categorizing) {
      this.#categorizeRequested = true;
      return;
    }
    void this.#categorizeLoop();
  }

  async #categorizeLoop(): Promise<void> {
    const since = () => new Date((this.options.now?.() ?? new Date()).getTime() - categorizeWindowDays * 86_400_000).toISOString();
    do {
      this.#categorizeRequested = false;
      if (!this.#settings.enabled || !this.#settings.autoCategorize || this.#disposed) break;
      let ready: { router: AIRouter; model: CatalogModel };
      try {
        ready = await this.#router();
      } catch (error) {
        if (!(error instanceof AINotConfiguredError)) this.#error = error instanceof Error ? error.message : String(error);
        break;
      }
      this.#categorizing = { remaining: this.options.results.uncategorizedCount(since()) };
      await this.#emit();
      for (;;) {
        if (!this.#settings.enabled || !this.#settings.autoCategorize || this.#disposed) break;
        const [message] = this.options.results.uncategorized(1, since());
        if (!message) break;
        try {
          const result = await categorizeMessage(ready.router, message, { attachmentNames: this.options.results.attachmentNames(message.id) });
          this.options.results.setCategory(message.id, result.category, result.origin);
        } catch (error) {
          if (error instanceof AIBlockedError || error instanceof AINotConfiguredError) break;
          // Modell kaputt oder beendet: anhalten statt endlos weiterzuversuchen
          this.#error = error instanceof Error ? error.message : String(error);
          break;
        }
        this.options.onCategorized?.();
        this.#categorizing = { remaining: Math.max(0, (this.#categorizing?.remaining ?? 1) - 1) };
        await this.#emit();
      }
      this.#categorizing = null;
      await this.#emit();
    } while (this.#categorizeRequested && !this.#error);
    this.#categorizing = null;
  }

  async #router(): Promise<{ router: AIRouter; model: CatalogModel }> {
    if (!this.#settings.enabled) throw new AINotConfiguredError("Die KI ist ausgeschaltet (Optionen → KI).");
    const model = this.#settings.modelId ? this.#model(this.#settings.modelId) : undefined;
    if (!model) throw new AINotConfiguredError("Noch kein KI-Modell gewählt (Optionen → KI).");
    const status = await this.options.store.status(model);
    if (status.state !== "installed") throw new AINotConfiguredError(`„${model.name}“ ist noch nicht heruntergeladen (Optionen → KI).`);
    const key = `${model.id}|${this.#settings.useGpu}`;
    if (this.#provider?.key !== key) {
      await this.#releaseProvider();
      const create = this.options.createProvider ?? ((m, path, s) => new LlamaCppProvider({ id: m.id, displayName: m.name, modelPath: path, gpu: s.useGpu ? "auto" : false }));
      this.#provider = { key, provider: create(model, status.path, this.#settings) };
    }
    const provider = this.#exclusive(this.#provider.provider);
    // Nur lokale Modelle – die Freigabe-Prüfung bleibt trotzdem im Weg jedes Aufrufs.
    return { router: new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() }), model };
  }

  async #releaseProvider(): Promise<void> {
    const current = this.#provider;
    this.#provider = null;
    if (current && this.#active === current.provider) this.#active = null;
    await current?.provider.dispose();
  }

  async #emit(): Promise<AIStatus> {
    const status = await this.status();
    this.options.onStatus?.(status);
    return status;
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#download?.controller.abort();
    await this.#releaseProvider();
    await this.#releaseVision();
  }
}

const imageTypes: Record<string, AIImage["mimeType"]> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
};

/** Bildtyp aus MIME-Typ oder Dateiendung – nur Formate, die llama.cpp lesen kann (kein HEIC, kein SVG). */
export function imageType(mimeType: string, filename: string): AIImage["mimeType"] | null {
  const fromMime = Object.values(imageTypes).find((type) => type === mimeType.toLowerCase());
  if (fromMime) return fromMime;
  return imageTypes[filename.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

/** Seitenbilder aus der Oberfläche prüfen: höchstens 3, nur PNG/JPEG, begrenzte Größe, gültiges Base64. */
export function validatePageImages(images: AIImage[]): AIImage[] {
  if (!Array.isArray(images) || images.length > maxImagesPerReading) throw new Error(`Höchstens ${maxImagesPerReading} Seiten auf einmal.`);
  return images.map((image) => {
    if (!image || (image.mimeType !== "image/png" && image.mimeType !== "image/jpeg")) throw new Error("Ungültiges Seitenbild.");
    if (typeof image.base64 !== "string" || image.base64.length > maxPageImageChars || !/^[A-Za-z0-9+/]+=*$/.test(image.base64)) {
      throw new Error("Ungültiges Seitenbild.");
    }
    return { mimeType: image.mimeType, base64: image.base64 };
  });
}
