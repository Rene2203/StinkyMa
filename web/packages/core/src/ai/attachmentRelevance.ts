import type { AttachmentRelevance } from "../models.js";
import { cleanMailText, truncate } from "./prepare.js";
import type { AIRouter } from "./router.js";
import { extractJson } from "./tasks.js";
import type { AIMessage, AIRequest, JsonSchema } from "./types.js";

// Anhang-Relevanzprüfung, Stufe 1 (W9.1, Spezifikation 7.8.3): Ist ein Anhang der eigentliche Inhalt der Mail
// („Anbei die Rechnung“), hilfreich oder unwichtig? Das Modell sieht nur Betreff, gekürzten Mailtext und je Anhang
// Name, Typ, Größe und einen kurzen Ausschnitt – nie das ganze Dokument. Der Code prüft und hat einen Rückfall ohne KI.
// Grundsatz: lieber einmal zu viel lesen als eine Rechnung übersehen.

export const attachmentRelevancePromptVersion = 1;

export const attachmentDocumentTypes = ["Rechnung", "Vertrag", "Angebot", "Kündigung", "Buchung", "Ticket", "Kontoauszug", "Lebenslauf", "Präsentation", "Foto", "Bescheid", "Formular", "Sonstiges"] as const;
export type DocumentTypeName = (typeof attachmentDocumentTypes)[number];

export interface RelevanceAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  pageCount?: number | null;
  /** Anfang des Textes (falls lesbar) */
  snippet?: string | null;
  locked?: boolean;
}

export interface RelevanceMail {
  subject: string;
  from: string;
  body: string;
}

export interface RelevanceResult {
  id: string;
  relevance: AttachmentRelevance;
  documentType: DocumentTypeName;
  reason: string;
}

export const snippetChars = 500;

// --- Regeln (ohne KI, und zum Prüfen der KI) ---

const typeWords: [DocumentTypeName, RegExp][] = [
  ["Rechnung", /\b(rechnung|invoice|faktura|quittung|receipt|beleg|gutschrift|abschlagsrechnung|zahlungserinnerung|mahnung)\w*/i],
  ["Kündigung", /\b(kündigung|kuendigung|kündigungsbestätigung)\w*/i],
  ["Vertrag", /\b(vertrag|vertr[äa]ge|contract|vereinbarung|mietvertrag|arbeitsvertrag|police|versicherungsschein)\w*/i],
  ["Angebot", /\b(angebot|kostenvoranschlag|offer|quote|quotation)\w*/i],
  ["Bescheid", /\b(bescheid|steuerbescheid|bewilligung)\w*/i],
  ["Kontoauszug", /\b(kontoauszug|depotauszug|statement|auszug)\w*/i],
  ["Ticket", /\b(ticket|fahrkarte|bordkarte|boarding|eintrittskarte|e-?ticket)\w*/i],
  ["Buchung", /\b(buchung|booking|reservierung|reservation|buchungsbestätigung|hotel)\w*/i],
  ["Lebenslauf", /\b(lebenslauf|cv|curriculum|bewerbung|anschreiben|zeugnis)\w*/i],
  ["Präsentation", /\b(präsentation|praesentation|slides|folien|deck)\w*|\.(pptx?|key)$/i],
  ["Formular", /\b(formular|antrag|vollmacht|einverständnis|anmeldung)\w*/i],
];

/** Dokumentart aus Dateiname und Textanfang */
export function guessDocumentType(attachment: Pick<RelevanceAttachment, "filename" | "mimeType" | "snippet">): DocumentTypeName {
  const name = attachment.filename.replace(/[_.-]+/g, " ");
  for (const [type, re] of typeWords) if (re.test(name)) return type;
  const head = (attachment.snippet ?? "").slice(0, 300);
  for (const [type, re] of typeWords) if (re.test(head)) return type;
  if (attachment.mimeType.startsWith("image/")) return "Foto";
  return "Sonstiges";
}

const refersToAttachment = /\b(anbei|im anhang|in der anlage|als anlage|angehängt|angehaengt|beigefügt|beigefuegt|attached|attachment|findest du|finden sie)\b/i;

/** Regel-Urteil: zentral, wenn die Mail auf den Anhang verweist (bzw. auf seine Art) – sonst unterstützend. */
export function ruleRelevance(mail: RelevanceMail, attachments: RelevanceAttachment[]): RelevanceResult[] {
  const text = `${mail.subject}\n${mail.body}`;
  const refers = refersToAttachment.test(text);
  return attachments.map((attachment) => {
    const documentType = guessDocumentType(attachment);
    const named = documentType !== "Sonstiges" && documentType !== "Foto" && (typeWords.find(([t]) => t === documentType)?.[1].test(text) ?? false);
    if (named && refers) return { id: attachment.id, relevance: "central", documentType, reason: `Die Mail verweist auf den Anhang (${documentType}).` };
    if (refers && attachments.length === 1) return { id: attachment.id, relevance: "central", documentType, reason: "Die Mail verweist auf den einzigen Anhang." };
    if (named) return { id: attachment.id, relevance: "central", documentType, reason: `${documentType}, in der Mail erwähnt.` };
    return { id: attachment.id, relevance: "supporting", documentType, reason: "Kein klarer Bezug in der Mail – bei Bedarf lesen." };
  });
}

// --- Modell ---

export const attachmentRelevanceSchema: JsonSchema = {
  type: "object",
  properties: {
    anhaenge: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nr: { type: "number" },
          relevanz: { type: "string", enum: ["zentral", "unterstützend", "unwichtig"] },
          art: { type: "string", enum: [...attachmentDocumentTypes] },
          grund: { type: "string", maxLength: 160 },
        },
        required: ["nr", "relevanz", "art", "grund"],
        additionalProperties: false,
      },
    },
  },
  required: ["anhaenge"],
  additionalProperties: false,
};

export function attachmentRelevancePrompt(mail: RelevanceMail, attachments: RelevanceAttachment[]): AIMessage[] {
  const list = attachments
    .map((a, i) => {
      const meta = [a.mimeType, `${Math.max(1, Math.round(a.size / 1024))} KB`, a.pageCount ? `${a.pageCount} Seiten` : "", a.locked ? "passwortgeschützt" : ""].filter(Boolean).join(", ");
      const snippet = a.snippet ? `\n   Anfang: ${truncate(a.snippet.replace(/\s+/g, " "), snippetChars)}` : "";
      return `${i + 1}. ${a.filename} (${meta})${snippet}`;
    })
    .join("\n");
  return [
    {
      role: "system",
      content: `Du prüfst die Anhänge einer E-Mail: Ist der Anhang wichtig, um die Mail zu verstehen? Antworte nur mit JSON:
{"anhaenge": [{"nr": 1, "relevanz": "zentral" | "unterstützend" | "unwichtig", "art": "${attachmentDocumentTypes.join('" | "')}", "grund": "ein kurzer Satz"}]}
- zentral: Der Anhang IST der eigentliche Inhalt (z. B. „Anbei die Rechnung“, der Vertrag zum Unterschreiben, das Ticket, der Bescheid).
- unterstützend: hilfreich, aber die Mail ist auch ohne verständlich (Fotos, Zusatzinfos, Präsentation zum Nachlesen).
- unwichtig: Werbung, Standardtexte, Newsletter-Beilagen, Logos.
- Im Zweifel zwischen zentral und unterstützend: zentral. Eine Zeile je Anhang.`,
    },
    { role: "user", content: `Von: ${mail.from}\nBetreff: ${mail.subject}\n\n${cleanMailText(mail.body, 1500)}\n\nAnhänge:\n${list}` },
  ];
}

const relevanceWord: Record<string, AttachmentRelevance> = { zentral: "central", "unterstützend": "supporting", unterstuetzend: "supporting", unwichtig: "irrelevant" };

/** Prüft die Modellantwort gegen die Regeln: Verweist die Mail klar auf einen Anhang, wird er nie „unwichtig“. */
export function parseAttachmentRelevance(text: string, mail: RelevanceMail, attachments: RelevanceAttachment[]): RelevanceResult[] | null {
  const value = extractJson(text) as { anhaenge?: unknown } | null;
  if (!value || !Array.isArray(value.anhaenge)) return null;
  const rules = ruleRelevance(mail, attachments);
  const out: RelevanceResult[] = [];
  for (const [index, attachment] of attachments.entries()) {
    const rule = rules[index];
    if (!rule) continue;
    const item = (value.anhaenge as Record<string, unknown>[]).find((x) => Number(x?.nr) === index + 1);
    const relevance = item ? relevanceWord[String(item.relevanz ?? "").toLowerCase()] : undefined;
    if (!item || !relevance) {
      out.push(rule);
      continue;
    }
    const art = attachmentDocumentTypes.find((t) => t.toLowerCase() === String(item.art ?? "").toLowerCase()) ?? rule.documentType;
    // Art aus dem Dateinamen schlägt die Vermutung des Modells (Name ist eindeutiger Beleg)
    const documentType = rule.documentType !== "Sonstiges" && rule.documentType !== "Foto" ? rule.documentType : art;
    const reason = truncate(String(item.grund ?? "").trim(), 160) || rule.reason;
    if (rule.relevance === "central" && relevance !== "central") {
      out.push({ ...rule, documentType, reason: `${rule.reason} (KI: ${relevance === "irrelevant" ? "unwichtig" : "unterstützend"})` });
      continue;
    }
    out.push({ id: attachment.id, relevance, documentType, reason });
  }
  return out;
}

/** Relevanz der Anhänge einer Mail per Modell (höchstens 8 Anhänge je Anfrage). Fehler gehen an den Aufrufer. */
export async function checkAttachmentRelevance(
  router: AIRouter,
  mail: RelevanceMail,
  attachments: RelevanceAttachment[],
  options: { accountIds: string[]; signal?: AbortSignal },
): Promise<{ results: RelevanceResult[]; durationMs: number; fromModel: boolean }> {
  const batch = attachments.slice(0, 8);
  const request: AIRequest = { task: "attachmentRelevance", messages: attachmentRelevancePrompt(mail, batch), jsonSchema: attachmentRelevanceSchema, maxTokens: 120 + 80 * batch.length, temperature: 0.1 };
  let durationMs = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await router.run(request, { accountIds: options.accountIds }, options.signal);
    durationMs += response.durationMs;
    const parsed = parseAttachmentRelevance(response.text, mail, batch);
    if (parsed) return { results: [...parsed, ...ruleRelevance(mail, attachments.slice(8))], durationMs, fromModel: true };
  }
  return { results: ruleRelevance(mail, attachments), durationMs, fromModel: false };
}
