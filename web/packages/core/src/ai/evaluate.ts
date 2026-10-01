import type { Message, MessageCategory } from "../models.js";
import { evalMails, evalThreads, type EvalMail, type EvalThread } from "./evalSet.js";
import { categories } from "./prompts.js";
import { AIRouter, GrantPolicy } from "./router.js";
import { categorizeMessage, summarizeThread } from "./tasks.js";
import type { AIProvider } from "./types.js";

// Messlauf (5.7): ein Modell gegen den deutschen Testsatz. Läuft im Messskript und später in der App
// („Modelle vergleichen“ auf dem eigenen Rechner). Nur On-Device-Anbieter – Testmails verlassen nie das Gerät.

const evalAccount = "eval";

export function evalMailToMessage(mail: EvalMail): Message {
  return {
    id: mail.id,
    accountId: evalAccount,
    mailboxId: "inbox",
    threadId: mail.id,
    from: mail.from,
    to: [{ name: "Anna Beispiel", address: "anna@beispiel.example" }],
    cc: [],
    subject: mail.subject,
    date: "2026-09-30T08:00:00Z",
    snippet: mail.body.slice(0, 120),
    bodyText: mail.body,
    flags: 0,
    hasAttachments: (mail.attachments?.length ?? 0) > 0,
  };
}

function threadMessages(thread: EvalThread): Message[] {
  return thread.mails.map((mail, index) => ({
    id: `${thread.id}-${index}`,
    accountId: evalAccount,
    mailboxId: "inbox",
    threadId: thread.id,
    from: mail.from,
    to: [],
    cc: [],
    subject: mail.subject,
    date: mail.date,
    snippet: mail.body.slice(0, 120),
    bodyText: mail.body,
    flags: 0,
    hasAttachments: false,
  }));
}

/** Für den Faktenvergleich: klein, Tausenderpunkte und Leerraum vereinheitlicht. */
export function normalizeFact(text: string): string {
  return text.toLowerCase().replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2").replace(/\s+/g, " ");
}

export interface CategoryOutcome {
  id: string;
  expected: MessageCategory;
  got: MessageCategory;
  correct: boolean;
  fallback: boolean;
  durationMs: number;
}

export interface SummaryOutcome {
  id: string;
  ok: boolean;
  summary: string;
  openPoints: string[];
  factsFound: number;
  factsTotal: number;
  missingFacts: string[];
  forbiddenFound: string[];
  waitingOnCorrect: boolean;
  durationMs: number;
}

export interface EvalReport {
  providerId: string;
  displayName: string;
  loadMs: number | null;
  categorize: {
    accuracy: number;
    fallbacks: number;
    perCategory: Record<string, { correct: number; total: number }>;
    medianMs: number;
    outcomes: CategoryOutcome[];
  };
  summarize: {
    factRecall: number;
    validRate: number;
    waitingOnAccuracy: number;
    forbiddenHits: number;
    medianMs: number;
    outcomes: SummaryOutcome[];
  };
  totalMs: number;
}

export interface EvalProgress {
  done: number;
  total: number;
  phase: "categorize" | "summarize";
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

export async function evaluateProvider(
  provider: AIProvider,
  options: { mails?: EvalMail[]; threads?: EvalThread[]; loadMs?: number; signal?: AbortSignal; onProgress?: (progress: EvalProgress) => void } = {},
): Promise<EvalReport> {
  if (provider.privacyClass !== "onDevice") throw new Error("Der Messlauf ist nur für Modelle auf diesem Gerät gedacht.");
  const mails = options.mails ?? evalMails;
  const threads = options.threads ?? evalThreads;
  const router = new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() });
  const started = Date.now();
  const total = mails.length + threads.length;

  const categoryOutcomes: CategoryOutcome[] = [];
  for (const mail of mails) {
    options.signal?.throwIfAborted();
    const result = await categorizeMessage(router, evalMailToMessage(mail), { attachmentNames: mail.attachments, signal: options.signal });
    const correct = result.category === mail.expected || (mail.alsoOk ?? []).includes(result.category);
    categoryOutcomes.push({ id: mail.id, expected: mail.expected, got: result.category, correct, fallback: result.origin === "rules", durationMs: result.durationMs });
    options.onProgress?.({ done: categoryOutcomes.length, total, phase: "categorize" });
  }

  const summaryOutcomes: SummaryOutcome[] = [];
  for (const thread of threads) {
    options.signal?.throwIfAborted();
    const startedThread = Date.now();
    try {
      const result = await summarizeThread(router, threadMessages(thread), { ownAddresses: [thread.ownAddress], signal: options.signal });
      const text = normalizeFact(`${result.summary}\n${result.openPoints.join("\n")}`);
      const missingFacts = thread.facts.filter((fact) => !text.includes(normalizeFact(fact)));
      summaryOutcomes.push({
        id: thread.id,
        ok: true,
        summary: result.summary,
        openPoints: result.openPoints,
        factsFound: thread.facts.length - missingFacts.length,
        factsTotal: thread.facts.length,
        missingFacts,
        forbiddenFound: (thread.forbidden ?? []).filter((word) => text.includes(normalizeFact(word))),
        waitingOnCorrect: result.waitingOn === thread.waitingOn,
        durationMs: result.durationMs,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      summaryOutcomes.push({
        id: thread.id,
        ok: false,
        summary: "",
        openPoints: [],
        factsFound: 0,
        factsTotal: thread.facts.length,
        missingFacts: thread.facts,
        forbiddenFound: [],
        waitingOnCorrect: false,
        durationMs: Date.now() - startedThread,
      });
    }
    options.onProgress?.({ done: mails.length + summaryOutcomes.length, total, phase: "summarize" });
  }

  const perCategory: Record<string, { correct: number; total: number }> = {};
  for (const category of categories) perCategory[category] = { correct: 0, total: 0 };
  for (const outcome of categoryOutcomes) {
    const entry = perCategory[outcome.expected] ?? { correct: 0, total: 0 };
    entry.total++;
    if (outcome.correct) entry.correct++;
    perCategory[outcome.expected] = entry;
  }
  const factsTotal = summaryOutcomes.reduce((sum, o) => sum + o.factsTotal, 0);
  const ratio = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

  return {
    providerId: provider.id,
    displayName: provider.displayName,
    loadMs: options.loadMs ?? null,
    categorize: {
      accuracy: ratio(categoryOutcomes.filter((o) => o.correct).length, categoryOutcomes.length),
      fallbacks: categoryOutcomes.filter((o) => o.fallback).length,
      perCategory,
      medianMs: median(categoryOutcomes.filter((o) => !o.fallback).map((o) => o.durationMs)),
      outcomes: categoryOutcomes,
    },
    summarize: {
      factRecall: ratio(summaryOutcomes.reduce((sum, o) => sum + o.factsFound, 0), factsTotal),
      validRate: ratio(summaryOutcomes.filter((o) => o.ok).length, summaryOutcomes.length),
      waitingOnAccuracy: ratio(summaryOutcomes.filter((o) => o.waitingOnCorrect).length, summaryOutcomes.length),
      forbiddenHits: summaryOutcomes.reduce((sum, o) => sum + o.forbiddenFound.length, 0),
      medianMs: median(summaryOutcomes.filter((o) => o.ok).map((o) => o.durationMs)),
      outcomes: summaryOutcomes,
    },
    totalMs: Date.now() - started,
  };
}

const percent = (value: number) => `${(value * 100).toFixed(1).replace(".", ",")} %`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

/** Vergleichstabelle (Markdown) für die Dokumentation. */
export function formatEvalReports(reports: EvalReport[], context: { machine: string }): string {
  const lines = [
    `Rechner: ${context.machine}`,
    "",
    "| Modell | Kategorie richtig | davon Regel-Rückfall | Fakten in Zusammenfassung | gültige Zusammenfassungen | „Wer ist dran“ richtig | Kategorie (Median) | Zusammenfassung (Median) | Laden |",
    "|---|---|---|---|---|---|---|---|---|",
    ...reports.map((r) =>
      `| ${r.displayName} | ${percent(r.categorize.accuracy)} | ${r.categorize.fallbacks} | ${percent(r.summarize.factRecall)} | ${percent(r.summarize.validRate)} | ${percent(r.summarize.waitingOnAccuracy)} | ${seconds(r.categorize.medianMs)} | ${seconds(r.summarize.medianMs)} | ${r.loadMs === null ? "–" : seconds(r.loadMs)} |`,
    ),
    "",
    "Je Kategorie (richtig/gesamt):",
    "",
    `| Modell | ${categories.join(" | ")} |`,
    `|---|${categories.map(() => "---").join("|")}|`,
    ...reports.map((r) => `| ${r.displayName} | ${categories.map((c) => `${r.categorize.perCategory[c]?.correct ?? 0}/${r.categorize.perCategory[c]?.total ?? 0}`).join(" | ")} |`),
  ];
  for (const r of reports) {
    const wrong = r.categorize.outcomes.filter((o) => !o.correct);
    const missing = r.summarize.outcomes.filter((o) => o.missingFacts.length > 0 || !o.waitingOnCorrect || o.forbiddenFound.length > 0);
    lines.push("", `**${r.displayName}** – Fehler:`);
    lines.push(`- Kategorie: ${wrong.length === 0 ? "keine" : wrong.map((o) => `${o.id} (${o.expected} → ${o.got}${o.fallback ? ", Regel" : ""})`).join(", ")}`);
    lines.push(
      `- Zusammenfassung: ${missing.length === 0 ? "keine" : missing.map((o) => `${o.id}${o.ok ? "" : " ungültig"}${o.missingFacts.length ? ` fehlt: ${o.missingFacts.join(", ")}` : ""}${o.waitingOnCorrect ? "" : " / wer-ist-dran falsch"}${o.forbiddenFound.length ? ` / erfunden: ${o.forbiddenFound.join(", ")}` : ""}`).join("; ")}`,
    );
  }
  return lines.join("\n");
}
