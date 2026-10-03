import type { EmailAddress, Message } from "../models.js";
import { explicitDates, fixYear, relativeDates } from "./actions.js";
import { amountToCents } from "../subscriptions.js";
import { cleanMailText, inputBudget, truncate } from "./prepare.js";
import type { AIRouter } from "./router.js";
import { extractJson, type ResultOrigin } from "./tasks.js";
import type { AIMessage, AIRequest, JsonSchema } from "./types.js";

// Verträge & Abos (W7.1): Muster wie bei den Aktionen – KI erkennt, Code prüft und rechnet, Nutzer bestätigt.
// Den letzten Kündigungstag rechnet immer der Code (Laufzeitende bzw. Verlängerung minus Kündigungsfrist).
// Keine Rechtsberatung: Die App zeigt nur, was in den Mails steht.

export const subscriptionKinds = ["subscription", "trial", "contract", "membership", "insurance"] as const;
export type SubscriptionKind = (typeof subscriptionKinds)[number];
export const billingIntervals = ["weekly", "monthly", "quarterly", "yearly"] as const;
export type BillingInterval = (typeof billingIntervals)[number];

export interface Notice {
  amount: number;
  unit: "day" | "week" | "month";
}

/** Was eine Mail über ein Abo/einen Vertrag sagt. Daten als YYYY-MM-DD. */
export interface SubscriptionFinding {
  kind: SubscriptionKind;
  provider: string;
  /** Betrag wie in der Mail, z. B. „12,99 €“ */
  amount: string | null;
  interval: BillingInterval | null;
  startDate: string | null;
  minTermMonths: number | null;
  /** Letzter Tag der Probezeit */
  trialEnd: string | null;
  /** Letzter Tag der (Mindest-)Laufzeit */
  termEnd: string | null;
  /** Erster Tag der Verlängerung */
  renewalDate: string | null;
  /** Ausdrücklich genannter Kündigungsschluss („Austritte bis 30.11.“) */
  cancelBy: string | null;
  notice: Notice | null;
  /** Kündigung bestätigt / Abo endet */
  cancelled: boolean;
  /** Belegstelle aus der Mail */
  quote: string;
}

// --- Datum rechnen ---

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monate addieren; Monatsende bleibt im Zielmonat („31.03. minus 1 Monat“ → 28./29.02.). */
function addMonths(iso: string, months: number): string {
  const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

function minusNotice(iso: string, notice: Notice): string {
  return notice.unit === "month" ? addMonths(iso, -notice.amount) : addDays(iso, -(notice.unit === "week" ? 7 : 1) * notice.amount);
}

/** Ende der Laufzeit: ausdrücklich genannt, sonst Beginn + Mindestlaufzeit. */
export function termEndOf(f: Pick<SubscriptionFinding, "termEnd" | "startDate" | "minTermMonths">): string | null {
  if (f.termEnd) return f.termEnd;
  if (f.startDate && f.minTermMonths) return addDays(addMonths(f.startDate, f.minTermMonths), -1);
  return null;
}

/**
 * Letzter Tag, an dem die Kündigung beim Anbieter sein muss. Probezeit: ihr letzter Tag (minus Frist). Laufzeit: ihr
 * Ende minus Frist. Nur Verlängerungsdatum bekannt: Verlängerung minus Frist, ohne Frist der Tag davor.
 */
export function lastCancelDay(f: SubscriptionFinding): string | null {
  if (f.cancelled) return null;
  if (f.cancelBy) return f.cancelBy;
  if (f.trialEnd) return f.notice ? minusNotice(f.trialEnd, f.notice) : f.trialEnd;
  const end = termEndOf(f);
  if (end) return f.notice ? minusNotice(end, f.notice) : end;
  if (f.renewalDate) return f.notice ? minusNotice(f.renewalDate, f.notice) : addDays(f.renewalDate, -1);
  return null;
}

/** „1 Monat“, „6 Wochen“, „14 Tage“, „einen Monat“ → Frist. */
export function parseNotice(text: string): Notice | null {
  const words: Record<string, number> = { ein: 1, eine: 1, einen: 1, einem: 1, zwei: 2, drei: 3, vier: 4, sechs: 6, acht: 8, zwölf: 12 };
  const match = /(\d{1,2}|einen?|eine[mn]?|zwei|drei|vier|sechs|acht|zwölf)\s+(tage?n?|wochen?|monate?n?|days?|weeks?|months?)(?!\p{L})/iu.exec(text);
  if (!match) return null;
  const amount = Number(match[1]) || words[(match[1] ?? "").toLowerCase()] || 0;
  if (!amount) return null;
  const unit = /^(woche|week)/i.test(match[2] ?? "") ? "week" : /^(monat|month)/i.test(match[2] ?? "") ? "month" : "day";
  return { amount, unit };
}

// --- Regeln (ohne KI) ---

const trialCue = /(probemonat|probeabo|probe-abo|probezeit|probephase|testphase|testzeitraum|testmonat|gratis-monat|gratismonat|kostenlose[nr]? (probe|test)|free trial|\btrial\b)/i;
const subscriptionCue = /([a-zäöüß-]*abos?(?![a-zäöüß])|abonnement|mitgliedschaft|mitgliedsbeitrag|jahresbeitrag|jahresgebühr|vertrag|tarif|versicherung|subscription|renews|verlängert sich|verlängerung|laufzeit|kündigungsfrist|kündbar|grundpreis|abschlag|leseausweis|austritt)/i;
const cancelledCue = /(bestätigen (die|ihre|deine) kündigung|kündigung (ihres|deines|bestätigt)|ist gekündigt|kündigung wurde bestätigt|subscription (has been |was )?cancell?ed)/i;
// Werbung, Phishing, kostenlose Newsletter: kein Abo
// „19 % MwSt.“ in Rechnungen ist keine Werbung – Prozente nur mit Rabatt-Wörtern
const adCue = /(jetzt (abo |das abo )?(abschließen|abonnieren|bestellen|sichern|testen)|prämie sichern|angebot gültig|nur bis|\d+ ?% (rabatt|günstiger|sparen|off|discount)|spare?n? (bis zu )?\d+ ?%|statt \d|zum halben preis|upgrade now|subscribe now|jetzt upgraden)/i;
// Zeichen einer eigenen Beziehung (Rechnung, Kundennummer, „dein Abo“) – Werbung hat das in der Regel nicht
const ownRelationCue = /((ihr|ihre|ihres|dein|deine|deines|your)\s+(aktuelle[sn]?\s+)?(abo|abonnement|vertrag|vertrags|mitgliedschaft|tarif|subscription|membership|plan|zahlung|payment)|kundennummer|vertragsnummer|rechnungsnummer|mitgliedsnummer|invoice|receipt|quittung|abgebucht|charged|lastschrift|zahlungseingang|payment (received|confirmation|successful)|zahlungsbestätigung|verlängert sich|renews|will renew)/i;

/** Werbung für ein Abo (statt eines eigenen Abos)? Rabatt-/Kaufaufforderung ohne Zeichen einer eigenen Beziehung. */
export function looksLikeAd(text: string): boolean {
  return adCue.test(text) && !ownRelationCue.test(text);
}
const phishingCue = /((zahlungsdaten|zahlungsinformationen|kreditkartendaten|zahlungsmethode) .{0,30}(aktualisieren|bestätigen)|aktualisieren sie .{0,40}(zahlungs|konto|kreditkarte)|konto wird gelöscht|innerhalb von \d+ stunden)/i;
const freeNewsletterCue = /(kostenlosen newsletter|newsletter abonniert)/i;

const intervalCues: [BillingInterval, RegExp][] = [
  ["quarterly", /(vierteljährlich|pro quartal|quartalsweise|quarterly)/i],
  ["weekly", /(wöchentlich|pro woche|weekly|per week)/i],
  ["monthly", /(monatlich|monatliche[rnms]?|pro monat|im monat|je monat|\/\s?monat|mtl\.|per month|a month|\/month|monthly)/i],
  ["yearly", /(jährlich|pro jahr|im jahr|je jahr|jahresabo|jahresbeitrag|jahresgebühr|per year|a year|\/year|yearly|annual)/i],
];

// Deutsch („12,99 €“, „€ 1.200,00“) und Englisch („€9.98“, „9.98 EUR“)
const amountRe = /(\d{1,3}(?:\.\d{3})*,\d{2})\s?(?:€|eur\b)|€\s?(\d{1,3}(?:\.\d{3})*,\d{2})|€\s?(\d+\.\d{2})(?!\d)|(\d+\.\d{2})\s?(?:€|eur\b)/gi;

/** Gefundener Betrag einheitlich als „9,98 €“. */
function amountValue(match: RegExpMatchArray): string {
  const german = match[1] ?? match[2];
  if (german) return `${german} €`;
  return `${(match[3] ?? match[4] ?? "").replace(".", ",")} €`;
}

function sentences(text: string): string[] {
  // Satzende nach Buchstabe/€ – nicht nach Zahlen („bis 30.11. zum Jahresende“)
  return text.split(/(?<=[a-zäöüß)€])[.!?](?=\s)|\n/i).map((s) => s.trim()).filter(Boolean);
}

function intervalIn(text: string): BillingInterval | null {
  for (const [interval, cue] of intervalCues) if (cue.test(text)) return interval;
  return null;
}

/** Erstes Datum (fest, sonst relativ) in einem Satz. */
function dateIn(sentence: string, mailDate: Date): string | null {
  return explicitDates(sentence, mailDate)[0]?.date ?? relativeDates(sentence, mailDate)[0]?.date ?? null;
}

/**
 * „Das ist ein Abo“ ohne Fund: Eintrag aus dem, was sicher in der Mail steht (Absender, erster Betrag, Zahlweise).
 * Der Nutzer kann den Rest korrigieren.
 */
export function manualSubscription(subject: string, body: string, from: EmailAddress): SubscriptionFinding {
  const text = `${subject}\n${body}`;
  let amount: string | null = null;
  let interval: BillingInterval | null = null;
  for (const sentence of sentences(text)) {
    const match = [...sentence.matchAll(amountRe)][0];
    if (!match) continue;
    amount ??= amountValue(match);
    const found = intervalIn(sentence);
    if (found) {
      amount = amountValue(match);
      interval = found;
      break;
    }
  }
  return {
    kind: trialCue.test(text) ? "trial" : "subscription", provider: providerName(from), amount, interval: interval ?? intervalIn(text),
    startDate: null, minTermMonths: null, trialEnd: null, termEnd: null, renewalDate: null, cancelBy: null, notice: null, cancelled: false,
    quote: subject.slice(0, 200),
  };
}

// Vorfilter für das Modell: bewusst breiter als die Regeln – lieber eine Mail zu viel prüfen als ein Abo übersehen
const candidateCue = /(subscrib|billed|renew|membership|mitglied|grundgebühr|monatsbeitrag|beitrag|lastschrift|plan\b)/i;

/** Schneller Vorfilter: kann diese Mail überhaupt von einem Abo/Vertrag handeln? (entscheidet, was das Modell prüft) */
export function mightBeSubscription(text: string): boolean {
  return trialCue.test(text) || cancelledCue.test(text) || subscriptionCue.test(text) || candidateCue.test(text);
}

/** Anbieter: Anzeigename ohne Zusätze, sonst die Domain. */
export function providerName(from: EmailAddress): string {
  const name = (from.name ?? "").replace(/\s*[-–|]?\s*\b(kundenservice|kundendienst|leserservice|service|support|team|billing|noreply)\b\s*$/i, "").trim();
  if (name) return name.slice(0, 60);
  const domain = from.address.split("@")[1] ?? from.address;
  return domain.replace(/\.(example|de|com|net|org|io|eu)$/i, "").slice(0, 60);
}

/** Erkennung ohne KI. Bewusst vorsichtig: lieber kein Abo als ein falsches. */
export function ruleSubscription(subject: string, body: string, from: EmailAddress, mailDate: Date): SubscriptionFinding | null {
  const text = `${subject}\n${body}`;
  const isTrial = trialCue.test(text);
  const cancelled = cancelledCue.test(text);
  if (!isTrial && !cancelled && !subscriptionCue.test(text)) return null;
  if (adCue.test(text) || phishingCue.test(text) || freeNewsletterCue.test(text)) return null;
  const parts = sentences(text);

  // Betrag: bevorzugt im Satz mit Intervall („12,99 € pro Monat“); bei „statt“ der erste (neuer Preis)
  let amount: string | null = null;
  let interval: BillingInterval | null = null;
  for (const sentence of parts) {
    const match = [...sentence.matchAll(amountRe)][0];
    if (!match) continue;
    const value = amountValue(match);
    const sentenceInterval = intervalIn(sentence);
    if (sentenceInterval) {
      amount = value;
      interval = sentenceInterval;
      break;
    }
    if (!amount && subscriptionCue.test(sentence)) amount = value;
    if (!amount && /(betrag|beitrag|kostet|kosten|preis|charged|abgebucht|paid|amount|total|summe)/i.test(sentence)) amount = value;
  }
  interval ??= intervalIn(text);

  let trialEnd: string | null = null;
  let termEnd: string | null = null;
  let renewalDate: string | null = null;
  let cancelBy: string | null = null;
  let startDate: string | null = null;
  let minTermMonths: number | null = null;
  let notice: Notice | null = null;
  let quote = "";
  for (const sentence of parts) {
    const date = dateIn(sentence, mailDate);
    if (isTrial && !trialEnd && date && (trialCue.test(sentence) || /(endet|läuft bis|ends|danach)/i.test(sentence))) {
      trialEnd = date;
      quote ||= sentence;
      continue;
    }
    // „Austritte sind bis 30.11. möglich“ – direkt hinter „bis“ muss ein Datum stehen (nicht „bis 14 Tage vor …“)
    const by = /(austritte?|kündigung(en)?|kündigen)\s+(sind |ist |muss |bitte )?(bis|spätestens)\s+(zum\s+)?(\d{1,2}\.\s?(\d{1,2}\.(\d{2,4})?|[a-zä]{3,}\.?(\s+\d{4})?))/i.exec(sentence);
    if (!cancelBy && by?.[6]) cancelBy = explicitDates(by[6], mailDate)[0]?.date ?? null;
    if (!renewalDate && date && /(verlängert sich am|verlängerung (erfolgt )?am|renews on|will renew .{0,25}\bon\b|wird am .{0,20} verlängert)/i.test(sentence)) {
      renewalDate = date;
      quote ||= sentence;
    } else if (!termEnd && date && /(läuft (noch )?(bis|am)|endet am|ablauf:?\s|versicherungsjahr endet|bis zum \d)/i.test(sentence) && !/(verlängert sich am)/i.test(sentence)) {
      termEnd = date;
      quote ||= sentence;
    }
    if (!startDate && /(vertragsbeginn|lieferbeginn|versicherungsbeginn|beginnt am|beginn:)/i.test(sentence)) startDate = explicitDates(sentence, mailDate)[0]?.date ?? null;
    const term = /(mindestlaufzeit|erstlaufzeit|laufzeit|läuft)\s*:?\s*(\d{1,2})\s*monate/i.exec(sentence);
    if (!minTermMonths && term) minTermMonths = Number(term[2]);
    if (!notice && /(kündig|frist|ablauf|vorher|austritt|cancel)/i.test(sentence)) {
      const n = /(\d{1,2}|einen?|eine[mn]?|zwei|drei|vier|sechs|acht|zwölf)\s+(tage?n?|wochen?|monate?n?)\s*(vor|vorher|zum)/i.exec(sentence);
      if (n) notice = parseNotice(n[0]);
    }
  }
  // Ein Termin-/Fristende in der Kündigungsbestätigung ist das Abo-Ende, kein Kündigungstermin
  if (!amount && !trialEnd && !termEnd && !renewalDate && !cancelBy && !cancelled && !(startDate && minTermMonths)) return null;
  if (!cancelled && !amount && !trialEnd && !renewalDate && !cancelBy && !interval) return null;

  const kind: SubscriptionKind =
    isTrial && !cancelled && (trialEnd || /(probe|test|gratis|trial)/i.test(text)) ? "trial"
    : /(versicherung|insurance)/i.test(`${text} ${from.name ?? ""}`) ? "insurance"
    : /(mitglied|verein|leseausweis|club)/i.test(`${text} ${from.name ?? ""}`) ? "membership"
    : /(vertrag|tarif|liefer|dsl)/i.test(text) && !/[a-zäöüß-]*abos?(?![a-zäöüß])|abonnement|subscription/i.test(text) ? "contract"
    : "subscription";
  return {
    kind,
    provider: providerName(from),
    amount,
    interval,
    startDate,
    minTermMonths,
    trialEnd,
    termEnd,
    renewalDate,
    cancelBy,
    notice,
    cancelled,
    quote: (quote || parts.find((p) => subscriptionCue.test(p) || trialCue.test(p)) || subject).slice(0, 200),
  };
}

// --- Modell ---

export const subscriptionPromptVersion = 1;

export const subscriptionSchema: JsonSchema = {
  type: "object",
  properties: {
    isSubscription: { type: "boolean" },
    kind: { type: "string", enum: [...subscriptionKinds] },
    provider: { type: "string", maxLength: 60 },
    amount: { type: "string", maxLength: 30 },
    interval: { type: "string", enum: [...billingIntervals, ""] },
    startDate: { type: "string", maxLength: 10 },
    minTermMonths: { type: "number" },
    trialEnd: { type: "string", maxLength: 10 },
    termEnd: { type: "string", maxLength: 10 },
    renewalDate: { type: "string", maxLength: 10 },
    cancelBy: { type: "string", maxLength: 10 },
    notice: { type: "string", maxLength: 30 },
    cancelled: { type: "boolean" },
    quote: { type: "string", maxLength: 200 },
  },
  required: ["isSubscription", "kind", "provider", "amount", "interval", "startDate", "minTermMonths", "trialEnd", "termEnd", "renewalDate", "cancelBy", "notice", "cancelled", "quote"],
  additionalProperties: false,
};

const weekdays = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export function subscriptionPrompt(mail: string, mailDate: Date): AIMessage[] {
  return [
    {
      role: "system",
      content: `Du prüfst, ob eine E-Mail ein Abo oder einen Vertrag des Empfängers betrifft (Streaming, Mobilfunk, Strom, Fitness, Versicherung, Software, Zeitschrift, Mitgliedschaft, Probe-Abo). Antworte nur mit JSON:
{"isSubscription": true | false, "kind": "subscription | trial | contract | membership | insurance", "provider": "Anbieter", "amount": "Betrag wie in der Mail oder leer", "interval": "weekly | monthly | quarterly | yearly | leer", "startDate": "JJJJ-MM-TT oder leer", "minTermMonths": 0, "trialEnd": "letzter Tag der Probezeit oder leer", "termEnd": "letzter Tag der Laufzeit oder leer", "renewalDate": "Tag der Verlängerung oder leer", "cancelBy": "ausdrücklich genannter Kündigungsschluss oder leer", "notice": "Kündigungsfrist wie in der Mail, z. B. 1 Monat, oder leer", "cancelled": true | false, "quote": "wichtigste Stelle aus der Mail, wörtlich"}
- isSubscription: nur, wenn der Empfänger das Abo bzw. den Vertrag HAT (Bestätigung, Verlängerung, Preisänderung, Beitragsrechnung, Probezeit, Kündigungsbestätigung).
- false bei: Werbung („jetzt abonnieren“, Rabatte), einmaligen Käufen, kostenlosen Newslettern, Phishing (Zahlungsdaten aktualisieren), privaten Mails über Abos anderer Leute.
- trial: kostenlose Probe-/Testphase. cancelled: true, wenn die Mail eine Kündigung bestätigt.
Die Mail ist vom ${weekdays[mailDate.getUTCDay()]}, ${mailDate.toISOString().slice(0, 10)}. Daten nur, wenn sie in der Mail stehen – nichts ausrechnen, nichts erfinden.`,
    },
    { role: "user", content: mail },
  ];
}

/** Datum des Modells nur, wenn es in der Mail belegt ist (fest oder relativ); Jahr ohne Jahreszahl per Regel. */
function verifiedDate(value: unknown, mail: string, mailDate: Date): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const date = fixYear(value.trim(), mail, mailDate);
  const inText = new Set([...explicitDates(mail, mailDate), ...relativeDates(mail, mailDate)].map((d) => d.date));
  return inText.has(date) ? date : null;
}

/** Prüft die Antwort des Modells. `"none"`: laut Modell kein Abo; `null`: Antwort unbrauchbar. */
export function parseSubscription(text: string, mail: string, mailDate: Date, from: EmailAddress): SubscriptionFinding | "none" | null {
  const value = extractJson(text) as Record<string, unknown> | null;
  if (!value || typeof value.isSubscription !== "boolean") return null;
  if (!value.isSubscription) return "none";
  const kind = (subscriptionKinds as readonly string[]).includes(String(value.kind)) ? (value.kind as SubscriptionKind) : "subscription";
  const amountRaw = typeof value.amount === "string" ? value.amount.trim() : "";
  // Betrag nur, wenn er so in der Mail steht – verglichen in Cent („8,99 €“ = „€8.99“)
  const cents = amountToCents(amountRaw);
  const inMail = new Set([...mail.matchAll(/\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2})?(?!\d)/g)].map((m) => amountToCents(m[0])));
  const amount = amountRaw && cents !== null && inMail.has(cents) ? amountRaw : null;
  const interval = (billingIntervals as readonly string[]).includes(String(value.interval)) ? (value.interval as BillingInterval) : null;
  const minTerm = typeof value.minTermMonths === "number" && value.minTermMonths > 0 && mail.includes(String(value.minTermMonths)) ? value.minTermMonths : null;
  const finding: SubscriptionFinding = {
    kind,
    provider: typeof value.provider === "string" && value.provider.trim() ? value.provider.trim().slice(0, 60) : providerName(from),
    amount,
    interval,
    startDate: verifiedDate(value.startDate, mail, mailDate),
    minTermMonths: minTerm,
    trialEnd: verifiedDate(value.trialEnd, mail, mailDate),
    termEnd: verifiedDate(value.termEnd, mail, mailDate),
    renewalDate: verifiedDate(value.renewalDate, mail, mailDate),
    cancelBy: verifiedDate(value.cancelBy, mail, mailDate),
    notice: typeof value.notice === "string" ? parseNotice(value.notice) : null,
    cancelled: value.cancelled === true,
    quote: typeof value.quote === "string" ? value.quote.trim().slice(0, 200) : "",
  };
  // Ohne jede belegte Angabe ist es keine brauchbare Erkennung
  if (!finding.cancelled && !finding.amount && !finding.trialEnd && !finding.termEnd && !finding.renewalDate && !finding.cancelBy && !finding.interval) return "none";
  return finding;
}

/** Regeln und Modell zusammen: Das Modell entscheidet, OB es ein Abo ist; belegte Angaben der Regeln gehen vor. */
export function mergeFindings(model: SubscriptionFinding, rules: SubscriptionFinding | null): SubscriptionFinding {
  if (!rules) return model;
  return {
    // Art: Probe-Abo, wenn eins von beiden es sagt; sonst die genauere Art der Regeln (Versicherung, Mitgliedschaft …)
    kind: model.kind === "trial" || rules.kind === "trial" ? (model.cancelled || rules.cancelled ? rules.kind : "trial") : rules.kind !== "subscription" ? rules.kind : model.kind,
    provider: rules.provider || model.provider,
    amount: rules.amount ?? model.amount,
    interval: rules.interval ?? model.interval,
    startDate: rules.startDate ?? model.startDate,
    minTermMonths: rules.minTermMonths ?? model.minTermMonths,
    trialEnd: rules.trialEnd ?? model.trialEnd,
    termEnd: rules.termEnd ?? model.termEnd,
    renewalDate: rules.renewalDate ?? model.renewalDate,
    cancelBy: rules.cancelBy ?? model.cancelBy,
    notice: rules.notice ?? model.notice,
    cancelled: rules.cancelled || model.cancelled,
    quote: model.quote || rules.quote,
  };
}

export interface SubscriptionResult {
  finding: SubscriptionFinding | null;
  origin: ResultOrigin;
  providerId: string | null;
  durationMs: number;
}

/** Abo-Erkennung einer Mail: Modell (mit Belegprüfung) plus Regeln; ohne brauchbare Modell-Antwort nur Regeln. */
/** Mailtext für die Abo-Erkennung: bereinigter Text plus Text aus Anhängen (Rechnung als PDF). */
export function subscriptionMailText(bodyText: string, attachmentText = ""): string {
  const extra = attachmentText.replace(/\s+/g, " ").trim();
  if (!extra) return cleanMailText(bodyText, 2000);
  return `${cleanMailText(bodyText, 2000)}\n\nAnhang:\n${truncate(extra, inputBudget.attachment)}`;
}

export async function extractSubscription(
  router: AIRouter,
  message: Message,
  options: { signal?: AbortSignal; attachmentText?: string } = {},
): Promise<SubscriptionResult> {
  const body = subscriptionMailText(message.bodyText ?? message.snippet, options.attachmentText);
  const mailDate = new Date(message.date);
  const mail = `Von: ${message.from.name ?? ""} <${message.from.address}>\nBetreff: ${message.subject}\n\n${body}`;
  const rules = ruleSubscription(message.subject, body, message.from, mailDate);
  const request: AIRequest = { task: "extractSubscription", messages: subscriptionPrompt(mail, mailDate), jsonSchema: subscriptionSchema, maxTokens: 350, temperature: 0 };
  let durationMs = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await router.run(request, { accountIds: [message.accountId] }, options.signal);
    durationMs += response.durationMs;
    const parsed = parseSubscription(response.text, mail, mailDate, message.from);
    if (parsed === "none") return { finding: null, origin: response.privacyClass, providerId: response.providerId, durationMs };
    // Werbung für ein Abo (Rabatt, Kaufaufforderung, ohne Rechnung/Kundennummer) ist kein eigenes Abo
    if (parsed && !rules && message.category !== "invoice" && looksLikeAd(`${message.subject}\n${body}`)) {
      return { finding: null, origin: response.privacyClass, providerId: response.providerId, durationMs };
    }
    if (parsed) return { finding: mergeFindings(parsed, rules), origin: response.privacyClass, providerId: response.providerId, durationMs };
  }
  return { finding: rules, origin: "rules", providerId: null, durationMs };
}
