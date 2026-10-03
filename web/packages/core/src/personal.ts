// Transparenz-Seite (W8.3/W8.4): Was hat StinkyMail über mich gelernt – und wie werde ich es wieder los?
// Alles bleibt auf diesem Rechner. Plattformneutral.

import type { BehaviorType, SenderStats } from "./priority.js";
import type { RecipientStyle, StyleProfile } from "./style.js";

export interface PersonalSender {
  address: string;
  name: string | null;
  /** Durchschnittliche Wichtigkeit seiner Mails (0–1) */
  score: number;
  stats: SenderStats;
}

export interface PersonalOverview {
  /** Mein Schreibstil aus gesendeten Mails */
  style: StyleProfile;
  /** Wie ich einzelne Personen anspreche (häufigste Empfänger) */
  recipients: RecipientStyle[];
  /** Absender mit den meisten Mails samt Wichtigkeit */
  senders: PersonalSender[];
  /** Wie oft welches Verhalten protokolliert wurde */
  events: Record<BehaviorType, number>;
}

/** Stil für eine Antwort an eine Person (fließt in Antwortvorschläge ein) */
export interface ReplyStyle {
  profile: StyleProfile;
  recipient: RecipientStyle | null;
}

export interface PersonalApi {
  overview(): Promise<PersonalOverview>;
  /** „Immer wichtig“ (1), „nie wichtig“ (-1) oder zurücksetzen (null) */
  setSenderPriority(address: string, value: 1 | -1 | null): Promise<void>;
  /** Verhalten und Festlegungen vergessen (der Stil wird ohnehin jedes Mal frisch aus gesendeten Mails berechnet) */
  forget(): Promise<void>;
}

export const personalApiMethods = ["overview", "setSenderPriority", "forget"] as const satisfies readonly (keyof PersonalApi)[];
