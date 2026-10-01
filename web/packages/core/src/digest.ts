import type { ActionType } from "./ai/actions.js";
import type { EmailAddress, MessageCategory } from "./models.js";

// Tagesüberblick (W6.6): Was heute wichtig ist – ohne Modell, aus Daten, die schon da sind: erkannte Fristen/Termine/
// Zahlungen, ungelesene persönliche Mails, Konversationen „wartet auf dich“. Newsletter & Co. nur als Zahl.
// Läuft damit auch auf schwacher Hardware sofort; die KI-Einordnung macht ihn nur genauer.

export interface DigestMail {
  messageId: string;
  from: EmailAddress;
  subject: string;
  date: string;
  category: MessageCategory | null;
}

export interface DigestAction {
  actionId: string;
  messageId: string;
  type: ActionType;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  time: string | null;
  amount: string | null;
  subject: string;
  from: EmailAddress;
  overdue: boolean;
}

export interface DigestView {
  /** Für diesen Tag (YYYY-MM-DD, Ortszeit) */
  day: string;
  /** Überfällig und in den nächsten 7 Tagen fällig */
  due: DigestAction[];
  /** Ungelesen und wichtig (persönlich, Arbeit, Termin, Rechnung oder noch nicht eingeordnet), letzte 2 Tage */
  important: DigestMail[];
  /** Konversationen, in denen laut Zusammenfassung du dran bist */
  waitingOnMe: DigestMail[];
  /** Nur gezählt: ungelesene Newsletter, Benachrichtigungen, Verdächtiges der letzten 2 Tage */
  counts: { newsletter: number; notification: number; spamSuspect: number; flagged: number };
}

/** Wichtig für den Überblick: alles außer Newsletter, Benachrichtigungen und Verdächtigem. */
export function isDigestImportant(category: MessageCategory | null | undefined): boolean {
  return category !== "newsletter" && category !== "notification" && category !== "spam_suspect";
}

/** Lokales Datum als YYYY-MM-DD. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Fällt der Überblick heute an? (Uhrzeit HH:MM erreicht und heute noch nicht gezeigt) */
export function digestDue(now: Date, time: string, lastShownDay: string | null): boolean {
  const [h, m] = time.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return false;
  const today = localDay(now);
  if (lastShownDay === today) return false;
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}

/** Kurzfassung für die Benachrichtigung – ohne Mail-Inhalte außer Anzahl (Betreffzeilen erst in der App). */
export function digestCounts(view: DigestView): { due: number; dueToday: number; overdue: number; important: number; waiting: number } {
  return {
    due: view.due.length,
    dueToday: view.due.filter((a) => a.date === view.day).length,
    overdue: view.due.filter((a) => a.overdue).length,
    important: view.important.length,
    waiting: view.waitingOnMe.length,
  };
}
