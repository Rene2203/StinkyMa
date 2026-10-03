import type { Account, Attachment, EmailAddress, Mailbox, MailboxRole, Message, MessageFlagName, MessageScope } from "./models.js";
import type { ComposeDraft, OutgoingMail } from "./compose.js";

/**
 * Zugriff auf den lokalen Mail-Bestand. Die Oberfläche spricht nur mit dieser Schnittstelle –
 * in der Windows-App über IPC, später im Browser über HTTP. Gegenstück zu `MailRepository` (Swift).
 */
export interface MailRepository {
  accounts(): Promise<Account[]>;
  mailboxes(accountId: string): Promise<Mailbox[]>;
  /** Nachrichten eines Bereichs, neueste zuerst. */
  messages(scope: MessageScope, limit: number): Promise<Message[]>;
  /** Alle Nachrichten einer Konversation, älteste zuerst. */
  thread(threadId: string): Promise<Message[]>;
  message(id: string): Promise<Message | null>;
  attachments(messageId: string): Promise<Attachment[]>;
  unreadCount(scope: MessageScope): Promise<number>;
  /** Alles für die Seitenleiste in einem Aufruf: Konten, Ordner (sortiert) und Zähler ungelesener Mails. */
  overview(): Promise<MailOverview>;
  setFlag(flag: MessageFlagName, enabled: boolean, messageIds: string[]): Promise<void>;
  /** Verschiebt in den Ordner mit dieser Rolle im jeweiligen Konto; ohne solchen Ordner bleibt die Mail, wo sie ist. */
  move(messageIds: string[], role: MailboxRole): Promise<void>;
  /** Absender (Adressen oder Domains), deren externe Inhalte sofort geladen werden – alphabetisch. */
  remoteContentExceptions(): Promise<string[]>;
  /** Fügt eine Ausnahme hinzu (wird vereinheitlicht, siehe `normalizeRemoteContentException`) und gibt sie zurück. */
  addRemoteContentException(input: string): Promise<string>;
  removeRemoteContentException(exception: string): Promise<void>;
  /**
   * Sendet eine Mail – nur auf ausdrücklichen Wunsch des Nutzers (Klick auf „Senden“). Die Mail landet sofort im
   * dauerhaften Postausgang und geht raus, sobald der Server erreichbar ist; danach liegt sie in „Gesendet“.
   */
  send(mail: OutgoingMail): Promise<void>;
  /** Holt eine noch nicht gesendete Mail aus dem Postausgang zurück (zum Bearbeiten); sie wird dann nicht gesendet. */
  reopenOutgoing(id: string): Promise<OutgoingMail | null>;
  /**
   * Speichert einen Entwurf (neu: `draftId` = null) und gibt seine ID zurück. Er erscheint sofort im Ordner
   * „Entwürfe“; die Server-Kopie folgt gebündelt im Hintergrund.
   */
  saveDraft(draftId: string | null, draft: ComposeDraft): Promise<string>;
  deleteDraft(draftId: string): Promise<void>;
  /** Öffnet eine Mail aus dem Ordner „Entwürfe“ zum Weiterschreiben (auch Entwürfe von anderen Geräten). */
  openDraft(messageId: string): Promise<ComposeDraft | null>;
  /**
   * Adressvorschläge für den Composer: passend zu Name oder Adresse; wem man geschrieben hat, steht oben,
   * dann häufige und zuletzt genutzte Kontakte. Eigene Adressen fehlen.
   */
  suggestAddresses(query: string, limit: number): Promise<EmailAddress[]>;
  /**
   * Volltextsuche (Betreff, Absender, Text) – neueste zuerst. Ohne `scope` in allen Ordnern außer Papierkorb
   * und Spam. Syntax: Wörter (Wortanfang genügt), "feste Wortgruppe", von:absender.
   */
  search(query: string, options: { scope?: MessageScope | null; limit: number }): Promise<Message[]>;
  /** Signatur eines Kontos setzen (leer/`null` = keine Signatur). */
  setSignature(accountId: string, html: string | null): Promise<void>;
  /**
   * Türsteher an/aus. Beim Einschalten gelten alle bisherigen Absender des Kontos, alle Empfänger eigener Mails und die
   * eigene Adresse als bekannt – nur wirklich neue Absender landen unter „Neue Absender“.
   */
  setScreener(accountId: string, enabled: boolean): Promise<void>;
  /**
   * Wie weit zurück Mails geladen werden (Tage; `null` = Standard 30, `0` = alle). Kürzer: ältere Mails verschwinden
   * aus StinkyMail (auf dem Server bleiben sie). Länger: der nächste Abgleich holt sie nach.
   */
  setSyncDays(accountId: string, days: number | null): Promise<void>;
  /** Absender erlauben (Mails erscheinen im Posteingang) oder blockieren (Mails verschwinden aus dem Posteingang). */
  decideSender(address: string, decision: "allow" | "block"): Promise<void>;
}

/** Eine Mail im Postausgang (noch nicht gesendet). */
export interface OutboxItem {
  id: string;
  accountId: string;
  subject: string;
  /** Empfänger zur Anzeige. */
  to: string;
  createdAt: string;
  /** queued: wird gesendet, sobald möglich · failed: vom Server abgelehnt, muss bearbeitet werden. */
  status: "queued" | "failed";
  /** Letzte Fehlermeldung (z. B. offline) – auch bei „queued“ möglich. */
  error: string | null;
}

export interface UnreadCounts {
  unifiedInbox: number;
  unread: number;
  /** Ungelesene unter den markierten Mails (ohne Papierkorb). */
  flagged: number;
  /** Ungelesene pro Ordner (Mailbox-ID → Anzahl); fehlende Ordner haben 0. */
  mailboxes: Record<string, number>;
  /** Mails neuer Absender, die auf eine Entscheidung warten (Türsteher) – gelesen oder nicht. */
  screener: number;
  /** Ungelesene wichtige Mails im Posteingang (W8.3; fehlt bei älteren Quellen). */
  important?: number;
}

export interface MailOverview {
  accounts: Account[];
  /** Ordner pro Konto, in Anzeige-Reihenfolge. */
  mailboxesByAccount: Record<string, Mailbox[]>;
  counts: UnreadCounts;
  /** Mails im Postausgang, älteste zuerst. */
  outbox: OutboxItem[];
}

/** Liste der Methoden – für IPC-/HTTP-Brücken, die Aufrufe weiterreichen. */
export const mailRepositoryMethods = [
  "accounts",
  "mailboxes",
  "messages",
  "thread",
  "message",
  "attachments",
  "unreadCount",
  "overview",
  "setFlag",
  "move",
  "remoteContentExceptions",
  "addRemoteContentException",
  "removeRemoteContentException",
  "send",
  "reopenOutgoing",
  "saveDraft",
  "deleteDraft",
  "openDraft",
  "suggestAddresses",
  "setSignature",
  "setSyncDays",
  "search",
  "setScreener",
  "decideSender",
] as const satisfies readonly (keyof MailRepository)[];

export type MailRepositoryMethod = (typeof mailRepositoryMethods)[number];
