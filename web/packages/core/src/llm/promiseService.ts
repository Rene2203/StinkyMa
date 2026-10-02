import { isAutomatedSender, mightContainPromise, promisePromptVersion, rulePromises, type PromiseDirection, type PromiseResult } from "../ai/promises.js";
import type { Message } from "../models.js";
import { defaultPromiseDays, followUpText, type PromisesApi, type PromisesView, type PromiseStatus, type StoredPromise } from "../promises.js";
import type { PromiseCandidate, PromiseStore } from "../sqlite/promiseStore.js";

export interface PromiseServiceOptions {
  store: PromiseStore;
  /** Zusagen per Modell; `null`, wenn kein Modell bereit ist (dann gelten die Regeln). */
  extract?: (message: Message, direction: PromiseDirection) => Promise<PromiseResult | null>;
  modelReady?: () => Promise<boolean>;
  onChange?: () => void;
  now?: () => Date;
  defaultDays?: number;
  ruleLimit?: number;
  modelLimit?: number;
  locale?: "de" | "en";
}

/** Erinnerung um 9 Uhr Ortszeit, `daysBefore` Tage vor der Frist – nie in der Vergangenheit (dann in 5 Minuten). */
function reminderDue(day: string, daysBefore: number, now: Date): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const due = new Date(y, m - 1, d - daysBefore, 9, 0, 0);
  const earliest = new Date(now.getTime() + 5 * 60_000);
  return (due < earliest ? earliest : due).toISOString();
}

function toMessage(c: PromiseCandidate): Message {
  return {
    id: c.id, accountId: c.accountId, mailboxId: "", threadId: c.threadId, from: c.from, to: c.to, cc: [], subject: c.subject, date: c.date,
    snippet: c.body.slice(0, 160), bodyText: c.body, flags: 0, hasAttachments: false, category: c.category,
  };
}

/** Nicht prüfen: Spam-Verdacht, Newsletter, automatische Absender (bei eingehenden Mails). */
function skip(c: PromiseCandidate): boolean {
  if (c.category === "spam_suspect") return true;
  if (c.direction === "theirs" && (c.category === "newsletter" || c.category === "notification" || isAutomatedSender(c.from))) return true;
  return false;
}

/**
 * Versprechen-Tracker (W7.3): Regeln sofort, das lokale Modell im Hintergrund. Für eigene Zusagen mit Frist in der
 * Zukunft legt die App eine Erinnerung einen Tag vorher an (Spezifikation 7.1); gesendet wird nie etwas.
 */
export class PromiseService implements PromisesApi {
  #scanning: { done: number; total: number } | null = null;
  #background: Promise<void> | null = null;
  #restart = false;

  constructor(private readonly options: PromiseServiceOptions) {}

  get #days(): number {
    return this.options.defaultDays ?? defaultPromiseDays;
  }

  async list(): Promise<PromisesView> {
    const now = this.#now();
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const items = this.options.store.list(since);
    const today = now.toISOString().slice(0, 10);
    const overdue = (direction: "mine" | "theirs") => items.filter((p) => p.direction === direction && p.status === "open" && p.dueDate < today).length;
    const modelReady = this.options.modelReady ? await this.options.modelReady().catch(() => false) : Boolean(this.options.extract);
    return {
      mine: items.filter((p) => p.direction === "mine"),
      theirs: items.filter((p) => p.direction === "theirs"),
      overdue: { mine: overdue("mine"), theirs: overdue("theirs") },
      scanning: this.#scanning ? { ...this.#scanning } : null,
      modelReady,
      defaultDays: this.#days,
    };
  }

  async scan(options: { recheck?: boolean } = {}): Promise<{ found: number }> {
    const store = this.options.store;
    if (options.recheck) {
      store.resetScans();
      if (this.#background) this.#restart = true;
    }
    const found = this.#scanWithRules(store.candidates(this.options.ruleLimit ?? 5_000));
    store.updateFollowUps();
    this.options.onChange?.();
    this.#startModelPass();
    return { found };
  }

  async idle(): Promise<void> {
    while (this.#background) await this.#background;
  }

  #apply(c: PromiseCandidate, findings: Parameters<PromiseStore["apply"]>[0], origin: StoredPromise["origin"]): number {
    const now = this.#now();
    const ids = this.options.store.apply(findings, c, origin, this.#days, now.toISOString());
    // Eigene Zusagen: Erinnerung einen Tag vor der Frist, wenn sie noch kommt
    const today = now.toISOString().slice(0, 10);
    for (const id of ids) {
      const promise = this.options.store.get(id);
      if (promise?.direction === "mine" && promise.dueDate >= today) {
        this.options.store.addReminder(id, reminderDue(promise.dueDate, 1, now), this.#reminderText(promise));
      }
    }
    return ids.length;
  }

  #scanWithRules(candidates: PromiseCandidate[]): number {
    let found = 0;
    for (const c of candidates) {
      if (skip(c)) continue;
      const findings = rulePromises(c.body, new Date(c.date), c.direction, c.from);
      if (findings.length) found += this.#apply(c, findings, "rules");
    }
    this.options.store.markScanned(candidates.map((c) => c.id), "rules", 0, this.#now().toISOString());
    return found;
  }

  #startModelPass(): void {
    if (!this.options.extract || this.#background) return;
    this.#background = this.#modelPass().finally(() => {
      this.#background = null;
      this.#scanning = null;
      this.options.store.updateFollowUps();
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
    const candidates = store
      .candidates(this.options.ruleLimit ?? 5_000, { recheckRules: true })
      .filter((c) => !skip(c) && mightContainPromise(c.body, c.direction))
      .slice(0, this.options.modelLimit ?? 300);
    if (candidates.length === 0) return;
    this.#scanning = { done: 0, total: candidates.length };
    this.options.onChange?.();
    for (const c of candidates) {
      let result: PromiseResult | null;
      try {
        result = await extract(toMessage(c), c.direction);
      } catch {
        break;
      }
      if (!result) break;
      if (result.origin !== "rules" || result.findings.length) this.#apply(c, result.findings, result.origin === "rules" ? "rules" : result.origin);
      store.markScanned([c.id], result.origin, result.origin === "rules" ? 0 : promisePromptVersion, this.#now().toISOString());
      this.#scanning = { done: (this.#scanning?.done ?? 0) + 1, total: candidates.length };
      this.options.onChange?.();
    }
  }

  async setStatus(id: string, status: PromiseStatus): Promise<void> {
    if (!["open", "done", "dismissed"].includes(status)) throw new Error("Ungültiger Status.");
    this.options.store.setStatus(id, status, this.#now().toISOString());
    this.options.onChange?.();
  }

  async setDueDate(id: string, dueDate: string): Promise<StoredPromise> {
    const store = this.options.store;
    store.setDueDate(id, dueDate, this.#now().toISOString());
    const promise = this.#get(id);
    // Erinnerung folgt der neuen Frist (nur wenn schon eine bestand)
    if (promise.reminder) store.addReminder(id, reminderDue(dueDate, 1, this.#now()), this.#reminderText(promise));
    this.options.onChange?.();
    return this.#get(id);
  }

  async remind(id: string, daysBefore: number): Promise<StoredPromise> {
    const promise = this.#get(id);
    this.options.store.addReminder(id, reminderDue(promise.dueDate, Math.max(0, Math.min(14, Math.round(daysBefore))), this.#now()), this.#reminderText(promise));
    return this.#get(id);
  }

  async cancelReminder(id: string): Promise<StoredPromise> {
    this.options.store.cancelReminder(id);
    return this.#get(id);
  }

  async followUpDraft(id: string): Promise<{ messageId: string | null; body: string }> {
    const promise = this.#get(id);
    return { messageId: promise.messageId, body: followUpText(promise, this.options.locale ?? "de") };
  }

  #reminderText(promise: StoredPromise): string {
    const who = promise.counterpart.name ?? promise.counterpart.address;
    return promise.direction === "mine" ? `Zugesagt an ${who}: ${promise.text}` : `${who} wollte: ${promise.text}`;
  }

  #get(id: string): StoredPromise {
    const promise = this.options.store.get(id);
    if (!promise) throw new Error("Diese Zusage gibt es nicht mehr.");
    return promise;
  }

  #now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
