import { mightBeReceipt, receiptMailText, receiptPromptVersion, ruleReceipt, type ReceiptFinding, type ReceiptResult } from "../ai/receipts.js";
import type { Message } from "../models.js";
import { exportFileName, receiptsCsv, type ReceiptEdit, type ReceiptsApi, type ReceiptStatus, type ReceiptsView, type StoredReceipt } from "../receipts.js";
import type { ReceiptCandidate, ReceiptStore } from "../sqlite/receiptStore.js";
import { createZip, type ZipEntry } from "../zip.js";

export interface ReceiptServiceOptions {
  store: ReceiptStore;
  /** Erkennung mit dem lokalen Modell; `null`, wenn kein Modell bereit ist (dann bleiben die Regeln). */
  extract?: (message: Message, attachmentText: string, categories: readonly string[]) => Promise<ReceiptResult | null>;
  modelReady?: () => Promise<boolean>;
  /** Inhalt eines Anhangs (ggf. vom Server geholt) – für den Export */
  attachmentContent?: (attachmentId: string) => Promise<{ filename: string; content: Uint8Array }>;
  /** Fragt nach dem Speicherort und speichert; `false` bei Abbruch */
  saveFile?: (defaultName: string, data: Uint8Array) => Promise<boolean>;
  onChange?: () => void;
  now?: () => Date;
  ruleLimit?: number;
  modelLimit?: number;
}

/** Erinnerung um 9 Uhr Ortszeit, `daysBefore` Tage vor der Frist – nie in der Vergangenheit (dann in 5 Minuten). */
function reminderDue(day: string, daysBefore: number, now: Date): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const due = new Date(y, m - 1, d - daysBefore, 9, 0, 0);
  const earliest = new Date(now.getTime() + 5 * 60_000);
  return (due < earliest ? earliest : due).toISOString();
}

function toMessage(c: ReceiptCandidate): Message {
  return {
    id: c.id, accountId: c.accountId, mailboxId: "", threadId: c.id, from: c.from, to: [], cc: [], subject: c.subject, date: c.date,
    snippet: c.body.slice(0, 160), bodyText: c.body, flags: 0, hasAttachments: c.attachmentText !== "", category: c.category,
  };
}

/** Lohnt sich der Blick des Modells? Rechnungen immer; sonst Vorfilter auf Text und Anhang. */
function modelCandidate(c: ReceiptCandidate): boolean {
  if (c.category === "spam_suspect" || c.category === "personal") return false;
  return c.category === "invoice" || mightBeReceipt(`${c.subject}\n${c.body}\n${c.attachmentText}`);
}

/**
 * Belegordner (W7.2): Regeln laufen sofort über alle Mails, das Modell danach im Hintergrund über die Kandidaten.
 * Beträge und Daten prüft der Code im Text; was er nicht findet, wird als „bitte prüfen“ markiert.
 */
export class ReceiptService implements ReceiptsApi {
  #scanning: { done: number; total: number } | null = null;
  #background: Promise<void> | null = null;
  #restart = false;

  constructor(private readonly options: ReceiptServiceOptions) {}

  async list(year: number | null): Promise<ReceiptsView> {
    const store = this.options.store;
    const items = store.list(year);
    const totals = new Map<string, { cents: number; count: number }>();
    for (const r of items) {
      if (r.status !== "active") continue;
      const key = r.category ?? "";
      const entry = totals.get(key) ?? { cents: 0, count: 0 };
      entry.cents += r.grossCents ?? 0;
      entry.count += 1;
      totals.set(key, entry);
    }
    const modelReady = this.options.modelReady ? await this.options.modelReady().catch(() => false) : Boolean(this.options.extract);
    return {
      items,
      years: store.years(),
      categories: store.categories(),
      totals: [...totals.entries()].map(([category, t]) => ({ category, ...t })).sort((a, b) => b.cents - a.cents),
      scanning: this.#scanning ? { ...this.#scanning } : null,
      modelReady,
    };
  }

  async scan(options: { recheck?: boolean } = {}): Promise<{ found: number }> {
    const store = this.options.store;
    if (options.recheck) {
      store.resetScans();
      if (this.#background) this.#restart = true;
    }
    const found = this.#scanWithRules(store.candidates(this.options.ruleLimit ?? 20_000));
    this.options.onChange?.();
    this.#startModelPass();
    return { found };
  }

  /** Neu angekommene Mails */
  async arrived(): Promise<void> {
    await this.scan();
  }

  async idle(): Promise<void> {
    while (this.#background) await this.#background;
  }

  #scanWithRules(candidates: ReceiptCandidate[]): number {
    const store = this.options.store;
    const now = this.#now().toISOString();
    let found = 0;
    for (const c of candidates) {
      // Spam-Verdacht, persönliche Mails und Newsletter (Preise in Werbung) nicht per Regel
      if (c.category === "spam_suspect" || c.category === "personal" || c.category === "newsletter") continue;
      const body = receiptMailText(c.body, c.attachmentText);
      if (!mightBeReceipt(`${c.subject}\n${body}`)) continue;
      const finding = ruleReceipt(c.subject, body, c.from, new Date(c.date));
      if (!finding) continue;
      store.apply(finding, { id: c.id, accountId: c.accountId, from: c.from, subject: c.subject, date: c.date }, "rules", now);
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
    const categories = store.categories();
    const candidates = store.candidates(this.options.ruleLimit ?? 20_000, { recheckRules: true }).filter(modelCandidate).slice(0, this.options.modelLimit ?? 500);
    if (candidates.length === 0) return;
    this.#scanning = { done: 0, total: candidates.length };
    this.options.onChange?.();
    for (const c of candidates) {
      let result: ReceiptResult | null;
      try {
        result = await extract(toMessage(c), c.attachmentText, categories);
      } catch {
        break; // Modell nicht verfügbar – die Regeln bleiben, später erneut
      }
      if (!result) break;
      const now = this.#now().toISOString();
      if (result.finding) {
        store.apply(result.finding, { id: c.id, accountId: c.accountId, from: c.from, subject: c.subject, date: c.date }, result.origin === "rules" ? "rules" : result.origin, now);
      } else if (result.origin !== "rules") {
        store.removeIfRulesOnly(c.id);
      }
      store.markScanned([c.id], result.origin, result.origin === "rules" ? 0 : receiptPromptVersion, now);
      this.#scanning = { done: (this.#scanning?.done ?? 0) + 1, total: candidates.length };
      this.options.onChange?.();
    }
  }

  async addFromMail(messageId: string): Promise<StoredReceipt> {
    const store = this.options.store;
    const c = store.candidate(messageId);
    if (!c) throw new Error("Diese Mail gibt es nicht mehr.");
    let finding: ReceiptFinding | null = null;
    if (this.options.extract) {
      try {
        finding = (await this.options.extract(toMessage(c), c.attachmentText, store.categories()))?.finding ?? null;
      } catch {
        finding = null;
      }
    }
    const body = receiptMailText(c.body, c.attachmentText);
    finding ??= ruleReceipt(c.subject, body, c.from, new Date(c.date)) ?? {
      // Nichts gefunden: Eintrag mit dem Sicheren (Absender, Datum der Mail) – Betrag trägt der Nutzer nach
      merchant: c.from.name?.trim() || c.from.address, date: c.date.slice(0, 10), grossCents: null, netCents: null, vatCents: null,
      invoiceNumber: null, dueDate: null, category: null, quote: c.subject, review: ["Kein Betrag gefunden"],
    };
    const now = this.#now().toISOString();
    const id = store.apply(finding, { id: c.id, accountId: c.accountId, from: c.from, subject: c.subject, date: c.date }, "user", now);
    store.markScanned([c.id], "user", 0, now);
    store.setStatus(id, "active", now);
    this.options.onChange?.();
    return this.#get(id);
  }

  async update(id: string, edit: ReceiptEdit): Promise<StoredReceipt> {
    this.options.store.update(id, edit, this.#now().toISOString());
    this.options.onChange?.();
    return this.#get(id);
  }

  async setStatus(id: string, status: ReceiptStatus): Promise<void> {
    if (status !== "active" && status !== "dismissed") throw new Error("Ungültiger Status.");
    this.options.store.setStatus(id, status, this.#now().toISOString());
    this.options.onChange?.();
  }

  async addCategory(name: string): Promise<string[]> {
    this.options.store.addCategory(name);
    return this.options.store.categories();
  }

  async removeCategory(name: string): Promise<string[]> {
    this.options.store.removeCategory(name);
    this.options.onChange?.();
    return this.options.store.categories();
  }

  async remind(id: string, daysBefore: number): Promise<StoredReceipt> {
    const receipt = this.#get(id);
    if (!receipt.dueDate) throw new Error("Für eine Erinnerung fehlt die Zahlungsfrist – bitte zuerst eintragen.");
    const days = Math.max(0, Math.min(30, Math.round(daysBefore)));
    this.options.store.addReminder(id, reminderDue(receipt.dueDate, days, this.#now()), `${receipt.merchant}: zahlen bis ${receipt.dueDate}`);
    return this.#get(id);
  }

  async cancelReminder(id: string): Promise<StoredReceipt> {
    this.options.store.cancelReminder(id);
    return this.#get(id);
  }

  /** ZIP mit Beleg-Dateien (PDF/Bild) und CSV-Übersicht. Fehlt eine Datei (Mail nicht mehr da, Server nicht erreichbar), steht der Beleg trotzdem in der CSV. */
  async export(year: number | null): Promise<{ saved: boolean; count: number; missingFiles: number }> {
    const { saveFile, attachmentContent } = this.options;
    if (!saveFile) throw new Error("Export ist hier nicht verfügbar.");
    const receipts = this.options.store.list(year).filter((r) => r.status === "active").sort((a, b) => a.date.localeCompare(b.date));
    if (receipts.length === 0) throw new Error("Keine Belege zum Exportieren.");
    const entries: ZipEntry[] = [];
    const fileNames = new Map<string, string[]>();
    const taken = new Set<string>(["belege.csv"]);
    let missingFiles = 0;
    for (const receipt of receipts) {
      if (receipt.attachments.length === 0) continue;
      for (const attachment of receipt.attachments) {
        try {
          if (!attachmentContent) throw new Error("kein Zugriff");
          const file = await attachmentContent(attachment.id);
          const name = exportFileName(receipt, file.filename || attachment.filename, taken);
          entries.push({ name: `Belege/${name}`, data: file.content });
          fileNames.set(receipt.id, [...(fileNames.get(receipt.id) ?? []), name]);
        } catch {
          missingFiles++;
        }
      }
    }
    const csv = new TextEncoder().encode(receiptsCsv(receipts, fileNames));
    const zip = createZip([{ name: "belege.csv", data: csv }, ...entries]);
    const saved = await saveFile(`Belege ${year ?? "alle"}.zip`, zip);
    return { saved, count: receipts.length, missingFiles };
  }

  #get(id: string): StoredReceipt {
    const receipt = this.options.store.get(id);
    if (!receipt) throw new Error("Diesen Beleg gibt es nicht mehr.");
    return receipt;
  }

  #now(): Date {
    return this.options.now?.() ?? new Date();
  }
}
