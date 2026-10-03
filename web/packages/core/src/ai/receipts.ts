import type { EmailAddress, Message } from "../models.js";
import { explicitDates } from "./actions.js";
import { receiptCategoryDefaults } from "./evalReceipts.js";
import { cleanMailText, inputBudget, truncate } from "./prepare.js";
import type { AIRouter } from "./router.js";
import { providerName } from "./subscriptions.js";
import { extractJson, type ResultOrigin } from "./tasks.js";
import type { AIMessage, AIRequest, JsonSchema } from "./types.js";

// Belegordner (W7.2): Muster wie bei Aktionen und Abos – KI erkennt, Code prüft im Originaltext, Nutzer bestätigt.
// Was der Code nicht im Text wiederfindet, bleibt drin, wird aber als „bitte prüfen“ markiert (Spezifikation 7.1).

export { receiptCategoryDefaults };

export interface ReceiptFinding {
  merchant: string;
  /** Rechnungs-/Belegdatum (YYYY-MM-DD), sonst Datum der Mail */
  date: string;
  grossCents: number | null;
  netCents: number | null;
  vatCents: number | null;
  invoiceNumber: string | null;
  dueDate: string | null;
  /** Vorschlag (aus der Liste der Belegkategorien) */
  category: string | null;
  quote: string;
  /** Gründe für „bitte prüfen“ (leer = alles im Text gefunden und stimmig) */
  review: string[];
}

// --- Beträge ---

/** Beträge mit Währung: „1.299,00 €“, „€ 59,00“, „€59.00“, „EUR 549.00“, „87.66 EUR“. Index = Position im Text. */
export function amountsIn(text: string): { cents: number; index: number; end: number }[] {
  const out: { cents: number; index: number; end: number }[] = [];
  const re = /(?:(?:€|eur\b)\s?(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2})?)|(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2})?)\s?(?:€|eur\b|euro\b))/gi;
  for (const match of text.matchAll(re)) {
    const raw = match[1] ?? match[2] ?? "";
    const cents = parseAmount(raw);
    if (cents !== null) out.push({ cents, index: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return out;
}

/** „1.299,00“ / „1,299.00“ / „59.00“ / „48“ → Cent. Das letzte Trennzeichen mit genau zwei Ziffern dahinter ist das Komma. */
export function parseAmount(raw: string): number | null {
  const clean = raw.replace(/\s/g, "");
  const decimal = /[.,](\d{2})$/.exec(clean);
  const whole = (decimal ? clean.slice(0, -3) : clean).replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole)) return null;
  return Number(whole) * 100 + (decimal ? Number(decimal[1]) : 0);
}

/** Kommt dieser Betrag (in Cent) im Text vor – egal in welcher Schreibweise? */
export function amountInText(cents: number, text: string): boolean {
  return amountsIn(text).some((a) => a.cents === cents) || plainNumbers(text).includes(cents);
}

/** Zahlen ohne Währungszeichen („Netto 900,00“) */
function plainNumbers(text: string): number[] {
  return [...text.matchAll(/(?<![\d.,])(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})(?![\d])/g)].map((m) => parseAmount(m[1] ?? "") ?? -1);
}

const grossCue = /(gesamtbetrag|rechnungsbetrag|gesamtsumme|endbetrag|bruttobetrag|brutto|zu zahlen|total( paid| charged| amount)?|amount paid|summe|gesamt|jahresbeitrag|beitrag von|fahrpreis|preis:?|zahlung (über|von)|spende (über|in höhe von)|in höhe von|betrag von)\b/i;
const strongGrossCue = /(gesamtbetrag|rechnungsbetrag|gesamtsumme|endbetrag|bruttobetrag|brutto|total( paid| charged| amount)?|amount paid|summe|gesamt)\b/i;
const netCue = /(nettobetrag|netto|net amount|zwischensumme netto)\b/i;
const vatCue = /(mwst\.?|ust\.?|umsatzsteuer|mehrwertsteuer|vat)\b/i;
const notGross = /(zwischensumme|abschläge?|nachzahlung|guthaben|trinkgeld|versand|mindestbestellwert|kontostand|à\s*$|je\s*$|ab\s*$|statt\s*$)/i;

/** Betrag direkt hinter (oder kurz vor) einem Stichwort – ohne Prozentangaben dazwischen mitzuzählen. */
function amountAfter(text: string, cue: RegExp, amounts: ReturnType<typeof amountsIn>, maxGap = 30): { cents: number; index: number } | null {
  const global = new RegExp(cue.source, "gi");
  let best: { cents: number; index: number } | null = null;
  for (const match of text.matchAll(global)) {
    const end = (match.index ?? 0) + match[0].length;
    const next = amounts.find((a) => a.index >= end && a.index - end <= maxGap && !/[a-zäöü]{4,}/i.test(text.slice(end, a.index).replace(/(mwst|ust|vat|inkl|zzgl|eur|euro)\.?/gi, "")));
    if (next) best = { cents: next.cents, index: next.index }; // das letzte Vorkommen gewinnt („Zwischensumme … Gesamtbetrag“)
  }
  return best;
}

/** Betrag direkt vor einem Stichwort („228,00 € netto“) */
function amountBefore(text: string, cue: RegExp, amounts: ReturnType<typeof amountsIn>): number | null {
  const global = new RegExp(cue.source, "gi");
  for (const match of text.matchAll(global)) {
    const start = match.index ?? 0;
    const prev = [...amounts].reverse().find((a) => a.end <= start && start - a.end <= 3);
    if (prev) return prev.cents;
  }
  return null;
}

/** Netto-, MwSt.- und Bruttobetrag aus dem Text (nur, was dasteht). */
export function receiptAmounts(text: string): { gross: number | null; net: number | null; vat: number | null; strong: boolean } {
  const amounts = amountsIn(text).filter((a) => !notGross.test(text.slice(Math.max(0, a.index - 22), a.index)) || strongGrossCue.test(text.slice(Math.max(0, a.index - 22), a.index)));
  const all = amountsIn(text);
  const strong = amountAfter(text, strongGrossCue, all);
  const weak = strong ? null : amountAfter(text, grossCue, amounts);
  let gross = strong?.cents ?? weak?.cents ?? null;
  if (gross === null && amounts.length === 1) gross = amounts[0]?.cents ?? null;
  // MwSt.: „19 % MwSt. 207,40 €“, „MwSt 19 % 171,00 €“, „VAT (19%): €9.42“; nur Prozent („inkl. 19 % MwSt.“) zählt nicht
  const vatMatch = amountAfter(text.replace(/\(?\d{1,2}\s?%\)?:?/g, (m) => " ".repeat(m.length)), vatCue, all, 12);
  const vat = vatMatch && vatMatch.cents !== gross ? vatMatch.cents : null;
  const net = amountAfter(text, netCue, all, 15)?.cents ?? amountBefore(text, /netto\b/i, all);
  return { gross, net: net !== gross ? net : null, vat, strong: !!strong };
}

// --- Daten ---

/** „23/09/2026“ (englische Rechnungen) zusätzlich zu den deutschen/englischen Schreibweisen der Aktionen. */
function datesIn(text: string, mailDate: Date): { date: string; index: number }[] {
  const out = explicitDates(text, mailDate);
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const month = Number(m[2]);
    const dayOfMonth = Number(m[3]);
    if (month >= 1 && month <= 12 && dayOfMonth >= 1 && dayOfMonth <= 31) out.push({ date: `${m[1]}-${m[2]}-${m[3]}`, index: m.index ?? 0 });
  }
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) out.push({ date: `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, index: m.index ?? 0 });
  }
  return out.sort((a, b) => a.index - b.index);
}

const invoiceDateCue = /(rechnungsdatum|belegdatum|invoice date|datum:?|\bvom\b|einkauf am|fahrt am|kauf am|spende .{0,40}?\bam\b|eingang .{0,60}?\bam\b|order #?\S+ on|\bon\b)/gi;
const dueCue = /(zahlbar bis|zahlungsziel:?\s*(bis)?|fällig (am|bis)|wird am|überweisen sie .{0,40}?bis( zum)?|bis zum|payment due( by)?|due (date|by)|fällig zum)/gi;

function dateAfter(text: string, cue: RegExp, dates: { date: string; index: number }[], maxGap = 25): string | null {
  for (const match of text.matchAll(cue)) {
    const end = (match.index ?? 0) + match[0].length;
    const next = dates.find((d) => d.index >= end && d.index - end <= maxGap);
    if (next) return next.date;
  }
  return null;
}

// --- Erkennen ---

const receiptCue = /(rechnung|quittung|kassenbon|kassenbeleg|beleg\b|bestellbestätigung|bestellung .{0,20}vom|zahlungsbestätigung|zahlung .{0,30}erhalten|zuwendungsbestätigung|spende|beitragsrechnung|abrechnung|invoice|receipt|order confirmation|payment (received|confirmation)|total paid|amount paid|fahrtquittung)/i;
const notReceipt = /(angebot gilt|unverbindliches angebot|bieten wir ihnen an|kostenvoranschlag|schätzen wir|storniert|stornierung|nichts berechnet|kontoauszug|fehlen uns noch die belege|jetzt shoppen|nur bis|mindestbestellwert|sparen|% rabatt|\bcode\b [A-Z0-9]{4,})/i;
const phishingCue = /(innerhalb von \d+ stunden|wird gesperrt|konto wird gesperrt|über den folgenden link|klicken sie hier)/i;

const categoryRules: [string, RegExp][] = [
  ["Spenden", /(spende|zuwendungsbestätigung|spendenquittung)/i],
  ["Gesundheit", /(apotheke|arzt|ärztin|zahnarzt|zahnreinigung|praxis|optiker|brille|gleitsicht|physiotherap|klinik)/i],
  ["Versicherungen", /(versicherung|beitragsrechnung|versicherungsschein|police)/i],
  ["Fahrtkosten & Reisen", /(bahn|fahrkarte|ticket|taxi|fahrt\b|flug|mietwagen|rental|hotel|tankstelle|parkhaus)/i],
  ["Handwerker & Dienstleistungen", /(wartung|handwerk|maler|elektriker|installateur|reparatur|gartenpflege|heizung|reinigungs(firma|kraft)|umzug|schornstein)/i],
  ["Arbeitsmittel", /(notebook|laptop|monitor|drucker|patrone|toner|software|lizenz|license|büro|schreibtisch|desk|chair|headset|tastatur)/i],
  ["Haushalt & Einkauf", /(strom|gas\b|wasser|abrechnung|möbel|lampe|baumarkt|akkuschrauber|haushalt|lebensmittel|supermarkt)/i],
];

/** Kategorie-Vorschlag per Stichwort (Absendername zählt mit). */
export function ruleReceiptCategory(text: string, from: EmailAddress): string | null {
  const all = `${from.name ?? ""} ${text}`;
  return categoryRules.find(([, re]) => re.test(all))?.[0] ?? null;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Erkennung ohne KI: nur, wenn es nach Beleg aussieht und ein Betrag dasteht. */
export function ruleReceipt(subject: string, body: string, from: EmailAddress, mailDate: Date): ReceiptFinding | null {
  const text = `${subject}\n${body}`;
  if (!receiptCue.test(text) || notReceipt.test(text) || phishingCue.test(text)) return null;
  const { gross, net, vat } = receiptAmounts(text);
  if (gross === null) return null;
  const dates = datesIn(text, mailDate);
  const mailDay = iso(mailDate);
  // Rechnungsdatum: nach einem Stichwort, nicht in der Zukunft (sonst ist es Reise-/Liefer-/Fälligkeitsdatum)
  let date: string | null = null;
  for (const match of text.matchAll(invoiceDateCue)) {
    const end = (match.index ?? 0) + match[0].length;
    const next = dates.find((d) => d.index >= end && d.index - end <= 25 && d.date <= mailDay);
    if (next) {
      date = next.date;
      break;
    }
  }
  const later = dates.filter((d) => d.date >= (date ?? mailDay));
  // „… am 01.11.2026 fällig“ / „… am 02.01.2027 abgebucht“: Stichwort hinter dem Datum
  let dueDate = dateAfter(text, dueCue, later) ?? later.find((d) => /^[^\n]{6,18}?\s(fällig|abgebucht|eingezogen)\b/i.test(text.slice(d.index, d.index + 34)))?.date ?? null;
  const days = /(innerhalb von|zahlungsziel:?)\s*(\d{1,3})\s*tag/i.exec(text);
  if (!dueDate && days) {
    const base = new Date(`${date ?? mailDay}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + Number(days[2]));
    dueDate = iso(base);
  }
  const number = /(rechnungs?\s?(?:nummer|-?nr\.?)|rechnung(?: nr\.?)?|re-?nr\.?|invoice(?: no\.?| number| #)?|receipt no\.?|order\s?#|bestellung|bestellnummer|beleg-?nr\.?|\bnr\.)\s*:?\s*#?([A-Z0-9][A-Z0-9\-/]*\d[A-Z0-9\-/]*)/i.exec(text);
  const invoiceNumber = number?.[2] && number[2].length >= 4 && !/^\d{1,2}\.\d{1,2}/.test(number[2]) ? number[2].replace(/[.,]$/, "") : null;
  const review: string[] = [];
  if (net !== null && vat !== null && Math.abs(net + vat - gross) > 1) review.push("Netto + MwSt. ergibt nicht den Gesamtbetrag");
  const sentence = text.split(/(?<=[a-zäöüß)€])[.!?](?=\s)|\n/i).find((s) => amountInText(gross, s)) ?? subject;
  return {
    merchant: providerName(from),
    date: date ?? mailDay,
    grossCents: gross,
    netCents: net,
    vatCents: vat,
    invoiceNumber,
    dueDate,
    category: ruleReceiptCategory(text, from),
    quote: truncate(sentence.trim(), 200),
    review,
  };
}

/** Vorfilter für das Modell: breiter als die Regeln. */
export function mightBeReceipt(text: string): boolean {
  return receiptCue.test(text) && !phishingCue.test(text);
}

// --- Modell ---

export const receiptPromptVersion = 1;

export function receiptSchema(categories: readonly string[]): JsonSchema {
  return {
    type: "object",
    properties: {
      istBeleg: { type: "boolean" },
      haendler: { type: "string", maxLength: 60 },
      datum: { type: "string" },
      brutto: { type: "string" },
      netto: { type: "string" },
      mwst: { type: "string" },
      rechnungsnummer: { type: "string", maxLength: 40 },
      zahlungsfrist: { type: "string" },
      kategorie: { type: "string", enum: [...categories, ""] },
    },
    required: ["istBeleg", "haendler", "datum", "brutto", "netto", "mwst", "rechnungsnummer", "zahlungsfrist", "kategorie"],
    additionalProperties: false,
  };
}

export function receiptPrompt(mail: string, mailDate: Date, categories: readonly string[]): AIMessage[] {
  return [
    {
      role: "system",
      content: `Du prüfst, ob eine E-Mail (mit Anhang) ein Beleg ist: Rechnung, Quittung, Kassenbon, Bestellbestätigung mit Preis, Zahlungsbestätigung, Spendenbestätigung oder Beitragsrechnung.
Kein Beleg: Angebote, Kostenvoranschläge, Werbung, Stornos, Kontoauszüge, Versandinfos ohne Preis, private Nachrichten, Zahlungsaufforderungen mit Drohung oder Link (Betrug).
Die Mail ist vom ${iso(mailDate)}. Übernimm nur, was dasteht – nichts ausrechnen oder erfinden; fehlt etwas, leerer Text.
- datum: Rechnungs- oder Belegdatum als JJJJ-MM-TT (nicht Reise-, Liefer- oder Fälligkeitsdatum)
- brutto: Gesamtbetrag wie im Text (z. B. "1.299,00 €"); netto und mwst nur, wenn sie als Betrag dastehen
- zahlungsfrist: "zahlbar bis"/"fällig am" als JJJJ-MM-TT
- kategorie: eine aus der Liste, sonst leer: ${categories.join(", ")}
Antworte nur mit JSON.`,
    },
    { role: "user", content: mail },
  ];
}

const documentWord = /^(die |eine? )?(rechnung|quittung|kassenbon|kassenbeleg|beleg|bestellbestätigung|zahlungsbestätigung|spendenbestätigung|zuwendungsbestätigung|beitragsrechnung|beitragsbestätigung|fahrtquittung|abrechnung|receipt|invoice|order)\b/i;

function isoOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

/**
 * Antwort lesen und gegen den Text prüfen. „none“ = laut Modell kein Beleg, `null` = unbrauchbar.
 * Beträge/Daten, die nicht im Text stehen, bleiben, landen aber in `review`.
 */
export function parseReceipt(text: string, mail: string, mailDate: Date, from: EmailAddress, categories: readonly string[]): ReceiptFinding | "none" | null {
  const value = extractJson(text) as Record<string, unknown> | null;
  if (!value || typeof value.istBeleg !== "boolean") return null;
  if (!value.istBeleg) return "none";
  const review: string[] = [];
  const money = (field: unknown, label: string): number | null => {
    if (typeof field !== "string" || !field.trim() || /%/.test(field)) return null; // „19 %“ ist ein Satz, kein Betrag
    const cents = amountsIn(field)[0]?.cents ?? parseAmount(field.replace(/[^\d.,]/g, ""));
    if (cents === null || cents === 0) return null;
    if (!amountInText(cents, mail)) review.push(`${label} steht so nicht in der Mail`);
    return cents;
  };
  const gross = money(value.brutto, "Betrag");
  // Netto und MwSt. nur, wenn sie als Betrag dastehen – ausgerechnete Werte fallen weg (statt „bitte prüfen“)
  const inText = (field: unknown) => {
    const cents = typeof field === "string" && !/%/.test(field) ? (amountsIn(field)[0]?.cents ?? parseAmount(field.replace(/[^\d.,]/g, ""))) : null;
    return cents && amountInText(cents, mail) ? cents : null;
  };
  const net = inText(value.netto);
  const vat = inText(value.mwst);
  const dateText = (d: string) => datesIn(mail, mailDate).some((x) => x.date === d);
  let date = isoOrNull(value.datum);
  if (date && !dateText(date) && date !== iso(mailDate)) {
    review.push("Datum steht so nicht in der Mail");
  }
  date ??= iso(mailDate);
  let due = isoOrNull(value.zahlungsfrist);
  if (due && !dateText(due)) due = null; // ausgedachte Frist: weglassen (die Regeln rechnen „innerhalb von 14 Tagen“)
  // Händler: muss im Absender oder in der Mail stehen und darf keine Dokumentart sein („Rechnung“, „Kassenbon“)
  const named = typeof value.haendler === "string" ? value.haendler.trim().slice(0, 60) : "";
  const plausible = named.length >= 2 && !documentWord.test(named) && `${from.name ?? ""} ${from.address} ${mail}`.toLowerCase().includes(named.toLowerCase());
  const merchant = plausible ? named : providerName(from);
  const number = typeof value.rechnungsnummer === "string" && value.rechnungsnummer.trim() && mail.includes(value.rechnungsnummer.trim()) ? value.rechnungsnummer.trim() : null;
  const category = typeof value.kategorie === "string" && categories.includes(value.kategorie) ? value.kategorie : null;
  if (gross === null) review.push("Kein Betrag gefunden");
  if (gross !== null && net !== null && vat !== null && Math.abs(net + vat - gross) > 1) review.push("Netto + MwSt. ergibt nicht den Gesamtbetrag");
  const sentence = gross !== null ? mail.split(/(?<=[a-zäöüß)€])[.!?](?=\s)|\n/i).find((s) => amountInText(gross, s)) : undefined;
  return { merchant, date, grossCents: gross, netCents: net, vatCents: vat, invoiceNumber: number, dueDate: due, category, quote: truncate((sentence ?? "").trim(), 200), review };
}

/** Modell + Regeln zusammenführen: was die Regeln sicher im Text gefunden haben, gewinnt. */
export function mergeReceipts(model: ReceiptFinding, rules: ReceiptFinding | null, strongRules: boolean, mailDay: string): ReceiptFinding {
  if (!rules) return model;
  const gross = strongRules || model.grossCents === null || model.review.some((r) => r.startsWith("Betrag")) ? rules.grossCents : model.grossCents;
  // Datum: von den Regeln hinter einem Stichwort gefunden (Rechnungsdatum, „vom“) ist sicherer als die Wahl des Modells
  const date = rules.date !== mailDay || model.review.some((r) => r.startsWith("Datum")) ? rules.date : model.date;
  const merged: ReceiptFinding = {
    merchant: model.merchant || rules.merchant,
    date,
    grossCents: gross,
    netCents: rules.netCents ?? model.netCents,
    vatCents: rules.vatCents ?? model.vatCents,
    invoiceNumber: rules.invoiceNumber ?? model.invoiceNumber,
    dueDate: rules.dueDate ?? model.dueDate,
    category: rules.category ?? model.category,
    quote: rules.quote || model.quote,
    review: [],
  };
  // Prüfung neu: nur, was nach dem Zusammenführen noch offen ist
  if (merged.grossCents === null) merged.review.push("Kein Betrag gefunden");
  if (merged.netCents !== null && merged.vatCents !== null && merged.grossCents !== null && Math.abs(merged.netCents + merged.vatCents - merged.grossCents) > 1) {
    merged.review.push("Netto + MwSt. ergibt nicht den Gesamtbetrag");
  }
  for (const reason of model.review) if (!reason.startsWith("Betrag") && !reason.startsWith("Datum") && !merged.review.includes(reason) && reason !== "Kein Betrag gefunden") merged.review.push(reason);
  return merged;
}

/** Mailtext für Belege: bereinigter Text plus Anhang (Rechnung als PDF). */
export function receiptMailText(bodyText: string, attachmentText = ""): string {
  const extra = attachmentText.replace(/\s+/g, " ").trim();
  if (!extra) return cleanMailText(bodyText, 2000);
  return `${cleanMailText(bodyText, 2000)}\n\nAnhang:\n${truncate(extra, inputBudget.attachment)}`;
}

export interface ReceiptResult {
  finding: ReceiptFinding | null;
  origin: ResultOrigin;
  durationMs: number;
}

/** Beleg-Erkennung einer Mail: Modell (mit Prüfung im Text) plus Regeln; ohne brauchbare Modell-Antwort nur Regeln. */
export async function extractReceipt(
  router: AIRouter,
  message: Message,
  options: { signal?: AbortSignal; attachmentText?: string; categories?: readonly string[] } = {},
): Promise<ReceiptResult> {
  const categories = options.categories ?? receiptCategoryDefaults;
  const body = receiptMailText(message.bodyText ?? message.snippet, options.attachmentText);
  const mailDate = new Date(message.date);
  const mail = `Von: ${message.from.name ?? ""} <${message.from.address}>\nBetreff: ${message.subject}\n\n${body}`;
  const text = `${message.subject}\n${body}`;
  const rules = ruleReceipt(message.subject, body, message.from, mailDate);
  const strong = receiptAmounts(text).strong;
  const request: AIRequest = { task: "extractReceipt", messages: receiptPrompt(mail, mailDate, categories), jsonSchema: receiptSchema(categories), maxTokens: 260, temperature: 0 };
  let durationMs = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await router.run(request, { accountIds: [message.accountId] }, options.signal);
    durationMs += response.durationMs;
    const parsed = parseReceipt(response.text, mail, mailDate, message.from, categories);
    if (parsed === "none") {
      // Regeln sind sich sicher (Beleg-Wort und klarer Gesamtbetrag): lieber behalten und prüfen lassen als verlieren
      if (rules && strong) return { finding: { ...rules, review: [...rules.review, "Die KI hält das für keinen Beleg"] }, origin: response.privacyClass, durationMs };
      return { finding: null, origin: response.privacyClass, durationMs };
    }
    if (parsed) return { finding: mergeReceipts(parsed, rules, strong, iso(mailDate)), origin: response.privacyClass, durationMs };
  }
  return { finding: rules, origin: "rules", durationMs };
}
