import { manualSubscription, mightBeSubscription, ruleSubscription, subscriptionMailText, subscriptionPromptVersion, type SubscriptionResult } from "../ai/subscriptions.js";
import type { Message } from "../models.js";
import type { SubscriptionCandidate, SubscriptionStore } from "../sqlite/subscriptionStore.js";
import { countsTowardsCosts, monthlyCents, type StoredSubscription, type SubscriptionEdit, type SubscriptionsApi, type SubscriptionScanOptions, type SubscriptionStatus, type SubscriptionsView } from "../subscriptions.js";

export interface SubscriptionServiceOptions {
  store: SubscriptionStore;
  /** Erkennung mit dem lokalen Modell; liefert `null`, wenn kein Modell bereit ist (dann bleiben die Regeln). */
  extract?: (message: Message, attachmentText: string) => Promise<SubscriptionResult | null>;
  /** Ist das Modell bereit? (nur für die Anzeige) */
  modelReady?: () => Promise<boolean>;
  now?: () => Date;
  /** Einträge haben sich geändert (Oberfläche neu laden). */
  onChange?: () => void;
  /** Höchstzahl Mails je Suchlauf mit Regeln (alle Mails im Zeitraum) bzw. mit dem Modell (nur Kandidaten). */
  ruleLimit?: number;
  modelLimit?: number;
}

/** Erinnerung um 9 Uhr Ortszeit, `daysBefore` Tage vor dem Kündigungstag – nie in der Vergangenheit (dann in 5 Minuten). */
function reminderDue(lastCancelDay: string, daysBefore: number, now: Date): string {
  const [y = 0, m = 1, d = 1] = lastCancelDay.split("-").map(Number);
  const due = new Date(y, m - 1, d - daysBefore, 9, 0, 0);
  const earliest = new Date(now.getTime() + 5 * 60_000);
  return (due < earliest ? earliest : due).toISOString();
}

/** Lohnt sich der Blick des Modells? Vorfilter auf Text und Anhang; Rechnungen immer (Abo-Rechnung nur im PDF). */
function modelCandidate(c: SubscriptionCandidate): boolean {
  if (c.category === "spam_suspect" || c.category === "personal") return false;
  return c.category === "invoice" || mightBeSubscription(`${c.subject}\n${c.body}\n${c.attachmentText}`);
}

function toMessage(c: SubscriptionCandidate): Message {
  return {
    id: c.id, accountId: c.accountId, mailboxId: "", threadId: c.id, from: c.from, to: [], cc: [], subject: c.subject, date: c.date,
    snippet: c.body.slice(0, 160), bodyText: c.body, flags: 0, hasAttachments: false, category: c.category,
  };
}

/**
 * Verträge & Abos (W7.1): Regeln laufen sofort über alle Mails, das lokale Modell danach im Hintergrund über die
 * Kandidaten (Vorfilter) – es entscheidet, ob es wirklich ein Abo ist, und ergänzt Angaben. Nichts wird gekündigt oder
 * versendet; die App zeigt nur an und erinnert.
 */
export class SubscriptionService implements SubscriptionsApi {
  #scanning: { done: number; total: number } | null = null;
  #background: Promise<void> | null = null;
  #restart = false;

  constructor(private readonly options: SubscriptionServiceOptions) {}

  async list(): Promise<SubscriptionsView> {
    const items = this.options.store.list();
    const monthly = items.filter(countsTowardsCosts).reduce((sum, s) => sum + (monthlyCents(s) ?? 0), 0);
    const modelReady = this.options.modelReady ? await this.options.modelReady().catch(() => false) : Boolean(this.options.extract);
    return { items, monthlyCents: monthly, yearlyCents: monthly * 12, scanning: this.#scanning ? { ...this.#scanning } : null, modelReady };
  }

  async scan(options: SubscriptionScanOptions = {}): Promise<{ found: number }> {
    const store = this.options.store;
    const now = this.#now().toISOString();
    if (options.recheck) {
      store.resetScans();
      // Läuft gerade ein Durchgang, startet danach ein neuer über alles
      if (this.#background) this.#restart = true;
    }
    store.mergeDuplicates(now);
    const found = this.#scanWithRules(store.candidates(this.options.ruleLimit ?? 20_000));
    this.options.onChange?.();
    this.#startModelPass();
    return { found };
  }

  async addFromMail(messageId: string): Promise<StoredSubscription> {
    const store = this.options.store;
    const c = store.candidate(messageId);
    if (!c) throw new Error("Diese Mail gibt es nicht mehr.");
    let finding = null;
    if (this.options.extract) {
      try {
        finding = (await this.options.extract(toMessage(c), c.attachmentText))?.finding ?? null;
      } catch {
        finding = null; // Modell nicht verfügbar – dann ohne
      }
    }
    const text = subscriptionMailText(c.body, c.attachmentText);
    finding ??= ruleSubscription(c.subject, text, c.from, new Date(c.date)) ?? manualSubscription(c.subject, text, c.from);
    const now = this.#now().toISOString();
    const id = store.apply(finding, { id: c.id, accountId: c.accountId, fromAddress: c.from.address, date: c.date }, "user", now);
    store.markScanned([c.id], "user", 0, now);
    const sub = this.#get(id);
    if (sub.status === "dismissed") store.setStatus(id, "active", now);
    this.options.onChange?.();
    return this.#get(id);
  }

  async merge(targetId: string, sourceId: string): Promise<StoredSubscription> {
    this.options.store.merge(targetId, sourceId, this.#now().toISOString());
    this.options.onChange?.();
    return this.#get(targetId);
  }

  /** Neu angekommene Mails (nach dem Abgleich): wie `scan`, nur für diese. */
  async arrived(): Promise<void> {
    await this.scan();
  }

  /** Wartet auf einen laufenden Hintergrund-Durchgang (für Tests). */
  async idle(): Promise<void> {
    await this.#background;
  }

  #scanWithRules(candidates: SubscriptionCandidate[]): number {
    const store = this.options.store;
    const now = this.#now().toISOString();
    let found = 0;
    for (const c of candidates) {
      const body = subscriptionMailText(c.body, c.attachmentText);
      // Spam-Verdacht, persönliche Mails („ich hab mein Abo gekündigt“) und Newsletter (Abo-Werbung) nicht per Regel
      if (c.category === "spam_suspect" || c.category === "personal" || c.category === "newsletter" || !mightBeSubscription(`${c.subject}\n${body}`)) continue;
      const finding = ruleSubscription(c.subject, body, c.from, new Date(c.date));
      if (!finding) continue;
      store.apply(finding, { id: c.id, accountId: c.accountId, fromAddress: c.from.address, date: c.date }, "rules", now);
      found++;
    }
    store.markScanned(candidates.map((c) => c.id), "rules", 0, now);
    return found;
  }

  #startModelPass(): void {
    if (!this.options.extract || this.#background) return;
    this.#background = this.#modelPass().finally(() => {
      this.#background = null;
      this.#scanning = null;
      this.options.onChange?.();
      if (this.#restart) {
        this.#restart = false;
        this.#startModelPass();
      }
    });
  }

  async #modelPass(): Promise<void> {
    const extract = this.options.extract;
    if (!extract) return;
    const store = this.options.store;
    // Nur Kandidaten (Vorfilter), die bisher nur mit Regeln geprüft wurden; kein Spam-Verdacht
    const candidates = store
      .candidates(this.options.ruleLimit ?? 20_000, { recheckRules: true })
      .filter(modelCandidate)
      .slice(0, this.options.modelLimit ?? 500);
    if (candidates.length === 0) return;
    this.#scanning = { done: 0, total: candidates.length };
    this.options.onChange?.();
    for (const c of candidates) {
      let result: SubscriptionResult | null;
      try {
        result = await extract(toMessage(c), c.attachmentText);
      } catch {
        break; // Modell nicht verfügbar/abgebrochen – die Regeln bleiben, später erneut
      }
      if (!result) break; // kein Modell bereit
      const now = this.#now().toISOString();
      if (result.finding) {
        store.apply(result.finding, { id: c.id, accountId: c.accountId, fromAddress: c.from.address, date: c.date }, result.origin === "rules" ? "rules" : result.origin, now);
      } else if (result.origin !== "rules") {
        // Laut Modell kein Abo: einen nur aus dieser Mail per Regel angelegten Eintrag wieder entfernen
        store.removeIfOnlyFrom(c.id);
      }
      store.markScanned([c.id], result.origin, result.origin === "rules" ? 0 : subscriptionPromptVersion, now);
      this.#scanning = { done: (this.#scanning?.done ?? 0) + 1, total: candidates.length };
      this.options.onChange?.();
    }
  }

  async update(id: string, edit: SubscriptionEdit): Promise<StoredSubscription> {
    this.options.store.update(id, edit, this.#now().toISOString());
    return this.#get(id);
  }

  async setStatus(id: string, status: SubscriptionStatus): Promise<void> {
    this.options.store.setStatus(id, status, this.#now().toISOString());
  }

  async remind(id: string, daysBefore: number): Promise<StoredSubscription> {
    const sub = this.#get(id);
    if (!sub.lastCancelDay) throw new Error("Für eine Erinnerung fehlt der letzte Kündigungstag – bitte zuerst eintragen.");
    const days = Math.max(0, Math.min(60, Math.round(daysBefore)));
    const text = sub.kind === "trial" ? `Probe-Abo ${sub.provider} endet – kündigen bis ${sub.lastCancelDay}?` : `${sub.provider}: kündigen bis ${sub.lastCancelDay}?`;
    this.options.store.addReminder(id, reminderDue(sub.lastCancelDay, days, this.#now()), text);
    return this.#get(id);
  }

  async cancelReminder(id: string): Promise<StoredSubscription> {
    this.options.store.cancelReminder(id);
    return this.#get(id);
  }

  #get(id: string): StoredSubscription {
    const sub = this.options.store.get(id);
    if (!sub) throw new Error("Diesen Eintrag gibt es nicht mehr.");
    return sub;
  }

  #now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
