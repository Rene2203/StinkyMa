import { foldAccents, questionWords } from "./ask.js";
import { condense } from "./compress.js";
import { inputBudget, truncate } from "./prepare.js";
import { documentTypes, type DocumentType } from "./prompts.js";
import type { AIRouter } from "./router.js";
import { extractJson } from "./tasks.js";
import type { AIMessage, AIRequest, JsonSchema } from "./types.js";

// Tiefenanalyse (Stufe 2) und „Frag den Anhang“ (W9.2, Spezifikation 7.8). Text kommt aus dem Anhang selbst (PDF,
// Office, Text); Seiten sind mit \f getrennt. Für ein ~3B-Modell: lange Dokumente werden verdichtet (Map-Reduce), für
// Fragen werden nur die passendsten Seiten gezeigt. Antworten nennen die Seite; der Code prüft Seiten und Zitat.

export const askAttachmentPromptVersion = 1;
export const analyzeAttachmentPromptVersion = 1;

export interface DocumentPage {
  /** Seitennummer ab 1; 0 = Dokument ohne Seiten (Word, Text) */
  number: number;
  text: string;
}

/** Text in Seiten (\f) – lange Seiten bzw. Dokumente ohne Seiten in Abschnitte von höchstens `maxChars`. */
export function documentPages(text: string, maxChars = 2500): DocumentPage[] {
  const raw = text.split("\f").map((t) => t.trim());
  const numbered = raw.length > 1;
  const pages: DocumentPage[] = [];
  raw.forEach((pageText, index) => {
    if (!pageText) return;
    for (let start = 0; start < pageText.length; start += maxChars) pages.push({ number: numbered ? index + 1 : 0, text: pageText.slice(start, start + maxChars) });
  });
  return pages;
}

/** Abschnitte, die zur Frage passen (Wort-Treffer), in Dokumentreihenfolge; kurze Dokumente ganz. */
export function relevantPages(pages: DocumentPage[], question: string, budget: number = inputBudget.attachment): DocumentPage[] {
  const total = pages.reduce((n, p) => n + p.text.length, 0);
  if (total <= budget) return pages;
  const words = questionWords(question).map((w) => w.slice(0, Math.max(4, w.length - 2))); // grob ohne Endungen
  const scored = pages.map((page, index) => {
    const folded = foldAccents(page.text);
    const score = words.reduce((n, w) => n + (folded.includes(w) ? 1 : 0), 0);
    return { page, index, score };
  });
  const picked: typeof scored = [];
  let used = 0;
  // Beste Treffer zuerst; ohne Treffer die ersten Seiten (Titel, Vertragspartner, Beträge stehen meist vorn)
  for (const s of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (used + s.page.text.length > budget) continue;
    picked.push(s);
    used += s.page.text.length;
  }
  return picked.sort((a, b) => a.index - b.index).map((s) => s.page);
}

// --- Frag den Anhang ---

export interface AttachmentAnswer {
  answer: string;
  /** Seiten, auf die sich die Antwort stützt (leer bei Dokumenten ohne Seiten) */
  pages: number[];
  /** Wörtliches Zitat aus dem Dokument (vom Code gefunden), sonst leer */
  quote: string;
  found: boolean;
  durationMs: number;
}

export const notInDocument = "Dazu steht in diesem Anhang nichts.";

export const askAttachmentSchema: JsonSchema = {
  type: "object",
  properties: {
    antwort: { type: "string", maxLength: 600 },
    seiten: { type: "array", items: { type: "number" } },
    zitat: { type: "string", maxLength: 300 },
  },
  required: ["antwort", "seiten", "zitat"],
  additionalProperties: false,
};

export function askAttachmentPrompt(filename: string, question: string, pages: DocumentPage[], today: string): AIMessage[] {
  const numbered = pages.some((p) => p.number > 0);
  const text = pages.map((p) => (numbered ? `[Seite ${p.number}]\n${p.text}` : p.text)).join("\n\n");
  return [
    {
      role: "system",
      content: `Du beantwortest eine Frage zu einem Dokument (Anhang einer E-Mail). Heute ist ${today}. Antworte nur mit JSON:
{"antwort": "kurze Antwort auf Deutsch, 1–3 Sätze", "seiten": [Seitennummern, auf denen es steht], "zitat": "die entscheidende Stelle wörtlich aus dem Dokument"}
- Nutze nur das Dokument. Nenne Beträge, Daten, Fristen und Namen genau so, wie sie dort stehen.
- Steht die Antwort nicht im Dokument, antworte genau: "${notInDocument}" und lass "seiten" leer und "zitat" leer.${numbered ? "" : "\n- Das Dokument hat keine Seitennummern: lass \"seiten\" leer."}`,
    },
    { role: "user", content: `Datei: ${filename}\n\n${text}\n\nFrage: ${question}` },
  ];
}

/** Prüft: Seiten müssen gezeigt worden sein; das Zitat muss (sinngemäß wörtlich) im Dokument stehen, sonst fällt es weg. */
export function parseAttachmentAnswer(raw: string, shown: DocumentPage[]): Omit<AttachmentAnswer, "durationMs"> | null {
  const value = extractJson(raw) as { antwort?: unknown; seiten?: unknown; zitat?: unknown } | null;
  if (!value || typeof value.antwort !== "string" || !value.antwort.trim()) return null;
  const answer = value.antwort.trim();
  // „Steht nicht drin“ in den üblichen Formulierungen eines kleinen Modells – ohne Seite und ohne Zitat
  const saysNothing = /steht (dazu )?(in diesem anhang |im dokument )?nichts|(enthält|nennt|erwähnt|gibt) (es )?keine (\p{L}+ )?(informationen?|angaben|hinweise)|keine (\p{L}+ )?(informationen?|angaben|hinweise) (darüber|dazu|zu)|wird (dort |im dokument )?nicht erwähnt|ist (im dokument )?nicht (erwähnt|aufgeführt|angegeben)|does not (mention|contain)|no information/iu.test(answer);
  const noEvidence = !(Array.isArray(value.seiten) && value.seiten.length > 0) && !(typeof value.zitat === "string" && value.zitat.trim());
  const notFound = foldAccents(answer).includes(foldAccents(notInDocument).slice(0, 24)) || (saysNothing && noEvidence);
  if (notFound) return { answer: notInDocument, pages: [], quote: "", found: false };
  const known = new Set(shown.map((p) => p.number).filter((n) => n > 0));
  const pages = Array.isArray(value.seiten) ? [...new Set(value.seiten.map(Number).filter((n) => known.has(n)))].sort((a, b) => a - b) : [];
  let quote = typeof value.zitat === "string" ? value.zitat.trim().replace(/^["„“]|["“”]$/g, "") : "";
  const squash = (t: string) => foldAccents(t).replace(/\s+/g, " ");
  const haystack = squash(shown.map((p) => p.text).join(" "));
  if (quote && !haystack.includes(squash(quote))) quote = "";
  // Kein Seiten-Hinweis vom Modell, aber das Zitat ist eindeutig auf einer Seite: die nehmen
  if (pages.length === 0 && quote) {
    const page = shown.find((p) => p.number > 0 && squash(p.text).includes(squash(quote)));
    if (page) pages.push(page.number);
  }
  return { answer: truncate(answer, 600), pages, quote: truncate(quote, 300), found: true };
}

export async function askAttachment(
  router: AIRouter,
  input: { filename: string; text: string; question: string },
  options: { accountIds: string[]; today: string; signal?: AbortSignal },
): Promise<AttachmentAnswer> {
  const shown = relevantPages(documentPages(input.text), input.question);
  const request: AIRequest = { task: "askAttachment", messages: askAttachmentPrompt(input.filename, input.question, shown, options.today), jsonSchema: askAttachmentSchema, maxTokens: 400, temperature: 0.1 };
  let durationMs = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await router.run(request, { accountIds: options.accountIds }, options.signal);
    durationMs += response.durationMs;
    const parsed = parseAttachmentAnswer(response.text, shown);
    if (parsed) return { ...parsed, durationMs };
  }
  return { answer: "Die KI hat keine brauchbare Antwort geliefert – bitte anders fragen.", pages: [], quote: "", found: false, durationMs };
}

// --- Tiefenanalyse ---

export interface DocumentAnalysis {
  documentType: DocumentType;
  title: string;
  summary: string;
  durationMs: number;
}

export const analyzeDocumentSchema: JsonSchema = {
  type: "object",
  properties: {
    documentType: { type: "string", enum: documentTypes },
    title: { type: "string", maxLength: 120 },
    summary: { type: "string", maxLength: 600 },
  },
  required: ["documentType", "title", "summary"],
  additionalProperties: false,
};

export function analyzeDocumentPrompt(filename: string, text: string): AIMessage[] {
  return [
    {
      role: "system",
      content: `Du fasst ein Dokument (Anhang einer E-Mail) zusammen und antwortest nur mit JSON:
{"documentType": "${documentTypes.join(" | ")}", "title": "kurzer Titel", "summary": "2–4 Sätze auf Deutsch: Was ist es, von wem, wichtigste Angaben (Beträge, Daten, Fristen, was zu tun ist)"}
Nenne Zahlen, Beträge, Daten und Namen genau so, wie sie im Dokument stehen. Erfinde nichts.`,
    },
    { role: "user", content: `Datei: ${filename}\n\n${text}` },
  ];
}

/** Zusammenfassung eines Dokuments; lange Texte werden vorher verdichtet (Map-Reduce). */
export async function analyzeDocument(
  router: AIRouter,
  input: { filename: string; text: string },
  options: { accountIds: string[]; signal?: AbortSignal },
): Promise<DocumentAnalysis> {
  const started = performance.now();
  const plain = input.text.replace(/\f/g, "\n");
  const text = plain.length > inputBudget.attachment
    ? await condense(router, plain, { accountIds: options.accountIds, targetChars: inputBudget.attachment, chunkChars: inputBudget.attachment, label: "Dokument", ...(options.signal ? { signal: options.signal } : {}) })
    : plain;
  const request: AIRequest = { task: "summarize", messages: analyzeDocumentPrompt(input.filename, text), jsonSchema: analyzeDocumentSchema, maxTokens: 450, temperature: 0.1 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await router.run(request, { accountIds: options.accountIds }, options.signal);
    const value = extractJson(response.text) as { documentType?: unknown; title?: unknown; summary?: unknown } | null;
    if (value && typeof value.summary === "string" && value.summary.trim()) {
      const documentType = documentTypes.find((t) => t === value.documentType) ?? "other";
      return { documentType, title: truncate(String(value.title ?? input.filename), 120), summary: truncate(value.summary.trim(), 600), durationMs: Math.round(performance.now() - started) };
    }
  }
  throw new Error("Die KI konnte den Anhang nicht zusammenfassen.");
}
