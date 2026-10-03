// Absender-Steckbrief (W8.2): alles zu einer Person auf einen Blick. Plattformneutral.

export interface ContactProfile {
  address: string;
  name: string | null;
  domain: string;
  /** Mails von dieser Person / von mir an sie */
  received: number;
  sent: number;
  firstContact: string | null;
  lastContact: string | null;
  /** Median der Antwortzeit (Stunden) im selben Verlauf – null, wenn zu wenig Daten */
  theyReplyHours: number | null;
  iReplyHours: number | null;
  /** Letzte Gespräche (Verläufe), neueste zuerst */
  recent: { threadId: string; messageId: string; subject: string; date: string; fromMe: boolean }[];
  /** Offene Zusagen: ich an sie, sie an mich */
  promises: { id: string; direction: "mine" | "theirs"; text: string; dueDate: string }[];
  /** Offene Termine/Fristen/Zahlungen aus ihren Mails */
  actions: { id: string; type: string; title: string; date: string | null; messageId: string }[];
  /** Belege dieses Absenders (alle Jahre) */
  receipts: { count: number; totalCents: number };
  /** Abo/Vertrag mit diesem Absender (falls erkannt) */
  subscription: { provider: string; amount: string | null; interval: string | null } | null;
  /** Häufigste Einordnung seiner Mails */
  usualCategory: string | null;
  /** Eigene Kategorie, die für ihn gemerkt ist */
  ownCategory: string | null;
}

export interface ContactsApi {
  profile(address: string): Promise<ContactProfile>;
}

export const contactsApiMethods = ["profile"] as const satisfies readonly (keyof ContactsApi)[];

/** Median (Stunden) oder null bei weniger als 2 Werten */
export function medianHours(deltasMs: number[]): number | null {
  if (deltasMs.length < 2) return null;
  const sorted = [...deltasMs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round((value / 3_600_000) * 10) / 10;
}
