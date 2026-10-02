import type { BillingInterval, Notice, SubscriptionKind } from "./ai/subscriptions.js";

// Verträge & Abos (W7.1): was die Oberfläche sieht und tun kann. Plattformneutral (IPC in Windows, später HTTP).

export type SubscriptionStatus = "active" | "cancelled" | "dismissed";

export interface StoredSubscription {
  id: string;
  accountId: string;
  /** Gruppierung: Absender-Domain */
  providerKey: string;
  provider: string;
  kind: SubscriptionKind;
  amount: string | null;
  amountCents: number | null;
  interval: BillingInterval | null;
  startDate: string | null;
  minTermMonths: number | null;
  trialEnd: string | null;
  termEnd: string | null;
  renewalDate: string | null;
  cancelBy: string | null;
  notice: Notice | null;
  /** Vom Code berechnet (oder vom Nutzer gesetzt) */
  lastCancelDay: string | null;
  status: SubscriptionStatus;
  sourceMessageId: string | null;
  lastMailDate: string;
  quote: string;
  origin: "rules" | "onDevice" | "ownServer" | "cloud" | "user";
  /** Vom Nutzer geändert – neue Mails überschreiben dann nichts mehr außer dem Status */
  userEdited: boolean;
  createdAt: string;
  updatedAt: string;
  /** Erinnerung vor dem Kündigungstag (falls gesetzt) */
  reminder: { id: string; dueDate: string } | null;
}

export interface SubscriptionEdit {
  provider?: string;
  kind?: SubscriptionKind;
  amount?: string | null;
  interval?: BillingInterval | null;
  lastCancelDay?: string | null;
}

export interface SubscriptionsView {
  items: StoredSubscription[];
  /** Laufende Kosten (ohne Probe-Abos, Gekündigtes und Ausgeblendetes) */
  monthlyCents: number;
  yearlyCents: number;
  /** Suchlauf mit KI im Hintergrund */
  scanning: { done: number; total: number } | null;
}

export interface SubscriptionsApi {
  list(): Promise<SubscriptionsView>;
  /** Mails nach Abos durchsuchen: Regeln sofort, das lokale Modell danach im Hintergrund (falls bereit). */
  scan(): Promise<{ found: number }>;
  update(id: string, edit: SubscriptionEdit): Promise<StoredSubscription>;
  setStatus(id: string, status: SubscriptionStatus): Promise<void>;
  /** Erinnerung `daysBefore` Tage vor dem letzten Kündigungstag (Windows-Benachrichtigung). */
  remind(id: string, daysBefore: number): Promise<StoredSubscription>;
  cancelReminder(id: string): Promise<StoredSubscription>;
}

export const subscriptionsApiMethods = ["list", "scan", "update", "setStatus", "remind", "cancelReminder"] as const satisfies readonly (keyof SubscriptionsApi)[];

/** Betrag in Cent („12,99 €“, „€8.99“, „1.200,00 €“). */
export function amountToCents(amount: string | null | undefined): number | null {
  if (!amount) return null;
  const match = /(\d{1,3}(?:[.\s]\d{3})*|\d+)(?:([.,])(\d{2}))?(?!\d)/.exec(amount);
  if (!match) return null;
  const euros = Number((match[1] ?? "0").replace(/[.\s]/g, ""));
  const cents = match[3] ? Number(match[3]) : 0;
  return euros * 100 + cents;
}

/** Monatliche Kosten in Cent (jährlich / 12 usw.); ohne Betrag oder Intervall null. */
export function monthlyCents(sub: Pick<StoredSubscription, "amountCents" | "interval">): number | null {
  if (sub.amountCents === null || !sub.interval) return null;
  const factor = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[sub.interval];
  return Math.round(sub.amountCents * factor);
}

/** Zählt zu den laufenden Kosten? */
export function countsTowardsCosts(sub: Pick<StoredSubscription, "status" | "kind">): boolean {
  return sub.status === "active" && sub.kind !== "trial";
}
