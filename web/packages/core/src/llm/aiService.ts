import { actionsPromptVersion, extractActions, ruleActions } from "../ai/actions.js";
import { cleanMailText } from "../ai/prepare.js";
import { calendarFileName, toICalendar } from "../calendar.js";
import type { ActionStatus, ActionStore, StoredAction } from "../sqlite/actionStore.js";
import { categorizeWindow, categorizeWindowDays, maxPageImageChars, type CategorizeWindow, normalizeAISettings, type ActionView, type MessageActionsView, type ReplyDraftsView, type AIApi, type AIModelInfo, type AISettings, type AIStatus, type AttachmentReadingView, type SummaryView } from "../ai/api.js";
import { modelCatalog, type CatalogModel } from "../ai/catalog.js";
import { promptVersions } from "../ai/prompts.js";
import { AIRouter, GrantPolicy } from "../ai/router.js";
import { interpretRule, interpretRuleWithRules, type RuleInterpretation } from "../ai/rules.js";
import { draftReplies } from "../ai/replies.js";
import type { ReplyStyle } from "../personal.js";
import { isDigestImportant, localDay, type DigestView } from "../digest.js";
import type { DigestStore } from "../sqlite/digestStore.js";
import { extractSubscription, type SubscriptionResult } from "../ai/subscriptions.js";
import { extractReceipt, type ReceiptResult } from "../ai/receipts.js";
import { extractPromises, type PromiseDirection, type PromiseResult } from "../ai/promises.js";
import { answerQuestion, type AskContextSource } from "../ai/ask.js";
import { classifyUserCategory, userCategoryPromptFor, type UserCategoryResult } from "../ai/userCategories.js";
import type { UserCategory } from "../userCategories.js";
import { categorizeMessage, ruleCategory, maxImagesPerReading, readDocumentImages, summarizeThread } from "../ai/tasks.js";
import { AIBlockedError, AINotConfiguredError, AITimeoutError, type AIImage, type AIProvider, type AIRequest, type AIResponse, type AITask } from "../ai/types.js";
import type { Message, MessageCategory } from "../models.js";
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
  /** Schreibstil des Nutzers für Antworten an eine Adresse (W8.4). */
  replyStyle?: (address: string) => ReplyStyle;
  /** Abfragen für den Tagesüberblick (W6.6). */
  digest?: DigestStore;
  /** Höchstdauer einer Modell-Anfrage, danach Abbruch und Neustart des Modells (Standard: Text 3 Min., Bilder 6 Min.). */
  generateTimeoutMs?: (request: AIRequest) => number;
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
  #categorizing: { remaining: number; done: number; total: number } | null = null;
  #activity: { task: AITask; startedAt: string } | null = null;
  #waiting = 0;
  #categorizeRequested = false;
  /** Vom Nutzer angefragte Mails (z. B. „KI prüfen“ beim Aufräumen) – vor dem normalen Zeitraum. */
  #priority: string[] = [];
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
    // Laufende Aufgabe zum Zeitpunkt des Aufrufs festhalten (das Folgende wartet auf Dateizugriffe)
    const activity = this.#activity ? { ...this.#activity, waiting: this.#waiting } : null;
    const categorizing = this.#categorizing ? { ...this.#categorizing } : null;
    const total = this.options.results.uncategorizedTotal();
    const window = this.#window();
    const recent = this.options.results.uncategorizedCount(window.since, window);
    const backlog = { recent, older: Math.max(0, total - recent) };
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
      categorizing,
      activity,
      backlog,
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
            this.#emitQuietly();
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

  async summarize(threadId: string, options: { full?: boolean } = {}): Promise<SummaryView> {
    const thread = await this.options.thread(threadId);
    if (thread.length === 0) throw new Error("Die Konversation gibt es nicht mehr.");
    const { router, model } = await this.#router();
    // Laufende Zusammenfassung: gibt es schon eine (gleiche Prompt-Version) und sind nur Mails dazugekommen, liest das
    // Modell die bisherige Zusammenfassung plus die neuen Mails statt des ganzen Verlaufs
    const cached = options.full ? null : this.options.results.summary(threadId);
    const previous =
      cached && cached.promptVersion === promptVersions.summarize && cached.messageCount < thread.length
        ? { summary: cached.summary, openPoints: cached.openPoints, lastMessageDate: cached.lastMessageDate }
        : undefined;
    const result = await summarizeThread(router, thread, { ownAddresses: await this.options.ownAddresses(), ...(previous ? { previous } : {}) });
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
        this.#emitQuietly();
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
        this.#waiting++;
        const run = this.#engine.then(async () => {
          this.#waiting = Math.max(0, this.#waiting - 1);
          this.#activity = { task: request.task, startedAt: (this.options.now?.() ?? new Date()).toISOString() };
          this.#emitQuietly();
          try {
            if (this.#active && this.#active !== provider) await this.#active.unload();
            this.#active = provider;
            return await this.#withTimeout(provider, request, signal);
          } finally {
            this.#activity = null;
            this.#emitQuietly();
          }
        });
        this.#engine = run.catch(() => undefined);
        return run;
      },
    };
  }

  /**
   * Eine Anfrage darf nie ewig hängen – sonst warten alle folgenden (Einordnung, Zusammenfassen …) mit, weil das Modell
   * eine Anfrage nach der anderen abarbeitet. Nach der Höchstdauer: abbrechen, Modell verwerfen (wird bei Bedarf neu
   * geladen), Fehler melden.
   */
  async #withTimeout(provider: ManagedProvider, request: AIRequest, signal?: AbortSignal): Promise<AIResponse> {
    const limit = this.options.generateTimeoutMs?.(request) ?? (request.task === "readImage" ? 360_000 : 180_000);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AITimeoutError("Das KI-Modell hat nicht rechtzeitig geantwortet und wird neu gestartet."));
      }, limit);
    });
    try {
      return await Promise.race([provider.generate(request, controller.signal), timeout]);
    } catch (error) {
      if (error instanceof AITimeoutError) this.#discard(provider);
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  /** Hängendes Modell verwerfen, ohne auf es zu warten. */
  #discard(provider: ManagedProvider): void {
    if (this.#active === provider) this.#active = null;
    if (this.#provider?.provider === provider) this.#provider = null;
    if (this.#vision?.provider === provider) this.#vision = null;
    void provider.dispose().catch(() => undefined);
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
    const style = this.options.replyStyle?.(message.from.address);
    const result = await draftReplies(router, message, { earlier, ...(style ? { style } : {}) });
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

  /** Abo-Erkennung (W7.1) mit dem lokalen Modell; `null`, wenn keins bereit ist (dann gelten die Regeln). */
  async extractSubscription(message: Message, attachmentText?: string): Promise<SubscriptionResult | null> {
    if (!(await this.#modelReady())) return null;
    const { router } = await this.#router();
    return extractSubscription(router, message, { attachmentText });
  }

  /** „Frag dein Postfach“: Antwort aus den gefundenen Stellen; `null`, wenn kein Modell bereit ist. */
  async answerQuestion(question: string, sources: AskContextSource[], accountIds: string[]) {
    if (!(await this.#modelReady())) return null;
    const { router } = await this.#router();
    const now = this.options.now?.() ?? new Date();
    return answerQuestion(router, question, sources, { accountIds, today: now.toISOString().slice(0, 10) });
  }

  /** Zusagen einer Mail per Modell (Zitat geprüft, Frist per Code); `null`, wenn kein Modell bereit ist. */
  async extractPromises(message: Message, direction: PromiseDirection): Promise<PromiseResult | null> {
    if (!(await this.#modelReady())) return null;
    const { router } = await this.#router();
    return extractPromises(router, message, direction);
  }

  /** Beleg einer Mail per Modell (mit Prüfung im Text); `null`, wenn kein Modell bereit ist. */
  async extractReceipt(message: Message, attachmentText: string, categories: readonly string[]): Promise<ReceiptResult | null> {
    if (!(await this.#modelReady())) return null;
    const { router } = await this.#router();
    return extractReceipt(router, message, { attachmentText, categories });
  }

  /** Eigene Kategorie einer Mail per Modell; `null`, wenn kein Modell bereit ist. */
  async classifyUserCategory(message: Message, categories: readonly UserCategory[]): Promise<UserCategoryResult | null> {
    if (!(await this.#modelReady())) return null;
    const { router, model } = await this.#router();
    return classifyUserCategory(router, message, categories, { promptVersion: userCategoryPromptFor(model.id) });
  }

  /** Ist ein lokales Modell eingeschaltet und installiert? */
  async modelReady(): Promise<boolean> {
    return this.#modelReady();
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
  async setCategory(messageId: string, category: MessageCategory | null, remember: boolean): Promise<{ changed: number }> {
    const message = await this.options.message?.(messageId);
    if (!message) throw new Error("Die Mail wurde nicht gefunden.");
    this.options.results.setCategory(messageId, category, "user");
    if (!remember) return { changed: 0 };
    const address = message.from.address;
    if (!category) {
      this.options.results.forgetSender(address);
      return { changed: 0 };
    }
    this.options.results.learnSender(address, category, (this.options.now?.() ?? new Date()).toISOString());
    return { changed: this.options.results.applyLearned(address, category, messageId) };
  }

  async learnedSenders(): Promise<{ address: string; category: MessageCategory; learnedAt: string }[]> {
    return this.options.results.learnedSenders();
  }

  async forgetSender(address: string): Promise<void> {
    this.options.results.forgetSender(address);
  }

  /** Welche Mails eingeordnet werden: neue (letzte Tage) plus der gewählte Zeitraum. */
  #window(): CategorizeWindow {
    return categorizeWindow(this.#settings.categorizeRange, this.options.now?.() ?? new Date());
  }

  async resume(): Promise<AIStatus> {
    this.#error = null;
    this.categorizeInBackground();
    return this.#emit();
  }

  /**
   * Diese Mails vorrangig einordnen (auch außerhalb des Zeitraums und ohne „automatisch einordnen“, solange die KI an
   * ist). Gibt zurück, wie viele noch fehlen.
   */
  categorizeMessages(ids: string[]): number {
    if (!this.#settings.enabled) return 0;
    const queued = new Set(this.#priority);
    const missing = this.options.results.uncategorizedIn([...new Set(ids)]).map((m) => m.id).filter((id) => !queued.has(id));
    this.#priority.push(...missing);
    if (missing.length) this.categorizeInBackground();
    return missing.length;
  }

  categorizeInBackground(): void {
    if (this.#categorizing) {
      this.#categorizeRequested = true;
      return;
    }
    this.#categorizeLoop().catch((error: unknown) => {
      // Unerwarteter Fehler außerhalb einer Modell-Anfrage: anhalten, melden – nie unbehandelt
      this.#categorizing = null;
      this.#error = error instanceof Error ? error.message : String(error);
      this.#emitQuietly();
    });
  }

  async #categorizeLoop(): Promise<void> {
    const since = () => this.#window().since;
    const range = () => this.#window();
    const active = () => this.#settings.enabled && !this.#disposed && (this.#settings.autoCategorize || this.#priority.length > 0);
    const remainingCount = () => this.#priority.length + (this.#settings.autoCategorize ? this.options.results.uncategorizedCount(since(), range()) : 0);
    const next = (): Message | undefined => {
      while (this.#priority.length) {
        const [message] = this.options.results.uncategorizedIn(this.#priority.splice(0, 1));
        if (message) return message;
      }
      return this.#settings.autoCategorize ? this.options.results.uncategorized(1, since(), range())[0] : undefined;
    };
    do {
      this.#categorizeRequested = false;
      if (!active()) break;
      let ready: { router: AIRouter; model: CatalogModel };
      try {
        ready = await this.#router();
      } catch (error) {
        if (!(error instanceof AINotConfiguredError)) this.#error = error instanceof Error ? error.message : String(error);
        break;
      }
      const total = remainingCount();
      this.#categorizing = { remaining: total, done: 0, total };
      await this.#emit();
      let failures = 0;
      for (;;) {
        if (!active()) break;
        const message = next();
        if (!message) break;
        // Vom Nutzer gelernt: ohne Modell, sofort
        const learned = this.options.results.learnedCategory(message.from.address);
        if (learned) {
          this.options.results.setCategory(message.id, learned, "learned");
          this.options.onCategorized?.();
          const remaining = remainingCount();
          const current: { remaining: number; done: number; total: number } = this.#categorizing ?? { remaining, done: 0, total: remaining };
          this.#categorizing = { remaining, done: current.done + 1, total: Math.max(current.total, current.done + 1 + remaining) };
          continue;
        }
        try {
          const result = await categorizeMessage(ready.router, message, { attachmentNames: this.options.results.attachmentNames(message.id) });
          this.options.results.setCategory(message.id, result.category, result.origin);
          failures = 0;
        } catch (error) {
          if (error instanceof AIBlockedError || error instanceof AINotConfiguredError) break;
          // Eine Mail, an der das Modell scheitert, darf nicht alles aufhalten: einfache Regel-Einordnung, weiter.
          // Erst wenn es mehrmals hintereinander scheitert, ist das Modell selbst kaputt – dann anhalten und melden.
          this.options.results.setCategory(message.id, ruleCategory(message).category, "rules");
          failures++;
          if (failures >= 3) {
            this.#error = error instanceof Error ? error.message : String(error);
            break;
          }
          try {
            ready = await this.#router(); // nach Zeitüberschreitung ggf. neu geladenes Modell
          } catch {
            break;
          }
        }
        this.options.onCategorized?.();
        const remaining = remainingCount();
        const current: { remaining: number; done: number; total: number } = this.#categorizing ?? { remaining, done: 0, total: remaining };
        // Neue Mails während des Laufs vergrößern das Ziel, statt die Anzeige rückwärts laufen zu lassen
        this.#categorizing = { remaining, done: current.done + 1, total: Math.max(current.total, current.done + 1 + remaining) };
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

  #emitSeq = 0;

  /** Status im Hintergrund melden – ein Fehler dabei (z. B. Datei gerade weg) darf nie unbehandelt bleiben. */
  #emitQuietly(): void {
    this.#emit().catch(() => undefined);
  }

  /** Status an die Oberfläche – nur der neueste: ältere, die sich überholt haben, würden „arbeitet …“ stehen lassen. */
  async #emit(): Promise<AIStatus> {
    const seq = ++this.#emitSeq;
    const status = await this.status();
    if (seq === this.#emitSeq) this.options.onStatus?.(status);
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
