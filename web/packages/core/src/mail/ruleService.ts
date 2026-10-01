import type { RuleInterpretation } from "../ai/rules.js";
import { interpretRuleWithRules } from "../ai/rules.js";
import { checkRule, ruleMatches, type MailRule, type RuleDefinition, type RuleInput, type RulePreview, type RulesApi } from "../rules.js";
import type { RuleCandidate, RuleStore } from "../sqlite/ruleStore.js";
import type { MailService } from "./mailService.js";

export interface RuleServiceOptions {
  /** Text → Regel. Standard: einfache Regeln ohne KI. Windows: AIService.interpretRule (Modell, falls bereit). */
  interpret?: (text: string, folders: readonly string[], accountIds: string[]) => Promise<RuleInterpretation>;
  /** Konten, für die die KI-Freigabe geprüft wird. */
  accountIds: () => Promise<string[]>;
  newId: () => string;
  now?: () => Date;
  /** So lange wartet eine Mail höchstens auf ihre Einordnung, wenn eine Regel davon abhängt (Standard 10 Minuten). */
  categoryWaitMs?: number;
}

const previewLimit = 2000;

/**
 * Regeln in normaler Sprache (W6.4): Lesen, Vorschau, Speichern und Anwenden auf neu angekommene Mails.
 * Angewendet wird über den MailService – also sofort lokal und über die Warteschlange auch auf dem Server.
 */
export class RuleService implements RulesApi {
  #running: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: RuleStore,
    private readonly mail: Pick<MailService, "move" | "moveToMailbox" | "setFlag">,
    private readonly options: RuleServiceOptions,
  ) {}

  async list(): Promise<MailRule[]> {
    return this.store.list();
  }

  async folders(accountId: string | null): Promise<string[]> {
    return this.store.folders(accountId);
  }

  async interpret(text: string, accountId: string | null): Promise<RulePreview> {
    const trimmed = text.trim().slice(0, 400);
    const folders = this.store.folders(accountId);
    const accountIds = accountId ? [accountId] : await this.options.accountIds();
    const result = this.options.interpret ? await this.options.interpret(trimmed, folders, accountIds) : interpretRuleWithRules(trimmed, folders);
    return { ...this.#preview(result.definition, accountId), problems: result.problems, origin: result.origin };
  }

  async preview(definition: RuleDefinition, accountId: string | null): Promise<RulePreview> {
    const checked = checkRule(definition, { folders: this.store.folders(accountId) });
    return { ...this.#preview(checked.definition, accountId), problems: checked.problems, origin: null };
  }

  async save(input: RuleInput, applyToExisting: boolean): Promise<MailRule> {
    const { definition, problems } = checkRule(input.definition, { folders: this.store.folders(input.accountId) });
    if (problems.length) throw new Error(problems.includes("noCondition") ? "Die Regel braucht eine Bedingung (Absender, Betreff, Art oder Anhang)." : problems.includes("noAction") ? "Die Regel braucht eine Aktion." : "Diesen Ordner gibt es nicht.");
    const text = input.text.trim().slice(0, 400);
    let rule: MailRule;
    if (input.id && this.store.get(input.id)) {
      this.store.update(input.id, { text, accountId: input.accountId, definition });
      rule = this.store.get(input.id) as MailRule;
    } else {
      rule = { id: this.options.newId(), text, accountId: input.accountId, definition, enabled: true, createdAt: this.#now().toISOString() };
      this.store.insert(rule);
    }
    if (applyToExisting) {
      const matching = this.store.inboxCandidates(rule.accountId, previewLimit).filter((m) => ruleMatches(definition, m) === true);
      await this.#apply(matching.map((m) => ({ candidate: m, rules: [rule] })));
    }
    return rule;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    this.store.update(id, { enabled });
  }

  async remove(id: string): Promise<void> {
    this.store.remove(id);
  }

  /** Neu angekommene Posteingangs-Mails vormerken und gleich abarbeiten. */
  async arrived(messageIds: string[]): Promise<void> {
    if (!this.store.list().some((r) => r.enabled)) return;
    this.store.enqueue(messageIds, this.#now().toISOString());
    await this.processQueue();
  }

  /** Wartende Mails durch die Regeln schicken (z. B. nachdem die KI sie eingeordnet hat). Läuft nie doppelt. */
  processQueue(): Promise<void> {
    this.#running = this.#running.then(() => this.#process()).catch(() => undefined);
    return this.#running;
  }

  async #process(): Promise<void> {
    const rules = this.store.list().filter((r) => r.enabled);
    const queued = this.store.queued();
    if (!queued.length) return;
    if (!rules.length) {
      this.store.dequeue(queued.map((q) => q.id));
      return;
    }
    const now = this.#now().getTime();
    const waitMs = this.options.categoryWaitMs ?? 10 * 60_000;
    const work: { candidate: RuleCandidate; rules: MailRule[] }[] = [];
    const done: string[] = [];
    for (const item of queued) {
      const applicable = rules.filter((r) => !r.accountId || r.accountId === item.accountId);
      const results = applicable.map((r) => ({ rule: r, match: ruleMatches(r.definition, item) }));
      // Hängt eine Regel von der Einordnung ab, die noch fehlt: warten (höchstens `waitMs`), dann ohne sie weiter
      if (results.some((r) => r.match === "waiting") && now - new Date(item.queuedAt).getTime() < waitMs) continue;
      done.push(item.id);
      const matching = results.filter((r) => r.match === true).map((r) => r.rule);
      if (matching.length) work.push({ candidate: item, rules: matching });
    }
    this.store.dequeue(done);
    await this.#apply(work);
  }

  /** Aktionen ausführen: erst Flags, dann höchstens ein Verschieben (erste passende Regel gewinnt). */
  async #apply(work: { candidate: RuleCandidate; rules: MailRule[] }[]): Promise<void> {
    const read: string[] = [];
    const flagged: string[] = [];
    const moves = new Map<string, string[]>(); // Ziel → Mail-IDs
    for (const { candidate, rules } of work) {
      if (rules.some((r) => r.definition.markRead)) read.push(candidate.id);
      if (rules.some((r) => r.definition.flag)) flagged.push(candidate.id);
      for (const rule of rules) {
        const { folder, move } = rule.definition;
        const target = folder ? (this.store.folderId(candidate.accountId, folder) ? `folder:${this.store.folderId(candidate.accountId, folder)}` : null) : move ? `role:${move}` : null;
        if (!target) continue;
        moves.set(target, [...(moves.get(target) ?? []), candidate.id]);
        break;
      }
    }
    if (read.length) await this.mail.setFlag("seen", true, read);
    if (flagged.length) await this.mail.setFlag("flagged", true, flagged);
    for (const [target, ids] of moves) {
      if (target.startsWith("folder:")) await this.mail.moveToMailbox(ids, target.slice("folder:".length));
      else await this.mail.move(ids, target.slice("role:".length) as "archive" | "trash" | "spam");
    }
  }

  #preview(definition: RuleDefinition, accountId: string | null): Omit<RulePreview, "problems" | "origin"> {
    const matching = this.store.inboxCandidates(accountId, previewLimit).filter((m) => ruleMatches(definition, m) === true);
    return {
      definition,
      matchCount: matching.length,
      samples: matching.slice(0, 5).map((m) => ({ id: m.id, from: m.from, subject: m.subject, date: m.date })),
    };
  }

  #now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
