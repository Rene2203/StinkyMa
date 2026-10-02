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
  /** Alle Mails zu diesem Eintrag (Bestätigung, Rechnungen mehrerer Monate …), neueste zuerst */
  mails: SubscriptionMailRef[];
}

export interface SubscriptionMailRef {
  messageId: string;
  date: string;
  subject: string;
  /** Betrag laut dieser Mail */
  amount: string | null;
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
  /** Ist das lokale Modell bereit? Sonst erkennen nur die Regeln. */
  modelReady: boolean;
}

export interface SubscriptionScanOptions {
  /** Auch schon geprüfte Mails neu prüfen (z. B. nachdem die KI eingeschaltet wurde). Von Hand Zugeordnetes bleibt. */
  recheck?: boolean;
}

export interface SubscriptionsApi {
  list(): Promise<SubscriptionsView>;
  /** Mails nach Abos durchsuchen: Regeln sofort, das lokale Modell danach im Hintergrund (falls bereit). */
  scan(options?: SubscriptionScanOptions): Promise<{ found: number }>;
  /** „Das ist ein Abo“: diese Mail von Hand übernehmen (mit KI, falls bereit; sonst mit dem, was die Regeln finden). */
  addFromMail(messageId: string): Promise<StoredSubscription>;
  /** Zwei Einträge zusammenführen: `sourceId` geht in `targetId` auf (Mails, fehlende Angaben, Erinnerung). */
  merge(targetId: string, sourceId: string): Promise<StoredSubscription>;
  update(id: string, edit: SubscriptionEdit): Promise<StoredSubscription>;
  setStatus(id: string, status: SubscriptionStatus): Promise<void>;
  /** Erinnerung `daysBefore` Tage vor dem letzten Kündigungstag (Windows-Benachrichtigung). */
  remind(id: string, daysBefore: number): Promise<StoredSubscription>;
  cancelReminder(id: string): Promise<StoredSubscription>;
}

export const subscriptionsApiMethods = ["list", "scan", "addFromMail", "merge", "update", "setStatus", "remind", "cancelReminder"] as const satisfies readonly (keyof SubscriptionsApi)[];

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

// Bekannte Zahlungsdienste: ihre Domain sagt nichts über den Anbieter (Stripe-Rechnung von Spotify und von Netflix).
const billingDomains = new Set([
  "stripe.com", "paypal.com", "paypal.de", "paddle.com", "paddle.net", "fastspring.com", "chargebee.com", "recurly.com",
  "digitalriver.com", "2checkout.com", "tebex.io", "lemonsqueezy.com", "apple.com", "google.com", "klarna.com", "klarna.de",
]);

/** Domain eines Zahlungsdienstes (dann zählt nur der Anbietername)? */
export function isBillingDomain(domain: string): boolean {
  return billingDomains.has(domain.toLowerCase());
}

const nameNoise = /\b(gmbh|ag|se|kg|ohg|ug|inc|ltd|llc|co|corp|limited|the|premium|plus|pro|abo|abonnement|subscription|membership|mitgliedschaft|billing|team|service|support|de|com|net|io)\b/g;

/** Vergleichsschlüssel für Anbieternamen: „Nexus Mods“, „NexusMods Premium“ und „nexusmods.com“ → „nexusmods“. */
export function providerSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.(com|de|net|org|io|eu|example|test)\b/g, " ")
    .replace(nameNoise, " ")
    .replace(/[^a-z0-9]/g, "");
}

/** Gleicher Anbieter? Gleicher Schlüssel oder einer beginnt mit dem anderen (ab 4 Zeichen: „spotify“ ~ „spotifyfamily“). */
export function sameProvider(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}
