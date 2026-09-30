import { MessageFlag, type MessageFlagName } from "../models.js";

const imapFlagBits: Record<string, number> = {
  "\\Seen": MessageFlag.seen,
  "\\Answered": MessageFlag.answered,
  "\\Flagged": MessageFlag.flagged,
  "\\Deleted": MessageFlag.deleted,
  "\\Draft": MessageFlag.draft,
};

export function flagsFromImap(flags: Iterable<string> | undefined): number {
  let bits = 0;
  for (const flag of flags ?? []) bits |= imapFlagBits[flag] ?? 0;
  return bits;
}

export const imapFlagName: Record<MessageFlagName, string> = {
  seen: "\\Seen",
  answered: "\\Answered",
  flagged: "\\Flagged",
  deleted: "\\Deleted",
  draft: "\\Draft",
};
