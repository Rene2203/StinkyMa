import { formatSlot, type MeetingSlot } from "../meetings.js";
import { cleanMailText } from "./prepare.js";
import type { AddressForm } from "./replies.js";
import type { AIRouter } from "./router.js";
import { extractJson } from "./tasks.js";
import type { AIMessage, AIRequest, JsonSchema } from "./types.js";

// Terminfinder (W9.4): Das Modell schreibt nur Einleitung und Schluss (1 Satz je), die Vorschläge setzt der Code als
// Liste ein – Zeiten, Tage und Daten kommen nie vom Modell. Ohne Modell oder bei unbrauchbarer Antwort: Vorlage.

export const meetingReplySchema: JsonSchema = {
  type: "object",
  properties: { einleitung: { type: "string", maxLength: 200 }, schluss: { type: "string", maxLength: 200 } },
  required: ["einleitung", "schluss"],
  additionalProperties: false,
};

export function meetingReplyPrompt(mail: string, form: AddressForm): AIMessage[] {
  return [
    {
      role: "system",
      content: `Du antwortest auf eine Terminanfrage. Zwischen Einleitung und Schluss stehen automatisch die Terminvorschläge als Liste. Antworte nur mit JSON:
{"einleitung": "ein kurzer Satz vor der Liste", "schluss": "ein kurzer Satz danach (z. B. Bitte um Rückmeldung)"}
- ${form === "du" ? "Duze den Empfänger." : "Sieze den Empfänger."} Ohne Anrede und ohne Gruß.
- Nenne KEINE Tage, Daten, Uhrzeiten oder Zahlen – die stehen in der Liste.`,
    },
    { role: "user", content: cleanMailText(mail, 2000) },
  ];
}

const timeWords = /\d|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|morgen|übermorgen|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember|uhr\b|\[|\]|\{|\}/i;

function checkSentence(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length < 8 || text.length > 200 || timeWords.test(text)) return null;
  if (/^(hallo|hi|liebe|sehr geehrte|guten tag)|grüße|gruß/i.test(text)) return null;
  return text;
}

export function meetingReplyText(intro: string, outro: string, slots: MeetingSlot[]): string {
  return `${intro}\n${slots.map((s) => `- ${formatSlot(s)}`).join("\n")}\n${outro}`;
}

export async function draftMeetingReply(router: AIRouter, mail: string, form: AddressForm, slots: MeetingSlot[], options: { accountIds: string[] }): Promise<string | null> {
  const request: AIRequest = { task: "draftReply", messages: meetingReplyPrompt(mail, form), jsonSchema: meetingReplySchema, maxTokens: 160, temperature: 0.3 };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await router.run(request, { accountIds: options.accountIds });
    const value = extractJson(response.text) as { einleitung?: unknown; schluss?: unknown } | null;
    const intro = checkSentence(value?.einleitung);
    const outro = checkSentence(value?.schluss);
    if (intro && outro) return meetingReplyText(intro, outro, slots);
  }
  return null;
}
