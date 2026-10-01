import type { EmailAddress, MessageCategory } from "./models.js";

// Aufräumen: Wo kommen viele Mails her (Absender oder Domain)? Alles davon in den Papierkorb – außer Mails, die man
// behalten sollte (Rechnungen, Bestellungen, Tickets, Zugangsdaten …). Der Schutz kommt aus einfachen Regeln (läuft
// sofort, auch ohne KI) und aus der KI-Einordnung, wo vorhanden. Gelöscht wird nur auf Klick, und nur in den Papierkorb.

export type CleanupGroupBy = "address" | "domain";

/** Warum eine Mail geschützt ist (wird nicht vorausgewählt). */
export type ProtectReason =
  | "invoice"
  | "order"
  | "contract"
  | "ticket"
  | "account"
  | "security"
  | "document"
  | "appointment"
  | "personal"
  | "flagged"
  | "answered"
  | "attachment"
  | "openAction";

export const protectReasons: readonly ProtectReason[] = [
  "invoice", "order", "contract", "ticket", "account", "security", "document", "appointment", "personal", "flagged", "answered", "attachment", "openAction",
];

export interface CleanupGroup {
  /** Adresse (klein) oder Domain */
  key: string;
  groupBy: CleanupGroupBy;
  /** Häufigster Anzeigename */
  name: string | null;
  count: number;
  unread: number;
  /** Davon geschützt (werden beim Löschen nicht vorausgewählt) */
  protectedCount: number;
  /** Noch nicht von der KI eingeordnet */
  uncategorized: number;
  newest: string;
  oldest: string;
  /** Für „Domain“: wie viele verschiedene Adressen */
  addresses: number;
}

export interface CleanupMail {
  id: string;
  accountId: string;
  from: EmailAddress;
  subject: string;
  date: string;
  unread: boolean;
  category: MessageCategory | null;
  /** Grund, warum die Mail besser bleibt; null = kann weg */
  protect: ProtectReason | null;
}

export interface CleanupGroupsQuery {
  accountId: string | null;
  groupBy: CleanupGroupBy;
  /** Höchstens so viele Gruppen (die größten zuerst) */
  limit: number;
  /** Nur Gruppen ab dieser Größe */
  minCount?: number;
}

export interface CleanupApi {
  /** Die größten Absender bzw. Domains (Posteingang, Archiv, eigene Ordner – ohne Papierkorb, Spam, Gesendet, Entwürfe). */
  groups(query: CleanupGroupsQuery): Promise<CleanupGroup[]>;
  /** Alle Mails einer Gruppe, neueste zuerst, mit Schutzgrund. */
  groupMails(key: string, groupBy: CleanupGroupBy, accountId: string | null, limit: number): Promise<CleanupMail[]>;
  /** Ausgewählte Mails in den Papierkorb – nur auf ausdrücklichen Klick. */
  trash(messageIds: string[]): Promise<{ moved: number }>;
  /** Noch nicht eingeordnete Mails einer Gruppe von der KI einordnen lassen (vorrangig). Gibt die Anzahl zurück. */
  check(key: string, groupBy: CleanupGroupBy, accountId: string | null): Promise<{ queued: number }>;
}

export const cleanupApiMethods = ["groups", "groupMails", "trash", "check"] as const satisfies readonly (keyof CleanupApi)[];

// Zweistufige Domains, bei denen die registrierte Domain drei Teile hat („shop.co.uk“).
const secondLevel = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "com.au", "net.au", "org.au", "co.at", "or.at", "gv.at", "ac.at", "com.br", "co.jp", "ne.jp", "or.jp", "co.nz", "co.za", "com.tr", "com.mx", "com.cn", "co.in", "co.kr"]);

/** Domain eines Absenders, zusammengefasst auf die registrierte Domain („news.shop.example“ → „shop.example“). */
export function registeredDomain(address: string): string {
  const host = address.toLowerCase().split("@").pop()?.trim() ?? "";
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  return secondLevel.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

export function groupKey(address: string, groupBy: CleanupGroupBy): string {
  return groupBy === "domain" ? registeredDomain(address) : address.toLowerCase().trim();
}

/** Für eine Regel „künftige Mails auch löschen“: Absender-Muster, die genau diese Gruppe treffen. */
export function groupRuleFrom(key: string, groupBy: CleanupGroupBy): string[] {
  return groupBy === "domain" ? [`@${key}`, `.${key}`] : [key];
}

// Betreff: breiter (der Betreff sagt, worum es geht). Text: nur eindeutige Formulierungen – Newsletter-Fußzeilen
// enthalten oft „Support“, „Kundennummer“ oder „Passwort vergessen?“.
const subjectRules: [ProtectReason, RegExp][] = [
  ["invoice", /\b(rechnung|rechnungs\w*|invoice|beleg|quittung|receipt|zahlungsbest[äa]tigung|zahlungseingang|kontoauszug|lastschrift|mahnung|zahlungserinnerung|gutschrift|abrechnung|payment (received|confirmation))/i],
  ["order", /\b(bestellung|bestellbest[äa]tigung|auftragsbest[äa]tigung|versandbest[äa]tigung|lieferbest[äa]tigung|ihre bestellung|deine bestellung|order (confirmation|#|no)|your order|has shipped|wurde versandt|buchungsbest[äa]tigung|reservierungsbest[äa]tigung|booking confirmation)/i],
  ["contract", /\b(vertrag|vertrags\w*|k[üu]ndigung|versicherungsschein|police\b|vertragsbest[äa]tigung|contract)/i],
  ["ticket", /(\bticket\s*(#|nr|nummer|id)|\[#?\d{3,}\]|\b(case|fall|vorgang|anfrage)\s*(#|nr\.?|nummer)\s*\d|\bsupport[- ]?(anfrage|ticket|request)|ihre anfrage|deine anfrage|your request)/i],
  ["account", /\b(passwort|kennwort|password|zugangsdaten|anmeldedaten|benutzername|username|konto (er[öo]ffnet|erstellt|best[äa]tigen|aktivieren)|account (created|confirm|activation|verification)|e-?mail(-adresse)? best[äa]tigen|verify your (e-?mail|account)|registrierung best[äa]tigen|willkommen bei|welcome to)/i],
  ["security", /\b(sicherheitscode|best[äa]tigungscode|verifizierungscode|einmalcode|verification code|security code|2fa|zwei-faktor|two-factor|wiederherstellung|recovery|neue anmeldung|new sign-in|sign-in attempt|login alert|sicherheitswarnung|security alert|sicherheitshinweis)/i],
  ["document", /\b(steuer\w*|finanzamt|lohnabrechnung|gehaltsabrechnung|lohnsteuer|sozialversicherung|lizenz(schl[üu]ssel)?|license key|garantie|warranty|zeugnis|bescheinigung|urkunde)/i],
];

const bodyRules: [ProtectReason, RegExp][] = [
  ["invoice", /\b(rechnungsnummer|rechnungsbetrag|rechnungsdatum|invoice (number|no\.?|#)|ihre rechnung|deine rechnung|anbei (die|ihre|deine) rechnung)/i],
  ["order", /\b(bestellnummer|auftragsnummer|order (number|no\.?|#)|sendungsnummer|tracking number)/i],
  ["contract", /\b(vertragsnummer|versicherungsnummer|policennummer)/i],
  ["ticket", /\b(ticketnummer|ticket-nr|ticket id|vorgangsnummer|fallnummer|case number)/i],
  ["account", /\b(ihr (neues |tempor[äa]res )?passwort (lautet|ist)|dein (neues |tempor[äa]res )?passwort (lautet|ist)|your (new |temporary )?password is|ihre zugangsdaten|deine zugangsdaten|ihr benutzername|dein benutzername|your username)/i],
  ["security", /\b(ihr (best[äa]tigungs|sicherheits|einmal)code|dein (best[äa]tigungs|sicherheits|einmal)code|your (verification|security|one-time) code)/i],
];

export interface ProtectInput {
  subject: string;
  /** Anfang des Textes (wenige tausend Zeichen genügen) */
  body: string;
  category: MessageCategory | null;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
  hasOpenAction: boolean;
}

/**
 * Sollte diese Mail bleiben? Reihenfolge: eigene Spuren (markiert, beantwortet), dann Inhalt, dann KI-Einordnung.
 * Von der KI als verdächtig eingeordnete Mails schützt der Inhalt nicht – „Ihr Passwort läuft ab“ ist dort meist Phishing.
 */
export function protectReason(mail: ProtectInput): ProtectReason | null {
  if (mail.flagged) return "flagged";
  if (mail.answered) return "answered";
  if (mail.category === "spam_suspect") return null;
  for (const [reason, pattern] of subjectRules) if (pattern.test(mail.subject)) return reason;
  for (const [reason, pattern] of bodyRules) if (pattern.test(mail.body)) return reason;
  if (mail.hasOpenAction) return "openAction";
  if (mail.category === "invoice") return "invoice";
  if (mail.category === "appointment") return "appointment";
  if (mail.category === "personal" || mail.category === "work") return "personal";
  if (mail.hasAttachments && mail.category !== "newsletter") return "attachment";
  return null;
}
