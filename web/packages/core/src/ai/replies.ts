import type { EmailAddress, Message } from "../models.js";
import { cleanMailText } from "./prepare.js";
import type { AIRouter } from "./router.js";
import { extractJson } from "./tasks.js";
import type { AIMessage, AIRequest, JsonSchema, PrivacyClass } from "./types.js";

// Antwortvorschläge (W6.5): 2–3 kurze Varianten zur letzten Mail. Für ein ~3B-Modell bewusst klein gehalten:
// Das Modell schreibt nur den Kern der Antwort. Anrede (du/Sie) und Gruß kommen aus Regeln bzw. der Signatur.
// Nichts wird ohne den Nutzer verschickt – ein Vorschlag öffnet nur den Antwort-Editor.

export const repliesPromptVersion = 2;

export type AddressForm = "du" | "Sie";

/** Richtung der Antwort – feste Plätze, damit auch ein kleines Modell mehrere Varianten liefert. */
export const replyKinds = ["agree", "decline", "ask"] as const;
export type ReplyKind = (typeof replyKinds)[number];

export interface ReplyVariant {
  kind: ReplyKind;
  /** Deutsche Kurzbezeichnung (die Oberfläche übersetzt `kind`) */
  label: string;
  /** Antworttext ohne Anrede und ohne Gruß */
  text: string;
}

export interface ReplyDrafts {
  form: AddressForm;
  /** z. B. „Hallo Tom,“ */
  greeting: string;
  replies: ReplyVariant[];
  origin: PrivacyClass;
  providerId: string;
  durationMs: number;
}

/** du oder Sie – wie in der Mail. Im Zweifel „Sie“ (höflicher Fehler statt zu vertraulich). */
export function addressForm(text: string, from?: EmailAddress): AddressForm {
  const body = text.replace(/\n>.*$/gm, "");
  if (/sehr geehrte|mit freundlichen grüßen|freundliche grüße/i.test(body)) return "Sie";
  const du = (body.match(/\b(du|dich|dir|dein|deine|deinen|deinem|deiner|euch|euer|eure|ihr lieben)\b/gi) ?? []).length;
  // „Sie“ als Anrede: großgeschrieben mitten im Satz, „Ihnen“, „Ihr(e)“ mitten im Satz
  const sie = (body.match(/(?<![.!?\n]\s{0,3})\b(Sie|Ihnen|Ihre[mnrs]?|Ihr)\b/g) ?? []).length;
  if (du > sie) return "du";
  if (sie > 0) return "Sie";
  if (/^(hi|hey|hallo|moin|servus|liebe[r]?)\b/im.test(body)) return "du";
  // Unterschrift nur mit Vornamen („Sarah“, „Gruß Tom“, „Kuss“) – unter Bekannten
  const last = body.trim().split("\n").at(-1)?.trim() ?? "";
  const firstName = (from?.name ?? "").trim().split(/\s+/)[0] ?? "";
  if (/^(kuss|lg|gruß \S+|dein[e]? \S+)$/i.test(last) || (firstName.length > 1 && last.toLowerCase() === firstName.toLowerCase())) return "du";
  return "Sie";
}

/** Wörter, die nach „Hallo Tom,“ kleingeschrieben weitergehen (Substantive bleiben groß). */
const continuesLower = /^(ja|nein|da|dazu|dafür|darauf|danach|damit|heute|morgen|gestern|jetzt|gleich|leider|gern|gerne|leider|klar|super|danke|vielen|herzlichen|ich|wir|das|der|die|es|wann|wie|was|wo|schön|toll|sehr|natürlich|selbstverständlich|okay|ok|prima|genau|bitte|kein|keine|zum|zur|am|im|bis|mit|für|ob|und|aber|dann|so|hier|anbei|lass|lasst|kannst|könntest|können|könnten|hast|habe|hab|bin|würde|wäre|komme|passt|sorry|tut|entschuldige|entschuldigen|vorab|kurze|kurz|gut|alles|eine?|einen?)$/i;

/** Anrede und Antwort zusammensetzen: „Hallo Tom,\nja, ich komme gern.“ */
export function joinGreeting(greeting: string, text: string): string {
  const first = /^[A-Za-zÄÖÜäöüß]+/.exec(text)?.[0] ?? "";
  const body = first && continuesLower.test(first) ? first.toLowerCase() + text.slice(first.length) : text;
  return `${greeting}\n${body}`;
}

const notAPerson = /\b(gmbh|ag|kg|team|service|support|abteilung|verwaltung|praxis|büro|shop|verein|newsletter|no-?reply|info|kundenservice|personalabteilung|bank|amt|stadtwerke)\b/i;

/** Anrede für die Antwort. Firmen/Abteilungen: neutral. */
export function replyGreeting(from: EmailAddress, form: AddressForm): string {
  const name = (from.name ?? "").replace(/^(dr\.|prof\.)\s+/i, "").trim();
  const person = name && !notAPerson.test(name) && !notAPerson.test(from.address) && !/\d|@/.test(name);
  if (form === "du") {
    const first = person ? name.split(/\s+/)[0] : "";
    return first ? `Hallo ${first},` : "Hallo,";
  }
  return person && name.includes(" ") ? `Guten Tag ${from.name?.trim()},` : "Guten Tag,";
}

export const repliesSchema: JsonSchema = {
  type: "object",
  properties: {
    agree: { type: "string", maxLength: 400 },
    decline: { type: "string", maxLength: 400 },
    ask: { type: "string", maxLength: 400 },
  },
  required: ["agree", "decline", "ask"],
  additionalProperties: false,
};

const kindLabels: Record<ReplyKind, string> = { agree: "Zusagen / Danke", decline: "Absagen / Später", ask: "Nachfragen" };

export function repliesPrompt(mail: string, form: AddressForm, earlier: string | null): AIMessage[] {
  const formText = form === "du" ? "Duze den Absender (du, dir, dich)." : "Sieze den Absender (Sie, Ihnen) – höflich und sachlich.";
  return [
    {
      role: "system",
      content: `Du schreibst drei kurze Antwortvorschläge auf die E-Mail unten, aus Sicht des Empfängers. Antworte nur mit JSON:
{"agree": "zusagen, zustimmen oder danken", "decline": "absagen, ablehnen oder auf später verschieben", "ask": "eine sinnvolle Rückfrage stellen"}
- ${formText}
- Jede Antwort 1 bis 3 kurze Sätze, auf Deutsch, natürlich und freundlich.
- OHNE Anrede („Hallo …“) und OHNE Grußformel oder Namen am Ende – die kommen automatisch dazu.
- Nichts erfinden: keine neuen Termine, Uhrzeiten, Beträge oder Fakten. Keine Platzhalter wie [Name] oder [Datum].
- Passt eine Richtung gar nicht (z. B. nichts zum Absagen), lass sie leer: "".`,
    },
    { role: "user", content: earlier ? `Vorher im Verlauf:\n${earlier}\n\nLetzte Mail:\n${mail}` : mail },
  ];
}

const greetingLine = /^(hallo|hi|hey|liebe[rs]?|sehr geehrte[rs]?|guten (tag|morgen|abend)|moin|servus)\b[^\n]{0,60}[,!]?\s*\n+/i;
/** Grußformel am Ende (plus höchstens eine kurze Namenszeile) entfernen – die kommt aus der Signatur. */
export function stripClosing(text: string): string {
  const lines = text.split("\n");
  const isClosing = (line: string) => /^\s*((viele|liebe|beste|herzliche|freundliche|schöne)\s+)?grüße\b|^\s*mit freundlichen grüßen|^\s*(lg|vg|bis bald|bis dann|gruß)\b[,!.]?\s*$/i.test(line);
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
    if (isClosing(lines[i] ?? "") && lines.slice(i + 1).every((l) => l.trim().length <= 25)) return lines.slice(0, i).join("\n").trim();
  }
  return text.trim();
}

const placeholder = /\[[^\]]{1,40}\]|\{[^}]{1,40}\}|<[^>]{1,40}>|\bXX+\b|\.\.\.\s*$/;

/** Prüft die Modellantwort. Unbrauchbare Varianten fallen weg; Zahlen, die nicht in der Mail stehen, auch. */
export function parseReplies(text: string, mail: string, form: AddressForm): ReplyVariant[] | null {
  const value = extractJson(text) as Record<string, unknown> | null;
  if (!value) return null;
  const mailNumbers = new Set(mail.match(/\d+/g) ?? []);
  const result: ReplyVariant[] = [];
  for (const kind of replyKinds) {
    const raw = value[kind];
    if (typeof raw !== "string") continue;
    let reply = raw.replace(/\r\n/g, "\n").trim().replace(greetingLine, "");
    reply = stripClosing(reply);
    if (reply.length < 8 || reply.length > 600 || placeholder.test(reply)) continue;
    // Falsche Anredeform: bei „Sie“ kein du/dir/dich; bei „du“ kein „Ihnen“
    if (form === "Sie" && /\b(du|dich|dir|dein\w*)\b/i.test(reply)) continue;
    if (form === "du" && /\bIhnen\b/.test(reply)) continue;
    // Erfundene Zahlen (Uhrzeit, Datum, Betrag)
    if ((reply.match(/\d+/g) ?? []).some((n) => !mailNumbers.has(n))) continue;
    reply = reply.replace(/\n{3,}/g, "\n\n");
    if (result.some((r) => r.text.toLowerCase() === reply.toLowerCase())) continue;
    result.push({ kind, label: kindLabels[kind], text: reply });
  }
  return result.length ? result : null;
}

/** Antwortvorschläge zur letzten Mail eines Verlaufs. Fehler/Blockade gehen an den Aufrufer; nichts Brauchbares → leere Liste. */
export async function draftReplies(
  router: AIRouter,
  message: Message,
  options: { earlier?: Message[]; signal?: AbortSignal } = {},
): Promise<ReplyDrafts> {
  const body = cleanMailText(message.bodyText ?? message.snippet, 1500);
  const mail = `Von: ${message.from.name ?? message.from.address}\nBetreff: ${message.subject}\n\n${body}`;
  const earlier = (options.earlier ?? [])
    .slice(-2)
    .map((m) => `${m.from.name ?? m.from.address}: ${cleanMailText(m.bodyText ?? m.snippet, 300)}`)
    .join("\n---\n");
  const form = addressForm(body, message.from);
  const greeting = replyGreeting(message.from, form);
  const request: AIRequest = { task: "draftReply", messages: repliesPrompt(mail, form, earlier || null), jsonSchema: repliesSchema, maxTokens: 450, temperature: 0.3 };
  let durationMs = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await router.run(request, { accountIds: [message.accountId] }, options.signal);
    durationMs += response.durationMs;
    const replies = parseReplies(response.text, `${message.subject}\n${body}\n${earlier}`, form);
    if (replies) return { form, greeting, replies, origin: response.privacyClass, providerId: response.providerId, durationMs };
    if (attempt === 1) return { form, greeting, replies: [], origin: response.privacyClass, providerId: response.providerId, durationMs };
  }
  return { form, greeting, replies: [], origin: "onDevice", providerId: "", durationMs };
}
