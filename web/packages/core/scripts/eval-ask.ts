import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIRouter, answerQuestion, evalAskCases, evalHoldoutMails, evalMails, GrantPolicy, type CatalogModel } from "../src/index.js";
import { AskService, fileNameFromUrl, LlamaCppProvider, LlamaEmbedder } from "../src/llm/index.js";
import { EmbeddingStore, MailWriter, openDatabase } from "../src/sqlite/index.js";

// Messlauf „Frag dein Postfach“: gleiche Fragen einmal nur mit Wortsuche, einmal mit Suche nach Bedeutung.
export async function runAskEval(options: { directory: string; model: CatalogModel; gpu: boolean; threads: number; out?: string | undefined }): Promise<string> {
  const db = openDatabase(":memory:");
  const writer = new MailWriter(db);
  writer.insertAccount({ id: "eval", email: "anna@beispiel.example", displayName: "Anna", provider: "imap", username: "anna", imapHost: "h", imapPort: 993, imapSecurity: "tls", smtpHost: "h", smtpPort: 465, smtpSecurity: "tls", authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0 });
  writer.upsertMailbox({ id: "eval/inbox", accountId: "eval", name: "INBOX", role: "inbox" });
  [...evalMails, ...evalHoldoutMails].forEach((m, i) => {
    writer.insertMessage({
      id: m.id, accountId: "eval", mailboxId: "eval/inbox", uid: i + 1, messageId: `<${m.id}@eval.example>`, threadId: m.id, threadSubject: m.subject,
      from: m.from, to: [{ name: "Anna Beispiel", address: "anna@beispiel.example" }], cc: [], subject: m.subject, date: "2026-09-30T08:00:00.000Z",
      snippet: m.body.slice(0, 120), bodyText: m.body, bodyHtml: null, flags: 0, attachments: [],
    });
  });
  const provider = new LlamaCppProvider({ id: options.model.id, displayName: options.model.name, modelPath: join(options.directory, fileNameFromUrl(options.model.url)), gpu: options.gpu ? "auto" : false, maxThreads: options.threads, idleUnloadMs: 0 });
  const router = new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() });
  const store = new EmbeddingStore(db);
  const answer = (question: string, sources: Parameters<typeof answerQuestion>[2], accountIds: string[]) => answerQuestion(router, question, sources, { accountIds, today: "2026-09-30" });
  const lines = ["| Suche | Quelle gefunden (Top 6) | Quelle auf Platz 1 | Antwort richtig (mit Quelle) | Falle erkannt | Zeit je Frage (Median) |", "|---|---|---|---|---|---|"];
  const misses: string[] = [];
  const reports: unknown[] = [];
  for (const mode of ["Wörter", "Bedeutung + Wörter"] as const) {
    // Wortsuche: leerer Modellordner; Bedeutung: Ordner mit dem Embedding-Modell
    const modelDirectory = mode === "Wörter" ? mkdtempSync(join(tmpdir(), "ask-none-")) : join(options.directory, "embedding");
    const service = new AskService({ store, modelDirectory, createEmbedder: (path) => new LlamaEmbedder({ modelPath: path, gpu: options.gpu ? "auto" : false, maxThreads: options.threads, idleUnloadMs: 0 }), answer });
    if (mode !== "Wörter") {
      const started = Date.now();
      service.startIndexing();
      await service.idle();
      misses.push(`Indexieren (${(await service.status()).indexed} Mails): ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
    let found = 0, first = 0, right = 0, trapOk = 0, traps = 0, real = 0;
    const times: number[] = [];
    for (const c of evalAskCases) {
      process.stderr.write(`\r${mode}: ${c.id}   `);
      const result = await service.ask(c.question);
      times.push(result.durationMs);
      const text = (result.answer ?? "").toLowerCase();
      if (c.sources.length === 0) {
        traps++;
        if (c.answer.some((w) => text.includes(w.toLowerCase())) && result.cited.length === 0) trapOk++;
        else misses.push(`${mode} ${c.id} (Falle): „${result.answer ?? "–"}“`);
        continue;
      }
      real++;
      const ids = result.sources.map((s) => s.messageId);
      const hit = ids.some((id) => c.sources.includes(id));
      if (hit) found++;
      if (c.sources.includes(ids[0] ?? "")) first++;
      const citedIds = result.cited.map((n) => result.sources.find((s) => s.n === n)?.messageId);
      const ok = c.answer.some((w) => text.includes(w.toLowerCase())) && citedIds.some((id) => id && c.sources.includes(id));
      if (ok) right++;
      else misses.push(`${mode} ${c.id}: ${hit ? "Quelle gefunden" : "Quelle NICHT gefunden"} – „${(result.answer ?? "–").slice(0, 120)}“ Quellen: ${ids.join(", ")}`);
    }
    process.stderr.write("\n");
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] ?? 0;
    lines.push(`| ${mode} | ${found}/${real} | ${first}/${real} | ${right}/${real} | ${trapOk}/${traps} | ${(median / 1000).toFixed(1).replace(".", ",")} s |`);
    reports.push({ mode, found, first, right, trapOk, median });
    await service.dispose();
  }
  await provider.dispose();
  if (options.out) writeFileSync(options.out, JSON.stringify(reports, null, 2));
  return [`Modell für Antworten: ${options.model.name}`, "", ...lines, "", "Abweichungen:", ...misses.map((m) => `- ${m}`)].join("\n");
}
