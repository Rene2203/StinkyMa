// Versprechen-Tracker (W7.3): was die Oberfläche sieht und tun kann. Plattformneutral.

export type PromiseStatus = "open" | "done" | "dismissed";

export interface StoredPromise {
  id: string;
  accountId: string;
  /** Mail mit der Zusage – null, wenn sie nicht mehr in StinkyMail liegt */
  messageId: string | null;
  threadId: string;
  /** „mine“: ich habe zugesagt (gesendete Mail); „theirs“: jemand hat mir zugesagt */
  direction: "mine" | "theirs";
  counterpart: { name: string | null; address: string };
  text: string;
  quote: string;
  /** Frist (YYYY-MM-DD) – genannt oder Standard (`dueStated` = false) */
  dueDate: string;
  dueStated: boolean;
  status: PromiseStatus;
  /** Spätere Mail im Verlauf, die die Zusage vermutlich erfüllt → „erledigt?“ vorschlagen */
  followUp: { messageId: string; date: string; subject: string } | null;
  origin: "rules" | "onDevice" | "ownServer" | "cloud" | "user";
  mailSubject: string;
  mailDate: string;
  reminder: { id: string; dueDate: string } | null;
}

export interface PromisesView {
  mine: StoredPromise[];
  theirs: StoredPromise[];
  /** Offene, deren Frist vorbei ist */
  overdue: { mine: number; theirs: number };
  scanning: { done: number; total: number } | null;
  modelReady: boolean;
  /** Standardfrist ohne genannte Frist (Tage) */
  defaultDays: number;
}

export interface PromisesApi {
  list(): Promise<PromisesView>;
  scan(options?: { recheck?: boolean }): Promise<{ found: number }>;
  setStatus(id: string, status: PromiseStatus): Promise<void>;
  setDueDate(id: string, dueDate: string): Promise<StoredPromise>;
  remind(id: string, daysBefore: number): Promise<StoredPromise>;
  cancelReminder(id: string): Promise<StoredPromise>;
  /** Text für eine Nachhak-Mail (nur Entwurf – gesendet wird nur, was der Nutzer selbst abschickt) */
  followUpDraft(id: string): Promise<{ messageId: string | null; body: string }>;
}

export const promisesApiMethods = ["list", "scan", "setStatus", "setDueDate", "remind", "cancelReminder", "followUpDraft"] as const satisfies readonly (keyof PromisesApi)[];

/** Ohne genannte Frist: Standard nach so vielen Tagen (Spezifikation 7.1) */
export const defaultPromiseDays = 3;

/** Nachhak-Text (ohne KI): freundlich, mit Bezug auf die Zusage */
export function followUpText(promise: Pick<StoredPromise, "counterpart" | "text" | "mailDate" | "quote">, locale: "de" | "en" = "de"): string {
  const first = (promise.counterpart.name ?? "").split(/\s+/)[0] || "";
  const date = new Date(promise.mailDate).toLocaleDateString(locale === "de" ? "de-DE" : "en-GB", { day: "numeric", month: "long" });
  if (locale === "en") return `Hi${first ? ` ${first}` : ""},\n\njust checking in on this – on ${date} you wrote: "${promise.quote}"\nIs there any news?\n\nThanks and best regards`;
  return `Hallo${first ? ` ${first}` : ""},\n\nkurze Nachfrage: Am ${date} hattest du geschrieben: „${promise.quote}“\nGibt es dazu schon etwas Neues?\n\nDanke und viele Grüße`;
}
