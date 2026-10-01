import { categorizeWindowDays, normalizeAISettings, type AIApi, type AIModelInfo, type AISettings, type AIStatus, type SummaryView } from "../ai/api.js";
import { modelCatalog, type CatalogModel } from "../ai/catalog.js";
import { promptVersions } from "../ai/prompts.js";
import { AIRouter, GrantPolicy } from "../ai/router.js";
import { categorizeMessage, summarizeThread } from "../ai/tasks.js";
import { AIBlockedError, AINotConfiguredError, type AIProvider } from "../ai/types.js";
import type { Message } from "../models.js";
import type { AIResultStore, StoredSummary } from "../sqlite/aiStore.js";
import { LlamaCppProvider } from "./llamaProvider.js";
import type { ModelStore } from "./modelStore.js";

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
  /** Status hat sich geändert (Download-Fortschritt, Einstellungen, Einordnung). */
  onStatus?: (status: AIStatus) => void;
  /** Eine Mail hat eine Kategorie bekommen – Oberfläche neu laden. */
  onCategorized?: () => void;
  now?: () => Date;
}

export class AIService implements AIApi {
  #settings: AISettings;
  #provider: { key: string; provider: ManagedProvider } | null = null;
  #download: { modelId: string; receivedBytes: number; totalBytes: number; controller: AbortController } | null = null;
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
      download: this.#download ? { modelId: this.#download.modelId, receivedBytes: this.#download.receivedBytes, totalBytes: this.#download.totalBytes } : null,
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
    if (providerChanged) await this.#releaseProvider();
    if (next.enabled && next.autoCategorize) this.categorizeInBackground();
    return this.#emit();
  }

  async download(modelId: string): Promise<void> {
    const model = this.#model(modelId);
    if (!model) throw new Error("Unbekanntes Modell.");
    if (this.#download) throw new Error("Es läuft bereits ein Download.");
    const controller = new AbortController();
    this.#download = { modelId, receivedBytes: 0, totalBytes: model.sizeBytes, controller };
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
    const provider = this.#provider.provider;
    // Nur lokale Modelle – die Freigabe-Prüfung bleibt trotzdem im Weg jedes Aufrufs.
    return { router: new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() }), model };
  }

  async #releaseProvider(): Promise<void> {
    const current = this.#provider;
    this.#provider = null;
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
  }
}
