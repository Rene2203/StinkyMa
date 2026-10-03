import type { AIProvider, AIRequest, AIResponse, JsonSchema } from "../ai/types.js";
import { modelContextTokens } from "../ai/prepare.js";

// Lokales Modell über llama.cpp (node-llama-cpp). Nur Node (Windows-App, später Server) – nie in der Oberfläche.
// Das native Modul wird erst beim ersten Aufruf geladen: Wer keine KI nutzt, zahlt nichts dafür.

type LlamaModule = typeof import("node-llama-cpp");
type Llama = Awaited<ReturnType<LlamaModule["getLlama"]>>;
type LlamaModel = Awaited<ReturnType<Llama["loadModel"]>>;
type LlamaContext = Awaited<ReturnType<LlamaModel["createContext"]>>;
type GbnfJsonSchema = import("node-llama-cpp").GbnfJsonSchema;

export interface LlamaProviderOptions {
  id: string;
  displayName: string;
  modelPath: string;
  /** Tokens für Eingabe + Ausgabe. 4096 reicht für Zusammenfassungen kurzer Konversationen und schont den Speicher. */
  contextSize?: number;
  /** Grafikkarte nutzen, wenn vorhanden (Vulkan/Metal) – sonst nur CPU. */
  gpu?: "auto" | false;
  /** Höchstzahl CPU-Threads (0 = automatisch). Auf schwachen Rechnern begrenzen, damit die App flüssig bleibt. */
  maxThreads?: number;
  /** Modell nach so langer Ruhe aus dem Speicher werfen (Standard 5 Minuten). */
  idleUnloadMs?: number;
}

interface Loaded {
  llama: Llama;
  model: LlamaModel;
  context: LlamaContext;
  /** Eine Sequenz für alle Anfragen: gleicher Anfang (System-Prompt) wird aus dem Zwischenspeicher übernommen. */
  sequence: ReturnType<LlamaContext["getSequence"]>;
  module: LlamaModule;
}

let llamaInstance: Promise<{ module: LlamaModule; llama: Llama }> | null = null;
let llamaGpu: "auto" | false | null = null;

export async function loadLlama(gpu: "auto" | false, maxThreads: number): Promise<{ module: LlamaModule; llama: Llama }> {
  if (llamaInstance && llamaGpu === gpu) return llamaInstance;
  llamaGpu = gpu;
  llamaInstance = (async () => {
    const module = await import("node-llama-cpp");
    // Nur mitgelieferte Binärdateien – nie zur Laufzeit herunterladen oder kompilieren.
    const llama = await module.getLlama({
      gpu,
      build: "never",
      usePrebuiltBinaries: true,
      skipDownload: true,
      maxThreads,
      logLevel: module.LlamaLogLevel.error,
      progressLogs: false,
    });
    return { module, llama };
  })();
  llamaInstance.catch(() => {
    llamaInstance = null;
  });
  return llamaInstance;
}

/** Unser vereinfachtes Schema → Grammatik-Schema von node-llama-cpp (Zahlengrenzen kann die Grammatik nicht). */
export function toGbnfSchema(schema: JsonSchema): GbnfJsonSchema {
  switch (schema.type) {
    case "object":
      return {
        type: "object",
        properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toGbnfSchema(value)])),
      } as GbnfJsonSchema;
    case "array":
      return { type: "array", items: toGbnfSchema(schema.items), ...(schema.maxItems !== undefined ? { maxItems: schema.maxItems } : {}) } as GbnfJsonSchema;
    case "string":
      if (schema.enum) return { enum: [...schema.enum] };
      return { type: "string", ...(schema.maxLength !== undefined ? { maxLength: schema.maxLength } : {}) } as GbnfJsonSchema;
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
  }
}

export class LlamaCppProvider implements AIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly privacyClass = "onDevice" as const;
  readonly contextWindow: number;

  #loaded: Promise<Loaded> | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #grammars = new Map<string, Promise<unknown>>();
  #disposed = false;

  constructor(private readonly options: LlamaProviderOptions) {
    this.id = options.id;
    this.displayName = options.displayName;
    this.contextWindow = options.contextSize ?? modelContextTokens;
  }

  /** Ist das Modell gerade im Speicher? */
  get isLoaded(): boolean {
    return this.#loaded !== null;
  }

  /** Modell laden (z. B. vorab beim Messen, damit die Ladezeit nicht in die erste Antwort fällt). */
  async load(): Promise<{ gpu: string | false; loadMs: number }> {
    const started = performance.now();
    const loaded = await this.#ensureLoaded();
    return { gpu: loaded.llama.gpu, loadMs: Math.round(performance.now() - started) };
  }

  generate(request: AIRequest, signal?: AbortSignal): Promise<AIResponse> {
    // Ein Modell, eine Sequenz: Anfragen nacheinander abarbeiten.
    const run = this.#queue.then(() => this.#generate(request, signal));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #generate(request: AIRequest, signal?: AbortSignal): Promise<AIResponse> {
    if (this.#disposed) throw new Error("Das KI-Modell wurde beendet.");
    signal?.throwIfAborted();
    this.#cancelIdle();
    const loaded = await this.#ensureLoaded();
    const { module, model, sequence } = loaded;
    const started = performance.now();
    try {
      const system = request.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const turns = request.messages.filter((m) => m.role !== "system");
      const last = turns.at(-1);
      if (!last || last.role !== "user") throw new Error("Die Anfrage an das Modell muss mit einer Nutzer-Nachricht enden.");

      const chatWrapper = module.resolveChatWrapper(model, {
        customWrapperSettings: {
          // Ohne „Nachdenken“: kostet auf schwacher Hardware viel Zeit und bringt bei kurzen Aufgaben wenig.
          qwen: { thoughts: "discourage", variation: "3.5" },
          gemma4: { reasoning: false },
        },
      });
      const session = new module.LlamaChatSession({ contextSequence: sequence, chatWrapper, systemPrompt: system || undefined, autoDisposeSequence: false });
      try {
        if (turns.length > 1) {
          const history = session.getChatHistory();
          for (const turn of turns.slice(0, -1)) {
            history.push(turn.role === "user" ? { type: "user", text: turn.content } : { type: "model", response: [turn.content] });
          }
          session.setChatHistory(history);
        }
        const grammar = request.jsonSchema ? await this.#grammar(loaded, request.jsonSchema) : undefined;
        const text = await session.prompt(last.content, {
          maxTokens: request.maxTokens,
          temperature: request.temperature ?? 0,
          ...(grammar ? { grammar: grammar as never } : {}),
          signal,
          stopOnAbortSignal: false,
        });
        return {
          text,
          providerId: this.id,
          privacyClass: this.privacyClass,
          durationMs: Math.round(performance.now() - started),
          tokensOut: model.tokenize(text).length,
        };
      } finally {
        session.dispose({ disposeSequence: false });
      }
    } finally {
      this.#scheduleIdle();
    }
  }

  async #grammar(loaded: Loaded, schema: JsonSchema): Promise<unknown> {
    const key = JSON.stringify(schema);
    let grammar = this.#grammars.get(key);
    if (!grammar) {
      // Generischer Typ von node-llama-cpp ist für zur Laufzeit gebaute Schemata zu eng
      grammar = loaded.llama.createGrammarForJsonSchema(toGbnfSchema(schema) as never);
      this.#grammars.set(key, grammar);
    }
    return grammar;
  }

  #ensureLoaded(): Promise<Loaded> {
    if (!this.#loaded) {
      this.#loaded = (async () => {
        const { module, llama } = await loadLlama(this.options.gpu ?? "auto", this.options.maxThreads ?? 0);
        const model = await llama.loadModel({ modelPath: this.options.modelPath });
        try {
          const context = await createContextWithSmallCache(model, this.contextWindow);
          return { llama, model, context, sequence: context.getSequence(), module };
        } catch (error) {
          await model.dispose();
          throw error;
        }
      })();
      this.#loaded.catch(() => {
        this.#loaded = null;
      });
    }
    return this.#loaded;
  }

  #cancelIdle(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
  }

  #scheduleIdle(): void {
    this.#cancelIdle();
    const after = this.options.idleUnloadMs ?? 5 * 60_000;
    if (after <= 0) return;
    this.#idleTimer = setTimeout(() => void this.unload(), after);
    this.#idleTimer.unref?.();
  }

  /** Modell aus dem Speicher nehmen (lädt beim nächsten Aufruf neu). */
  async unload(): Promise<void> {
    this.#cancelIdle();
    const loaded = this.#loaded;
    this.#loaded = null;
    this.#grammars.clear();
    if (!loaded) return;
    try {
      const { context, model } = await loaded;
      await context.dispose();
      await model.dispose();
    } catch {
      // Laden war schon fehlgeschlagen – nichts freizugeben
    }
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    await this.unload();
  }
}

/**
 * Kontext mit halb so großem Zwischenspeicher (KV-Cache als Q8_0 statt F16, Flash-Attention wenn möglich) – spart bei
 * 16K-Fenster Arbeitsspeicher bei kaum Qualitätsverlust. Die Option ist in node-llama-cpp als experimentell markiert;
 * schlägt das Anlegen fehl, gilt der normale Zwischenspeicher.
 */
async function createContextWithSmallCache(model: LlamaModel, contextSize: number): Promise<LlamaContext> {
  try {
    return await model.createContext({
      contextSize,
      sequences: 1,
      flashAttention: "auto",
      experimentalKvCacheKeyType: "Q8_0",
      experimentalKvCacheValueType: "Q8_0",
    });
  } catch {
    return model.createContext({ contextSize, sequences: 1 });
  }
}
