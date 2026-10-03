import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { chunkMail, dot, embeddingInput, embeddingModelFile, fuseRankings, keywordQuery, normalizeVector, type AskContextSource } from "../ai/ask.js";
import { cleanMailText, truncate } from "../ai/prepare.js";
import type { ResultOrigin } from "../ai/tasks.js";
import type { AskApi, AskIndexStatus, AskResult, AskSource } from "../ask.js";
import type { EmbeddingStore, StoredChunk } from "../sqlite/embeddingStore.js";
import type { Embedder } from "./embedder.js";
import { downloadVerified } from "./modelStore.js";

export interface AskServiceOptions {
  store: EmbeddingStore;
  /** Ordner für das Embedding-Modell */
  modelDirectory: string;
  createEmbedder: (modelPath: string) => Embedder;
  /** Antwort des Sprachmodells aus den Quellen; `null`, wenn keins bereit ist (dann nur Fundstellen). */
  answer?: (question: string, sources: AskContextSource[], accountIds: string[]) => Promise<{ answer: string; cited: number[]; origin: ResultOrigin } | null>;
  fetchImpl?: typeof fetch;
  onChange?: () => void;
  now?: () => Date;
  /** Wie viele Quellen das Modell sieht */
  maxSources?: number;
}

/**
 * „Frag dein Postfach“ (W8.1): Suche nach Bedeutung (EmbeddingGemma, lokal) und nach Wörtern (Volltext), Rangfolgen
 * zusammengeführt; das Sprachmodell antwortet nur aus den gefundenen Stellen und nennt seine Quellen.
 */
export class AskService implements AskApi {
  #embedder: Embedder | null = null;
  #download: { receivedBytes: number; controller: AbortController } | null = null;
  #indexing: Promise<void> | null = null;
  #again = false;
  #chunks: StoredChunk[] | null = null;
  #disposed = false;

  constructor(private readonly options: AskServiceOptions) {}

  get #modelPath(): string {
    return join(this.options.modelDirectory, "embeddinggemma-300M-Q8_0.gguf");
  }

  #modelReady(): boolean {
    return existsSync(this.#modelPath);
  }

  async status(): Promise<AskIndexStatus> {
    const counts = this.options.store.counts(embeddingModelFile.id);
    return {
      model: {
        state: this.#download ? "downloading" : this.#modelReady() ? "ready" : "missing",
        sizeBytes: embeddingModelFile.sizeBytes,
        receivedBytes: this.#download?.receivedBytes ?? 0,
        license: embeddingModelFile.license,
      },
      indexed: counts.indexed,
      total: counts.total,
      running: this.#indexing !== null,
    };
  }

  async downloadModel(): Promise<void> {
    if (this.#download) throw new Error("Es läuft bereits ein Download.");
    if (this.#modelReady()) return;
    const controller = new AbortController();
    this.#download = { receivedBytes: 0, controller };
    this.options.onChange?.();
    try {
      await mkdir(this.options.modelDirectory, { recursive: true });
      let last = 0;
      await downloadVerified(this.options.fetchImpl ?? fetch, embeddingModelFile, this.#modelPath, controller.signal, (received) => {
        if (this.#download) this.#download.receivedBytes = received;
        if (received - last > 5_000_000) {
          last = received;
          this.options.onChange?.();
        }
      });
    } finally {
      this.#download = null;
      this.options.onChange?.();
    }
    this.startIndexing();
  }

  async deleteModel(): Promise<void> {
    this.#download?.controller.abort();
    await this.#embedder?.dispose();
    this.#embedder = null;
    await rm(this.#modelPath, { force: true });
    await rm(`${this.#modelPath}.part`, { force: true });
    this.options.store.clear();
    this.#chunks = null;
    this.options.onChange?.();
  }

  #getEmbedder(): Embedder {
    this.#embedder ??= this.options.createEmbedder(this.#modelPath);
    return this.#embedder;
  }

  /** Neue Mails indexieren (im Hintergrund, neueste zuerst). Mehrfachaufrufe: genau ein weiterer Durchgang. */
  startIndexing(): void {
    if (!this.#modelReady() || this.#disposed) return;
    if (this.#indexing) {
      this.#again = true;
      return;
    }
    this.#indexing = this.#indexLoop()
      .catch(() => undefined)
      .finally(() => {
        this.#indexing = null;
        this.options.onChange?.();
        if (this.#again) {
          this.#again = false;
          this.startIndexing();
        }
      });
    this.options.onChange?.();
  }

  /** Wartet auf den laufenden Durchgang (für Tests). */
  async idle(): Promise<void> {
    while (this.#indexing) await this.#indexing;
  }

  async #indexLoop(): Promise<void> {
    const store = this.options.store;
    const embedder = this.#getEmbedder();
    let done = 0;
    for (;;) {
      if (this.#disposed) return;
      const batch = store.pending(20, embeddingModelFile.id);
      if (batch.length === 0) return;
      for (const mail of batch) {
        const chunks = chunkMail(mail.subject, mail.body, mail.attachments);
        const vectors = [];
        for (const chunk of chunks) {
          const raw = await embedder.embed(embeddingInput.document(chunk.source === "mail" ? mail.subject : chunk.source, chunk.text));
          vectors.push({ ...chunk, vector: normalizeVector(raw) });
        }
        store.save(mail.id, vectors, embeddingModelFile.id, this.#now().toISOString());
        this.#chunks = null;
        if (++done % 25 === 0) this.options.onChange?.();
      }
    }
  }

  async ask(question: string, options: { sender?: string } = {}): Promise<AskResult> {
    const started = Date.now();
    const q = question.trim();
    if (q.length < 3) throw new Error("Bitte eine Frage eingeben.");
    const store = this.options.store;
    const allowed = options.sender ? store.idsForSender(options.sender) : null;
    // Nach Bedeutung: beste Textstücke, je Mail das beste
    const bestChunk = new Map<string, StoredChunk>();
    let semanticIds: string[] = [];
    const semantic = this.#modelReady() && store.counts(embeddingModelFile.id).indexed > 0;
    if (semantic) {
      const query = normalizeVector(await this.#getEmbedder().embed(embeddingInput.query(q)));
      this.#chunks ??= store.chunks(embeddingModelFile.id);
      const scored = this.#chunks
        .filter((c) => !allowed || allowed.has(c.messageId))
        .map((c) => ({ c, score: dot(query, c.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 40);
      for (const { c } of scored) if (!bestChunk.has(c.messageId)) bestChunk.set(c.messageId, c);
      semanticIds = [...bestChunk.keys()];
    }
    // Nach Wörtern
    const keywordIds = store.keywordHits(keywordQuery(q), 30, options.sender);
    const ranked = fuseRankings([semanticIds, keywordIds]).slice(0, this.options.maxSources ?? 6);
    const mails = store.mails(ranked);
    const sources: AskSource[] = mails.map((m, i) => {
      const chunk = bestChunk.get(m.id);
      const excerpt = chunk ? chunk.text.replace(/^.*\n/, "") : cleanMailText(m.body, 400);
      return {
        n: i + 1, messageId: m.id, subject: m.subject, from: m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress, date: m.date,
        excerpt: truncate(excerpt.trim(), 280), attachment: chunk && chunk.source !== "mail" ? chunk.source : null,
      };
    });
    let answer: string | null = null;
    let cited: number[] = [];
    if (this.options.answer && sources.length > 0) {
      const context: AskContextSource[] = mails.map((m, i) => {
        const chunk = bestChunk.get(m.id);
        // Mailtext plus (falls getroffen) die Stelle im Anhang
        const text = [cleanMailText(m.body, 2500), chunk && chunk.source !== "mail" ? `Anhang „${chunk.source}“: ${chunk.text}` : ""].filter(Boolean).join("\n");
        return { n: i + 1, header: `${m.date.slice(0, 10)} · ${m.fromName ?? m.fromAddress} · Betreff: ${m.subject}`, text };
      });
      const result = await this.options.answer(q, context, [...new Set(mails.map((m) => m.accountId))]);
      if (result) {
        answer = result.answer;
        cited = result.cited;
      }
    } else if (this.options.answer && sources.length === 0) {
      answer = "Dazu habe ich in deinen Mails nichts gefunden.";
    }
    return { question: q, answer, cited, sources, search: { semantic, keyword: keywordIds.length > 0 }, durationMs: Date.now() - started };
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#download?.controller.abort();
    await this.#embedder?.dispose();
  }

  #now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
