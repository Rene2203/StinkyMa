import { createHash } from "node:crypto";

/**
 * Konversations-ID aus den Kopfzeilen: Wurzel ist der erste Eintrag in `References`, sonst `In-Reply-To`,
 * sonst die eigene `Message-ID`. Deterministisch – Antworten landen ohne Nachschlagen im selben Thread,
 * auch wenn sie vor der Ursprungsmail abgeholt werden. Pro Konto getrennt.
 */
export function threadIdFor(
  accountId: string,
  headers: { messageId?: string | null; inReplyTo?: string | null; references?: string[] | string | null },
  fallback: string,
): string {
  const references = normalizeIds(headers.references);
  const root = references[0] ?? normalizeIds(headers.inReplyTo)[0] ?? normalizeIds(headers.messageId)[0] ?? fallback;
  return `thread-${createHash("sha1").update(`${accountId}\n${root}`).digest("hex").slice(0, 20)}`;
}

export function normalizeIds(value: string[] | string | null | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .flatMap((v) => v.match(/<[^<>]+>/g) ?? (v.trim() ? [v.trim()] : []))
    .map((id) => id.toLowerCase());
}

/** Betreff ohne „Re:“, „AW:“, „Fwd:“, „WG:“ – für den Thread-Titel. */
export function baseSubject(subject: string): string {
  let result = subject.trim();
  const prefix = /^(re|aw|antw|fwd?|wg|tr)(\[\d+\])?\s*:\s*/i;
  while (prefix.test(result)) result = result.replace(prefix, "");
  return result || subject.trim();
}
