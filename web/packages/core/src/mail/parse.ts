import { convert } from "html-to-text";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { EmailAddress } from "../models.js";
import { makeSnippet } from "../mockData.js";
import { isExtractable } from "./attachmentText.js";
import { headerValue, parseListUnsubscribe, type UnsubscribeInfo } from "../unsubscribe.js";

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
  isInline: boolean;
  /** Inhalt nur bei Anhängen, aus denen Text für die Suche gelesen wird (PDF, Text) – nicht gespeichert. */
  content?: Buffer;
}

export interface ParsedMessage {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  date: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string;
  attachments: ParsedAttachment[];
  /** Abmelde-Angabe (List-Unsubscribe), falls vorhanden */
  listUnsubscribe: UnsubscribeInfo | null;
}

function addresses(value: AddressObject | AddressObject[] | undefined): EmailAddress[] {
  const list = value ? (Array.isArray(value) ? value : [value]) : [];
  return list.flatMap((group) =>
    group.value.flatMap((entry) =>
      entry.group
        ? entry.group.map((g) => ({ name: g.name || null, address: g.address ?? "" }))
        : [{ name: entry.name || null, address: entry.address ?? "" }],
    ),
  ).filter((a) => a.address);
}

/** Lesbarer Text aus HTML (für Vorschau, Suche und später die KI): ohne Bilder, Links nur als Text. */
export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
      ...(["h1", "h2", "h3", "h4", "h5", "h6"].map((h) => ({ selector: h, options: { uppercase: false } }))),
      { selector: "table", format: "dataTable", options: { uppercaseHeaderCells: false } },
    ],
  }).trim();
}

/** Text für die Vorschau: ohne zitierte Zeilen und Zitat-Einleitungen. */
export function snippetFromText(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(">")) continue;
    if (/^(am|on) .+(schrieb|wrote)[^:]*:\s*$/i.test(trimmed)) break;
    if (/^-{2,}\s*(original|urspr(ü|ue)ngliche) (message|nachricht)/i.test(trimmed)) break;
    if (trimmed === "--") break; // Signatur
    kept.push(line);
  }
  return makeSnippet(kept.join("\n"));
}

/** Zerlegt eine Rohmail (RFC 5322). Anhänge nur als Metadaten – Inhalte lädt der Anhang-Reader später. */
export async function parseMessage(source: Buffer | string): Promise<ParsedMessage> {
  const mail: ParsedMail = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true, skipHtmlToText: true });
  const from = addresses(mail.from)[0] ?? { name: null, address: "unbekannt@invalid" };
  const references = typeof mail.references === "string" ? [mail.references] : mail.references ?? [];
  const bodyHtml = typeof mail.html === "string" && mail.html.trim() ? mail.html : null;
  const bodyText = mail.text?.trim() ? mail.text : bodyHtml ? htmlToText(bodyHtml) : null;
  return {
    messageId: mail.messageId ?? null,
    inReplyTo: mail.inReplyTo ?? null,
    references,
    from,
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    subject: mail.subject ?? "",
    date: mail.date ? mail.date.toISOString() : null,
    bodyText,
    bodyHtml,
    snippet: snippetFromText(bodyText ?? ""),
    listUnsubscribe: listUnsubscribeOf(mail),
    attachments: mail.attachments.map((a) => {
      const filename = a.filename ?? "Anhang";
      const isInline = a.related || a.contentDisposition === "inline";
      return {
        filename,
        mimeType: a.contentType,
        size: a.size,
        contentId: a.cid ?? null,
        isInline,
        ...(!isInline && isExtractable(filename, a.contentType, a.size) ? { content: a.content } : {}),
      };
    }),
  };
}

/** Inhalt eines Anhangs aus der Rohmail – Index wie in `parseMessage` (gleiche Reihenfolge wie beim Abgleich). */
export async function extractAttachment(source: Buffer | string, index: number): Promise<{ filename: string; mimeType: string; content: Buffer } | null> {
  const mail = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true, skipHtmlToText: true });
  const attachment = mail.attachments[index];
  if (!attachment) return null;
  return { filename: attachment.filename ?? "Anhang", mimeType: attachment.contentType, content: attachment.content };
}

function listUnsubscribeOf(mail: ParsedMail): UnsubscribeInfo | null {
  const lines = (mail.headerLines ?? []).filter((h) => h.key === "list-unsubscribe" || h.key === "list-unsubscribe-post").map((h) => h.line).join("\n");
  return lines ? parseListUnsubscribe(headerValue(lines, "List-Unsubscribe"), headerValue(lines, "List-Unsubscribe-Post")) : null;
}
