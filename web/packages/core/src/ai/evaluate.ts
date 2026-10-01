import type { Message, MessageCategory } from "../models.js";
import { evalActionCases, evalHoldoutMails, evalMails, evalReplyCases, evalRuleCases, evalRuleFolders, evalRuleHoldout, evalThreads, type EvalActionCase, type EvalMail, type EvalThread } from "./evalSet.js";
import { extractActions, ruleActions, type MailAction } from "./actions.js";
import { cleanMailText } from "./prepare.js";
import { interpretRule, interpretRuleWithRules } from "./rules.js";
import { draftReplies, joinGreeting } from "./replies.js";
import { ruleEquals } from "../rules.js";
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

// --- Aktionen (W6.1) ---

export interface ActionsEvalReport {
  name: string;
  /** Anteil der erwarteten Angaben (Datum/Uhrzeit/Betrag), die gefunden wurden */
  recall: number;
  expectedTotal: number;
  /** Aktionen in Mails, in denen nichts erkannt werden darf */
  falsePositives: number;
  fallbacks: number;
  medianMs: number;
  misses: string[];
}

function actionMatches(action: MailAction, expected: EvalActionCase["expected"][number]): boolean {
  const digits = (value: string | null) => (value ?? "").replace(/[^\d,]/g, "");
  return (!expected.date || action.date === expected.date) && (!expected.time || action.time === expected.time) && (!expected.amount || digits(action.amount) === digits(expected.amount));
}

/** Aktionen-Messlauf; ohne Anbieter nur mit Regeln (Vergleichswert). */
export async function evaluateActions(provider: AIProvider | null, options: { cases?: EvalActionCase[]; onProgress?: (done: number, total: number) => void } = {}): Promise<ActionsEvalReport> {
  const cases = options.cases ?? evalActionCases;
  const all = [...evalMails, ...evalHoldoutMails];
  const router = provider ? new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() }) : null;
  let expectedTotal = 0;
  let found = 0;
  let falsePositives = 0;
  let fallbacks = 0;
  const durations: number[] = [];
  const misses: string[] = [];
  for (const [index, testCase] of cases.entries()) {
    const mail = all.find((m) => m.id === testCase.mailId);
    if (!mail) throw new Error(`Testmail ${testCase.mailId} fehlt`);
    const message = evalMailToMessage(mail);
    let actions: MailAction[];
    if (router) {
      const result = await extractActions(router, message);
      actions = result.actions;
      if (result.origin === "rules") fallbacks++;
      else durations.push(result.durationMs);
    } else {
      actions = ruleActions(message.subject, cleanMailText(message.bodyText ?? "", 2000), new Date(message.date));
    }
    if (testCase.expected.length === 0) {
      falsePositives += actions.length;
      if (actions.length) misses.push(`${testCase.mailId}: ${actions.length} unnötig`);
    }
    for (const expected of testCase.expected) {
      const keys = Object.keys(expected).length;
      expectedTotal += keys;
      const best = Math.max(0, ...actions.map((a) => Object.entries(expected).filter(([k]) => actionMatches(a, { [k]: (expected as Record<string, string>)[k] })).length));
      found += best;
      if (best < keys) misses.push(`${testCase.mailId}: erwartet ${JSON.stringify(expected)}, erkannt ${JSON.stringify(actions.map((a) => [a.date, a.time, a.amount]))}`);
    }
    options.onProgress?.(index + 1, cases.length);
  }
  return {
    name: provider?.displayName ?? "Regeln (ohne KI)",
    recall: expectedTotal ? found / expectedTotal : 0,
    expectedTotal,
    falsePositives,
    fallbacks,
    medianMs: median(durations),
    misses,
  };
}

export function formatActionsReports(reports: ActionsEvalReport[]): string {
  const lines = ["| Verfahren | Angaben gefunden | unnötige Aktionen | Regel-Rückfall | Zeit (Median) |", "|---|---|---|---|---|"];
  for (const r of reports) lines.push(`| ${r.name} | ${percent(r.recall)} (von ${r.expectedTotal}) | ${r.falsePositives} | ${r.fallbacks} | ${seconds(r.medianMs)} |`);
  for (const r of reports) if (r.misses.length) lines.push("", `**${r.name}** – Abweichungen:`, ...r.misses.map((m) => `- ${m}`));
  return lines.join("\n");
}

// --- Regeln in normaler Sprache (W6.4) ---

export interface RulesEvalReport {
  name: string;
  correct: number;
  total: number;
  holdoutCorrect: number;
  holdoutTotal: number;
  /** Wie oft das Modell gefragt wurde. */
  modelCalls: number;
  /** … und davon nichts Brauchbares lieferte (die Regeln blieben). */
  fallbacks: number;
  medianMs: number;
  misses: string[];
}

export async function evaluateRules(provider: AIProvider | null, options: { modelOnly?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<RulesEvalReport> {
  const router = provider ? new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() }) : null;
  const sets = [{ cases: evalRuleCases, holdout: false }, { cases: evalRuleHoldout, holdout: true }];
  const total = evalRuleCases.length + evalRuleHoldout.length;
  const report: RulesEvalReport = { name: provider ? `${provider.displayName} (${options.modelOnly ? "nur Modell" : "Regeln zuerst"})` : "Regeln (ohne KI)", correct: 0, total: evalRuleCases.length, holdoutCorrect: 0, holdoutTotal: evalRuleHoldout.length, modelCalls: 0, fallbacks: 0, medianMs: 0, misses: [] };
  const durations: number[] = [];
  let done = 0;
  for (const set of sets) {
    for (const testCase of set.cases) {
      const result = router ? await interpretRule(router, testCase.text, evalRuleFolders, [evalAccount], { modelOnly: options.modelOnly ?? false }) : interpretRuleWithRules(testCase.text, evalRuleFolders);
      // Nur Fälle, in denen das Modell gefragt wurde
      if (result.durationMs > 0) {
        durations.push(result.durationMs);
        if (result.origin === "rules") report.fallbacks++;
      }
      const ok = !result.problems.some((p) => p !== "notInText") && ruleEquals(result.definition, testCase.expected);
      if (ok) set.holdout ? report.holdoutCorrect++ : report.correct++;
      else report.misses.push(`${testCase.id}${set.holdout ? " (Kontrolle)" : ""}: „${testCase.text}“ → ${JSON.stringify(result.definition)}${result.problems.length ? ` ${result.problems.join(",")}` : ""}`);
      options.onProgress?.(++done, total);
    }
  }
  report.medianMs = median(durations);
  report.modelCalls = durations.length;
  return report;
}

export function formatRulesReports(reports: RulesEvalReport[]): string {
  const lines = ["| Verfahren | Testsatz | Kontrollsatz | Modell gefragt | davon unbrauchbar | Zeit je Modell-Aufruf (Median) |", "|---|---|---|---|---|---|"];
  for (const r of reports) lines.push(`| ${r.name} | ${r.correct}/${r.total} | ${r.holdoutCorrect}/${r.holdoutTotal} | ${r.modelCalls} | ${r.fallbacks} | ${seconds(r.medianMs)} |`);
  for (const r of reports) if (r.misses.length) lines.push("", `**${r.name}** – Abweichungen:`, ...r.misses.map((m) => `- ${m}`));
  return lines.join("\n");
}

// --- Antwortvorschläge (W6.5) ---

export interface RepliesEvalReport {
  name: string;
  cases: number;
  /** Fälle mit mindestens zwei brauchbaren Vorschlägen (Ziel) bzw. mindestens einem */
  twoOrMore: number;
  atLeastOne: number;
  formCorrect: number;
  medianMs: number;
  /** Alle Vorschläge zum Lesen (Qualität lässt sich nur so beurteilen) */
  samples: string[];
}

export async function evaluateReplies(provider: AIProvider, options: { onProgress?: (done: number, total: number) => void } = {}): Promise<RepliesEvalReport> {
  const router = new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() });
  const report: RepliesEvalReport = { name: provider.displayName, cases: evalReplyCases.length, twoOrMore: 0, atLeastOne: 0, formCorrect: 0, medianMs: 0, samples: [] };
  const durations: number[] = [];
  for (const [index, testCase] of evalReplyCases.entries()) {
    const mail = evalMails.find((m) => m.id === testCase.mailId);
    if (!mail) throw new Error(`Testmail ${testCase.mailId} fehlt`);
    const result = await draftReplies(router, evalMailToMessage(mail));
    durations.push(result.durationMs);
    if (result.replies.length >= 2) report.twoOrMore++;
    if (result.replies.length >= 1) report.atLeastOne++;
    if (result.form === testCase.form) report.formCorrect++;
    report.samples.push(
      `**${mail.id} – ${mail.subject}** (${result.form}, ${seconds(result.durationMs)})`,
      ...result.replies.map((r) => `- *${r.label}:* ${joinGreeting(result.greeting, r.text).replace(/\n+/g, " ")}`),
      ...(result.replies.length ? [] : ["- (kein brauchbarer Vorschlag)"]),
      "",
    );
    options.onProgress?.(index + 1, evalReplyCases.length);
  }
  report.medianMs = median(durations);
  return report;
}

export function formatRepliesReports(reports: RepliesEvalReport[]): string {
  const lines = ["| Modell | ≥ 2 Vorschläge | ≥ 1 Vorschlag | du/Sie richtig | Zeit (Median) |", "|---|---|---|---|---|"];
  for (const r of reports) lines.push(`| ${r.name} | ${r.twoOrMore}/${r.cases} | ${r.atLeastOne}/${r.cases} | ${r.formCorrect}/${r.cases} | ${seconds(r.medianMs)} |`);
  for (const r of reports) lines.push("", `### ${r.name}`, "", ...r.samples);
  return lines.join("\n");
}
