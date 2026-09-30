import type { MailboxRole } from "../models.js";

// Ordnerrolle aus IMAP SPECIAL-USE (RFC 6154), sonst anhand üblicher Namen (auch deutsch).

const specialUse: Record<string, MailboxRole> = {
  "\\Inbox": "inbox",
  "\\Sent": "sent",
  "\\Drafts": "drafts",
  "\\Trash": "trash",
  "\\Junk": "spam",
  "\\Archive": "archive",
};

const byName: [RegExp, MailboxRole][] = [
  [/^inbox$/i, "inbox"],
  [/^(sent|sent items|sent messages|gesendet|gesendete (objekte|elemente|nachrichten))$/i, "sent"],
  [/^(drafts|entw(ü|ue)rfe)$/i, "drafts"],
  [/^(trash|deleted items|deleted messages|papierkorb|gel(ö|oe)schte (objekte|elemente))$/i, "trash"],
  [/^(junk|spam|junk e-?mail|werbung)$/i, "spam"],
  [/^(archive|archiv|all mail|alle nachrichten)$/i, "archive"],
];

export function mailboxRole(path: string, delimiter: string | undefined, special?: string | null): MailboxRole {
  if (special && specialUse[special]) return specialUse[special]!;
  if (path.toUpperCase() === "INBOX") return "inbox";
  const leaf = delimiter ? path.split(delimiter).at(-1) ?? path : path;
  // Gmail: „[Gmail]/Gesendet“ usw. – der letzte Pfadteil entscheidet.
  for (const [pattern, role] of byName) if (pattern.test(leaf.trim())) return role;
  return "custom";
}

/**
 * Wählt pro Rolle höchstens einen Ordner (die Oberfläche und „Verschieben nach Archiv“ brauchen Eindeutigkeit).
 * Weitere Ordner mit derselben Rolle werden zu „custom“.
 */
export function assignUniqueRoles<T extends { path: string; role: MailboxRole; specialUse: boolean }>(folders: T[]): T[] {
  const taken = new Set<MailboxRole>();
  // SPECIAL-USE hat Vorrang vor Namensraten.
  const ordered = [...folders].sort((a, b) => Number(b.specialUse) - Number(a.specialUse));
  for (const folder of ordered) {
    if (folder.role === "custom") continue;
    if (taken.has(folder.role)) folder.role = "custom";
    else taken.add(folder.role);
  }
  return folders;
}
