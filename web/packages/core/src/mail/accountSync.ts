import type { ImapFlow, ListResponse } from "imapflow";
import type { Account, Mailbox } from "../models.js";
import type { MailWriter } from "../sqlite/writer.js";
import { flagsFromImap } from "./flags.js";
import { parseMessage } from "./parse.js";
import { assignUniqueRoles, mailboxRole } from "./roles.js";
import { baseSubject, threadIdFor } from "./threading.js";

export interface SyncOptions {
  /** Nur Mails ab diesem Datum abgleichen (Spezifikation 4.2: zuerst die neuesten 30 Tage). */
  since: Date;
  /** Wie viele Mails pro FETCH geholt werden. */
  batchSize?: number;
  /** Nach jedem Ordner – damit die Oberfläche neue Mails sofort zeigt, nicht erst am Ende. */
  onMailboxSynced?: (counts: { added: number; removed: number; flagsChanged: number }) => void;
}

export interface SyncResult {
  mailboxes: number;
  added: number;
  removed: number;
  flagsChanged: number;
}

export const mailboxIdFor = (accountId: string, path: string) => `${accountId}/${path}`;
export const messageIdFor = (mailboxId: string, uidValidity: number, uid: number) => `${mailboxId}#${uidValidity}:${uid}`;

/** Gleicht ein Konto mit dem Server ab: Ordner, neue Mails, Flags, gelöschte Mails. */
export async function syncAccount(client: ImapFlow, writer: MailWriter, account: Account, options: SyncOptions): Promise<SyncResult> {
  const result: SyncResult = { mailboxes: 0, added: 0, removed: 0, flagsChanged: 0 };
  const folders = await listFolders(client, account.id);

  // Ordner, die es auf dem Server nicht mehr gibt, entfernen.
  const serverIds = new Set(folders.map((f) => f.mailbox.id));
  for (const local of writer.mailboxes(account.id)) {
    if (!serverIds.has(local.id)) writer.deleteMailbox(local.id);
  }
  for (const folder of folders) writer.upsertMailbox(folder.mailbox);

  // Posteingang zuerst – dort erwartet man neue Mails.
  const ordered = [...folders].sort((a, b) => Number(b.mailbox.role === "inbox") - Number(a.mailbox.role === "inbox"));
  for (const folder of ordered) {
    const counts = await syncMailbox(client, writer, account, folder, options);
    options.onMailboxSynced?.(counts);
    result.mailboxes += 1;
    result.added += counts.added;
    result.removed += counts.removed;
    result.flagsChanged += counts.flagsChanged;
  }
  return result;
}

interface Folder {
  path: string;
  mailbox: Mailbox;
}

async function listFolders(client: ImapFlow, accountId: string): Promise<Folder[]> {
  const list: ListResponse[] = await client.list();
  const selectable = list.filter((entry) => !entry.flags.has("\\Noselect") && !entry.flags.has("\\NonExistent"));
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
): Promise<{ added: number; removed: number; flagsChanged: number }> {
  const lock = await client.getMailboxLock(folder.path, { readOnly: true });
  try {
    const status = client.mailbox;
    if (!status) return { added: 0, removed: 0, flagsChanged: 0 };
    const uidValidity = Number(status.uidValidity);
    const stored = writer.mailboxes(account.id).find((m) => m.id === folder.mailbox.id);
    if (stored?.uidValidity !== uidValidity) writer.resetMailbox(folder.mailbox.id, uidValidity);

    const known = writer.knownMessages(folder.mailbox.id);
    const serverUids = status.exists === 0 ? [] : ((await client.search({ since: options.since }, { uid: true })) || []);
    const serverSet = new Set(serverUids);

    // 1. Neue Mails holen
    const missing = serverUids.filter((uid) => !known.has(uid)).sort((a, b) => b - a); // neueste zuerst
    let added = 0;
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
        added += 1;
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
        if (local && local.flags !== flags) {
          writer.updateFlags(local.id, flags);
          flagsChanged += 1;
        }
      }
    }

    // 3. Auf dem Server gelöschte/verschobene Mails lokal entfernen (nur im abgeglichenen Zeitraum)
    const sinceIso = options.since.toISOString();
    const gone = [...known.entries()].filter(([uid, m]) => !serverSet.has(uid) && m.date >= sinceIso).map(([, m]) => m.id);
    writer.deleteMessages(gone);

    return { added, removed: gone.length, flagsChanged };
  } finally {
    lock.release();
  }
}
