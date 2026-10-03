import type { Message } from "../models.js";
import { cleanMailText, inputBudget } from "./prepare.js";
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
    const modelDate = typeof item.date === "string" ? validDate(item.date.trim(), mailDate) : null;
    // Gegenprobe mit den Regeln: Belegt die Fundstelle ein anderes Datum („übermorgen“, „17.10.“), gilt das –
    // kleine Modelle rechnen Wochentage oft falsch. Werbung und Öffnungszeiten sind keine Termine.
    if (type !== "payment" && (adPattern.test(quote) || isRecurring(quote))) continue;
    // Ganzer Satz aus der Mail: das Zitat ist oft gekürzt („Termin: Dienstag“ statt „Dienstag, 14.10.“)
    const at = mail.indexOf(quote);
    const fromQuote = datesInQuote(at >= 0 ? sentenceOf(mail, at) : quote, mailDate);
    let date = modelDate ? fixYear(modelDate, mail, mailDate) : null;
    if (fromQuote.length && (!date || !fromQuote.includes(date))) date = fromQuote[0] ?? date;
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

/**
 * Steht das Datum in der Mail ohne Jahr („31. Oktober“, „15.10.“), setzt der Code das Jahr: das nächste passende ab dem
 * Maildatum. Die Modelle raten hier oft das falsche Jahr.
 */
export function fixYear(date: string, mail: string, mailDate: Date): string {
  const [, m = 0, d = 0] = date.split("-").map(Number);
  const names = Object.entries(months).filter(([, n]) => n === m).map(([name]) => name).join("|");
  const withoutYear = new RegExp(`(?<!\\d)0?${d}\\.\\s?(?:0?${m}\\.(?!\\s?\\d)|(?:${names})\\b\\.?(?!\\s+\\d{2,4}))`, "i");
  if (!withoutYear.test(mail)) return date;
  return isoDate(d, m, null, mailDate) ?? date;
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

export function isoDate(day: number, month: number, year: number | null, mailDate: Date): string | null {
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

const dateRe = /\b(\d{1,2})\.\s?(?:(\d{1,2})\.(\d{2,4})?|(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|apr|jun|jul|aug|sept?|okt|nov|dez)\.?(?:\s+(\d{4}))?)/gi;
const weekdayIndex: Record<string, number> = { sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6 };
// \b greift nicht vor Umlauten („übermorgen“) – deshalb Buchstaben-Grenzen mit Unicode
const relativeRe = /(?<!heute |guten |Guten )(?<!\p{L})(übermorgen|morgen|[Mm]ontag|[Dd]ienstag|[Mm]ittwoch|[Dd]onnerstag|[Ff]reitag|[Ss]amstag|[Ss]onntag)(?!\p{L})/gu;

const englishMonths: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const englishDateRe = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?/gi;

/** Feste Daten im Text („15.10.2026“, „15.10.“, „15. Oktober“, englisch „October 12, 2026“) mit Fundstelle. */
export function explicitDates(text: string, mailDate: Date): { date: string; index: number }[] {
  const out: { date: string; index: number }[] = [];
  for (const match of text.matchAll(dateRe)) {
    const day = Number(match[1]);
    const month = match[2] ? Number(match[2]) : months[(match[4] ?? "").toLowerCase()];
    const yearText = match[3] ?? match[5];
    if (!month || month > 12 || day < 1 || day > 31) continue;
    const date = isoDate(day, month, yearText ? Number(yearText) : null, mailDate);
    if (date) out.push({ date, index: match.index ?? 0 });
  }
  for (const match of text.matchAll(englishDateRe)) {
    const month = englishMonths[(match[1] ?? "").toLowerCase()];
    const day = Number(match[2]);
    if (!month || day < 1 || day > 31) continue;
    const date = isoDate(day, month, match[3] ? Number(match[3]) : null, mailDate);
    if (date) out.push({ date, index: match.index ?? 0 });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** „morgen“, „übermorgen“, Wochentage – als nächstes passendes Datum nach dem Maildatum (gleicher Wochentag: nächste Woche). */
export function relativeDates(text: string, mailDate: Date): { date: string; index: number }[] {
  const out: { date: string; index: number }[] = [];
  for (const match of text.matchAll(relativeRe)) {
    const word = (match[1] ?? "").toLowerCase();
    const offset = word === "morgen" ? 1 : word === "übermorgen" ? 2 : ((weekdayIndex[word] ?? 0) - mailDate.getUTCDay() + 7) % 7 || 7;
    out.push({ date: new Date(Date.UTC(mailDate.getUTCFullYear(), mailDate.getUTCMonth(), mailDate.getUTCDate() + offset)).toISOString().slice(0, 10), index: match.index ?? 0 });
  }
  // Englisch: „tomorrow“, „today“
  for (const match of text.matchAll(/\b(tomorrow|today)\b/gi)) {
    const offset = (match[1] ?? "").toLowerCase() === "tomorrow" ? 1 : 0;
    out.push({ date: new Date(Date.UTC(mailDate.getUTCFullYear(), mailDate.getUTCMonth(), mailDate.getUTCDate() + offset)).toISOString().slice(0, 10), index: match.index ?? 0 });
  }
  // „in 3 Tagen“, „in zwei Wochen“
  const numbers: Record<string, number> = { einem: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, zehn: 10, vierzehn: 14 };
  for (const match of text.matchAll(/(?<!\p{L})in\s+(\d{1,2}|einem|einer|zwei|drei|vier|fünf|sechs|sieben|zehn|vierzehn)\s+(tagen|tag|wochen|woche)(?!\p{L})/giu)) {
    const n = Number(match[1]) || numbers[(match[1] ?? "").toLowerCase()] || 0;
    const days = /woche/i.test(match[2] ?? "") ? n * 7 : n;
    if (!days) continue;
    out.push({ date: new Date(Date.UTC(mailDate.getUTCFullYear(), mailDate.getUTCMonth(), mailDate.getUTCDate() + days)).toISOString().slice(0, 10), index: match.index ?? 0 });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Öffnungszeiten und Wiederkehrendes („Montag bis Freitag“, „immer dienstags“) sind kein Termin. */
function isRecurring(quote: string): boolean {
  return /(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s*(bis|-|–)\s*(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)/i.test(quote) || /(erreichbar|geöffnet|öffnungszeit|sprechzeit|hotline|jeden|immer|montags|dienstags|mittwochs|donnerstags|freitags|samstags|sonntags)/i.test(quote);
}

/** Werbung („gültig bis“, „nur solange“, „20 %“) ist keine Frist und kein Termin. „Angebot“ allein schon (Geschäftsangebot). */
const adPattern = /(gültig|solange|angebote\b|angebot gilt|im angebot|rabatt|\d+ ?%|aktion|gutschein|sale)/i;

/** Welche Daten belegt die Fundstelle? Feste Daten zuerst, sonst relative Angaben (ohne Öffnungszeiten). */
export function datesInQuote(quote: string, mailDate: Date): string[] {
  const explicit = explicitDates(quote, mailDate).map((d) => d.date);
  if (explicit.length || isRecurring(quote)) return explicit;
  return relativeDates(quote, mailDate).map((d) => d.date);
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
  for (const found of explicitDates(text, mailDate)) {
    const action = classifyAction(sentenceOf(text, found.index), found.date, subjectTitle);
    if (action) result.push(action);
  }
  // Relative Angaben: „morgen um 14 Uhr“, „am Dienstag um 9:30“, „bis Freitag“ – nicht bei Öffnungszeiten („Montag bis Freitag“)
  for (const found of relativeDates(text, mailDate)) {
    const quote = sentenceOf(text, found.index);
    if (isRecurring(quote) || explicitDates(quote, mailDate).length) continue; // festes Datum im Satz gilt (oben)
    const action = classifyAction(quote, found.date, subjectTitle);
    if (action && action.type !== "payment") result.push(action);
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

/** Art einer Fundstelle mit Datum (ohne KI). Werbung zählt nicht. */
function classifyAction(quote: string, date: string, subjectTitle: string): MailAction | null {
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
  if (!type) return null;
  // Werbung („gültig bis“, „nur solange“, „20 %“) ist keine Frist und kein Termin
  if (type !== "payment" && adPattern.test(quote)) return null;
  return { type, title, date, time: type === "payment" ? null : time, amount: amountMatch ? amountMatch[0].replace(/\s?eur\b/i, " €") : null, quote };
}

export interface ActionsResult {
  actions: MailAction[];
  origin: ResultOrigin;
  providerId: string | null;
  durationMs: number;
}

/** Aktionen einer Mail: Modell (mit Belegprüfung), sonst Regeln. Blockade/fehlendes Modell → Fehler an den Aufrufer. */
export async function extractActions(router: AIRouter, message: Message, options: { signal?: AbortSignal } = {}): Promise<ActionsResult> {
  const body = cleanMailText(message.bodyText ?? message.snippet, inputBudget.mail);
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
