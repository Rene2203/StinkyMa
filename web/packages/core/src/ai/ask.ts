import { cleanMailText, inputBudget, truncate } from "./prepare.js";
import type { AIRouter } from "./router.js";
import { extractJson, type ResultOrigin } from "./tasks.js";
import type { AIMessage, AIRequest, JsonSchema } from "./types.js";
import { splitIntoChunks } from "./compress.js";

// „Frag dein Postfach“ (W8.1): Textstücke für die Suche nach Bedeutung, Volltext-Anfrage, Antwort mit Quellen.

/** Embedding-Modell (EmbeddingGemma 300M, Q8_0 von ggml-org). Lizenz: Gemma Terms of Use. */
export const embeddingModelFile = {
  id: "embeddinggemma-300m-q8",
  name: "EmbeddingGemma 300M",
  url: "https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF/resolve/main/embeddinggemma-300M-Q8_0.gguf",
  sizeBytes: 333_590_944,
  sha256: "b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63",
  license: "Gemma Terms of Use",
  /** Gespeicherte Länge der Vektoren (Matryoshka: die ersten 256 von 768 genügen, spart Platz und Zeit) */
  dims: 256,
} as const;

/** Textstück einer Mail für die Suche */
export interface MailChunk {
  /** „mail“ oder Dateiname des Anhangs */
  source: string;
  text: string;
}

const chunkChars = 900;

/** Mail in Textstücke teilen: Betreff + Text (höchstens 3 Stücke), Anhänge (je höchstens 2 Stücke). */
export function chunkMail(subject: string, body: string, attachments: { filename: string; text: string }[] = []): MailChunk[] {
  const out: MailChunk[] = [];
  const text = cleanMailText(body, chunkChars * 3);
  const parts = splitIntoChunks(text, chunkChars).slice(0, 3);
  if (parts.length === 0) parts.push("");
  for (const part of parts) out.push({ source: "mail", text: `${subject}\n${part}`.trim() });
  for (const attachment of attachments) {
    const clean = attachment.text.replace(/\s+/g, " ").trim();
    if (clean.length < 40) continue;
    for (const part of splitIntoChunks(clean, chunkChars).slice(0, 2)) out.push({ source: attachment.filename, text: part });
  }
  return out;
}

/** Eingaben für EmbeddingGemma (die Modellkarte verlangt diese Vorsätze) */
export const embeddingInput = {
  document: (title: string, text: string) => `title: ${title || "none"} | text: ${text}`,
  query: (question: string) => `task: search result | query: ${question}`,
};

/** Vektor kürzen (Matryoshka) und auf Länge 1 bringen – dann ist das Skalarprodukt der Kosinus. */
export function normalizeVector(vector: readonly number[], dims: number = embeddingModelFile.dims): Float32Array {
  const out = new Float32Array(Math.min(dims, vector.length));
  let norm = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = vector[i] ?? 0;
    norm += out[i]! * out[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / norm;
  return out;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i]! * b[i]!;
  return sum;
}

const stopwords = new Set(
  "der die das den dem des ein eine einen einem einer eines und oder aber auch noch schon mal nur wie was wer wann wo warum wieso welche welcher welches hat haben habe hatte ist sind war waren wird werden wurde kann können konnte soll sollte muss mich mir mein meine meinen dich dir dein deine ich du er sie es wir ihr ihnen ihm ihn uns euch man von vom zum zur zu im in an am auf aus bei mit nach über unter für gegen ohne um bis seit nicht kein keine keinen etwas alles gibt gab letzte letzten letzter neueste gestern heute morgen bitte denn dann doch ja nein hier dort the a an of to in is was what when who which did do does have has my me i you".split(" "),
);

/** Volltext-Anfrage aus einer Frage: Inhaltswörter mit ODER und Präfix („Abrechnung*“). Leer, wenn nichts übrig bleibt. */
export function keywordQuery(question: string): string {
  const words = question
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !stopwords.has(w));
  const unique = [...new Set(words)].slice(0, 8);
  return unique.map((w) => `"${w}"*`).join(" OR ");
}

/** Rangfolgen zusammenführen (Reciprocal Rank Fusion): wer in beiden Listen weit oben steht, gewinnt. */
export function fuseRankings(lists: string[][], k = 60): string[] {
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

// --- Antwort ---

export const askPromptVersion = 2;

const askSchema: JsonSchema = {
  type: "object",
  properties: {
    antwort: { type: "string", maxLength: 1200 },
    quellen: { type: "array", items: { type: "number" }, maxItems: 6 },
  },
  required: ["antwort", "quellen"],
  additionalProperties: false,
};

export interface AskContextSource {
  n: number;
  header: string;
  text: string;
}

export function askPrompt(question: string, sources: AskContextSource[], today: string): AIMessage[] {
  const context = sources.map((s) => `[${s.n}] ${s.header}\n${s.text}`).join("\n\n");
  return [
    {
      role: "system",
      content: `Du beantwortest Fragen zum E-Mail-Postfach des Nutzers – nur mit den nummerierten Quellen unten (Auszüge aus seinen Mails). Heute ist ${today}.
- Antworte kurz auf Deutsch (1–4 Sätze). Übernimm Daten, Beträge und Namen genau wie in den Quellen.
- Gib in "quellen" die Nummern an, auf die sich die Antwort stützt.
- Prüfe zuerst, ob eine Quelle genau das Gefragte enthält. Behandeln die Quellen nur ein ähnliches Thema (z. B. Nebenkosten statt Mieterhöhung), beantwortet das die Frage NICHT.
- Steht die Antwort in keiner Quelle, antworte genau: "Dazu habe ich in deinen Mails nichts gefunden." und lass "quellen" leer. Erfinde nichts.
Antworte nur mit JSON: {"antwort": "...", "quellen": [1, 2]}

Quellen:
${context}`,
    },
    { role: "user", content: question },
  ];
}

export function parseAsk(text: string, validNumbers: number[]): { answer: string; cited: number[] } | null {
  const value = extractJson(text) as { antwort?: unknown; quellen?: unknown } | null;
  if (!value || typeof value.antwort !== "string" || !value.antwort.trim()) return null;
  const cited = Array.isArray(value.quellen) ? [...new Set(value.quellen.filter((n): n is number => typeof n === "number" && validNumbers.includes(n)))] : [];
  // Verweise im Text („[2]“) zählen auch – nur gültige
  for (const match of value.antwort.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(match[1]);
    if (validNumbers.includes(n) && !cited.includes(n)) cited.push(n);
  }
  return { answer: value.antwort.trim(), cited };
}

/** Antwort aus den Quellen; Quellen, die nicht ins Budget passen, werden gekürzt (neueste Treffer zuerst). */
export async function answerQuestion(
  router: AIRouter,
  question: string,
  sources: AskContextSource[],
  options: { accountIds: string[]; today: string; signal?: AbortSignal },
): Promise<{ answer: string; cited: number[]; origin: ResultOrigin; durationMs: number } | null> {
  const perSource = Math.max(400, Math.floor((inputBudget.thread * 0.8) / Math.max(1, sources.length)));
  const fitted = sources.map((s) => ({ ...s, text: truncate(s.text, perSource) }));
  const request: AIRequest = { task: "ask", messages: askPrompt(question, fitted, options.today), jsonSchema: askSchema, maxTokens: 450, temperature: 0.1 };
  let durationMs = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await router.run(request, { accountIds: options.accountIds }, options.signal);
    durationMs += response.durationMs;
    const parsed = parseAsk(response.text, sources.map((s) => s.n));
    if (parsed) return { ...parsed, origin: response.privacyClass, durationMs };
  }
  return null;
}
