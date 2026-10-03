// Priorisierung (W8.3): Wie wichtig ist eine Mail? Aus dem Verhalten des Nutzers (öffnet, antwortet, markiert, löscht
// ungelesen) je Absender und der Einordnung – reiner Code, nachvollziehbar, auf diesem Rechner. Plattformneutral.

import type { MessageCategory } from "./models.js";

export type BehaviorType = "open" | "reply" | "flag" | "archive" | "trash";

export interface SenderStats {
  /** Mails von diesem Absender (Posteingang/Archiv) */
  received: number;
  opened: number;
  replied: number;
  flagged: number;
  /** Ungelesen gelöscht */
  trashedUnread: number;
  /** Wie oft ich diesem Absender geschrieben habe */
  sentTo: number;
  /** Vom Nutzer festgelegt: 1 immer wichtig, -1 nie wichtig */
  userPriority: 1 | -1 | null;
}

/** Ab diesem Wert gilt eine Mail als wichtig */
export const importantThreshold = 0.55;

const categoryBase: Record<MessageCategory, number> = {
  personal: 0.6,
  work: 0.6,
  appointment: 0.55,
  invoice: 0.5,
  notification: 0.25,
  newsletter: 0.1,
  spam_suspect: 0,
};

/** Wie sehr der Nutzer auf diesen Absender reagiert (0–1); null ohne Daten. Geglättet, damit 1 Mail nicht alles entscheidet. */
export function senderEngagement(s: SenderStats): number | null {
  if (s.userPriority === 1) return 1;
  if (s.userPriority === -1) return 0;
  if (s.received === 0 && s.sentTo === 0) return null;
  const n = Math.max(1, s.received);
  const open = (s.opened + 1) / (n + 2);
  const reply = (s.replied + 0.5) / (n + 3);
  const flag = s.flagged / (n + 2);
  const ignore = s.trashedUnread / (n + 2);
  const known = s.sentTo > 0 ? 0.2 : 0;
  return Math.max(0, Math.min(1, 0.45 * open + 1.4 * reply + 0.6 * flag - 0.9 * ignore + known));
}

/** Wichtigkeit einer Mail (0–1): Einordnung und Absender je zur Hälfte; Festlegungen des Nutzers gewinnen. */
export function messagePriority(category: MessageCategory | null | undefined, stats: SenderStats): number {
  if (stats.userPriority === 1) return 1;
  if (stats.userPriority === -1) return 0;
  if (category === "spam_suspect") return 0;
  const base = category ? categoryBase[category] : 0.35;
  const engagement = senderEngagement(stats) ?? 0.35;
  return Math.round((0.5 * base + 0.5 * engagement) * 100) / 100;
}
