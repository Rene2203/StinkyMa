import type { MessageCategory } from "../models.js";
import type { AIMessage, JsonSchema } from "./types.js";

// Versionierte Prompt-Vorlagen (5.5). Auf Deutsch, kurz und eindeutig – für ~3B-Modelle formuliert.
// Ändert sich eine Vorlage, steigt die Version (Ergebnisse lassen sich so nachvollziehen und neu messen).

export const promptVersions = { categorize: 2, summarize: 3, readImage: 1 } as const;

export const categories: readonly MessageCategory[] = [
  "personal", "work", "newsletter", "notification", "invoice", "appointment", "spam_suspect",
];

const categoryGuide = `- personal: private Nachricht von einem Menschen (Familie, Freunde, Bekannte)
- work: beruflich (Kollegen, Kunden, Projekte, Angebote)
- newsletter: Werbung, Angebote, Rundbriefe, Neuigkeiten von Firmen oder Vereinen
- notification: automatische Mitteilung (Versand, Login, Passwort, Bestätigung, System)
- invoice: Rechnung, Zahlungsaufforderung, Beleg, Abbuchung, Kontoauszug
- appointment: Termin, Einladung, Terminanfrage, Terminbestätigung oder -absage
- spam_suspect: Betrugsverdacht (Phishing) – siehe unten`;

// v2: Der Messlauf (v1) zeigte, dass kleine Modelle Phishing im Look einer Benachrichtigung oder Rechnung
// meist als „notification“/„invoice“ einordnen. Deshalb klare Vorrang-Regel mit typischen Merkmalen.
const spamGuide = `Vorrang: Wähle spam_suspect, sobald die Mail eines dieser Merkmale hat – auch wenn sie wie eine Benachrichtigung, Rechnung oder Nachricht vom Chef aussieht:
- drängt zu sofortigem Handeln über einen Link: anmelden, Konto bestätigen/verifizieren, Daten oder Kreditkarte eingeben, Gebühr zahlen
- droht (Sperrung, Schließung, Pfändung, letzte Mahnung) oder setzt eine knappe Frist
- verspricht Gewinne, Erbschaften, Erstattungen oder schnelles Geld
- Absenderadresse passt nicht zur genannten Firma oder Person (z. B. Bank, Behörde, Chef von einer fremden oder kostenlosen Adresse)
- bittet um Geschenkkarten, Codes oder Geheimhaltung
Echte Benachrichtigungen informieren nur (Versand, Termin, Passwort wurde geändert) und verlangen keine Daten über einen Link.`;

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
${spamGuide}
Bei Unsicherheit wähle die wahrscheinlichste Kategorie und eine niedrige confidence.`,
    },
    { role: "user", content: mail },
  ];
}

// v3 (Feinabstimmung): „wer ist dran“ nicht mehr als eine Wahl aus drei, sondern zwei einfache Ja/Nein-Fragen.
// Wer die letzte Mail geschrieben hat, bestimmt der Code und sagt es dem Modell ausdrücklich.
export const summarizeSchema: JsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string", maxLength: 600 },
    openPoints: { type: "array", items: { type: "string", maxLength: 160 }, maxItems: 4 },
    nutzerMussHandeln: { type: "boolean" },
    nutzerWartet: { type: "boolean" },
  },
  required: ["summary", "openPoints", "nutzerMussHandeln", "nutzerWartet"],
  additionalProperties: false,
};

export function summarizePrompt(thread: string, ownAddresses: string[]): AIMessage[] {
  return [
    {
      role: "system",
      content: `Du fasst E-Mail-Konversationen auf Deutsch zusammen. Antworte nur mit JSON:
{"summary": "2 bis 4 kurze Sätze", "openPoints": ["was noch offen ist"], "nutzerMussHandeln": true | false, "nutzerWartet": true | false}
Mails des Nutzers (${ownAddresses.join(", ") || "Empfänger"}) sind mit „(Nutzer)“ markiert.
- "summary": Übernimm alle Beträge, Mengen, Daten, Uhrzeiten und Namen genau so, wie sie in den Mails stehen – auch bei Punkten, die schon erledigt sind.
- "openPoints": offene Fragen, Bitten und Fristen – höchstens 4, sonst leer.
- "nutzerMussHandeln": true, wenn jemand den Nutzer etwas fragt, ihn um etwas bittet oder ihm eine Frist setzt und der Nutzer darauf noch nicht geantwortet hat. Sonst false.
- "nutzerWartet": true, wenn der Nutzer auf andere wartet: Er hat zuletzt etwas gefragt oder um etwas gebeten, oder jemand hat angekündigt, sich noch zu melden. Sonst false.
- Dank, Bestätigungen und reine Informationen: beide false.
Erfinde nichts.`,
    },
    { role: "user", content: thread },
  ];
}

// v4: Das Modell beurteilt nur noch die letzte Mail (Frage/Bitte/Frist? Meldung angekündigt?). Wer dann dran ist, folgt
// im Code daraus, wer die letzte Mail geschrieben hat – das verwechseln kleine Modelle sonst.
export const summarizeSchemaV4: JsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string", maxLength: 600 },
    openPoints: { type: "array", items: { type: "string", maxLength: 160 }, maxItems: 4 },
    letzteMailFragtOderBittet: { type: "boolean" },
    letzteMailKuendigtMeldungAn: { type: "boolean" },
  },
  required: ["summary", "openPoints", "letzteMailFragtOderBittet", "letzteMailKuendigtMeldungAn"],
  additionalProperties: false,
};

export function summarizePromptV4(thread: string, ownAddresses: string[]): AIMessage[] {
  return [
    {
      role: "system",
      content: `Du fasst E-Mail-Konversationen auf Deutsch zusammen. Antworte nur mit JSON:
{"summary": "2 bis 4 kurze Sätze", "openPoints": ["was noch offen ist"], "letzteMailFragtOderBittet": true | false, "letzteMailKuendigtMeldungAn": true | false}
Mails des Nutzers (${ownAddresses.join(", ") || "Empfänger"}) sind mit „(Nutzer)“ markiert.
- "summary": Übernimm alle Beträge, Mengen, Daten, Uhrzeiten und Namen genau so, wie sie in den Mails stehen – auch bei Punkten, die schon erledigt sind.
- "openPoints": offene Fragen, Bitten und Fristen – höchstens 4, sonst leer.
- "letzteMailFragtOderBittet": Schau nur auf die LETZTE Mail. true, wenn sie eine Frage stellt, um etwas bittet, eine Frist setzt oder eine Entscheidung braucht. false bei Dank, Zusage, Bestätigung oder reiner Information.
- "letzteMailKuendigtMeldungAn": Schau nur auf die LETZTE Mail. true, wenn der Absender ankündigt, sich bis zu einem Zeitpunkt zu melden oder etwas zu klären. Sonst false.
Erfinde nichts.`,
    },
    { role: "user", content: thread },
  ];
}

/** Fassung v2 – nur noch für Vergleichsmessungen (eval-models.ts --summary-v2). */
export const summarizeSchemaV2: JsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string", maxLength: 600 },
    openPoints: { type: "array", items: { type: "string", maxLength: 160 }, maxItems: 4 },
    waitingOn: { type: "string", enum: ["me", "others", "nobody"] },
  },
  required: ["summary", "openPoints", "waitingOn"],
  additionalProperties: false,
};

export function summarizePromptV2(thread: string, ownAddresses: string[]): AIMessage[] {
  return [
    {
      role: "system",
      content: `Du fasst E-Mail-Konversationen auf Deutsch zusammen. Antworte nur mit JSON:
{"summary": "2 bis 4 kurze Sätze", "openPoints": ["offene Punkte, Fragen, Fristen – höchstens 4, sonst leer"], "waitingOn": "me" | "others" | "nobody"}
Mails des Nutzers (${ownAddresses.join(", ") || "Empfänger"}) sind mit „(Nutzer)“ markiert.
"waitingOn" – wer muss als Nächstes handeln? Richte dich nach der letzten Mail:
- "me": jemand anderes bittet den Nutzer um etwas, fragt ihn oder setzt ihm eine Frist, und der Nutzer hat danach noch nicht geantwortet
- "others": der Nutzer hat zuletzt eine Frage gestellt oder um etwas gebeten und wartet auf Antwort
- "nobody": alles ist geklärt, bestätigt oder nur zur Information
Erfinde nichts. Nenne Beträge, Daten und Namen genau so, wie sie in den Mails stehen.`,
    },
    { role: "user", content: thread },
  ];
}

export const documentTypes = ["invoice", "receipt", "contract", "letter", "form", "ticket", "screenshot", "photo", "other"] as const;
export type DocumentType = (typeof documentTypes)[number];

export const readImageSchema: JsonSchema = {
  type: "object",
  properties: {
    documentType: { type: "string", enum: documentTypes },
    title: { type: "string", maxLength: 120 },
    summary: { type: "string", maxLength: 400 },
    text: { type: "string", maxLength: 6000 },
  },
  required: ["documentType", "title", "summary", "text"],
  additionalProperties: false,
};

/** Bild(er) eines Dokuments lesen: Art, Titel, kurze Beschreibung und der vollständige sichtbare Text. */
export function readImagePrompt(context: { filename: string; pages: number }): { system: string; user: string } {
  return {
    system: `Du liest Bilder von Dokumenten (Fotos, Scans, Bildschirmfotos) und antwortest nur mit JSON:
{"documentType": "${documentTypes.join(" | ")}", "title": "kurzer Titel", "summary": "1–2 Sätze auf Deutsch: Was ist es, von wem, wichtigste Angaben (Beträge, Daten, Fristen)", "text": "der vollständige sichtbare Text, Zeile für Zeile"}
Schreibe Zahlen, Beträge, Daten, Namen und Nummern (IBAN, Rechnungsnummer) exakt so ab, wie sie im Bild stehen. Erfinde nichts; Unlesbares lässt du weg.
Ist kein Text zu sehen (Foto), beschreibe das Bild in "summary" und lasse "text" leer.`,
    user: context.pages > 1 ? `Datei: ${context.filename} (${context.pages} Seiten, in Reihenfolge)` : `Datei: ${context.filename}`,
  };
}
