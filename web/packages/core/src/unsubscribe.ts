// Newsletter abbestellen über die Abmelde-Angabe im Mail-Kopf (List-Unsubscribe, RFC 2369; Ein-Klick: RFC 8058).
// Abbestellt wird nur auf ausdrücklichen Klick. Bei Spam-Verdacht rät die App ab: Ein Klick bestätigt dort nur, dass die
// Adresse gelesen wird – besser löschen bzw. blockieren.

export interface UnsubscribeInfo {
  /** HTTPS-Adresse für die Ein-Klick-Abmeldung (POST „List-Unsubscribe=One-Click“) */
  oneClickUrl: string | null;
  /** Abmelde-Webseite, nur https (öffnet im Browser, dort muss man evtl. noch bestätigen) */
  url: string | null;
  /** Abmelde-Mail */
  mailto: { address: string; subject: string; body: string } | null;
}

export type UnsubscribeMethod = "oneClick" | "mail" | "web";

export interface UnsubscribeView {
  messageId: string;
  /** Absender-Adresse (klein) */
  sender: string;
  /** null = die Mail bietet keine Abmeldung an */
  info: UnsubscribeInfo | null;
  /** Welcher Weg genommen würde */
  method: UnsubscribeMethod | null;
  /** Schon abbestellt (für diesen Absender) */
  done: { method: UnsubscribeMethod; at: string } | null;
  /** Von der KI als verdächtig eingeordnet – Abbestellen nicht empfohlen */
  suspicious: boolean;
}

export interface UnsubscribeResult {
  method: UnsubscribeMethod;
  /** Bei „web“: diese Seite öffnet die Oberfläche im Browser */
  url?: string;
}

/** Nur https (die App öffnet nichts Unverschlüsseltes), keine Zugangsdaten in der Adresse. */
function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseMailto(value: string): UnsubscribeInfo["mailto"] {
  if (!/^mailto:/i.test(value)) return null;
  const [rawAddress = "", query = ""] = value.slice("mailto:".length).split("?");
  let address: string;
  try {
    address = decodeURIComponent(rawAddress).trim();
  } catch {
    return null;
  }
  // Nur eine einfache Adresse – keine Listen, keine Header-Tricks
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address)) return null;
  const params = new URLSearchParams(query);
  const clean = (v: string | null, fallback: string) => (v ?? fallback).replace(/[\r\n]+/g, " ").trim().slice(0, 200) || fallback;
  return { address, subject: clean(params.get("subject"), "unsubscribe"), body: clean(params.get("body"), "unsubscribe") };
}

/** Liest „List-Unsubscribe“ (und „List-Unsubscribe-Post“). Gibt null zurück, wenn nichts Brauchbares drinsteht. */
export function parseListUnsubscribe(header: string | null | undefined, post: string | null | undefined): UnsubscribeInfo | null {
  if (!header) return null;
  const entries = [...header.matchAll(/<([^>]+)>/g)].map((m) => (m[1] ?? "").replace(/\s+/g, ""));
  let url: string | null = null;
  let mailto: UnsubscribeInfo["mailto"] = null;
  for (const entry of entries) {
    if (!mailto && /^mailto:/i.test(entry)) mailto = parseMailto(entry);
    else if (!url && /^https?:/i.test(entry)) url = safeUrl(entry);
  }
  const oneClick = !!post && /List-Unsubscribe\s*=\s*One-Click/i.test(post) && url ? url : null;
  if (!url && !mailto) return null;
  return { oneClickUrl: oneClick, url, mailto };
}

/** Bevorzugter Weg: Ein-Klick (kein Browser, keine Mail), dann Abmelde-Mail, dann Webseite. */
export function unsubscribeMethod(info: UnsubscribeInfo | null): UnsubscribeMethod | null {
  if (!info) return null;
  if (info.oneClickUrl) return "oneClick";
  if (info.mailto) return "mail";
  if (info.url) return "web";
  return null;
}

/** Kopfzeilen aus einer Rohmail bzw. einem Header-Block holen (Folgezeilen zusammengefügt). */
export function headerValue(headers: string, name: string): string | null {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const match = new RegExp(`^${name}:[ \\t]*(.*)$`, "im").exec(unfolded);
  return match?.[1]?.trim() || null;
}
