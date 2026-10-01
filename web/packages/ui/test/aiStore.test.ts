import { describe, expect, it } from "vitest";
import { createMockData, InMemoryMailRepository, type AIApi, type AIStatus, type SummaryView } from "@stinkyma/core";
import { BrowserStore, selectedMessage } from "../src/store.js";

// Testdaten erfunden.

function status(overrides: Partial<AIStatus> = {}): AIStatus {
  return {
    settings: { enabled: true, modelId: "m", autoCategorize: true, useGpu: true },
    models: [],
    ramGb: 8,
    ready: true,
    download: null,
    categorizing: null,
    error: null,
    ...overrides,
  };
}

function fakeAI(options: { ready?: boolean; cached?: SummaryView | null; fail?: string } = {}) {
  const calls: string[] = [];
  let release: (() => void) | null = null;
  const api: AIApi = {
    status: async () => status({ ready: options.ready ?? true }),
    update: async (patch) => {
      calls.push(`update:${JSON.stringify(patch)}`);
      return status({ settings: { enabled: true, modelId: "m", autoCategorize: true, useGpu: true, ...patch } });
    },
    download: async (id) => {
      calls.push(`download:${id}`);
      throw new Error("Netz weg");
    },
    cancelDownload: async () => {
      calls.push("cancel");
    },
    deleteModel: async (id) => {
      calls.push(`delete:${id}`);
    },
    cachedSummary: async (threadId) => {
      calls.push(`cached:${threadId}`);
      return options.cached ?? null;
    },
    summarize: async (threadId) => {
      calls.push(`summarize:${threadId}`);
      await new Promise<void>((resolve) => (release = resolve));
      if (options.fail) throw new Error(options.fail);
      return { threadId, summary: "Kurz gesagt.", openPoints: ["Antworten"], waitingOn: "me", origin: "onDevice", modelName: "Gemma", createdAt: "2026-10-01T10:00:00Z", stale: false };
    },
  };
  return { api, calls, finish: () => release?.() };
}

async function setup(ai: ReturnType<typeof fakeAI>) {
  const store = new BrowserStore(new InMemoryMailRepository(createMockData(new Date("2026-09-29T10:00:00Z"))), { ai: ai.api });
  await store.start();
  return store;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("BrowserStore – KI", () => {
  it("lädt den KI-Status beim Start; ohne KI-Schnittstelle bleibt er leer", async () => {
    const store = await setup(fakeAI());
    expect(store.getState().ai?.ready).toBe(true);
    const plain = new BrowserStore(new InMemoryMailRepository(createMockData()));
    await plain.start();
    expect(plain.getState().ai).toBeNull();
  });

  it("fasst die geöffnete Konversation zusammen und zeigt den Zwischenstand", async () => {
    const ai = fakeAI();
    const store = await setup(ai);
    const first = store.getState().messages[0];
    if (!first) throw new Error("keine Mail");
    await store.selectMessage(first.id);
    const done = store.summarize();
    expect(store.getState().summary).toMatchObject({ threadId: first.threadId, busy: true, view: null });
    ai.finish();
    await done;
    expect(store.getState().summary).toMatchObject({ busy: false, error: null, view: { summary: "Kurz gesagt.", waitingOn: "me" } });
    expect(ai.calls).toContain(`summarize:${first.threadId}`);
  });

  it("zeigt Fehler in der Karte statt im Banner", async () => {
    const ai = fakeAI({ fail: "Error invoking remote method 'ai': Error: Modell fehlt" });
    const store = await setup(ai);
    const first = store.getState().messages[0];
    if (!first) throw new Error("keine Mail");
    await store.selectMessage(first.id);
    const done = store.summarize();
    ai.finish();
    await done;
    expect(store.getState().summary?.error).toBe("Modell fehlt");
    expect(store.getState().error).toBeNull();
  });

  it("zeigt gespeicherte Zusammenfassungen beim Öffnen und verwirft sie beim Wechsel", async () => {
    const messages = createMockData(new Date("2026-09-29T10:00:00Z")).messages;
    const [first] = messages;
    if (!first) throw new Error("keine Mail");
    const cached: SummaryView = { threadId: first.threadId, summary: "Gespeichert.", openPoints: [], waitingOn: "nobody", origin: "onDevice", modelName: "Qwen", createdAt: "", stale: true };
    const ai = fakeAI({ cached });
    const store = await setup(ai);
    await store.selectMessage(first.id);
    await flush();
    expect(store.getState().summary?.view?.summary).toBe("Gespeichert.");
    const other = store.getState().messages.find((m) => m.threadId !== first.threadId);
    if (!other) throw new Error("keine zweite Konversation");
    await store.selectMessage(other.id);
    expect(store.getState().summary?.threadId ?? other.threadId).toBe(other.threadId);
    expect(selectedMessage(store.getState())?.id).toBe(other.id);
  });

  it("fragt ohne fertiges Modell keine Zusammenfassungen ab", async () => {
    const ai = fakeAI({ ready: false });
    const store = await setup(ai);
    const first = store.getState().messages[0];
    if (!first) throw new Error("keine Mail");
    await store.selectMessage(first.id);
    await flush();
    expect(ai.calls.filter((c) => c.startsWith("cached"))).toEqual([]);
  });

  it("reicht Einstellungen, Download, Abbruch und Löschen durch – Download-Fehler nicht ins Banner", async () => {
    const ai = fakeAI();
    const store = await setup(ai);
    await store.updateAI({ autoCategorize: false });
    expect(store.getState().ai?.settings.autoCategorize).toBe(false);
    await store.downloadModel("gemma");
    await store.cancelModelDownload();
    await store.deleteModel("gemma");
    expect(ai.calls).toEqual(['update:{"autoCategorize":false}', "download:gemma", "cancel", "delete:gemma"]);
    expect(store.getState().error).toBeNull();
  });

  it("übernimmt Status-Meldungen (Fortschritt)", async () => {
    const store = await setup(fakeAI());
    store.setAIStatus(status({ download: { modelId: "m", receivedBytes: 5, totalBytes: 10 } }));
    expect(store.getState().ai?.download?.receivedBytes).toBe(5);
  });
});
