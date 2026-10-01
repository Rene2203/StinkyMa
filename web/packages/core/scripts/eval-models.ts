// Messlauf: lokale Modelle gegen den deutschen Testsatz.
// Aufruf: npx tsx packages/core/scripts/eval-models.ts <Modellordner> [modell-id ...] [--out bericht.json] [--threads N] [--gpu]
// Die Modelldateien liegen wie im Katalog benannt im Ordner (z. B. Qwen3.5-2B-Q4_K_M.gguf).
import { writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import { evalHoldoutMails, evalHoldoutThreads, evalMails, evalThreads, evaluateActions, evaluateProvider, evaluateReplies, evaluateRules, formatActionsReports, formatEvalReports, formatRepliesReports, formatRulesReports, modelCatalog, type ActionsEvalReport, type EvalReport, type RepliesEvalReport, type RulesEvalReport } from "../src/index.js";
import { fileNameFromUrl, LlamaCppProvider } from "../src/llm/index.js";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
};
const out = flag("--out");
// --holdout: nur den Kontrollsatz (ohne Zusammenfassungen); --all: Testsatz + Kontrollsatz
const holdout = args.includes("--holdout");
// --actions: nur der Aktionen-Messlauf (W6.1), inklusive Vergleichswert „Regeln ohne KI“
const actionsOnly = args.includes("--actions");
if (actionsOnly) args.splice(args.indexOf("--actions"), 1);
// --rules: Regeln in normaler Sprache (W6.4), Testsatz + Kontrollsatz, mit Vergleichswert „Regeln ohne KI“
const rulesOnly = args.includes("--rules");
if (rulesOnly) args.splice(args.indexOf("--rules"), 1);
// --replies: Antwortvorschläge (W6.5) – Zahlen plus alle Vorschläge zum Lesen
const repliesOnly = args.includes("--replies");
if (repliesOnly) args.splice(args.indexOf("--replies"), 1);
// --summaries: nur Zusammenfassungen, Testsatz und Kontrollsatz (Konversationen) getrennt
const summariesOnly = args.includes("--summaries");
if (summariesOnly) args.splice(args.indexOf("--summaries"), 1);
// --summary-v2: Zusammenfassung mit der älteren Fassung v2 (Vergleich)
const summaryV2 = args.includes("--summary-v2");
if (summaryV2) args.splice(args.indexOf("--summary-v2"), 1);
const summaryV4 = args.includes("--summary-v4");
if (summaryV4) args.splice(args.indexOf("--summary-v4"), 1);
const all = args.includes("--all");
for (const name of ["--holdout", "--all"]) if (args.includes(name)) args.splice(args.indexOf(name), 1);
const mails = holdout ? evalHoldoutMails : all ? [...evalMails, ...evalHoldoutMails] : evalMails;
const threads = Number(flag("--threads") ?? 0);
const gpuIndex = args.indexOf("--gpu");
const gpu = gpuIndex !== -1;
if (gpu) args.splice(gpuIndex, 1);
const [directory, ...ids] = args;
if (!directory) throw new Error("Modellordner fehlt.");

if (actionsOnly) {
  const [directoryArg, ...idsArg] = args;
  const reports: ActionsEvalReport[] = [await evaluateActions(null)];
  for (const model of modelCatalog.filter((m) => idsArg.length === 0 || idsArg.includes(m.id))) {
    const provider = new LlamaCppProvider({ id: model.id, displayName: model.name, modelPath: join(directoryArg ?? "", fileNameFromUrl(model.url)), gpu: gpu ? "auto" : false, maxThreads: threads, idleUnloadMs: 0 });
    try {
      await provider.load();
      reports.push(await evaluateActions(provider, { onProgress: (d, t) => process.stderr.write(`\r${model.id}: ${d}/${t}   `) }));
      process.stderr.write("\n");
      if (out) writeFileSync(out, JSON.stringify(reports, null, 2));
    } finally {
      await provider.dispose();
    }
  }
  console.log(formatActionsReports(reports));
  process.exit(0);
}

if (repliesOnly) {
  const reports: RepliesEvalReport[] = [];
  for (const model of modelCatalog.filter((m) => ids.length === 0 || ids.includes(m.id))) {
    const provider = new LlamaCppProvider({ id: model.id, displayName: model.name, modelPath: join(directory, fileNameFromUrl(model.url)), gpu: gpu ? "auto" : false, maxThreads: threads, idleUnloadMs: 0 });
    try {
      await provider.load();
      reports.push(await evaluateReplies(provider, { onProgress: (d, t) => process.stderr.write(`\r${model.id}: ${d}/${t}   `) }));
      process.stderr.write("\n");
      if (out) writeFileSync(out, JSON.stringify(reports, null, 2));
    } finally {
      await provider.dispose();
    }
  }
  console.log(formatRepliesReports(reports));
  process.exit(0);
}

if (rulesOnly) {
  const reports: RulesEvalReport[] = [await evaluateRules(null)];
  for (const model of modelCatalog.filter((m) => ids.length === 0 || ids.includes(m.id))) {
    const provider = new LlamaCppProvider({ id: model.id, displayName: model.name, modelPath: join(directory, fileNameFromUrl(model.url)), gpu: gpu ? "auto" : false, maxThreads: threads, idleUnloadMs: 0 });
    try {
      await provider.load();
      for (const modelOnly of [false, true]) {
        reports.push(await evaluateRules(provider, { modelOnly, onProgress: (d, t) => process.stderr.write(`\r${model.id}${modelOnly ? " (nur Modell)" : ""}: ${d}/${t}   `) }));
      }
      process.stderr.write("\n");
      if (out) writeFileSync(out, JSON.stringify(reports, null, 2));
    } finally {
      await provider.dispose();
    }
  }
  console.log(formatRulesReports(reports));
  process.exit(0);
}

if (summariesOnly) {
  const reports: EvalReport[] = [];
  for (const model of modelCatalog.filter((m) => ids.length === 0 || ids.includes(m.id))) {
    const provider = new LlamaCppProvider({ id: model.id, displayName: model.name, modelPath: join(directory, fileNameFromUrl(model.url)), gpu: gpu ? "auto" : false, maxThreads: threads, idleUnloadMs: 0 });
    try {
      const { loadMs } = await provider.load();
      for (const [label, set] of [["Testsatz", evalThreads], ["Kontrollsatz", evalHoldoutThreads]] as const) {
        const report = await evaluateProvider(provider, { loadMs, mails: [], threads: set, ...(summaryV2 ? { summaryPromptVersion: 2 as const } : summaryV4 ? { summaryPromptVersion: 4 as const } : {}), onProgress: (p) => process.stderr.write(`\r${model.id} ${label}: ${p.done}/${p.total}   `) });
        reports.push({ ...report, displayName: `${report.displayName} ${summaryV2 ? "v2" : summaryV4 ? "v4" : "v3"} (${label})` });
        process.stderr.write("\n");
        if (out) writeFileSync(out, JSON.stringify(reports, null, 2));
      }
    } finally {
      await provider.dispose();
    }
  }
  console.log(formatEvalReports(reports, { machine: "" }));
  process.exit(0);
}

const models = modelCatalog.filter((m) => ids.length === 0 || ids.includes(m.id));
const reports: EvalReport[] = [];
for (const model of models) {
  const provider = new LlamaCppProvider({ id: model.id, displayName: model.name, modelPath: join(directory, fileNameFromUrl(model.url)), gpu: gpu ? "auto" : false, maxThreads: threads, idleUnloadMs: 0 });
  try {
    const { loadMs } = await provider.load();
    const report = await evaluateProvider(provider, {
      loadMs,
      mails,
      ...(holdout ? { threads: [] } : {}),
      onProgress: (p) => process.stderr.write(`\r${model.id}: ${p.done}/${p.total} (${p.phase})   `),
    });
    process.stderr.write("\n");
    reports.push(report);
    if (out) writeFileSync(out, JSON.stringify(reports, null, 2));
    console.log(formatEvalReports([report], { machine: "" }));
  } finally {
    await provider.dispose();
  }
}
const machine = `${cpus()[0]?.model ?? "CPU"} (${threads || "alle"} Threads von ${cpus().length}), ${Math.round(totalmem() / 2 ** 30)} GB RAM, ${gpu ? "GPU wenn vorhanden" : "nur CPU"}`;
console.log(`\n\n${formatEvalReports(reports, { machine })}`);
