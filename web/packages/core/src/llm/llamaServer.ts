import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { dirname } from "node:path";
import type { AIRequest, AIResponse, PrivacyClass } from "../ai/types.js";
import type { ManagedProvider } from "./aiService.js";

// Anbieter über die OpenAI-kompatible Schnittstelle von llama.cpp (llama-server). Zwei Teile:
// - OpenAIChatClient: reines HTTP – später auch für den Heimserver („eigener Server“) nutzbar.
// - LlamaServerProvider: startet llama-server auf diesem Rechner (nur 127.0.0.1, zufälliger Schlüssel).

export interface OpenAIChatClientOptions {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

/** Baut den Anfrage-Körper (Bilder als data-URL, JSON-Schema, kein „Nachdenken“). */
export function chatRequestBody(request: AIRequest, model?: string): Record<string, unknown> {
  return {
    ...(model ? { model } : {}),
    messages: request.messages.map((message) =>
      message.images?.length
        ? {
            role: message.role,
            content: [
              ...message.images.map((image) => ({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}` } })),
              { type: "text", text: message.content },
            ],
          }
        : { role: message.role, content: message.content },
    ),
    max_tokens: request.maxTokens,
    temperature: request.temperature ?? 0,
    ...(request.jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: request.task, schema: request.jsonSchema } } } : {}),
    chat_template_kwargs: { enable_thinking: false },
    stream: false,
  };
}

export class OpenAIChatClient {
  constructor(private readonly options: OpenAIChatClientOptions) {}

  async complete(request: AIRequest, signal?: AbortSignal): Promise<{ text: string; tokensOut?: number }> {
    const response = await (this.options.fetchImpl ?? fetch)(`${this.options.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}) },
      body: JSON.stringify(chatRequestBody(request, this.options.model)),
      signal,
    });
    if (!response.ok) {
      // Fehlertext des Servers nicht weiterreichen – er kann Teile der Anfrage enthalten.
      throw new Error(`Das KI-Modell hat die Anfrage abgelehnt (HTTP ${response.status}).`);
    }
    const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[]; usage?: { completion_tokens?: number } };
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("Das KI-Modell hat keine Antwort geliefert.");
    return { text, tokensOut: body.usage?.completion_tokens };
  }
}

export interface LlamaServerOptions {
  id: string;
  displayName: string;
  serverPath: string;
  modelPath: string;
  /** Bild-Baustein; ohne ihn versteht das Modell nur Text. */
  mmprojPath?: string | null;
  gpu?: boolean;
  maxThreads?: number;
  contextSize?: number;
  idleUnloadMs?: number;
  /** Wie lange der Start dauern darf (Modell von der Platte laden). */
  startTimeoutMs?: number;
  privacyClass?: PrivacyClass;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export class LlamaServerProvider implements ManagedProvider {
  readonly id: string;
  readonly displayName: string;
  readonly privacyClass: PrivacyClass;
  readonly contextWindow: number;
  readonly acceptsImages: boolean;

  #process: ChildProcess | null = null;
  #client: OpenAIChatClient | null = null;
  #starting: Promise<OpenAIChatClient> | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  constructor(private readonly options: LlamaServerOptions) {
    this.id = options.id;
    this.displayName = options.displayName;
    this.privacyClass = options.privacyClass ?? "onDevice";
    this.contextWindow = options.contextSize ?? 4096;
    this.acceptsImages = !!options.mmprojPath;
  }

  get isLoaded(): boolean {
    return this.#process !== null;
  }

  generate(request: AIRequest, signal?: AbortSignal): Promise<AIResponse> {
    const run = this.#queue.then(async () => {
      if (this.#disposed) throw new Error("Das KI-Modell wurde beendet.");
      this.#cancelIdle();
      const client = await this.#start();
      const started = performance.now();
      try {
        const { text, tokensOut } = await client.complete(request, signal);
        return { text, providerId: this.id, privacyClass: this.privacyClass, durationMs: Math.round(performance.now() - started), tokensOut };
      } finally {
        this.#scheduleIdle();
      }
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /** Startet llama-server und wartet, bis das Modell geladen ist. */
  #start(): Promise<OpenAIChatClient> {
    if (this.#client && this.#process) return Promise.resolve(this.#client);
    if (this.#starting) return this.#starting;
    this.#starting = (async () => {
      const port = await freePort();
      const apiKey = randomBytes(24).toString("hex");
      const args = [
        "-m", this.options.modelPath,
        "--host", "127.0.0.1",
        "--port", String(port),
        "-c", String(this.contextWindow),
        "-np", "1",
        // Automatische Speicher-Anpassung aus: kostete beim Start mehrere Minuten (gemessen).
        "--fit", "off",
        "--no-ui",
        "-ngl", this.options.gpu ? "99" : "0",
      ];
      if (this.options.mmprojPath) args.push("--mmproj", this.options.mmprojPath);
      if (this.options.maxThreads) args.push("-t", String(this.options.maxThreads));
      // Schlüssel über die Umgebung, nicht über die Befehlszeile (dort für andere Programme sichtbar)
      const env: NodeJS.ProcessEnv = { ...process.env, LLAMA_API_KEY: apiKey };
      if (process.platform === "linux") env.LD_LIBRARY_PATH = [dirname(this.options.serverPath), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
      const child = spawn(this.options.serverPath, args, { env, stdio: "ignore", windowsHide: true });
      this.#process = child;
      let exited: number | null | undefined;
      child.once("exit", (code) => {
        exited = code;
        if (this.#process === child) {
          this.#process = null;
          this.#client = null;
        }
      });
      const spawnError = new Promise<never>((_, reject) => child.once("error", (error) => reject(new Error(`Die Bild-Laufzeit startet nicht: ${error.message}`))));
      const client = new OpenAIChatClient({ baseUrl: `http://127.0.0.1:${port}`, apiKey });
      const deadline = Date.now() + (this.options.startTimeoutMs ?? 180_000);
      const ready = (async () => {
        while (Date.now() < deadline) {
          if (exited !== undefined) throw new Error(`Die Bild-Laufzeit wurde unerwartet beendet (Code ${exited}).`);
          try {
            const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
            if (health.ok) return client;
          } catch {
            // noch nicht bereit
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        throw new Error("Die Bild-Laufzeit hat zu lange zum Starten gebraucht.");
      })();
      try {
        const result = await Promise.race([ready, spawnError]);
        this.#client = result;
        return result;
      } catch (error) {
        child.kill();
        this.#process = null;
        throw error;
      }
    })();
    const starting = this.#starting;
    void starting.finally(() => {
      if (this.#starting === starting) this.#starting = null;
    }).catch(() => undefined);
    return starting;
  }

  #cancelIdle(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
  }

  #scheduleIdle(): void {
    this.#cancelIdle();
    const after = this.options.idleUnloadMs ?? 2 * 60_000;
    if (after <= 0) return;
    this.#idleTimer = setTimeout(() => void this.unload(), after);
    this.#idleTimer.unref?.();
  }

  /** Beendet llama-server (gibt den Speicher frei); beim nächsten Aufruf startet er neu. */
  async unload(): Promise<void> {
    this.#cancelIdle();
    const child = this.#process;
    this.#process = null;
    this.#client = null;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    await this.unload();
  }
}
