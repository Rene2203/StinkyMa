import type { UserCategoryResult } from "../ai/userCategories.js";
import type { Message } from "../models.js";
import type { UserCategoryStore } from "../sqlite/userCategoryStore.js";
import { normalizeUserCategory, type UserCategoriesApi, type UserCategoriesView, type UserCategory, type UserCategoryInput } from "../userCategories.js";

export interface UserCategoryServiceOptions {
  store: UserCategoryStore;
  /** Eigene Kategorie per Modell; `null`, wenn kein Modell bereit ist (dann gelten nur Absender und Gelerntes). */
  classify?: (message: Message, categories: readonly UserCategory[]) => Promise<UserCategoryResult | null>;
  onChange?: () => void;
  now?: () => Date;
  /** Höchstzahl Mails je Durchgang des Modells (neueste zuerst) */
  modelLimit?: number;
}

/**
 * Eigene Kategorien: Reihenfolge von Hand gesetzt → für den Absender gelernt → Absenderliste der Kategorie → Modell.
 * Das Modell läuft im Hintergrund über die neuesten Mails und prüft neu, wenn sich die Kategorien ändern.
 */
export class UserCategoryService implements UserCategoriesApi {
  #checking: { done: number; total: number } | null = null;
  #background: Promise<void> | null = null;
  #again = false;

  constructor(private readonly options: UserCategoryServiceOptions) {}

  async list(): Promise<UserCategoriesView> {
    return { categories: this.options.store.categories(), unread: this.options.store.unread(), checking: this.#checking ? { ...this.#checking } : null };
  }

  async save(input: UserCategoryInput): Promise<UserCategory> {
    const saved = this.options.store.save(normalizeUserCategory(input), this.#now());
    await this.refresh();
    return saved;
  }

  async remove(id: string): Promise<void> {
    this.options.store.remove(id);
    await this.refresh();
  }

  async assign(messageId: string, categoryId: string | null, remember: boolean): Promise<{ changed: number }> {
    const store = this.options.store;
    if (categoryId && !store.categories().some((c) => c.id === categoryId)) throw new Error("Diese Kategorie gibt es nicht mehr.");
    const message = store.message(messageId);
    if (!message) throw new Error("Die Mail wurde nicht gefunden.");
    store.assign(messageId, categoryId);
    let changed = 0;
    if (remember) {
      if (categoryId) changed = store.learn(message.from.address, categoryId, messageId, this.#now());
      else store.forget(message.from.address);
    }
    this.options.onChange?.();
    return { changed };
  }

  /** Nach neuen Mails, Änderungen an Kategorien, beim Start: Regeln sofort, Modell im Hintergrund. */
  async refresh(): Promise<void> {
    if (this.options.store.categories().length === 0) {
      this.options.onChange?.();
      return;
    }
    this.options.store.applyRules();
    this.options.onChange?.();
    this.#startModelPass();
  }

  /** Wartet auf einen laufenden Hintergrund-Durchgang (für Tests). */
  async idle(): Promise<void> {
    while (this.#background) await this.#background;
  }

  #startModelPass(): void {
    if (!this.options.classify) return;
    if (this.#background) {
      this.#again = true;
      return;
    }
    this.#background = this.#modelPass().finally(() => {
      this.#background = null;
      this.#checking = null;
      this.options.onChange?.();
      if (this.#again) {
        this.#again = false;
        this.#startModelPass();
      }
    });
  }

  async #modelPass(): Promise<void> {
    const classify = this.options.classify;
    const store = this.options.store;
    if (!classify) return;
    const categories = store.categories();
    if (categories.length === 0) return;
    const version = store.version();
    const pending = store.pending(this.options.modelLimit ?? 300, version);
    if (pending.length === 0) return;
    this.#checking = { done: 0, total: pending.length };
    this.options.onChange?.();
    for (const message of pending) {
      if (this.#again) return; // Kategorien geändert: mit neuem Stand von vorn
      let result: UserCategoryResult | null;
      try {
        result = await classify(message, categories);
      } catch {
        return; // Modell nicht verfügbar – später erneut
      }
      if (!result) return; // kein Modell bereit
      if (result.origin === "rules") continue; // unbrauchbare Antwort: offen lassen, nächster Durchgang
      store.setFromModel(message.id, result.categoryId, result.origin, version);
      this.#checking = { done: (this.#checking?.done ?? 0) + 1, total: pending.length };
      this.options.onChange?.();
    }
  }

  #now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
}
