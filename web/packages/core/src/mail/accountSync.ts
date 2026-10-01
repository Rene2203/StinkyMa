import type { ImapFlow, ListResponse } from "imapflow";
import { MessageFlag, type Account, type Mailbox, type MailboxRole } from "../models.js";
import type { MailWriter } from "../sqlite/writer.js";
import { flagsFromImap } from "./flags.js";
import { parseMessage } from "./parse.js";
import { extractAttachmentText } from "./attachmentText.js";
import { assignUniqueRoles, isVirtualFolder, mailboxRole } from "./roles.js";
import { baseSubject, threadIdFor } from "./threading.js";

export interface SyncOptions {
  /** Nur Mails ab diesem Datum abgleichen (Spezifikation 4.2: zuerst die neuesten 30 Tage). */
  since: Date;
  /** Wie viele Mails pro FETCH geholt werden. */
  batchSize?: number;
  /** Nach jedem Ordner – damit die Oberfläche neue Mails sofort zeigt, nicht erst am Ende. */
  onMailboxSynced?: (counts: MailboxCounts) => void;
  /** Nur Ordner mit diesen Rollen abgleichen (z. B. nur den Posteingang, wenn der Server neue Mails meldet). */
  roles?: MailboxRole[];
}

interface MailboxCounts {
  added: number;
  removed: number;
  flagsChanged: number;
  /** IDs neu geholter, ungelesener Mails. */
  newUnread: string[];
}

export interface SyncResult {
  mailboxes: number;
  added: number;
  removed: number;
  flagsChanged: number;
  /** Neue ungelesene Mails im Posteingang (für Benachrichtigungen). */
  newInInbox: string[];
}

export const mailboxIdFor = (accountId: string, path: string) => `${accountId}/${path}`;
export const messageIdFor = (mailboxId: string, uidValidity: number, uid: number) => `${mailboxId}#${uidValidity}:${uid}`;

/** Gleicht ein Konto mit dem Server ab: Ordner, neue Mails, Flags, gelöschte Mails. */
export async function syncAccount(client: ImapFlow, writer: MailWriter, account: Account, options: SyncOptions): Promise<SyncResult> {
  const result: SyncResult = { mailboxes: 0, added: 0, removed: 0, flagsChanged: 0, newInInbox: [] };
  const folders = await listFolders(client, account.id);

  // Ordner, die es auf dem Server nicht mehr gibt, entfernen.
  const serverIds = new Set(folders.map((f) => f.mailbox.id));
  for (const local of writer.mailboxes(account.id)) {
    if (!serverIds.has(local.id)) writer.deleteMailbox(local.id);
  }
  for (const folder of folders) writer.upsertMailbox(folder.mailbox);

  // Posteingang zuerst – dort erwartet man neue Mails.
  const ordered = [...folders]
    .filter((f) => !options.roles || options.roles.includes(f.mailbox.role))
    .sort((a, b) => Number(b.mailbox.role === "inbox") - Number(a.mailbox.role === "inbox"));
  for (const folder of ordered) {
    const counts = await syncMailbox(client, writer, account, folder, options);
    options.onMailboxSynced?.(counts);
    result.mailboxes += 1;
    result.added += counts.added;
    result.removed += counts.removed;
    result.flagsChanged += counts.flagsChanged;
    if (folder.mailbox.role === "inbox") result.newInInbox.push(...counts.newUnread);
  }
  return result;
}

interface Folder {
  path: string;
  mailbox: Mailbox;
}

async function listFolders(client: ImapFlow, accountId: string): Promise<Folder[]> {
  const list: ListResponse[] = await client.list();
  const selectable = list.filter(
    (entry) => !entry.flags.has("\\Noselect") && !entry.flags.has("\\NonExistent") && !isVirtualFolder(entry.specialUse),
  );
  const withRoles = assignUniqueRoles(
    selectable.map((entry) => ({
      path: entry.path,
      name: entry.name,
      specialUse: Boolean(entry.specialUse),
      role: mailboxRole(entry.path, entry.delimiter, entry.specialUse),
    })),
  );
  return withRoles.map((f) => ({
    path: f.path,
    mailbox: {
      id: mailboxIdFor(accountId, f.path),
      accountId,
      // Der Posteingang heißt auf dem Server immer INBOX; für die Anzeige zählt die Rolle.
      name: f.role === "inbox" ? "INBOX" : f.path,
      role: f.role,
    },
  }));
}

async function syncMailbox(
  client: ImapFlow,
  writer: MailWriter,
  account: Account,
  folder: Folder,
  options: SyncOptions,
): Promise<MailboxCounts> {
  const lock = await client.getMailboxLock(folder.path, { readOnly: true });
  try {
    const status = client.mailbox;
    if (!status) return { added: 0, removed: 0, flagsChanged: 0, newUnread: [] };
    const uidValidity = Number(status.uidValidity);
    const stored = writer.mailboxes(account.id).find((m) => m.id === folder.mailbox.id);
    if (stored?.uidValidity !== uidValidity) writer.resetMailbox(folder.mailbox.id, uidValidity);

    const known = writer.knownMessages(folder.mailbox.id);
    const serverUids = status.exists === 0 ? [] : ((await client.search({ since: options.since }, { uid: true })) || []);
    const serverSet = new Set(serverUids);

    // 1. Neue Mails holen
    const missing = serverUids.filter((uid) => !known.has(uid)).sort((a, b) => b - a); // neueste zuerst
    let added = 0;
    const newUnread: string[] = [];
    const batchSize = options.batchSize ?? 25;
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      for await (const msg of client.fetch(batch.join(","), { uid: true, flags: true, source: true, internalDate: true }, { uid: true })) {
        if (!msg.source) continue;
        const parsed = await parseMessage(msg.source);
        const id = messageIdFor(folder.mailbox.id, uidValidity, msg.uid);
        const internalDate = msg.internalDate instanceof Date ? msg.internalDate : msg.internalDate ? new Date(msg.internalDate) : null;
        const date = parsed.date ?? internalDate?.toISOString() ?? new Date().toISOString();
        writer.insertMessage({
          id,
          accountId: account.id,
          mailboxId: folder.mailbox.id,
          uid: msg.uid,
          messageId: parsed.messageId,
          threadId: threadIdFor(account.id, parsed, id),
          threadSubject: baseSubject(parsed.subject),
          from: parsed.from,
          to: parsed.to,
          cc: parsed.cc,
          subject: parsed.subject,
          date,
          snippet: parsed.snippet,
          bodyText: parsed.bodyText,
          bodyHtml: parsed.bodyHtml,
          flags: flagsFromImap(msg.flags),
          attachments: parsed.attachments,
        });
        // Text aus PDF-/Text-Anhängen für die Suche – Fehler dabei halten den Abgleich nie auf.
        for (const [index, attachment] of parsed.attachments.entries()) {
          if (!attachment.content) continue;
          const extracted = await extractAttachmentText({ filename: attachment.filename, mimeType: attachment.mimeType, content: attachment.content });
          if (extracted) writer.setAttachmentText(`${id}/a${index}`, extracted.text, extracted.source);
        }
        added += 1;
        if ((flagsFromImap(msg.flags) & MessageFlag.seen) === 0) newUnread.push(id);
        // Dem Main-Prozess Luft lassen: Oberfläche und Aktionen bleiben während des Abgleichs bedienbar.
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    // 2. Flags bekannter Mails auffrischen (in W4 effizienter über CONDSTORE/QRESYNC)
    let flagsChanged = 0;
    const stillThere = serverUids.filter((uid) => known.has(uid));
    for (let i = 0; i < stillThere.length; i += 500) {
      const batch = stillThere.slice(i, i + 500);
      for await (const msg of client.fetch(batch.join(","), { uid: true, flags: true }, { uid: true })) {
        const local = known.get(msg.uid);
        const flags = flagsFromImap(msg.flags);
        // Noch nicht übertragene Änderung (z. B. eben geöffnet = gelesen): lokaler Stand gewinnt, sonst sähe die Mail
        // kurz wieder ungelesen aus, bis die Warteschlange beim Server ist.
        if (local && local.flags !== flags && !writer.hasPendingAction(account.id, local.id)) {
          writer.updateFlags(local.id, flags);
          flagsChanged += 1;
        }
      }
    }

    // 3. Auf dem Server gelöschte/verschobene Mails lokal entfernen (nur im abgeglichenen Zeitraum)
    const sinceIso = options.since.toISOString();
    const gone = [...known.entries()].filter(([uid, m]) => !serverSet.has(uid) && m.date >= sinceIso).map(([, m]) => m.id);
    writer.deleteMessages(gone);

    return { added, removed: gone.length, flagsChanged, newUnread };
  } finally {
    lock.release();
  }
}
