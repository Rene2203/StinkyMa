import type { MessageCategory } from "../models.js";
import type { AIMessage, JsonSchema } from "./types.js";

// Versionierte Prompt-Vorlagen (5.5). Auf Deutsch, kurz und eindeutig – für ~3B-Modelle formuliert.
// Ändert sich eine Vorlage, steigt die Version (Ergebnisse lassen sich so nachvollziehen und neu messen).

export const promptVersions = { categorize: 1, summarize: 1 } as const;

export const categories: readonly MessageCategory[] = [
  "personal", "work", "newsletter", "notification", "invoice", "appointment", "spam_suspect",
];

const categoryGuide = `- personal: private Nachricht von einem Menschen (Familie, Freunde, Bekannte)
- work: beruflich (Kollegen, Kunden, Projekte, Angebote)
- newsletter: Werbung, Angebote, Rundbriefe, Neuigkeiten von Firmen oder Vereinen
- notification: automatische Mitteilung (Versand, Login, Passwort, Bestätigung, System)
- invoice: Rechnung, Zahlungsaufforderung, Beleg, Abbuchung, Kontoauszug
- appointment: Termin, Einladung, Terminanfrage, Terminbestätigung oder -absage
- spam_suspect: verdächtig – Druck, Drohung, Gewinn, Konto gesperrt, fremde Links, passt nicht zum Absender`;

export const categorizeSchema: JsonSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: categories },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["category", "confidence"],
  additionalProperties: false,
};

export function categorizePrompt(mail: string): AIMessage[] {
  return [
    {
      role: "system",
      content: `Du ordnest E-Mails genau einer Kategorie zu. Antworte nur mit JSON: {"category": "...", "confidence": 0.0 bis 1.0}.
Kategorien:
${categoryGuide}
Bei Unsicherheit wähle die wahrscheinlichste Kategorie und eine niedrige confidence.`,
    },
    { role: "user", content: mail },
  ];
}

export const summarizeSchema: JsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string", maxLength: 600 },
    openPoints: { type: "array", items: { type: "string", maxLength: 160 }, maxItems: 4 },
    waitingOn: { type: "string", enum: ["me", "others", "nobody"] },
  },
  required: ["summary", "openPoints", "waitingOn"],
  additionalProperties: false,
};

export function summarizePrompt(thread: string, ownAddresses: string[]): AIMessage[] {
  return [
    {
      role: "system",
      content: `Du fasst E-Mail-Konversationen auf Deutsch zusammen. Antworte nur mit JSON:
{"summary": "2 bis 4 kurze Sätze", "openPoints": ["offene Punkte, Fragen, Fristen – höchstens 4, sonst leer"], "waitingOn": "me" | "others" | "nobody"}
"waitingOn" = wer zuletzt etwas tun muss: "me" (der Nutzer: ${ownAddresses.join(", ") || "Empfänger"}), "others" (jemand anderes) oder "nobody".
Erfinde nichts. Nenne Beträge, Daten und Namen genau so, wie sie in den Mails stehen.`,
    },
    { role: "user", content: thread },
  ];
}
