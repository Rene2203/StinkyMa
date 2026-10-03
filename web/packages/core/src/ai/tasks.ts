import type { Message, MessageCategory } from "../models.js";
import { condense } from "./compress.js";
import { inputBudget, mailForModel, threadForModel } from "./prepare.js";
import { categories, categorizePrompt, categorizeSchema, documentTypes, readImagePrompt, readImageSchema, summarizePrompt, summarizePromptV2, summarizeSchema, summarizeSchemaV2, type DocumentType } from "./prompts.js";
import type { AIRouter } from "./router.js";
import type { AIImage, AIRequest, AIResponse, PrivacyClass } from "./types.js";

/** Woher ein Ergebnis stammt – die Oberfläche zeigt es an (5.0: Gerät / eigener Server / Cloud / Regeln). */
export type ResultOrigin = PrivacyClass | "rules";

export interface CategoryResult {
  category: MessageCategory;
  confidence: number;
  origin: ResultOrigin;
  providerId: string | null;
  durationMs: number;
}

export interface ThreadSummary {
  summary: string;
  openPoints: string[];
  waitingOn: "me" | "others" | "nobody";
  origin: Exclude<ResultOrigin, "rules">;
  providerId: string;
  durationMs: number;
}

/** Erstes JSON-Objekt aus einer Modellantwort (manche Modelle schreiben Text oder ```json drumherum). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseCategory(text: string): { category: MessageCategory; confidence: number } | null {
  const value = extractJson(text) as { category?: unknown; confidence?: unknown } | null;
  if (!value || typeof value.category !== "string") return null;
  const category = value.category.trim().toLowerCase() as MessageCategory;
  if (!categories.includes(category)) return null;
  const confidence = typeof value.confidence === "number" && value.confidence >= 0 && value.confidence <= 1 ? value.confidence : 0.5;
  return { category, confidence };
}

/**
 * Liest die Zusammenfassung. „Wer ist dran“ (v4): Das Modell sagt nur, ob die letzte Mail fragt/bittet oder eine Meldung
 * ankündigt; wer dann dran ist, folgt daraus, ob der Nutzer sie geschrieben hat. Antworten mit `waitingOn` (v2) gehen auch.
 */
export function parseSummary(text: string, context: { lastFromUser?: boolean } = {}): Pick<ThreadSummary, "summary" | "openPoints" | "waitingOn"> | null {
  const value = extractJson(text) as { summary?: unknown; openPoints?: unknown; waitingOn?: unknown; letzteMailFragtOderBittet?: unknown; letzteMailKuendigtMeldungAn?: unknown } | null;
  if (!value || typeof value.summary !== "string" || !value.summary.trim()) return null;
  const openPoints = Array.isArray(value.openPoints)
    ? value.openPoints.filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim()).slice(0, 4)
    : [];
  let waitingOn: ThreadSummary["waitingOn"];
  const v4 = value;
  if (typeof v4.letzteMailFragtOderBittet === "boolean" || typeof v4.letzteMailKuendigtMeldungAn === "boolean") {
    // Frage/Bitte in der letzten Mail: dran ist, wer sie bekommen hat. Angekündigte Meldung: dran ist, wer sie geschrieben hat.
    const fromUser = context.lastFromUser ?? false;
    if (v4.letzteMailFragtOderBittet === true) waitingOn = fromUser ? "others" : "me";
    else if (v4.letzteMailKuendigtMeldungAn === true) waitingOn = fromUser ? "me" : "others";
    else waitingOn = "nobody";
  } else {
    waitingOn = value.waitingOn === "me" || value.waitingOn === "others" ? value.waitingOn : "nobody";
  }
  return { summary: value.summary.trim(), openPoints, waitingOn };
}

/**
 * Regeln als Rückfall, wenn das Modell nach einem zweiten Versuch nichts Brauchbares liefert (5.5) – lieber
 * eine einfache, nachvollziehbare Einordnung mit niedriger Konfidenz als gar keine.
 */
export function ruleCategory(message: Message): { category: MessageCategory; confidence: number } {
  const text = `${message.subject}\n${message.bodyText ?? message.snippet}`.toLowerCase();
  const from = message.from.address.toLowerCase();
  if (/(konto (wurde )?gesperrt|verifizieren sie|gewonnen|letzte mahnung.*sofort|ihr paket konnte nicht zugestellt)/.test(text)) return { category: "spam_suspect", confidence: 0.4 };
  if (/(rechnung|invoice|zahlungserinnerung|abbuchung|beleg|kontoauszug|abschlag)/.test(text)) return { category: "invoice", confidence: 0.4 };
  if (/(termin|einladung|meeting|besprechung|uhr\b|kalender)/.test(text)) return { category: "appointment", confidence: 0.3 };
  if (/(abmelden|abbestellen|unsubscribe|newsletter|angebot der woche|rabatt)/.test(text)) return { category: "newsletter", confidence: 0.4 };
  if (/^(no-?reply|noreply|notification|benachrichtigung|info|service)@/.test(from)) return { category: "notification", confidence: 0.35 };
  return { category: "personal", confidence: 0.2 };
}

/** Ein Aufruf mit genau einem zweiten Versuch bei ungültiger Ausgabe (5.5). */
async function runParsed<T>(
  router: AIRouter,
  request: AIRequest,
  accountIds: string[],
  parse: (text: string) => T | null,
  signal?: AbortSignal,
): Promise<{ value: T; response: AIResponse; durationMs: number } | null> {
  let durationMs = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await router.run(attempt === 0 ? request : { ...request, temperature: 0 }, { accountIds }, signal);
    durationMs += response.durationMs;
    const value = parse(response.text);
    if (value) return { value, response, durationMs };
  }
  return null;
}

/** Kategorie einer Mail. Antwortet das Modell zweimal unbrauchbar: Regeln. Fehlt es oder ist es blockiert: Fehler. */
export async function categorizeMessage(
  router: AIRouter,
  message: Message,
  options: { maxChars?: number; signal?: AbortSignal; attachmentNames?: string[] } = {},
): Promise<CategoryResult> {
  const request: AIRequest = {
    task: "categorize",
    messages: categorizePrompt(mailForModel(message, options.maxChars ?? 1500, { attachmentNames: options.attachmentNames })),
    jsonSchema: categorizeSchema,
    maxTokens: 40,
    temperature: 0,
  };
  const result = await runParsed(router, request, [message.accountId], parseCategory, options.signal);
  if (!result) return { ...ruleCategory(message), origin: "rules", providerId: null, durationMs: 0 };
  return { ...result.value, origin: result.response.privacyClass, providerId: result.response.providerId, durationMs: result.durationMs };
}

/** Bisheriger Stand für die laufende Zusammenfassung (nur neue Mails lesen) */
export interface PreviousSummary {
  summary: string;
  openPoints: string[];
  /** Datum der letzten schon zusammengefassten Mail */
  lastMessageDate: string;
}

/**
 * Text der Konversation für das Modell, passend ins Budget: Passt alles, kommt alles; sonst bleiben die neuesten Mails
 * im Wortlaut und der frühere Verlauf wird verdichtet (Map-Reduce) statt weggelassen.
 */
export async function threadTextFor(
  router: AIRouter,
  thread: Message[],
  options: { ownAddresses: string[]; budget: number; accountIds: string[]; signal?: AbortSignal },
): Promise<string> {
  const ordered = [...thread].sort((a, b) => a.date.localeCompare(b.date));
  const full = ordered.map((m) => mailForModel(m, 8000, { ownAddresses: options.ownAddresses })).join("\n\n---\n\n");
  if (full.length <= options.budget) return full;
  // Neueste Mails im Wortlaut (halbes Budget), der Rest verdichtet
  const recent: Message[] = [];
  let used = 0;
  for (const message of [...ordered].reverse()) {
    const block = mailForModel(message, 8000, { ownAddresses: options.ownAddresses });
    if (recent.length > 0 && used + block.length > options.budget / 2) break;
    recent.unshift(message);
    used += block.length;
  }
  const older = ordered.slice(0, ordered.length - recent.length);
  const recentText = threadForModel(recent, Math.floor(options.budget / 2), options.ownAddresses);
  if (older.length === 0) return recentText;
  const olderText = older.map((m) => mailForModel(m, 8000, { ownAddresses: options.ownAddresses })).join("\n\n---\n\n");
  const condensed = await condense(router, olderText, {
    accountIds: options.accountIds,
    targetChars: Math.floor(options.budget / 2) - 200,
    label: "früherer Teil einer E-Mail-Konversation",
    signal: options.signal,
  });
  return `[Früherer Verlauf, verdichtet – ${older.length} Mail(s)]\n${condensed}\n\n---\n\n${recentText}`;
}

/**
 * Zusammenfassung einer Konversation. Mit `previous` (laufende Zusammenfassung): das Modell liest nur die bisherige
 * Zusammenfassung plus die neuen Mails. Ohne gültige Antwort: Fehler (keine erfundene Zusammenfassung).
 */
export async function summarizeThread(
  router: AIRouter,
  thread: Message[],
  options: { ownAddresses: string[]; maxChars?: number; signal?: AbortSignal; previous?: PreviousSummary; /** nur für Vergleichsmessungen */ promptVersion?: 2 | 4 },
): Promise<ThreadSummary> {
  const own = new Set(options.ownAddresses.map((a) => a.toLowerCase()));
  const last = [...thread].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const lastFromUser = !!last && own.has(last.from.address.toLowerCase());
  const lastLine = last ? `\n\n---\nDie letzte Mail ist ${lastFromUser ? "vom Nutzer selbst" : `von ${last.from.name || last.from.address} an den Nutzer`}.` : "";
  const accountIds = [...new Set(thread.map((m) => m.accountId))];
  const budget = options.maxChars ?? inputBudget.thread;
  const v2 = options.promptVersion === 2;
  let threadText: string;
  const fresh = options.previous ? thread.filter((m) => m.date > options.previous!.lastMessageDate) : thread;
  if (v2) {
    threadText = threadForModel(thread, budget, options.ownAddresses);
  } else if (options.previous && fresh.length > 0 && fresh.length < thread.length) {
    const earlier = [
      `[Bisherige Zusammenfassung bis ${options.previous.lastMessageDate.slice(0, 10)}]`,
      options.previous.summary,
      options.previous.openPoints.length ? `Offene Punkte bisher: ${options.previous.openPoints.join("; ")}` : "",
    ].filter(Boolean).join("\n");
    const newText = await threadTextFor(router, fresh, { ownAddresses: options.ownAddresses, budget: budget - earlier.length, accountIds, signal: options.signal });
    threadText = `${earlier}\n\n---\n\n[Neue Mails seitdem]\n\n${newText}`;
  } else {
    threadText = await threadTextFor(router, thread, { ownAddresses: options.ownAddresses, budget, accountIds, signal: options.signal });
  }
  const request: AIRequest = {
    task: "summarize",
    messages: v2 ? summarizePromptV2(threadText, options.ownAddresses) : summarizePrompt(threadText + lastLine, options.ownAddresses),
    jsonSchema: v2 ? summarizeSchemaV2 : summarizeSchema,
    maxTokens: 400,
    temperature: 0.2,
  };
  const result = await runParsed(router, request, accountIds, (text) => parseSummary(text, { lastFromUser }), options.signal);
  if (!result) throw new Error("Das Modell hat keine brauchbare Zusammenfassung geliefert. Bitte noch einmal versuchen.");
  return { ...result.value, origin: result.response.privacyClass as ThreadSummary["origin"], providerId: result.response.providerId, durationMs: result.durationMs };
}

export interface ImageReading {
  documentType: DocumentType;
  title: string;
  summary: string;
  text: string;
  origin: Exclude<ResultOrigin, "rules">;
  providerId: string;
  durationMs: number;
}

export function parseImageReading(text: string): Pick<ImageReading, "documentType" | "title" | "summary" | "text"> | null {
  const value = extractJson(text) as { documentType?: unknown; title?: unknown; summary?: unknown; text?: unknown } | null;
  if (!value || typeof value.summary !== "string") return null;
  const documentType = (documentTypes as readonly string[]).includes(String(value.documentType)) ? (value.documentType as DocumentType) : "other";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const body = typeof value.text === "string" ? value.text.trim() : "";
  if (!value.summary.trim() && !body) return null;
  return { documentType, title, summary: value.summary.trim(), text: body };
}

/** Höchstens so viele Seiten/Bilder auf einmal – kleine Modelle und schwache Rechner. */
export const maxImagesPerReading = 3;

/** Liest ein Dokument aus Bildern (Foto, Scan, gerenderte PDF-Seiten). Ohne gültige Antwort: Fehler. */
export async function readDocumentImages(
  router: AIRouter,
  images: AIImage[],
  options: { filename: string; accountIds: string[]; signal?: AbortSignal },
): Promise<ImageReading> {
  if (images.length === 0) throw new Error("Kein Bild zum Lesen.");
  const pages = images.slice(0, maxImagesPerReading);
  const prompt = readImagePrompt({ filename: options.filename, pages: pages.length });
  const request: AIRequest = {
    task: "readImage",
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user, images: pages },
    ],
    jsonSchema: readImageSchema,
    maxTokens: 1500,
    temperature: 0,
  };
  const result = await runParsed(router, request, options.accountIds, parseImageReading, options.signal);
  if (!result) throw new Error("Das Modell konnte das Bild nicht lesen. Bitte noch einmal versuchen.");
  return { ...result.value, origin: result.response.privacyClass as ImageReading["origin"], providerId: result.response.providerId, durationMs: result.durationMs };
}
