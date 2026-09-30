import { convert } from "html-to-text";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { EmailAddress } from "../models.js";
import { makeSnippet } from "../mockData.js";

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
  isInline: boolean;
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
    attachments: mail.attachments.map((a) => ({
      filename: a.filename ?? "Anhang",
      mimeType: a.contentType,
      size: a.size,
      contentId: a.cid ?? null,
      isInline: a.related || a.contentDisposition === "inline",
    })),
  };
}
