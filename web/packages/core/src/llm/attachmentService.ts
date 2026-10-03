import { attachmentRelevancePromptVersion, ruleRelevance, type RelevanceAttachment, type RelevanceMail, type RelevanceResult } from "../ai/attachmentRelevance.js";
import { passwordCandidates, type AttachmentDecision, type AttachmentRule, type AttachmentsApi, type UnlockResult } from "../attachments.js";
import { SecretKeys, type SecretStore } from "../secrets.js";
import type { AttachmentMailCandidate, AttachmentStore } from "../sqlite/attachmentStore.js";

export interface AttachmentServiceOptions {
  store: AttachmentStore;
  /** Relevanz per Modell; `null`, wenn kein Modell bereit ist (dann gelten die Regeln). */
  check?: (mail: RelevanceMail, attachments: RelevanceAttachment[], accountId: string) => Promise<{ results: RelevanceResult[]; fromModel: boolean } | null>;
  /** Tiefenanalyse eines zentralen Anhangs (W9.2) – liest sofort („Trotzdem lesen“) */
  analyze?: (attachmentId: string) => Promise<void>;
  modelReady?: () => Promise<boolean>;
  /** Gemerkte Anhang-Passwörter je Absender */
  secrets?: SecretStore;
  /** Inhalt des Anhangs (ggf. vom Server) */
  content?: (attachmentId: string) => Promise<Uint8Array>;
  /** Liest ein gesperrtes PDF mit Passwort; `null` bei falschem Passwort */
  openWithPassword?: (content: Uint8Array, password: string) => Promise<{ text: string; pageCount: number } | null>;
  onChange?: () => void;
  now?: () => Date;
  modelLimit?: number;
  deepLimit?: number;
}

/**
 * Anhang-Relevanz (W9.1, Spezifikation 7.8.3): Stufe 0 (Code) und Regeln sofort, das Modell danach im Hintergrund
 * über die neuesten Mails. Entscheidungen des Nutzers und seine Regeln überschreibt nichts.
 */
export class AttachmentService implements AttachmentsApi {
  #background: Promise<void> | null = null;
  #restart = false;

  constructor(private readonly options: AttachmentServiceOptions) {}

  async scan(options: { recheck?: boolean } = {}): Promise<{ checked: number }> {
    const store = this.options.store;
    if (options.recheck) {
      store.resetScans();
      if (this.#background) this.#restart = true;
    }
    let checked = store.prefilterPending();
    // Regeln für alles Übrige sofort – die Oberfläche hat gleich einen Stand, die KI verfeinert danach
    for (const c of store.candidates(20_000)) {
      const open = c.attachments.filter((a) => a.origin === null);
      if (open.length === 0) continue;
      store.save(ruleRelevance(mailOf(c), open), "rules", 0);
      checked += open.length;
    }
    this.options.onChange?.();
    this.#startModelPass();
    return { checked };
  }

  async arrived(): Promise<void> {
    await this.scan();
  }

  async idle(): Promise<void> {
    while (this.#background) await this.#background;
  }

  #startModelPass(): void {
    if (!this.options.check || this.#background) return;
    this.#background = this.#modelPass().finally(() => {
      this.#background = null;
      this.options.onChange?.();
      if (this.#restart) {
        this.#restart = false;
        this.#startModelPass();
      }
    });
  }

  async #modelPass(): Promise<void> {
    const check = this.options.check;
    if (!check) return;
    const store = this.options.store;
    const candidates = store.candidates(this.options.modelLimit ?? 300, { includeRules: true, version: attachmentRelevancePromptVersion });
    for (const c of candidates) {
      const open = c.attachments.filter((a) => a.origin === null || a.origin === "rules" || a.origin === "onDevice");
      if (open.length === 0) continue;
      let result: Awaited<ReturnType<typeof check>>;
      try {
        result = await check(mailOf(c), open, c.accountId);
      } catch {
        break; // Modell nicht verfügbar – Regeln bleiben, später erneut
      }
      if (!result) break;
      store.save(result.results, result.fromModel ? "onDevice" : "rules", result.fromModel ? attachmentRelevancePromptVersion : 0);
      this.options.onChange?.();
    }
    // Stufe 2: zentrale Anhänge mit Text im Hintergrund zusammenfassen (neueste zuerst)
    const analyze = this.options.analyze;
    if (!analyze) return;
    for (const item of store.pendingDeepAnalysis(this.options.deepLimit ?? 100)) {
      try {
        await analyze(item.id);
      } catch {
        // Status steht auf „fehlgeschlagen“; Modell weg → später erneut
        if (!(await this.options.modelReady?.().catch(() => false) ?? true)) break;
      }
      this.options.onChange?.();
    }
  }

  async decide(attachmentId: string, decision: AttachmentDecision, remember: boolean): Promise<void> {
    if (decision !== "read" && decision !== "ignore") throw new Error("Ungültige Entscheidung.");
    this.options.store.decide(attachmentId, decision, remember, this.#now().toISOString());
    this.options.onChange?.();
    // „Trotzdem lesen“: Tiefenanalyse sofort (Fehler zeigen sich am Status, nicht als Meldung)
    if (decision === "read" && this.options.analyze && (await this.options.modelReady?.().catch(() => false) ?? true)) {
      try {
        await this.options.analyze(attachmentId);
      } catch {
        // Kein Text lesbar oder Modell weg: die Entscheidung gilt trotzdem, der Status zeigt „fehlgeschlagen“
      } finally {
        this.options.onChange?.();
      }
    }
  }

  async unlock(attachmentId: string, options: { password?: string; remember?: boolean } = {}): Promise<UnlockResult> {
    const { secrets, content, openWithPassword, store } = { ...this.options, store: this.options.store };
    if (!content || !openWithPassword) throw new Error("Entsperren ist hier nicht möglich.");
    const context = store.passwordContext(attachmentId);
    if (!context) throw new Error("Den Anhang gibt es nicht mehr.");
    if (!/pdf$/i.test(context.mimeType) && !/\.pdf$/i.test(context.filename)) throw new Error("Entsperren geht bisher nur bei PDF-Dateien.");
    const key = SecretKeys.attachmentPassword(context.sender);
    const candidates: { password: string; source: Exclude<UnlockResult["source"], null> }[] = [];
    if (options.password !== undefined) {
      if (!options.password) throw new Error("Bitte ein Passwort eingeben.");
      candidates.push({ password: options.password, source: "entered" });
    } else {
      const remembered = await secrets?.get(key).catch(() => null);
      if (remembered) candidates.push({ password: remembered, source: "remembered" });
      for (const password of passwordCandidates(context.texts)) if (password !== remembered) candidates.push({ password, source: "mail" });
    }
    if (candidates.length === 0) return { unlocked: false, source: null, tried: 0 };
    const data = await content(attachmentId);
    let tried = 0;
    for (const candidate of candidates.slice(0, 10)) {
      tried++;
      const opened = await openWithPassword(data, candidate.password);
      if (!opened) continue;
      store.markUnlocked(attachmentId, opened.text, opened.pageCount);
      // Merken nur auf Wunsch – oder wenn das Passwort ohnehin schon gemerkt war
      if (options.remember && secrets && candidate.source !== "remembered") await secrets.set(key, candidate.password);
      this.options.onChange?.();
      void this.scan().catch(() => undefined); // Relevanz und Zusammenfassung mit dem jetzt lesbaren Text
      return { unlocked: true, source: candidate.source, tried };
    }
    return { unlocked: false, source: null, tried };
  }

  async rules(): Promise<AttachmentRule[]> {
    return this.options.store.rules();
  }

  async removeRule(id: string): Promise<void> {
    this.options.store.removeRule(id);
    this.options.onChange?.();
  }

  #now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function mailOf(c: AttachmentMailCandidate): RelevanceMail {
  return { subject: c.subject, from: c.from, body: c.body };
}
