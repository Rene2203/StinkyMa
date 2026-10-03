import { loadLlama } from "./llamaProvider.js";

// Embedding-Modell (W8.1) über node-llama-cpp: Text → Vektor. Lädt bei Bedarf und gibt den Speicher nach Leerlauf frei.

export interface Embedder {
  embed(text: string): Promise<number[]>;
  dispose(): Promise<void>;
}

type EmbeddingContext = { getEmbeddingFor(text: string): Promise<{ vector: readonly number[] }>; dispose(): Promise<void> };
type LoadedModel = { createEmbeddingContext(options: { contextSize: number }): Promise<EmbeddingContext>; dispose(): Promise<void> };

export class LlamaEmbedder implements Embedder {
  #loaded: Promise<{ model: LoadedModel; context: EmbeddingContext }> | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: { modelPath: string; gpu?: "auto" | false; maxThreads?: number; idleUnloadMs?: number }) {}

  embed(text: string): Promise<number[]> {
    // Nacheinander – ein Kontext, wenig Speicher
    const run = this.#queue.then(async () => {
      const { context } = await this.#ensureLoaded();
      const result = await context.getEmbeddingFor(text.slice(0, 6000));
      this.#armIdle();
      return [...result.vector];
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }

  #ensureLoaded() {
    if (!this.#loaded) {
      this.#loaded = (async () => {
        const { llama } = await loadLlama(this.options.gpu ?? "auto", this.options.maxThreads ?? 0);
        const model = (await llama.loadModel({ modelPath: this.options.modelPath })) as unknown as LoadedModel;
        const context = await model.createEmbeddingContext({ contextSize: 2048 });
        return { model, context };
      })();
      this.#loaded.catch(() => {
        this.#loaded = null;
      });
    }
    return this.#loaded;
  }

  #armIdle(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    const ms = this.options.idleUnloadMs ?? 120_000;
    if (ms <= 0) return;
    this.#idleTimer = setTimeout(() => void this.dispose(), ms);
    this.#idleTimer.unref?.();
  }

  async dispose(): Promise<void> {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    const loaded = this.#loaded;
    this.#loaded = null;
    if (!loaded) return;
    try {
      const { model, context } = await loaded;
      await context.dispose();
      await model.dispose();
    } catch {
      // schon weg
    }
  }
}
