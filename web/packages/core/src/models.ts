// Plattformneutrale Modelle – Gegenstück zu MailCore (Swift). Spezifikation, Abschnitt 8.

export interface EmailAddress {
  name?: string | null;
  address: string;
}

export type MailProvider = "icloud" | "gmail" | "outlook" | "yahoo" | "imap";
export type AuthType = "password" | "oauth2";
export type AccountColor = "blue" | "green" | "orange" | "purple" | "pink" | "teal" | "red" | "yellow";

export interface Account {
  id: string;
  email: string;
  displayName: string;
  provider: MailProvider;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  authType: AuthType;
  color: AccountColor;
  /** Nutzer-Freigabe: Darf eine Cloud-KI Mails dieses Kontos verarbeiten? Standard: nein (5.0). */
  aiCloudAllowed: boolean;
  sortOrder: number;
}

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
  | { kind: "mailbox"; mailboxId: string };

export function scopeKey(scope: MessageScope): string {
  return scope.kind === "mailbox" ? `mailbox:${scope.mailboxId}` : scope.kind;
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
