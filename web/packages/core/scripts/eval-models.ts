// Messlauf: lokale Modelle gegen den deutschen Testsatz.
// Aufruf: npx tsx packages/core/scripts/eval-models.ts <Modellordner> [modell-id ...] [--out bericht.json] [--threads N] [--gpu]
// Die Modelldateien liegen wie im Katalog benannt im Ordner (z. B. Qwen3.5-2B-Q4_K_M.gguf).
import { writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import { evalHoldoutMails, evalMails, evaluateProvider, formatEvalReports, modelCatalog, type EvalReport } from "../src/index.js";
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
const all = args.includes("--all");
for (const name of ["--holdout", "--all"]) if (args.includes(name)) args.splice(args.indexOf(name), 1);
const mails = holdout ? evalHoldoutMails : all ? [...evalMails, ...evalHoldoutMails] : evalMails;
const threads = Number(flag("--threads") ?? 0);
const gpuIndex = args.indexOf("--gpu");
const gpu = gpuIndex !== -1;
if (gpu) args.splice(gpuIndex, 1);
const [directory, ...ids] = args;
if (!directory) throw new Error("Modellordner fehlt.");

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
