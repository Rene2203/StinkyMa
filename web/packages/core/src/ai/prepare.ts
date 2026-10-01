import { displayName, type Message } from "../models.js";

// Eingaben für die KI kurz und sauber halten (5.7): kleine Modelle haben ein kleines Kontextfenster und
// werden durch Zitate, Signaturen und Newsletter-Ballast schlechter.

const quoteIntro = /^\s*(am|on)\s.+(schrieb|wrote)[^:]*:\s*$/i;
const originalMarker = /^\s*-{2,}\s*(original|urspr(ü|ue)ngliche|weitergeleitete|forwarded)\s+(message|nachricht)/i;
const footerMarker = /(abmelden|abbestellen|unsubscribe|newsletter abbestellen|diese e-mail wurde (automatisch )?versendet|impressum|datenschutzerklärung)/i;

/** Mailtext ohne Zitate, Signatur und Fußzeilen; Leerraum zusammengefasst; auf `maxChars` gekürzt. */
export function cleanMailText(text: string, maxChars: number): string {
  const kept: string[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(">")) continue;
    if (quoteIntro.test(trimmed) || originalMarker.test(trimmed)) break;
    if (trimmed === "--" || trimmed === "-- ") break; // Signatur
    kept.push(trimmed);
  }
  let result = kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  // Fußzeilen (Newsletter, Impressum) nur am Ende abschneiden – im letzten Viertel suchen
  const footerAt = result.search(footerMarker);
  if (footerAt > result.length * 0.6) result = result.slice(0, footerAt).trim();
  return truncate(result, maxChars);
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "));
  return `${lastBreak > maxChars * 0.7 ? cut.slice(0, lastBreak + 1) : cut} […]`;
}

/** Kopf + bereinigter Text einer Mail, so wie das Modell sie sieht. */
export function mailForModel(message: Message, maxChars: number, extra?: { attachmentNames?: string[]; ownAddresses?: string[] }): string {
  const own = extra?.ownAddresses?.some((a) => a.toLowerCase() === message.from.address.toLowerCase()) ?? false;
  const lines = [
    // Kleine Modelle verwechseln sonst leicht, wer schreibt – eigene Mails ausdrücklich kennzeichnen.
    `Von: ${displayName(message.from)} <${message.from.address}>${own ? " (Nutzer)" : ""}`,
    `Betreff: ${message.subject || "(kein Betreff)"}`,
    `Datum: ${message.date.slice(0, 10)}`,
  ];
  if (extra?.attachmentNames?.length) lines.push(`Anhänge: ${extra.attachmentNames.join(", ")}`);
  lines.push("", cleanMailText(message.bodyText ?? message.snippet, maxChars));
  return lines.join("\n");
}

/**
 * Konversation für die Zusammenfassung: neueste Mails haben Vorrang. Passt nicht alles hinein, werden ältere
 * Mails auf ihren Anfang gekürzt bzw. weggelassen (mit Hinweis), statt die neuesten abzuschneiden.
 */
export function threadForModel(thread: Message[], maxChars: number, ownAddresses: string[] = []): string {
  const ordered = [...thread].sort((a, b) => a.date.localeCompare(b.date));
  const perMail = Math.max(400, Math.floor(maxChars / Math.max(1, ordered.length)));
  const parts: string[] = [];
  let used = 0;
  for (const message of [...ordered].reverse()) {
    const budget = Math.min(perMail * 2, maxChars - used);
    if (budget < 300) {
      parts.push(`[${ordered.length - parts.length} ältere Nachricht(en) ausgelassen]`);
      break;
    }
    const block = mailForModel(message, budget, { ownAddresses });
    parts.push(block);
    used += block.length;
  }
  return parts.reverse().join("\n\n---\n\n");
}
