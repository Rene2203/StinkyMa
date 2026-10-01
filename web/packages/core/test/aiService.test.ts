import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockData, type AIRequest, type AISettings, type AIStatus, type CatalogModel } from "../src/index.js";
import { AIService, ModelStore, type ManagedProvider } from "../src/llm/index.js";
import { AIResultStore, openDatabase, seedIfEmpty, SqliteMailRepository } from "../src/sqlite/index.js";

// Testdaten erfunden.

const catalog: CatalogModel[] = ["klein", "gross"].map((id) => ({
  id,
  name: `Modell ${id}`,
  family: "qwen",
  paramsB: 1,
  quantization: "Q4_K_M",
  url: `https://models.example/${id}.gguf`,
  sizeBytes: 10,
  sha256: "0".repeat(64),
  minRamGb: id === "klein" ? 4 : 32,
  capabilities: ["text"],
  license: "Apache-2.0",
  note: "",
}));

class FakeProvider implements ManagedProvider {
  readonly privacyClass = "onDevice" as const;
  readonly contextWindow = 4096;
  readonly displayName: string;
  requests: AIRequest[] = [];
  disposed = false;
  fail = false;
  constructor(readonly id: string) {
    this.displayName = id;
  }
  async generate(request: AIRequest) {
    if (this.fail) throw new Error("Modell abgestürzt");
    this.requests.push(request);
    const text = request.task === "categorize"
      ? '{"category": "work", "confidence": 0.7}'
      : '{"summary": "Es geht um den Grillabend.", "openPoints": ["Salat mitbringen"], "waitingOn": "me"}';
    return { text, providerId: this.id, privacyClass: this.privacyClass, durationMs: 3 };
  }
  async unload() {}
  async dispose() {
    this.disposed = true;
  }
}

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stinkyma-ai-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(initial: Partial<AISettings> = {}, options: { failing?: boolean } = {}) {
  const db = openDatabase(":memory:");
  seedIfEmpty(db, createMockData(new Date()));
  db.prepare("UPDATE message SET category = NULL").run();
  const repository = new SqliteMailRepository(db);
  const store = new ModelStore(dir);
  const results = new AIResultStore(db);
  let saved: unknown = initial;
  const providers: FakeProvider[] = [];
  const statuses: AIStatus[] = [];
  let categorized = 0;
  const service = new AIService({
    store,
    results,
    thread: (id) => repository.thread(id),
    ownAddresses: async () => (await repository.accounts()).map((a) => a.email),
    settings: { load: () => saved, save: (s) => (saved = s) },
    ramGb: 8,
    catalog,
    createProvider: (model) => {
      const provider = new FakeProvider(model.id);
      provider.fail = options.failing ?? false;
      providers.push(provider);
      return provider;
    },
    onStatus: (s) => statuses.push(s),
    onCategorized: () => categorized++,
  });
  const install = (id: string) => {
    const model = catalog.find((m) => m.id === id);
    if (!model) throw new Error("Testmodell fehlt");
    const path = store.pathFor(model);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "gguf");
  };
  return { db, repository, results, service, providers, statuses, install, saved: () => saved, categorized: () => categorized };
}

async function until(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(condition()).toBe(true);
}

describe("AIService", () => {
  it("zeigt Modelle mit Speicherbedarf und Zustand; ohne Modell nicht bereit", async () => {
    const { service, install } = setup();
    install("klein");
    const status = await service.status();
    expect(status.ready).toBe(false);
    expect(status.models.map((m) => [m.id, m.state, m.fits])).toEqual([
      ["klein", "installed", true],
      ["gross", "missing", false],
    ]);
    await expect(service.summarize("egal")).rejects.toThrow();
  });

  it("speichert Einstellungen und lehnt unbekannte Modelle ab", async () => {
    const { service, saved, install } = setup();
    install("klein");
    const status = await service.update({ enabled: true, modelId: "klein", autoCategorize: false });
    expect(status.ready).toBe(true);
    expect(saved()).toEqual({ enabled: true, modelId: "klein", autoCategorize: false, useGpu: true });
    await expect(service.update({ modelId: "gibt-es-nicht" })).rejects.toThrow(/Unbekanntes Modell/);
  });

  it("vergisst ein gespeichertes Modell, das es nicht mehr gibt", async () => {
    const service = new AIService({
      store: new ModelStore(dir),
      results: new AIResultStore(openDatabase(":memory:")),
      thread: async () => [],
      ownAddresses: async () => [],
      settings: { load: () => ({ enabled: true, modelId: "uralt" }), save: () => undefined },
      ramGb: 8,
      catalog,
    });
    expect((await service.status()).settings.modelId).toBeNull();
  });

  it("fasst zusammen, speichert das Ergebnis und erkennt neue Mails", async () => {
    const { service, install, repository, db, providers } = setup({ enabled: true, modelId: "klein", autoCategorize: false });
    install("klein");
    const [message] = await repository.messages({ kind: "unifiedInbox" }, 1);
    if (!message) throw new Error("keine Testmail");
    expect(await service.cachedSummary(message.threadId)).toBeNull();
    const view = await service.summarize(message.threadId);
    expect(view).toMatchObject({ summary: "Es geht um den Grillabend.", openPoints: ["Salat mitbringen"], waitingOn: "me", origin: "onDevice", modelName: "Modell klein", stale: false });
    // Prompt enthält die eigenen Adressen (für „wer ist dran“)
    expect(providers[0]?.requests[0]?.messages[0]?.content).toContain("@");
    expect(await service.cachedSummary(message.threadId)).toMatchObject({ summary: view.summary, stale: false });

    // neue Mail in der Konversation → veraltet
    db.prepare("UPDATE message SET date = '2099-01-01T00:00:00.000Z' WHERE id = ?").run(message.id);
    expect(await service.cachedSummary(message.threadId)).toMatchObject({ stale: true });
  });

  it("ordnet Posteingangsmails im Hintergrund ein und merkt sich die Herkunft", async () => {
    const { service, install, results, db, categorized, statuses } = setup();
    install("klein");
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const before = results.uncategorizedCount(since);
    expect(before).toBeGreaterThan(0);
    await service.update({ enabled: true, modelId: "klein" });
    await until(() => results.uncategorizedCount(since) === 0 && statuses.at(-1)?.categorizing === null);
    expect(categorized()).toBe(before);
    const origins = db.prepare("SELECT DISTINCT category, categoryOrigin FROM message m JOIN mailbox b ON b.id = m.mailboxId WHERE b.role = 'inbox' AND m.date >= ?").all(since);
    expect(origins).toEqual([{ category: "work", categoryOrigin: "onDevice" }]);
    // Gesendete Mails bleiben unberührt
    const sent = db.prepare("SELECT COUNT(*) AS n FROM message m JOIN mailbox b ON b.id = m.mailboxId WHERE b.role != 'inbox' AND m.category IS NOT NULL").get() as { n: number };
    expect(sent.n).toBe(0);
  });

  it("hält die Einordnung bei einem Modellfehler an und meldet ihn", async () => {
    const { service, install, results, providers, statuses } = setup({}, { failing: true });
    install("klein");
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const before = results.uncategorizedCount(since);
    await service.update({ enabled: true, modelId: "klein" });
    await until(() => statuses.some((s) => s.error !== null) && statuses.at(-1)?.categorizing === null);
    expect(providers).toHaveLength(1);
    expect(results.uncategorizedCount(since)).toBe(before);
    expect((await service.status()).error).toBe("Modell abgestürzt");
    // Neuer Anstoß ohne Änderung: bleibt stehen (kein Dauerversuch) – Einstellungen ändern setzt den Fehler zurück
    expect((await service.update({ autoCategorize: false })).error).toBeNull();
  });

  it("Modell löschen gibt es frei und setzt die Auswahl zurück", async () => {
    const { service, install, providers, saved, repository } = setup({ enabled: true, modelId: "klein", autoCategorize: false });
    install("klein");
    const [message] = await repository.messages({ kind: "unifiedInbox" }, 1);
    if (!message) throw new Error("keine Testmail");
    await service.summarize(message.threadId);
    await service.deleteModel("klein");
    expect(providers.every((p) => p.disposed)).toBe(true);
    expect((saved() as AISettings).modelId).toBeNull();
    const status = await service.status();
    expect(status.models[0]?.state).toBe("missing");
    expect(status.ready).toBe(false);
  });

  it("Ausschalten gibt das Modell frei", async () => {
    const { service, install, repository, providers } = setup({ enabled: true, modelId: "klein", autoCategorize: false });
    install("klein");
    const [message] = await repository.messages({ kind: "unifiedInbox" }, 1);
    if (!message) throw new Error("keine Testmail");
    await service.summarize(message.threadId);
    expect(providers).toHaveLength(1);
    await service.update({ enabled: false });
    expect(providers[0]?.disposed).toBe(true);
    await expect(service.summarize(message.threadId)).rejects.toThrow(/ausgeschaltet/);
  });
});

describe("AIResultStore", () => {
  it("Zusammenfassung verschwindet mit ihrer Konversation; kaputte Einträge werden tolerant gelesen", () => {
    const db = openDatabase(":memory:");
    seedIfEmpty(db, createMockData(new Date()));
    const results = new AIResultStore(db);
    const { threadId } = db.prepare("SELECT threadId FROM message LIMIT 1").get() as { threadId: string };
    results.saveSummary({ threadId, summary: "S", openPoints: ["a"], waitingOn: "others", modelId: "m", privacyClass: "onDevice", promptVersion: 2, lastMessageDate: "x", messageCount: 1, createdAt: "y" });
    results.saveSummary({ threadId, summary: "S2", openPoints: [], waitingOn: "me", modelId: "m", privacyClass: "onDevice", promptVersion: 2, lastMessageDate: "x", messageCount: 1, createdAt: "z" });
    expect(results.summary(threadId)).toMatchObject({ summary: "S2", waitingOn: "me", openPoints: [] });
    db.prepare("UPDATE threadSummary SET openPoints = 'kaputt', waitingOn = '?' WHERE threadId = ?").run(threadId);
    expect(results.summary(threadId)).toMatchObject({ openPoints: [], waitingOn: "nobody" });
    db.prepare("DELETE FROM message WHERE threadId = ?").run(threadId);
    db.prepare("DELETE FROM thread WHERE id = ?").run(threadId);
    expect(results.summary(threadId)).toBeNull();
  });
});
