import type { Account, EmailAddress, Message } from "./models.js";
import type { OutgoingAttachment } from "./files.js";

// Mails schreiben: Antworten, Allen antworten, Weiterleiten. Plattformneutral (kein Node, kein DOM),
// damit Windows-App, Server und später iPad dieselben Regeln nutzen.

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

/** Eine Mail, die gesendet werden soll – so, wie der Nutzer sie im Composer geschrieben hat. */
export interface OutgoingMail {
  accountId: string;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  /** Nur-Text-Fassung (immer vorhanden – für schlichte Mailprogramme und die Vorschau). */
  bodyText: string;
  /** Formatierte Fassung aus dem Editor (HTML-Fragment ohne <html>/<body>); fehlt bei reinen Textmails. */
  bodyHtml?: string | null;
  /** Angehängte Dateien. */
  attachments?: OutgoingAttachment[];
  /** Message-ID der beantworteten Mail (für In-Reply-To). */
  inReplyTo?: string | null;
  /** Kette der Message-IDs der Konversation, älteste zuerst (für References). */
  references?: string[];
  /** Lokale ID der beantworteten Mail – wird nach dem Senden als „beantwortet“ markiert. */
  answeredMessageId?: string | null;
  /** Entwurf, aus dem diese Mail entstanden ist – wird nach dem Senden gelöscht. */
  draftId?: string | null;
}

/** Vorbelegung des Composers. */
export interface ComposeDraft extends OutgoingMail {
  mode: ComposeMode;
}

/** Texte für Zitat-Kopf und Weiterleitung – kommen aus der Oberfläche (Sprache). */
export interface ComposeLabels {
  /** z. B. „Am 30.09.2026 um 21:16 schrieb Anna <anna@example.org>:“ */
  wrote: (message: Message) => string;
  /** Kopf über einer weitergeleiteten Mail, mehrzeilig. */
  forwardHeader: (message: Message) => string;
}

const replyPrefix = /^\s*(re|aw|antw|sv)(\[\d+\])?\s*:/i;
const forwardPrefix = /^\s*(fwd?|wg|tr)(\[\d+\])?\s*:/i;

export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  return replyPrefix.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

export function forwardSubject(subject: string): string {
  const trimmed = subject.trim();
  return forwardPrefix.test(trimmed) ? trimmed : `Fwd: ${trimmed}`;
}

/** Zitiert Text mit „> “ vor jeder Zeile. */
export function quoteText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n+$/, "")
    .split("\n")
    .map((line) => (line.startsWith(">") ? `>${line}` : `> ${line}`))
    .join("\n");
}

/**
 * Belegt den Composer vor. `thread` ist die Konversation (älteste zuerst) für die References-Kette,
 * `ownAddresses` die eigenen Adressen – die fallen bei „Allen antworten“ heraus.
 */
export function prepareCompose(
  mode: ComposeMode,
  options: {
    account: Pick<Account, "id" | "email">;
    original?: Message | null;
    thread?: Message[];
    ownAddresses?: string[];
    labels: ComposeLabels;
  },
): ComposeDraft {
  const { account, original, labels } = options;
  const empty: ComposeDraft = { mode: "new", accountId: account.id, to: [], cc: [], bcc: [], subject: "", bodyText: "" };
  if (mode === "new" || !original) return empty;

  const body = original.bodyText ?? original.snippet;
  if (mode === "forward") {
    return {
      ...empty,
      mode,
      accountId: original.accountId,
      subject: forwardSubject(original.subject),
      bodyText: `\n\n${labels.forwardHeader(original)}\n\n${body.replace(/\n+$/, "")}\n`,
      bodyHtml: `<p></p><p></p>${textToHtml(labels.forwardHeader(original))}<p></p>${textToHtml(body)}`,
    };
  }

  const own = new Set([account.email, ...(options.ownAddresses ?? [])].map((a) => a.toLowerCase()));
  const isOwn = (a: EmailAddress) => own.has(a.address.toLowerCase());
  const fromMe = isOwn(original.from);
  // Antwort auf eine eigene (gesendete) Mail geht an deren Empfänger, nicht an mich selbst.
  let to = fromMe ? original.to.filter((a) => !isOwn(a)) : [original.from];
  let cc: EmailAddress[] = [];
  if (mode === "replyAll") {
    to = unique([...to, ...original.to.filter((a) => !isOwn(a))]);
    cc = unique(original.cc.filter((a) => !isOwn(a))).filter((a) => !to.some((t) => sameAddress(t, a)));
  }

  const threadIds = (options.thread ?? [])
    .filter((m) => m.date <= original.date)
    .map((m) => m.messageId)
    .filter((id): id is string => Boolean(id));
  const references = uniqueStrings([...threadIds, ...(original.messageId ? [original.messageId] : [])]);

  return {
    ...empty,
    mode,
    accountId: original.accountId,
    to,
    cc,
    subject: replySubject(original.subject),
    bodyText: `\n\n${labels.wrote(original)}\n${quoteText(body)}\n`,
    bodyHtml: `<p></p><p></p>${textToHtml(labels.wrote(original))}<blockquote>${textToHtml(body)}</blockquote>`,
    inReplyTo: original.messageId ?? null,
    references,
    answeredMessageId: original.id,
  };
}

/** Text → HTML-Absätze (eine Zeile = ein Absatz, Sonderzeichen maskiert). Zitierte Zeilen („> “) werden eingerückt. */
export function textToHtml(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  let html = "";
  let depth = 0;
  for (const line of lines) {
    const level = /^(>\s?)+/.exec(line)?.[0].replace(/\s/g, "").length ?? 0;
    while (depth < level) { html += "<blockquote>"; depth++; }
    while (depth > level) { html += "</blockquote>"; depth--; }
    const content = line.replace(/^(>\s?)+/, "");
    html += content ? `<p>${escapeHtml(content)}</p>` : "<p></p>";
  }
  while (depth > 0) { html += "</blockquote>"; depth--; }
  return html;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Grundschrift gesendeter Mails, wenn der Nutzer nichts anderes wählt – auf allen Systemen vorhanden. */
export const defaultMailFont = { family: "Arial, Helvetica, sans-serif", size: "11pt" };

/**
 * Macht aus dem Editor-HTML eine versandfertige HTML-Mail: Stile inline (Mailprogramme ignorieren <style>
 * oft), Absätze ohne Abstand wie in Outlook/Apple Mail, leere Zeilen bleiben sichtbar, Zitate mit Linie.
 */
export function emailHtml(fragment: string): string {
  const body = fragment
    .replace(/<p([^>]*)><\/p>/g, "<p$1><br></p>")
    .replace(/<p(?![^>]*style=)([^>]*)>/g, '<p style="margin:0"$1>')
    .replace(/<p([^>]*)style="([^"]*)"([^>]*)>/g, (match, a: string, style: string, b: string) =>
      style.includes("margin") ? match : `<p${a}style="margin:0;${style}"${b}>`)
    .replace(/<blockquote>/g, '<blockquote style="margin:0 0 0 0.8ex;border-left:2px solid #c8c8c8;padding-left:1ex;color:#555">')
    .replace(/<ul>/g, '<ul style="margin:0;padding-left:1.6em">')
    .replace(/<ol>/g, '<ol style="margin:0;padding-left:1.6em">');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><div style="font-family:${defaultMailFont.family};font-size:${defaultMailFont.size};line-height:1.4">${body}</div></body></html>`;
}

/**
 * Liest eine Empfängerzeile: „Anna <anna@example.org>, bernd@example.org; "Müller, Carl" <c@example.org>“.
 * Liefert gültige Adressen und die Teile, die keine Adresse sind.
 */
export function parseAddressList(input: string): { addresses: EmailAddress[]; invalid: string[] } {
  const addresses: EmailAddress[] = [];
  const invalid: string[] = [];
  for (const part of splitAddressList(input)) {
    const parsed = parseAddress(part);
    if (parsed) addresses.push(parsed);
    else invalid.push(part);
  }
  return { addresses: unique(addresses), invalid };
}

export function formatAddress(address: EmailAddress): string {
  if (!address.name) return address.address;
  const name = /[",;<>@]/.test(address.name) ? `"${address.name.replace(/"/g, "'")}"` : address.name;
  return `${name} <${address.address}>`;
}

export function formatAddressList(list: EmailAddress[]): string {
  return list.map(formatAddress).join(", ");
}

const addressPattern = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

function parseAddress(part: string): EmailAddress | null {
  const angle = /^(.*)<([^<>]+)>\s*$/.exec(part);
  if (angle) {
    const address = (angle[2] ?? "").trim();
    const name = (angle[1] ?? "").trim().replace(/^"(.*)"$/, "$1").trim();
    return addressPattern.test(address) ? { name: name || null, address } : null;
  }
  const address = part.trim();
  return addressPattern.test(address) ? { name: null, address } : null;
}

/** Trennt an Komma/Semikolon, aber nicht innerhalb von Anführungszeichen oder spitzen Klammern. */
function splitAddressList(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  let angle = false;
  for (const char of input) {
    if (char === '"') quoted = !quoted;
    else if (char === "<" && !quoted) angle = true;
    else if (char === ">" && !quoted) angle = false;
    if ((char === "," || char === ";" || char === "\n") && !quoted && !angle) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function sameAddress(a: EmailAddress, b: EmailAddress): boolean {
  return a.address.toLowerCase() === b.address.toLowerCase();
}

function unique(list: EmailAddress[]): EmailAddress[] {
  const result: EmailAddress[] = [];
  for (const a of list) if (!result.some((r) => sameAddress(r, a))) result.push(a);
  return result;
}

function uniqueStrings(list: string[]): string[] {
  return [...new Set(list)];
}

/**
 * Lokale Kopie einer gesendeten Mail für den Ordner „Gesendet“ – für Beispielkonten ohne Server
 * (bei echten Konten kommt die Kopie beim nächsten Abgleich vom Server).
 */
export function localSentMessage(
  mail: OutgoingMail,
  options: { id: string; mailboxId: string; from: EmailAddress; threadId: string; date: string; messageId: string },
): Message {
  const text = mail.bodyText.replace(/\r\n/g, "\n");
  return {
    id: options.id,
    accountId: mail.accountId,
    mailboxId: options.mailboxId,
    uid: null,
    messageId: options.messageId,
    threadId: options.threadId,
    from: options.from,
    to: mail.to,
    cc: mail.cc,
    subject: mail.subject,
    date: options.date,
    snippet: text.replace(/^>.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, 160),
    bodyText: text,
    bodyHtml: mail.bodyHtml ? emailHtml(mail.bodyHtml) : null,
    flags: 1, // gelesen
    hasAttachments: (mail.attachments?.length ?? 0) > 0,
  };
}

/** Lokale Mail-Zeile für einen Entwurf im Ordner „Entwürfe“ (gelesen + Entwurf). */
export function localDraftMessage(draft: OutgoingMail, options: { id: string; mailboxId: string; from: EmailAddress; date: string }): Message {
  return {
    ...localSentMessage(draft, { ...options, threadId: `thread-${options.id}`, messageId: `<${options.id}@stinkyma.local>` }),
    flags: 1 | 16, // gelesen, Entwurf
  };
}

/** Composer-Vorbelegung aus einer Mail im Ordner „Entwürfe“ (z. B. auf einem anderen Gerät angelegt). */
export function draftFromMessage(message: Message): ComposeDraft {
  return {
    mode: "new",
    accountId: message.accountId,
    to: message.to,
    cc: message.cc,
    bcc: [],
    subject: message.subject,
    bodyText: message.bodyText ?? message.snippet,
    bodyHtml: message.bodyHtml ? htmlBodyContent(message.bodyHtml) : null,
  };
}

/** Inhalt von <body> (ohne Kopf, Stile und Skripte) – für den Editor. */
function htmlBodyContent(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return body.replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "");
}

/** Ein Kontakt mit Nutzungszählern – Grundlage für Adressvorschläge. */
export interface ContactUsage {
  address: string;
  name: string | null;
  /** Wie oft man diesem Kontakt geschrieben hat (Ordner „Gesendet“). */
  sent: number;
  /** Wie oft Mails von diesem Kontakt kamen. */
  received: number;
  /** Zuletzt gesehen (ISO-8601). */
  last: string;
}

/** Sortiert und filtert Kontakte für die Vorschlagsliste (gleiche Regeln in allen Speichern). */
export function rankContacts(contacts: ContactUsage[], options: { query: string; ownAddresses: string[]; limit: number }): EmailAddress[] {
  const query = options.query.trim().toLowerCase();
  if (!query) return [];
  const own = new Set(options.ownAddresses.map((a) => a.toLowerCase()));
  const wordStart = (text: string) => text.toLowerCase().split(/[\s.@_-]+/).some((word) => word.startsWith(query));
  return contacts
    .filter((c) => !own.has(c.address.toLowerCase()) && c.address.includes("@"))
    .filter((c) => c.address.toLowerCase().includes(query) || (c.name ?? "").toLowerCase().includes(query))
    .map((c) => ({ c, score: c.sent * 5 + c.received + (wordStart(c.name ?? "") || c.address.toLowerCase().startsWith(query) ? 3 : 0) }))
    .sort((a, b) => b.score - a.score || b.c.last.localeCompare(a.c.last))
    .slice(0, options.limit)
    .map(({ c }) => ({ name: c.name, address: c.address }));
}
