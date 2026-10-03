// Messlauf Anhang-Relevanz (W9.1): Vorfilter + Regeln bzw. Vorfilter + Modell (mit Code-Prüfung).
// Aufruf: npx tsx packages/core/scripts/eval-attachments.ts <Modellordner> [modell-id ...] [--threads N] [--set test|kontrolle]
import { join } from "node:path";
import {
  AIRouter, checkAttachmentRelevance, evalAttachmentCases, evalAttachmentControl, GrantPolicy, modelCatalog, prefilterAttachment, ruleRelevance,
  type AttachmentRelevance, type EvalAttachmentCase, type RelevanceAttachment,
} from "../src/index.js";
import { fileNameFromUrl, LlamaCppProvider } from "../src/llm/index.js";

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const threads = Number(flag("--threads") ?? 0);
const setName = flag("--set") ?? "test";
const directory = args[0] ?? "";
const modelIds = args.slice(1).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const sets: Record<string, EvalAttachmentCase[]> = { test: evalAttachmentCases, kontrolle: evalAttachmentControl };
const cases = sets[setName] ?? evalAttachmentCases;

type Judge = (c: EvalAttachmentCase, open: RelevanceAttachment[]) => Promise<{ id: string; relevance: AttachmentRelevance }[]>;

async function run(label: string, judge: Judge) {
  let right = 0, total = 0, missed = 0, wasted = 0;
  const wrong: string[] = [];
  const times: number[] = [];
  for (const c of cases) {
    const open: RelevanceAttachment[] = [];
    const got = new Map<string, AttachmentRelevance>();
    c.attachments.forEach((a, i) => {
      const id = `${c.id}#${i}`;
      const pre = prefilterAttachment({ filename: a.filename, mimeType: a.mimeType, size: a.size, isInline: a.isInline ?? false, contentId: a.contentId ?? null });
      if (pre) got.set(id, pre.relevance);
      else open.push({ id, filename: a.filename, mimeType: a.mimeType, size: a.size, pageCount: a.pageCount ?? null, snippet: a.snippet ?? null });
    });
    if (open.length) {
      const started = performance.now();
      for (const r of await judge(c, open)) got.set(r.id, r.relevance);
      times.push(performance.now() - started);
    }
    c.attachments.forEach((a, i) => {
      const value = got.get(`${c.id}#${i}`);
      total++;
      if (value === a.expect) right++;
      else wrong.push(`${c.id} ${a.filename}: ${value} statt ${a.expect}`);
      if (a.expect === "central" && value === "irrelevant") missed++;
      if (a.expect === "irrelevant" && value === "central") wasted++;
    });
  }
  times.sort((a, b) => a - b);
  const median = times.length ? (times[Math.floor(times.length / 2)] ?? 0) / 1000 : 0;
  console.log(`| ${label} | ${right}/${total} (${((100 * right) / total).toFixed(1)} %) | ${missed} | ${wasted} | ${median.toFixed(1)} s |`);
  return wrong;
}

console.log(`Satz: ${setName}\n\n| Verfahren | richtig | zentral übersehen (→ unwichtig) | unnötig gelesen (unwichtig → zentral) | Zeit je Mail (Median) |\n|---|---|---|---|---|`);
const notes: string[] = [];
notes.push(...(await run("Vorfilter + Regeln", async (c, open) => ruleRelevance({ subject: c.subject, from: c.from, body: c.body }, open))).map((w) => `Regeln ${w}`));
for (const id of modelIds) {
  const model = modelCatalog.find((m) => m.id === id);
  if (!model) throw new Error(`Unbekanntes Modell ${id}`);
  const provider = new LlamaCppProvider({ id: model.id, displayName: model.name, modelPath: join(directory, fileNameFromUrl(model.url)), gpu: false, maxThreads: threads, idleUnloadMs: 0 });
  const router = new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() });
  await router.run({ task: "attachmentRelevance", messages: [{ role: "user", content: "Hallo" }], maxTokens: 4 }, { accountIds: ["eval"] });
  notes.push(...(await run(`Vorfilter + ${model.name}`, async (c, open) => (await checkAttachmentRelevance(router, { subject: c.subject, from: c.from, body: c.body }, open, { accountIds: ["eval"] })).results)).map((w) => `${model.name} ${w}`));
  await provider.dispose();
}
console.log(`\nAbweichungen:\n${notes.map((n) => `- ${n}`).join("\n")}`);
