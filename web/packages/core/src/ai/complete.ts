import type { AddressForm } from "./replies.js";
import type { AIMessage, AIRequest } from "./types.js";

// Autovervollständigung beim Tippen (W8.5): Das lokale Modell schlägt die Fortsetzung des angefangenen Satzes vor
// (grauer Text, Tab übernimmt). Für ein ~3B-Modell klein gehalten: wenig Kontext, höchstens ~12 Wörter, Klartext statt
// JSON. Der Code prüft die Antwort: eine Zeile, keine Wiederholung, keine erfundenen Zahlen, Adressen oder Platzhalter.

export const completePromptVersion = 1;

export interface CompletionInput {
  /** Text vor dem Cursor (der angefangene Entwurf) */
  before: string;
  /** Text nach dem Cursor – bei Antworten die zitierte Mail */
  after?: string;
  subject?: string;
  /** Empfänger (für du/Sie aus dem Stilprofil) */
  to?: string[];
  accountId?: string | null;
}

export interface CompletionView {
  /** Einzufügender Text, genau so (mit führendem Leerzeichen, falls nötig) */
  text: string;
  durationMs: number;
}

export const completionLimits = { before: 1200, after: 1200, words: 12 } as const;

/** Nur nach einem fertigen Wort (Leerzeichen) oder Satzzeichen vorschlagen – mitten im Wort nicht. */
export function shouldComplete(before: string): boolean {
  const line = before.split("\n").at(-1) ?? "";
  if (line.trim().length < 3) return false;
  return /\s$|[.,!?:;]$/.test(before);
}

/** Beispiele zeigen einem kleinen Modell besser als Regeln, was „fortsetzen“ heißt (mitten im Satz weiterschreiben). */
const completionExamples: [string, string][] = [
  ["Vielen Dank für Ihre schnelle", "Rückmeldung."],
  ["Ich komme gern und bringe", "einen Salat mit."],
  ["Leider schaffe ich es heute nicht,", "können wir den Termin verschieben?"],
  ["Anbei sende ich Ihnen", "die gewünschten Unterlagen."],
  ["Thanks for the update, I will", "send you the slides tomorrow."],
];

export function completionPrompt(input: CompletionInput, form: AddressForm | null): AIMessage[] {
  const before = input.before.slice(-completionLimits.before);
  const after = (input.after ?? "").trim().slice(0, completionLimits.after);
  const formText = form === "du" ? " Der Empfänger wird geduzt." : form === "Sie" ? " Der Empfänger wird gesiezt." : "";
  return [
    {
      role: "system",
      content: `Du vervollständigst den angefangenen Satz einer E-Mail. Schreib nur die fehlenden Wörter, die direkt hinter dem letzten Wort stehen – so, dass Text und Fortsetzung zusammen einen richtigen Satz ergeben. Höchstens ${completionLimits.words} Wörter, eine Zeile, gleiche Sprache wie der Text.${formText} Erfinde keine Termine, Uhrzeiten, Beträge, Namen oder Adressen. Passt nichts, antworte genau: KEIN

Beispiele (Text → Fortsetzung):
${completionExamples.map(([text, next]) => `${text} → ${next}`).join("\n")}`,
    },
    {
      role: "user",
      content: [
        input.subject ? `Betreff: ${input.subject}` : "",
        after ? `Darunter (z. B. die Mail, auf die geantwortet wird):\n${after}` : "",
        `Text:\n${before}`,
      ]
        .filter(Boolean)
        .join("\n\n") + "\n\nFortsetzung:",
    },
  ];
}

export function completionRequest(input: CompletionInput, form: AddressForm | null): AIRequest {
  return { task: "complete", messages: completionPrompt(input, form), maxTokens: 32, temperature: 0.2 };
}

const placeholder = /\[[^\]]{0,40}\]|\{[^}]{0,40}\}|<[^>]{0,40}>|\bXX+\b/;

/** Modellantwort → einfügbarer Text oder null. */
export function parseCompletion(raw: string, input: CompletionInput): string | null {
  let text = raw.replace(/\r/g, "").split("\n").find((l) => l.trim())?.trim() ?? "";
  text = text.replace(/^(fortsetzung|continuation)\s*:\s*/i, "").replace(/^[-–•→]+\s*/, "");
  text = text.replace(/^["„“'»«]+|["“”'»«]+$/g, "").replace(/^(…|\.\.\.)\s*/, "").trim();
  if (!text || /^kein\.?$/i.test(text)) return null;
  // Wiederholt das Modell das Ende des Entwurfs, den doppelten Teil weglassen
  const tail = input.before.trimEnd();
  for (let n = Math.min(tail.length, 60); n >= 4; n--) {
    const piece = tail.slice(-n);
    if (text.toLowerCase().startsWith(piece.toLowerCase())) {
      text = text.slice(n).trim();
      break;
    }
  }
  // Doppeltes Wort am Anschluss („Könnten Sie mir | mir bitte …“)
  const lastWord = /(\p{L}+)\s*$/u.exec(input.before)?.[1];
  const firstWord = /^(\p{L}+)\b/u.exec(text)?.[1];
  if (lastWord && firstWord && lastWord.toLowerCase() === firstWord.toLowerCase()) text = text.slice(firstWord.length).trim();
  if (!text) return null;
  // Neuer Satz statt Fortsetzung: Endet der Entwurf mitten im Satz, darf der Vorschlag nicht groß mit „Ich/Wir/Bitte …“
  // neu ansetzen (mitten im Satz steht „ich“ klein; Substantive dürfen groß beginnen)
  if (!/[.!?:]\s*$/.test(input.before) && /^(Ich|Wir|Bitte|Vielen|Danke|Liebe|Hallo|Gerne|Please|Thanks|Thank|We)\b/.test(text)) return null;
  if (placeholder.test(text) || /@|https?:|www\./i.test(text)) return null;
  // Pronomen direkt nach Artikel/Präposition („zu meiner ich …“) ergibt keinen Satz
  if (/\b(der|die|das|dem|den|des|ein|eine|einen|einem|einer|mein|meine|meinen|meinem|meiner|dein|deine|ihr|ihre|ihren|zu|zum|zur|für|von|vom|mit|auf|an|am|im|in|the|a|an|my|your|to|for|of)\s*$/i.test(input.before) && /^(ich|du|wir|er|sie|es|i|you|we)\b/i.test(text)) return null;
  // Zeitangaben in Worten zählen wie Zahlen: Wochentage, Monate, Zahlwörter nur, wenn sie schon dastehen
  const context = `${input.subject ?? ""} ${input.before} ${input.after ?? ""}`.toLowerCase();
  const timeWords = text.toLowerCase().match(/\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember|monday|tuesday|wednesday|thursday|friday|saturday|sunday|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwanzig|dreißig|hundert|halb|viertel)\b/g) ?? [];
  if (timeWords.some((w) => !context.includes(w))) return null;
  // Keine Zahlen, die nirgends stehen (Uhrzeit, Datum, Betrag)
  const known = new Set(`${input.subject ?? ""} ${input.before} ${input.after ?? ""}`.match(/\d+/g) ?? []);
  if ((text.match(/\d+/g) ?? []).some((n) => !known.has(n))) return null;
  // Höchstens ein Satz und höchstens N Wörter
  const sentence = /^(.+?[.!?])(\s|$)/.exec(text);
  if (sentence?.[1]) text = sentence[1];
  const words = text.split(/\s+/);
  if (words.length > completionLimits.words) text = words.slice(0, completionLimits.words).join(" ");
  if (text.length < 2) return null;
  // Abstand: nach Satzzeichen ohne Leerzeichen eins einfügen; Satzzeichen am Anfang direkt anhängen
  const needsSpace = !/\s$/.test(input.before) && !/^[.,!?:;)]/.test(text);
  return needsSpace ? ` ${text}` : text;
}
