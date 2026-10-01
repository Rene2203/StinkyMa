import type { Message } from "../models.js";
import { cleanMailText } from "./prepare.js";
import type { AIRouter } from "./router.js";
import { extractJson, type ResultOrigin } from "./tasks.js";
import type { AIMessage, AIRequest, JsonSchema } from "./types.js";

// Aktionen aus Mails erkennen (Spezifikation 5.5 „Aktionen extrahieren“, Phase 7): Termine, Fristen, To-dos, Zahlungen.
// Kleine Modelle erfinden gern – deshalb muss jede Aktion ein wörtliches Zitat aus der Mail haben, das wir prüfen.
// Ohne Modell (oder wenn es versagt) erkennen einfache Regeln Daten, Uhrzeiten und Beträge.

export const actionTypes = ["appointment", "deadline", "todo", "payment"] as const;
export type ActionType = (typeof actionTypes)[number];

export interface MailAction {
  type: ActionType;
  title: string;
  /** YYYY-MM-DD oder null */
  date: string | null;
  /** HH:MM oder null */
  time: string | null;
  /** wie in der Mail geschrieben, z. B. „84,20 €“ */
  amount: string | null;
  /** wörtliche Stelle aus der Mail (Beleg) */
  quote: string;
}

export const actionsPromptVersion = 1;

export const actionsSchema: JsonSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: actionTypes },
          title: { type: "string", maxLength: 80 },
          date: { type: "string", maxLength: 10 },
          time: { type: "string", maxLength: 5 },
          amount: { type: "string", maxLength: 20 },
          quote: { type: "string", maxLength: 160 },
        },
        required: ["type", "title", "date", "time", "amount", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const weekdays = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export function actionsPrompt(mail: string, mailDate: Date): AIMessage[] {
  const iso = mailDate.toISOString().slice(0, 10);
  return [
    {
      role: "system",
      content: `Du findest in einer E-Mail, was der Empfänger tun oder sich merken muss. Antworte nur mit JSON:
{"items": [{"type": "appointment | deadline | todo | payment", "title": "kurz, z. B. Zahnarzttermin", "date": "JJJJ-MM-TT oder leer", "time": "HH:MM oder leer", "amount": "Betrag wie in der Mail oder leer", "quote": "die Stelle aus der Mail, wörtlich"}]}
- appointment: Termin mit Datum (Arzt, Treffen, Besichtigung, Elternabend).
- deadline: Frist – etwas muss bis zu einem Datum erledigt sein (einreichen, antworten, anmelden).
- payment: Betrag, der bezahlt oder abgebucht wird (mit Datum, falls genannt).
- todo: Bitte an den Empfänger ohne festes Datum.
Die Mail ist vom ${weekdays[mailDate.getUTCDay()]}, ${iso}. Rechne „morgen“, „Dienstag“, „Ende des Monats“ in ein Datum um; fehlt das Jahr, nimm das nächste passende.
Nur was wirklich in der Mail steht – nichts erfinden. Werbung, Newsletter und reine Infos ohne Handlung: {"items": []}.`,
    },
    { role: "user", content: mail },
  ];
}

/** Für Vergleiche: klein, Leerraum vereinheitlicht, Tausenderpunkte und typografische Zeichen angeglichen. */
function norm(text: string): string {
  return text.toLowerCase().replace(/[„“”"‚‘’']/g, "").replace(/[–—]/g, "-").replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2").replace(/\s+/g, " ").trim();
}

/** Stammt das Zitat aus der Mail? Kleine Modelle kürzen oder glätten – mindestens 70 % der Wörter müssen vorkommen. */
export function quoteFound(quote: string, mail: string): boolean {
  const q = norm(quote);
  const m = norm(mail);
  if (!q) return false;
  if (m.includes(q)) return true;
  const words = q.split(" ").filter((w) => w.length > 2);
  if (words.length === 0) return false;
  return words.filter((w) => m.includes(w)).length / words.length >= 0.7;
}

function validDate(value: string, mailDate: Date): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  const diffDays = (date.getTime() - mailDate.getTime()) / 86_400_000;
  return diffDays > -366 && diffDays < 731 ? value : null;
}

/** Prüft und bereinigt die Antwort des Modells. Aktionen ohne Beleg in der Mail fallen weg. */
export function parseActions(text: string, mail: string, mailDate: Date): MailAction[] | null {
  const value = extractJson(text) as { items?: unknown } | null;
  if (!value || !Array.isArray(value.items)) return null;
  const result: MailAction[] = [];
  for (const raw of value.items.slice(0, 5)) {
    const item = raw as Record<string, unknown>;
    const type = (actionTypes as readonly string[]).includes(String(item.type)) ? (item.type as ActionType) : null;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const quote = typeof item.quote === "string" ? item.quote.trim() : "";
    if (!type || !title || !quoteFound(quote, mail)) continue;
    const date = typeof item.date === "string" ? validDate(item.date.trim(), mailDate) : null;
    const time = typeof item.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time.trim()) ? item.time.trim() : null;
    const amountRaw = typeof item.amount === "string" ? item.amount.trim() : "";
    // Betrag nur, wenn die Zahl so in der Mail steht
    const digits = amountRaw.replace(/[^\d,]/g, "");
    const amount = digits && norm(mail).replace(/[^\d,]/g, " ").split(" ").includes(digits) ? amountRaw : null;
    if (type === "appointment" && !date) continue; // Termin ohne Datum ist keiner
    result.push({ type, title: title.slice(0, 80), date, time, amount, quote: quote.slice(0, 160) });
  }
  return dedupe(result);
}

function dedupe(actions: MailAction[]): MailAction[] {
  const seen = new Set<string>();
  return actions.filter((a) => {
    const key = `${a.type}|${a.date}|${a.time}|${a.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- Regeln (ohne Modell) ---

const months: Record<string, number> = {
  januar: 1, jan: 1, februar: 2, feb: 2, märz: 3, maerz: 3, mär: 3, april: 4, apr: 4, mai: 5, juni: 6, jun: 6,
  juli: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12,
};

function isoDate(day: number, month: number, year: number | null, mailDate: Date): string | null {
  let y = year ?? mailDate.getUTCFullYear();
  if (year !== null && year < 100) y = 2000 + year;
  if (year === null) {
    // ohne Jahr: nächstes passendes Datum ab Maildatum (Toleranz 30 Tage zurück)
    const candidate = Date.UTC(y, month - 1, day);
    if (candidate < mailDate.getTime() - 30 * 86_400_000) y += 1;
  }
  const value = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validDate(value, mailDate);
}

/** Satz um eine Fundstelle – Satzende ist ein Punkt nach einem Buchstaben (nicht „21.10.“) oder ein Zeilenumbruch. */
const sentenceOf = (text: string, index: number) => {
  const boundary = /(?<=[a-zäöüß)])[.!?]\s|\n/gi;
  let start = 0;
  let end = text.length;
  for (const match of text.matchAll(boundary)) {
    const position = match.index ?? 0;
    if (position < index) start = position + match[0].length;
    else {
      end = position + 1;
      break;
    }
  }
  return text.slice(start, end).trim().slice(0, 160);
};

/**
 * Einfache Erkennung ohne KI: Datum (15.10.2026, 15.10., 15. Oktober), Uhrzeit (9:30 Uhr, 18 Uhr), Betrag (84,20 €) und
 * Schlüsselwörter. Bewusst vorsichtig – lieber eine Aktion weniger als eine falsche.
 */
export function ruleActions(subject: string, body: string, mailDate: Date): MailAction[] {
  const text = `${subject}\n${body}`;
  // Titel ohne KI: der Betreff (ohne „Re:/AW:/Fwd:“) – aussagekräftiger als nur „Zahlung“
  const subjectTitle = subject.replace(/^\s*((re|aw|wg|fwd?|antw)\s*:\s*)+/i, "").trim().slice(0, 80);
  const result: MailAction[] = [];
  const dateRe = /\b(\d{1,2})\.\s?(?:(\d{1,2})\.(\d{2,4})?|(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|apr|jun|jul|aug|sept?|okt|nov|dez)\.?(?:\s+(\d{4}))?)/gi;
  for (const match of text.matchAll(dateRe)) {
    const day = Number(match[1]);
    const month = match[2] ? Number(match[2]) : months[(match[4] ?? "").toLowerCase()];
    const yearText = match[3] ?? match[5];
    if (!month || month > 12 || day < 1 || day > 31) continue;
    const date = isoDate(day, month, yearText ? Number(yearText) : null, mailDate);
    if (!date) continue;
    const quote = sentenceOf(text, match.index ?? 0);
    const lower = quote.toLowerCase();
    // Zeitspanne („zwischen 9 und 10 Uhr“, „von 14 bis 18 Uhr“): Beginn zählt
    const timeMatch =
      /\b([01]?\d|2[0-3])(?::([0-5]\d))?\s?(?:bis|und|-|–)\s?(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s?uhr\b/i.exec(quote) ??
      /\b([01]?\d|2[0-3])(?::([0-5]\d))?\s?uhr\b/i.exec(quote) ??
      /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(quote);
    const time = timeMatch ? `${timeMatch[1]?.padStart(2, "0")}:${timeMatch[2] ?? "00"}` : null;
    const amountMatch = /\b\d{1,3}(?:\.\d{3})*,\d{2}\s?(?:€|eur\b)/i.exec(quote);
    let type: ActionType | null = null;
    let title = "";
    if (amountMatch && /(abgebucht|abbuchung|überweis|zahlbar|fällig|bezahlen|nachzahlung|betrag)/.test(lower)) {
      type = "payment";
      title = subjectTitle || "Zahlung";
    } else if (/(termin|einladung|findet .* statt|elternabend|besichtigung|treffen|abholung|ablesung)/.test(lower) || (time && !/(versendet|zugestellt|erhalten)/.test(lower))) {
      type = "appointment";
      title = subjectTitle || "Termin";
    } else if (/(\bbis\b|spätestens|frist|einreichen|zurücksenden|eintragen|anmelden)/.test(lower)) {
      type = "deadline";
      title = subjectTitle || "Frist";
    }
    if (!type) continue;
    // Werbung („gültig bis“, „nur solange“, „20 %“) ist keine Frist und kein Termin
    if (type !== "payment" && /(gültig|solange|angebot|rabatt|\d+ ?%|aktion|gutschein|sale)/i.test(quote)) continue;
    result.push({ type, title, date, time: type === "payment" ? null : time, amount: amountMatch ? amountMatch[0].replace(/\s?eur\b/i, " €") : null, quote });
  }
  // Beträge ohne Datum („Rechnung über 39,99 €“, „bitte 65,00 € überweisen“)
  for (const match of text.matchAll(/\b\d{1,3}(?:\.\d{3})*,\d{2}\s?(?:€|eur\b)/gi)) {
    const amount = match[0].replace(/\s?eur\b/i, " €");
    if (result.some((a) => a.amount?.replace(/\s/g, "") === amount.replace(/\s/g, ""))) continue;
    const quote = sentenceOf(text, match.index ?? 0);
    if (!/(rechnung|abgebucht|abbuchung|überweis|zahlbar|fällig|bezahlen|nachzahlung|betrag|beträgt|lastschrift|gebühr|beitrag)/i.test(quote)) continue;
    if (/(\d+ ?%|rabatt|günstiger|ab \d|angebot|guthaben|erstatte)/i.test(quote)) continue; // Werbung, Gutschrift
    result.push({ type: "payment", title: subjectTitle || "Zahlung", date: null, time: null, amount, quote });
  }
  return dedupe(result).slice(0, 5);
}

export interface ActionsResult {
  actions: MailAction[];
  origin: ResultOrigin;
  providerId: string | null;
  durationMs: number;
}

/** Aktionen einer Mail: Modell (mit Belegprüfung), sonst Regeln. Blockade/fehlendes Modell → Fehler an den Aufrufer. */
export async function extractActions(router: AIRouter, message: Message, options: { signal?: AbortSignal } = {}): Promise<ActionsResult> {
  const body = cleanMailText(message.bodyText ?? message.snippet, 2000);
  const mailDate = new Date(message.date);
  const mail = `Betreff: ${message.subject}\n\n${body}`;
  const request: AIRequest = { task: "extractActions", messages: actionsPrompt(mail, mailDate), jsonSchema: actionsSchema, maxTokens: 400, temperature: 0 };
  let durationMs = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await router.run(request, { accountIds: [message.accountId] }, options.signal);
    durationMs += response.durationMs;
    const actions = parseActions(response.text, mail, mailDate);
    if (actions) return { actions, origin: response.privacyClass, providerId: response.providerId, durationMs };
  }
  return { actions: ruleActions(message.subject, body, mailDate), origin: "rules", providerId: null, durationMs };
}
