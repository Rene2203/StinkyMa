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
  /** Scheitert nur an bestimmten Mails */
  failWhen: ((request: AIRequest) => boolean) | null = null;
  /** Hängt (antwortet nie, bis abgebrochen) */
  hangWhen: ((request: AIRequest) => boolean) | null = null;
  /** Rechenzeit (wie ein echtes Modell) */
  delayMs = 0;
  /** Gemeldete Rechenzeit */
  reportedMs = 3;
  constructor(readonly id: string) {
    this.displayName = id;
  }
  async generate(request: AIRequest, signal?: AbortSignal) {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.fail) throw new Error("Modell abgestürzt");
    if (this.failWhen?.(request)) throw new Error("Kontext zu klein");
    if (this.hangWhen?.(request)) {
      await new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("abgebrochen"))));
    }
    this.requests.push(request);
    const text = request.task === "complete"
      ? "gern dabei. Bis dann!"
      : request.task === "categorize"
      ? '{"category": "work", "confidence": 0.7}'
      : '{"summary": "Es geht um den Grillabend.", "openPoints": ["Salat mitbringen"], "waitingOn": "me"}';
    return { text, providerId: this.id, privacyClass: this.privacyClass, durationMs: this.reportedMs };
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

function setup(initial: Partial<AISettings> = {}, options: { failing?: boolean; configure?: (provider: FakeProvider, index: number) => void; timeoutMs?: number } = {}) {
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
    message: (id) => repository.message(id),
    ownAddresses: async () => (await repository.accounts()).map((a) => a.email),
    settings: { load: () => saved, save: (s) => (saved = s) },
    ramGb: 8,
    catalog,
    createProvider: (model) => {
      const provider = new FakeProvider(model.id);
      provider.fail = options.failing ?? false;
      options.configure?.(provider, providers.length);
      providers.push(provider);
      return provider;
    },
    onStatus: (s) => statuses.push(s),
    onCategorized: () => categorized++,
    ...(options.timeoutMs ? { generateTimeoutMs: () => options.timeoutMs ?? 0 } : {}),
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
  for (let i = 0; i < 600 && !condition(); i++) await new Promise((r) => setTimeout(r, 5));
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
    expect(saved()).toEqual({ enabled: true, modelId: "klein", autoCategorize: false, useGpu: true, vision: false, categorizeRange: { kind: "recent" }, autocomplete: true });
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
    const { service, install, results, db, categorized, statuses } = setup({}, { configure: (p) => (p.delayMs = 15) });
    install("klein");
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const before = results.uncategorizedCount(since);
    expect(before).toBeGreaterThan(0);
    await service.update({ enabled: true, modelId: "klein" });
    await until(() => results.uncategorizedCount(since) === 0 && statuses.at(-1)?.categorizing === null);
    expect(categorized()).toBe(before);
    // Fortschritt und laufende Aufgabe werden gemeldet (für die Anzeige in der Seitenleiste)
    expect(statuses.some((s) => s.activity?.task === "categorize")).toBe(true);
    const progress = statuses.map((s) => s.categorizing).filter((c) => c !== null);
    expect(progress[0]).toMatchObject({ done: 0, total: before });
    expect(progress.at(-1)).toMatchObject({ done: before, remaining: 0 });
    expect(statuses.at(-1)?.activity).toBeNull();
    const origins = db.prepare("SELECT DISTINCT category, categoryOrigin FROM message m JOIN mailbox b ON b.id = m.mailboxId WHERE b.role = 'inbox' AND m.date >= ?").all(since);
    expect(origins).toEqual([{ category: "work", categoryOrigin: "onDevice" }]);
    // Gesendete Mails bleiben unberührt
    const sent = db.prepare("SELECT COUNT(*) AS n FROM message m JOIN mailbox b ON b.id = m.mailboxId WHERE b.role != 'inbox' AND m.category IS NOT NULL").get() as { n: number };
    expect(sent.n).toBe(0);
  });

  it("hält die Einordnung erst nach mehreren Fehlern in Folge an und meldet sie", async () => {
    const { service, install, results, providers, statuses } = setup({}, { failing: true });
    install("klein");
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const before = results.uncategorizedCount(since);
    await service.update({ enabled: true, modelId: "klein" });
    await until(() => statuses.some((s) => s.error !== null) && statuses.at(-1)?.categorizing === null);
    expect(providers).toHaveLength(1);
    // drei Mails bekamen die einfache Regel-Einordnung, dann Stopp (kein Dauerversuch)
    expect(results.uncategorizedCount(since)).toBe(before - 3);
    expect((await service.status()).error).toBe("Modell abgestürzt");
    // „Weiter einordnen“: Fehler weg, neuer Anlauf
    providers[0]!.fail = false;
    expect((await service.resume()).error).toBeNull();
    await until(() => results.uncategorizedCount(since) === 0 && statuses.at(-1)?.categorizing === null);
  });

  it("eine Mail, an der das Modell scheitert, hält die übrigen nicht auf", async () => {
    let problem = "";
    const { service, install, results, db, statuses } = setup({}, {
      configure: (p) => {
        p.failWhen = (r) => {
          const text = r.messages.at(-1)?.content ?? "";
          if (!problem) problem = text;
          return text === problem;
        };
      },
    });
    install("klein");
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    await service.update({ enabled: true, modelId: "klein" });
    await until(() => results.uncategorizedCount(since) === 0 && statuses.at(-1)?.categorizing === null);
    const origins = db.prepare("SELECT categoryOrigin AS o, COUNT(*) AS n FROM message WHERE categoryOrigin IS NOT NULL GROUP BY categoryOrigin ORDER BY o").all();
    expect(origins).toEqual([{ o: "onDevice", n: expect.any(Number) }, { o: "rules", n: 1 }]);
    expect((await service.status()).error).toBeNull();
  });

  it("hängt das Modell, wird die Anfrage abgebrochen, das Modell neu geladen und weitergemacht", async () => {
    const { service, install, results, providers, statuses, db } = setup({}, {
      timeoutMs: 50,
      // Das erste Modell hängt bei jeder Anfrage; das neu geladene arbeitet normal
      configure: (p, index) => {
        if (index === 0) p.hangWhen = () => true;
      },
    });
    install("klein");
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    await service.update({ enabled: true, modelId: "klein" });
    await until(() => results.uncategorizedCount(since) === 0 && statuses.at(-1)?.categorizing === null);
    expect(providers.length).toBe(2);
    expect(providers[0]?.disposed).toBe(true);
    // Zusammenfassen danach geht – die Warteschlange ist nicht blockiert
    const { threadId } = db.prepare("SELECT threadId FROM message LIMIT 1").get() as { threadId: string };
    expect((await service.summarize(threadId)).summary).toBe("Es geht um den Grillabend.");
  });

  it("Korrektur von Hand: gemerkt je Absender, andere KI-Einordnungen des Absenders folgen, neue Mails ohne Modell", async () => {
    const { service, install, results, db, providers, statuses } = setup();
    install("klein");
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    await service.update({ enabled: true, modelId: "klein" });
    await until(() => results.uncategorizedCount(since) === 0 && statuses.at(-1)?.categorizing === null);
    // Ein Absender mit mehreren Mails
    const inbox = "FROM message m JOIN mailbox b ON b.id = m.mailboxId WHERE b.role = 'inbox' AND m.date >= ?";
    const { fromAddress } = db.prepare(`SELECT m.fromAddress ${inbox} GROUP BY lower(m.fromAddress) HAVING COUNT(*) > 1 LIMIT 1`).get(since) as { fromAddress: string };
    const ids = (db.prepare(`SELECT m.id ${inbox} AND m.fromAddress = ? ORDER BY m.date`).all(since, fromAddress) as { id: string }[]).map((r) => r.id);
    const [first, ...others] = ids;
    expect(others.length).toBeGreaterThan(0);
    const { changed } = await service.setCategory(first!, "newsletter", true);
    expect(changed).toBeGreaterThanOrEqual(others.length); // die übrigen (KI: „work“) folgen
    expect(db.prepare("SELECT category, categoryOrigin FROM message WHERE id = ?").get(first)).toEqual({ category: "newsletter", categoryOrigin: "user" });
    expect(await service.learnedSenders()).toEqual([expect.objectContaining({ address: fromAddress.toLowerCase(), category: "newsletter" })]);

    // Neue Mail des Absenders (ohne Einordnung): kommt ohne Modell zur gemerkten Einordnung
    const requestsBefore = providers[0]!.requests.length;
    db.prepare("UPDATE message SET category = NULL, categoryOrigin = NULL WHERE id = ?").run(others[0]);
    service.categorizeInBackground();
    await until(() => results.uncategorizedCount(since) === 0 && statuses.at(-1)?.categorizing === null);
    expect(db.prepare("SELECT category, categoryOrigin FROM message WHERE id = ?").get(others[0])).toEqual({ category: "newsletter", categoryOrigin: "learned" });
    expect(providers[0]!.requests.length).toBe(requestsBefore);
    // Vergessen; „keine Einordnung“ ohne Merken
    await service.forgetSender(fromAddress);
    expect(await service.learnedSenders()).toEqual([]);
    await service.setCategory(first!, null, false);
    expect(db.prepare("SELECT category, categoryOrigin FROM message WHERE id = ?").get(first)).toEqual({ category: null, categoryOrigin: null });
  });

  it("ältere Mails nur auf Wunsch; der Rückstand wird gemeldet", async () => {
    const { service, install, results, db, statuses } = setup();
    install("klein");
    // Zwei Posteingangs-Mails sind 40 Tage alt
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    db.prepare("UPDATE message SET date = ? WHERE id IN (SELECT m.id FROM message m JOIN mailbox b ON b.id = m.mailboxId WHERE b.role = 'inbox' LIMIT 2)").run(old);
    await service.update({ enabled: true, modelId: "klein" });
    await until(() => statuses.at(-1)?.categorizing === null && (statuses.at(-1)?.backlog.recent ?? 1) === 0);
    expect((await service.status()).backlog).toEqual({ recent: 0, older: 2 });
    // Eigener Zeitraum ohne diese Tage: bleibt bei 2 außerhalb
    await service.update({ categorizeRange: { kind: "custom", from: "2020-01-01", to: "2020-01-31" } });
    expect((await service.status()).backlog).toEqual({ recent: 0, older: 2 });
    await service.update({ categorizeRange: { kind: "all" } });
    await until(() => results.uncategorizedTotal() === 0 && statuses.at(-1)?.categorizing === null);
    expect((await service.status()).backlog).toEqual({ recent: 0, older: 0 });
  });

  it("Aufräumen „KI prüfen“: gewünschte Mails vorrangig, auch alte und ohne automatische Einordnung", async () => {
    const { service, install, db, statuses } = setup({ enabled: true, modelId: "klein", autoCategorize: false });
    install("klein");
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const ids = (db.prepare("SELECT m.id FROM message m JOIN mailbox b ON b.id = m.mailboxId WHERE b.role = 'inbox' LIMIT 2").all() as { id: string }[]).map((r) => r.id);
    expect(ids).toHaveLength(2);
    db.prepare(`UPDATE message SET date = ? WHERE id IN (${ids.map(() => "?").join(",")})`).run(old, ...ids);
    expect(service.categorizeMessages([...ids, ids[0]!])).toBe(2);
    await until(() => statuses.at(-1)?.categorizing === null && ids.every((id) => (db.prepare("SELECT category FROM message WHERE id = ?").get(id) as { category: string | null }).category !== null));
    // Nur die gewünschten – sonst bleibt alles uneingeordnet (automatisch ist aus)
    const others = db.prepare("SELECT COUNT(*) AS n FROM message WHERE category IS NOT NULL").get() as { n: number };
    expect(others.n).toBe(2);
    expect(service.categorizeMessages(ids)).toBe(0); // schon eingeordnet
    await service.update({ enabled: false });
    expect(service.categorizeMessages(["egal"])).toBe(0);
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

describe("AIService – Autovervollständigung (W8.5)", () => {
  it("ergänzt den Satz, nur nach einem fertigen Wort, nur mit Konto; aus = kein Vorschlag", async () => {
    const { service, install, providers } = setup({ enabled: true, modelId: "klein", autoCategorize: false });
    install("klein");
    const input = { before: "Hallo Tom,\nich bin ", after: "> Kommst du am Samstag?", subject: "Grillabend", to: ["tom@example.test"], accountId: "acc" };
    expect(await service.complete(input)).toMatchObject({ text: "gern dabei." });
    expect(providers[0]?.requests.at(-1)?.task).toBe("complete");
    expect(await service.complete({ ...input, before: "Hallo Tom,\nich bi" })).toBeNull();
    expect(await service.complete({ ...input, accountId: null })).toBeNull();
    await service.update({ autocomplete: false });
    expect(await service.complete(input)).toBeNull();
  });

  it("Vordergrund vor Hintergrund: ein Klick wartet nicht hinter der Einordnung aller Mails", async () => {
    const { service, install, providers, repository } = setup({ enabled: true, modelId: "klein", autoCategorize: true }, { configure: (p) => (p.delayMs = 15) });
    install("klein");
    service.categorizeInBackground();
    await until(() => (providers[0]?.requests.length ?? 0) >= 1);
    const [first] = await repository.messages({ kind: "unifiedInbox" }, 1);
    await service.summarize(first?.threadId ?? "", { full: true });
    const tasks = providers[0]?.requests.map((r) => r.task) ?? [];
    // Höchstens die gerade laufende Einordnung kam noch davor
    expect(tasks.indexOf("summarize")).toBeLessThanOrEqual(2);
    expect(tasks.filter((t) => t === "categorize").length).toBeLessThan(5);
  });

  it("schaltet sich auf zu langsamen Rechnern aus, bis es wieder eingeschaltet wird", async () => {
    const { service, install } = setup({ enabled: true, modelId: "klein", autoCategorize: false }, { configure: (p) => (p.reportedMs = 9000) });
    install("klein");
    const input = { before: "Vielen Dank für ", accountId: "acc" };
    for (let i = 0; i < 3; i++) await service.complete(input);
    expect((await service.status()).autocompleteSlow).toBe(true);
    expect(await service.complete(input)).toBeNull();
    await service.update({ autocomplete: true });
    expect((await service.status()).autocompleteSlow).toBe(false);
  });

  it("stellt sich höchstens hinter eine laufende KI-Anfrage an", async () => {
    const { service, install, repository } = setup({ enabled: true, modelId: "klein", autoCategorize: false }, { configure: (p) => (p.delayMs = 80) });
    install("klein");
    const [first] = await repository.messages({ kind: "unifiedInbox" }, 1);
    // Eine laufende Anfrage: Vorschlag kommt danach; laufen schon zwei (eine wartet), gibt es keinen
    const one = service.summarize(first?.threadId ?? "", { full: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(await service.complete({ before: "Vielen Dank für ", accountId: "acc" })).toMatchObject({ text: "gern dabei." });
    await one;
    const a = service.summarize(first?.threadId ?? "", { full: true });
    const b = service.summarize(first?.threadId ?? "", { full: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(await service.complete({ before: "Vielen Dank für ", accountId: "acc" })).toBeNull();
    await Promise.all([a, b]);
  });
});
