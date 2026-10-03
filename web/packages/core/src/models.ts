// Plattformneutrale Modelle – Gegenstück zu MailCore (Swift). Spezifikation, Abschnitt 8.

export interface EmailAddress {
  name?: string | null;
  address: string;
}

export type MailProvider = "icloud" | "gmail" | "outlook" | "yahoo" | "imap";
export type AuthType = "password" | "oauth2";
/** Verbindungssicherheit: TLS ab Verbindungsbeginn (993/465), STARTTLS (143/587) oder – nur für Tests – ohne. */
export type ConnectionSecurity = "tls" | "starttls" | "none";
export type AccountColor = "blue" | "green" | "orange" | "purple" | "pink" | "teal" | "red" | "yellow";

export interface Account {
  id: string;
  email: string;
  displayName: string;
  provider: MailProvider;
  /** Anmeldename am Server; meist die Mail-Adresse. */
  username: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: ConnectionSecurity;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: ConnectionSecurity;
  authType: AuthType;
  color: AccountColor;
  /** Nutzer-Freigabe: Darf eine Cloud-KI Mails dieses Kontos verarbeiten? Standard: nein (5.0). */
  aiCloudAllowed: boolean;
  /** Türsteher: Mails unbekannter Absender erst unter „Neue Absender“ zeigen (W6.3). */
  screener?: boolean;
  sortOrder: number;
  /** Zeitpunkt des letzten erfolgreichen Abgleichs (ISO-8601), `null` = noch nie. */
  lastSyncAt?: string | null;
  /** Letzter Fehler beim Abgleich (für die Anzeige), `null` = alles gut. */
  syncError?: string | null;
  /** Signatur (HTML-Fragment aus dem Editor), wird unter neue Mails und Antworten gesetzt. */
  signatureHtml?: string | null;
  /** Wie weit zurück Mails geladen werden, in Tagen. `null` = Standard (30), `0` = alle. */
  syncDays?: number | null;
}

/** Zeitraum für den Abgleich, wenn nichts eingestellt ist (Spezifikation 4.2: zuerst die neuesten 30 Tage). */
export const defaultSyncDays = 30;
/** Auswahl in den Optionen: 30 Tage, 3 Monate, 1 Jahr, alle (0). */
export const syncDayChoices = [30, 90, 365, 0] as const;

/** Ab wann Mails dieses Kontos geladen werden. `0` = alle (ab 1970). */
export function syncSince(account: Pick<Account, "syncDays">, now: Date): Date {
  const days = account.syncDays ?? defaultSyncDays;
  return days === 0 ? new Date(0) : new Date(now.getTime() - days * 86_400_000);
}

/** Beispielkonten (Mock-Daten) erkennt man an diesem Präfix. */
export const demoAccountPrefix = "mock-";
export const isDemoAccount = (account: Pick<Account, "id">) => account.id.startsWith(demoAccountPrefix);

export type MailboxRole = "inbox" | "sent" | "drafts" | "trash" | "archive" | "spam" | "custom";

/** Reihenfolge der Ordner in der Seitenleiste. */
export const mailboxRoleRank: Record<MailboxRole, number> = {
  inbox: 0,
  drafts: 1,
  sent: 2,
  archive: 3,
  spam: 4,
  trash: 5,
  custom: 6,
};

export interface Mailbox {
  id: string;
  accountId: string;
  /** Server-Name bzw. Pfad, z. B. `INBOX`. */
  name: string;
  role: MailboxRole;
  uidValidity?: number | null;
  highestModSeq?: number | null;
}

/** IMAP-System-Flags als Bitmaske (gleiche Werte wie in der Swift-App). */
export const MessageFlag = {
  seen: 1 << 0,
  answered: 1 << 1,
  flagged: 1 << 2,
  deleted: 1 << 3,
  draft: 1 << 4,
} as const;
export type MessageFlagName = keyof typeof MessageFlag;

export type MessageCategory =
  | "personal"
  | "work"
  | "newsletter"
  | "notification"
  | "invoice"
  | "appointment"
  | "spam_suspect";

export interface Message {
  id: string;
  accountId: string;
  mailboxId: string;
  uid?: number | null;
  messageId?: string | null;
  threadId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  /** ISO-8601, UTC. */
  date: string;
  snippet: string;
  bodyText?: string | null;
  bodyHtml?: string | null;
  flags: number;
  hasAttachments: boolean;
  category?: MessageCategory | null;
  /** Eigene Kategorie des Nutzers (ID aus `userCategory`), zusätzlich zur festen Einordnung */
  userCategory?: string | null;
  priorityScore?: number | null;
  snoozedUntil?: string | null;
}

export interface MailThread {
  id: string;
  subject: string;
  participants: EmailAddress[];
  lastDate: string;
  summary?: string | null;
  summaryUpdatedAt?: string | null;
}

export type AttachmentRelevance = "central" | "supporting" | "irrelevant";
export type AttachmentAnalysisStatus = "pending" | "skipped" | "analyzed" | "locked" | "failed";

export interface Attachment {
  id: string;
  messageId: string;
  filename: string;
  mimeType: string;
  size: number;
  localPath?: string | null;
  sha256?: string | null;
  isInline: boolean;
  contentId?: string | null;
  pageCount?: number | null;
  isEncrypted: boolean;
  relevance?: AttachmentRelevance | null;
  relevanceReason?: string | null;
  documentType?: string | null;
  analysisStatus: AttachmentAnalysisStatus;
  riskFlags: number;
}

/** Welche Mails eine Liste zeigt. */
export type MessageScope =
  | { kind: "unifiedInbox" }
  | { kind: "unread" }
  | { kind: "flagged" }
  | { kind: "mailbox"; mailboxId: string }
  /** Türsteher: Mails neuer Absender, die noch auf „Erlauben“ oder „Blockieren“ warten */
  | { kind: "screener" }
  /** Wichtige Mails im Posteingang (Priorisierung W8.3) */
  | { kind: "important" }
  /** Alle Mails einer Kategorie (Posteingang, Archiv, eigene Ordner): feste Kategorie oder eigene als `u:<id>` */
  | { kind: "category"; category: string };

export function scopeKey(scope: MessageScope): string {
  return scope.kind === "mailbox" ? `mailbox:${scope.mailboxId}` : scope.kind === "category" ? `category:${scope.category}` : scope.kind;
}

export function isRead(message: Pick<Message, "flags">): boolean {
  return (message.flags & MessageFlag.seen) !== 0;
}

export function isFlagged(message: Pick<Message, "flags">): boolean {
  return (message.flags & MessageFlag.flagged) !== 0;
}

export function displayName(address: EmailAddress): string {
  const name = address.name?.trim();
  return name ? name : address.address;
}

/** Bis zu zwei Initialen für Avatare, z. B. „AB“ für „Anna Beispiel“. */
export function initials(address: EmailAddress): string {
  const name = address.name?.trim();
  const source = name ? name : address.address.split("@")[0] ?? "";
  const words = source.split(/[\s._-]+/).filter((w) => /^\p{L}/u.test(w));
  const picked = words.length >= 2 ? [words[0]!, words[words.length - 1]!] : words.slice(0, 1);
  const result = picked.map((w) => w[0]!.toUpperCase()).join("");
  return result || "?";
}

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
}
