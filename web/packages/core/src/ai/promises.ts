import type { EmailAddress, Message } from "../models.js";
import { explicitDates, relativeDates } from "./actions.js";
import { cleanMailText, truncate } from "./prepare.js";
import type { AIRouter } from "./router.js";
import { extractJson, type ResultOrigin } from "./tasks.js";
import type { AIMessage, AIRequest, JsonSchema } from "./types.js";

// Versprechen-Tracker (W7.3): Zusagen in gesendeten Mails („Meine Zusagen“) und Zusagen anderer an den Nutzer
// („Ich warte auf“). KI findet die Zusage, der Code prüft das Zitat im Text und rechnet die Frist aus dem Ausdruck.

export type PromiseDirection = "mine" | "theirs";

export interface PromiseFinding {
  /** Was zugesagt wurde (kurz, aus der Mail) */
  text: string;
  /** Satz aus der Mail (Beleg) */
  quote: string;
  /** Frist als Datum (YYYY-MM-DD) – null: keine Frist genannt (die App setzt eine Standardfrist) */
  dueDate: string | null;
}

// --- Fristen ---

const day = (d: Date, offset: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset)).toISOString().slice(0, 10);

/** Frist aus einem Ausdruck in der Mail, gerechnet ab dem Sendedatum. null = kein (fester) Zeitpunkt genannt. */
export function dueFromText(raw: string, mailDate: Date): string | null {
  // „wegen Samstag“, „für Montag“, „über den 15.10.“: Anlass, keine Frist
  const text = raw.replace(/\b(wegen|für|über|zum thema|regarding|about)\s+(dem |den |der |das )?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|\d{1,2}\.\s?\d{1,2}\.(\d{2,4})?)/giu, " ");
  const explicit = explicitDates(text, mailDate)[0]?.date;
  if (explicit) return explicit;
  const weekday = mailDate.getUTCDay(); // 0 = Sonntag
  const untilFriday = (5 - weekday + 7) % 7;
  if (/(ende (der|dieser) woche|end of (the|this) week|bis zum wochenende|by the weekend)/i.test(text)) return day(mailDate, untilFriday);
  if (/(anfang (der )?nächste[rn]? woche|early next week|anfang kommender woche)/i.test(text)) return day(mailDate, ((1 - weekday + 7) % 7) || 7);
  if (/((nächste|kommende)[rn]? woche|next week)/i.test(text)) return day(mailDate, untilFriday + 7);
  if (/(ende (des|diese[sn]) monats|monatsende|end of (the|this) month)/i.test(text)) {
    return new Date(Date.UTC(mailDate.getUTCFullYear(), mailDate.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  }
  // „next Tuesday“ / „by Friday“ (Englisch); deutsche Wochentage und „morgen“ kennt relativeDates
  const english = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(text);
  if (english) {
    const target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf((english[1] ?? "").toLowerCase());
    return day(mailDate, ((target - weekday + 7) % 7) || 7);
  }
  const relative = relativeDates(text, mailDate)[0]?.date;
  if (relative) return relative;
  if (/(heute|heut abend|nachher|gleich|later today|tonight|today)/i.test(text)) return day(mailDate, 0);
  return null;
}

// --- Regeln ---

const promiseVerbs =
  "schicke|schick|sende|melde|kümmere|kläre|prüfe|gebe|geb|bringe|bring|lade|überweise|rufe|erstelle|reiche|werfe|mache|erledige|liefere|unterschreibe|organisiere|frag|frage|besorge|besorg|sag|sage|teile|kümmern|melden|schicken|senden|prüfen|reichen|liefern|rufen|übernehme|bereite|setze|trage";
/** „Ich schicke …“, „wir prüfen …“ (Verb kurz danach) */
const firstPersonLead = new RegExp(`(?<![\\p{L}])(ich|wir)\\s+(?:[\\p{L},-]+\\s+){0,4}?(${promiseVerbs})(?![\\p{L}])`, "iu");
/** „die Fotos lade ich …“ (Verb vor „ich/wir“) */
const firstPersonInverted = new RegExp(`(?<![\\p{L}])(${promiseVerbs})\\s+(ich|wir)(?![\\p{L}])`, "iu");
/** Fremde Zusage in dritter Person / Passiv: „bekommst du bis Montag von mir“, „ein Techniker meldet sich“ */
const theirOther = /(bekomm(st|en sie)|erhalt(en sie|st du)|kriegst du)\b.{0,60}\bvon (mir|uns)\b|\b(meldet sich|melden sich|ruft .{0,20}an|rufen sie .{0,20}zurück|wird sich .{0,30}melden)\b|\bvon mir (bekommst|erhältst)\b/i;
const english = /\b(i('ll| will| am going to| shall)|we('ll| will))\s+(\w+\s+){0,2}(send|get back|call|check|share|sign|deliver|prepare|finish|follow up|update|bring|let you know)\b/i;
const pastOrDone = /(\b(habe|hab|haben|hatte)\b.{0,50}\b(ge\p{L}+t|ge\p{L}+en|abgesagt|erledigt)\b|wie versprochen|anbei|im anhang|ist angekommen|schon (erledigt|geschickt|abgesagt))/iu;
const request = /(\b(kannst|könntest|würdest|kann ich|könnten sie|bitte schick|bitte sende)\b|\?)/i;
const marketing = /(angebote|newsletter|bleiben sie gespannt|neue folgen|jetzt (bestellen|shoppen)|rabatt|sale\b)/i;
const vague = /(in den nächsten tagen|zeitnah|demnächst|bald|asap|so schnell wie möglich|baldmöglichst)/i;

/** Automatische Absender (Versand, Newsletter): keine persönlichen Zusagen */
export function isAutomatedSender(from: EmailAddress): boolean {
  return /^(no-?reply|noreply|donotreply|news|newsletter|marketing|mailer|notification|benachrichtigung|info-?mail)@/i.test(from.address);
}

function sentences(text: string): string[] {
  return text.split(/(?<=[\p{L})!])[.!?](?=\s)|\n/u).map((s) => s.trim()).filter((s) => s.length > 3);
}

/** Erkennung ohne KI: Sätze mit eigener Zusage (gesendet) bzw. Zusage des Absenders (eingehend). */
export function rulePromises(body: string, mailDate: Date, direction: PromiseDirection, from: EmailAddress): PromiseFinding[] {
  if (direction === "theirs" && isAutomatedSender(from)) return [];
  const text = cleanMailText(body, 3000);
  const out: PromiseFinding[] = [];
  const all = sentences(text);
  for (const [i, sentence] of all.entries()) {
    if (request.test(sentence) || pastOrDone.test(sentence) || marketing.test(sentence)) continue;
    const hit = firstPersonLead.test(sentence) || firstPersonInverted.test(sentence) || english.test(sentence) || (direction === "theirs" && theirOther.test(sentence));
    if (!hit) continue;
    // Frist im Satz; „Bis Sonntag“ als Abschiedsgruß im nächsten Satz zählt mit
    const next = all[i + 1] ?? "";
    const due = vague.test(sentence) ? null : (dueFromText(sentence, mailDate) ?? (/^bis\s/i.test(next) ? dueFromText(next, mailDate) : null));
    out.push({ text: truncate(sentence, 140), quote: truncate(sentence, 200), dueDate: due });
  }
  return out;
}

/** Vorfilter für das Modell */
export function mightContainPromise(body: string, direction: PromiseDirection): boolean {
  const text = cleanMailText(body, 3000);
  return firstPersonLead.test(text) || firstPersonInverted.test(text) || english.test(text) || (direction === "theirs" && theirOther.test(text)) || /\b(ich|wir|i|we)\b/i.test(text);
}

// --- Modell ---

export const promisePromptVersion = 1;

export const promiseSchema: JsonSchema = {
  type: "object",
  properties: {
    zusagen: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          was: { type: "string", maxLength: 120 },
          frist: { type: "string", maxLength: 60 },
          zitat: { type: "string", maxLength: 240 },
        },
        required: ["was", "frist", "zitat"],
        additionalProperties: false,
      },
    },
  },
  required: ["zusagen"],
  additionalProperties: false,
};

export function promisePrompt(mail: string, direction: PromiseDirection): AIMessage[] {
  const who = direction === "mine" ? "die Nutzerin selbst (sie hat die E-Mail geschrieben)" : "der Absender (er schreibt an die Nutzerin)";
  return [
    {
      role: "system",
      content: `Finde Zusagen in der E-Mail: Sätze, in denen ${who} verspricht, künftig etwas zu tun („Ich schicke dir … bis Freitag“, „Wir melden uns“, „I'll send …“).
Keine Zusage: Bitten und Fragen an andere, schon Erledigtes („anbei“, „habe geschickt“), Werbung, automatische Mitteilungen, zitierter Text früherer Mails.
- was: kurz, was zugesagt wurde
- frist: der Zeitausdruck genau wie in der Mail („bis Freitag“, „nächste Woche“, „15.10.“), sonst leer
- zitat: der Satz aus der Mail, wörtlich
Antworte nur mit JSON: {"zusagen": [...]} – keine Zusage: {"zusagen": []}`,
    },
    { role: "user", content: mail },
  ];
}

const normalize = (s: string) => s.toLowerCase().replace(/[„“"'’]/g, "").replace(/\s+/g, " ").trim();

/** Antwort lesen: nur Zusagen, deren Zitat (weitgehend) wörtlich in der Mail steht. Frist rechnet der Code. */
export function parsePromises(text: string, mail: string, mailDate: Date): PromiseFinding[] | null {
  const value = extractJson(text) as { zusagen?: unknown } | null;
  if (!value || !Array.isArray(value.zusagen)) return null;
  const haystack = normalize(mail);
  const out: PromiseFinding[] = [];
  for (const item of value.zusagen as Record<string, unknown>[]) {
    const quote = typeof item.zitat === "string" ? item.zitat.trim() : "";
    const what = typeof item.was === "string" ? item.was.trim() : "";
    if (!quote || !what) continue;
    // Zitat muss in der Mail stehen (Anfang reicht – kleine Modelle kürzen gern)
    const probe = normalize(quote).slice(0, 40);
    if (probe.length < 8 || !haystack.includes(probe)) continue;
    if (request.test(quote) || pastOrDone.test(quote)) continue;
    const deadline = typeof item.frist === "string" ? item.frist.trim() : "";
    // Frist: aus dem Ausdruck, wenn er in der Mail steht – sonst aus dem Zitat
    const fromDeadline = deadline && haystack.includes(normalize(deadline)) ? dueFromText(deadline, mailDate) : null;
    const due = vague.test(quote) ? null : (fromDeadline ?? dueFromText(quote, mailDate));
    out.push({ text: truncate(what, 140), quote: truncate(quote, 200), dueDate: due });
  }
  return out;
}

export interface PromiseResult {
  findings: PromiseFinding[];
  origin: ResultOrigin;
  durationMs: number;
}

/** Zusagen einer Mail: Modell (Zitat geprüft) – ohne brauchbare Antwort die Regeln. */
export async function extractPromises(
  router: AIRouter,
  message: Message,
  direction: PromiseDirection,
  options: { signal?: AbortSignal } = {},
): Promise<PromiseResult> {
  const mailDate = new Date(message.date);
  const rules = rulePromises(message.bodyText ?? message.snippet, mailDate, direction, message.from);
  if (direction === "theirs" && isAutomatedSender(message.from)) return { findings: [], origin: "rules", durationMs: 0 };
  const body = cleanMailText(message.bodyText ?? message.snippet, 1800);
  const mail = `${direction === "mine" ? `An: ${message.to.map((t) => t.name ?? t.address).join(", ")}` : `Von: ${message.from.name ?? ""} <${message.from.address}>`}\nBetreff: ${message.subject}\n\n${body}`;
  const request: AIRequest = { task: "extractPromises", messages: promisePrompt(mail, direction), jsonSchema: promiseSchema, maxTokens: 300, temperature: 0 };
  let durationMs = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await router.run(request, { accountIds: [message.accountId] }, options.signal);
    durationMs += response.durationMs;
    const parsed = parsePromises(response.text, body, mailDate);
    if (parsed) {
      // Frist: was die Regeln zum selben Satz gerechnet haben, gewinnt bei Abweichung nicht – beide rechnen gleich;
      // fehlt dem Modell die Frist, ergänzt die Regel aus demselben Satz („Bis Sonntag“ im Folgesatz)
      for (const finding of parsed) {
        if (finding.dueDate) continue;
        const twin = rules.find((r) => normalize(r.quote).includes(normalize(finding.quote).slice(0, 30)) || normalize(finding.quote).includes(normalize(r.quote).slice(0, 30)));
        if (twin?.dueDate) finding.dueDate = twin.dueDate;
      }
      return { findings: parsed, origin: response.privacyClass, durationMs };
    }
  }
  return { findings: rules, origin: "rules", durationMs };
}
