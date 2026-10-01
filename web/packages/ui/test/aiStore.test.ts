import { describe, expect, it } from "vitest";
import { createMockData, InMemoryMailRepository, type AIApi, type AIStatus, type AttachmentFiles, type SummaryView } from "@stinkyma/core";
import { BrowserStore, selectedMessage } from "../src/store.js";

// Testdaten erfunden.

function status(overrides: Partial<AIStatus> = {}): AIStatus {
  return {
    settings: { enabled: true, modelId: "m", autoCategorize: true, useGpu: true, vision: true, categorizeOlder: false },
    models: [],
    vision: { state: "ready", missingBytes: 0 },
    ramGb: 8,
    ready: true,
    download: null,
    categorizing: null,
    activity: null,
    backlog: { recent: 0, older: 0 },
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
      return status({ settings: { enabled: true, modelId: "m", autoCategorize: true, useGpu: true, vision: true, categorizeOlder: false, ...patch } });
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
    downloadVision: async () => {
      calls.push("downloadVision");
    },
    attachmentReading: async (id) => {
      calls.push(`reading:${id}`);
      return null;
    },
    readAttachment: async (id, pages) => {
      calls.push(`read:${id}:${pages?.length ?? 0}`);
      if (options.fail) throw new Error(options.fail);
      return { attachmentId: id, documentType: "invoice", title: "Rechnung", summary: "Rechnung über 10 €", text: "10 €", origin: "onDevice", modelName: "Gemma", createdAt: "", durationMs: 1000 };
    },
    messageActions: async (messageId) => {
      calls.push(`actions:${messageId}`);
      return { messageId, origin: "rules", actions: [{ id: "a1", messageId, type: "payment", title: "Zahlung", date: "2026-10-15", time: null, amount: "84,20 €", quote: "…", status: "open", origin: "rules", reminder: null }] };
    },
    setActionStatus: async (id, status) => {
      calls.push(`status:${id}:${status}`);
    },
    remind: async (id, due) => {
      calls.push(`remind:${id}:${due}`);
    },
    cancelReminder: async (id) => {
      calls.push(`cancel:${id}`);
    },
    setCategory: async (messageId, category, remember) => {
      calls.push(`category:${messageId}:${category}:${remember}`);
      return { changed: remember ? 2 : 0 };
    },
    learnedSenders: async () => [{ address: "news@tsv.example", category: "newsletter", learnedAt: "2026-10-01T10:00:00Z" }],
    forgetSender: async (address) => {
      calls.push(`forget:${address}`);
    },
    resume: async () => {
      calls.push("resume");
      return status({ ready: true });
    },
    dailyDigest: async () => {
      calls.push("digest");
      return { day: "2026-09-29", due: [], important: [], waitingOnMe: [], counts: { newsletter: 2, notification: 0, spamSuspect: 0, flagged: 1 } };
    },
    replyDrafts: async (messageId) => {
      calls.push(`replies:${messageId}`);
      if (options.fail) throw new Error(`Error invoking remote method 'ai': Error: ${options.fail}`);
      return { messageId, form: "du", greeting: "Hallo Jonas,", replies: [{ kind: "agree", label: "Zusagen", text: "Klar, ich bin dabei!" }, { kind: "decline", label: "Absagen", text: "Da kann ich leider nicht." }], modelName: "Gemma", durationMs: 4000 };
    },
    addToCalendar: async (id) => {
      calls.push(`calendar:${id}`);
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
    store.setAIStatus(status({ download: { kind: "model", modelId: "m", receivedBytes: 5, totalBytes: 10 } }));
    expect(store.getState().ai?.download?.receivedBytes).toBe(5);
  });

  it("liest einen Anhang in der Vorschau mit KI – PDF-Seiten werden mitgeschickt, Fehler in der Karte", async () => {
    const ai = fakeAI();
    const files: AttachmentFiles = { open: async () => undefined, save: async () => true, read: async () => ({ filename: "x", mimeType: "image/png", contentBase64: "" }) };
    const store = new BrowserStore(new InMemoryMailRepository(createMockData(new Date("2026-09-29T10:00:00Z"))), { ai: ai.api, files });
    await store.start();
    expect(store.canReadAttachments).toBe(true);
    await store.showAttachment({ id: "anhang-1", filename: "Scan.pdf", mimeType: "application/pdf" });
    await flush();
    expect(ai.calls).toContain("reading:anhang-1");
    await store.readAttachmentWithAI([{ mimeType: "image/jpeg", base64: "AAAA" }]);
    expect(store.getState().reading).toMatchObject({ attachmentId: "anhang-1", busy: false, view: { summary: "Rechnung über 10 €" } });
    expect(ai.calls).toContain("read:anhang-1:1");
    store.closePreview();
    expect(store.getState().reading).toBeNull();

    const failing = fakeAI({ fail: "Error invoking remote method 'ai': Error: Bildformat nicht lesbar" });
    const store2 = new BrowserStore(new InMemoryMailRepository(createMockData()), { ai: failing.api, files });
    await store2.start();
    await store2.showAttachment({ id: "b", filename: "Foto.png", mimeType: "image/png" });
    await store2.readAttachmentWithAI();
    expect(store2.getState().reading?.error).toBe("Bildformat nicht lesbar");
    expect(store2.getState().error).toBeNull();
  });

  it("ohne Bild-Einstellung kein „Mit KI lesen“", async () => {
    const ai = fakeAI();
    const store = await setup(ai);
    store.setAIStatus(status({ vision: { state: "missing", missingBytes: 10 } }));
    expect(store.canReadAttachments).toBe(false);
    await store.downloadVision();
    expect(ai.calls).toContain("downloadVision");
  });

  it("lädt erkannte Aktionen der geöffneten Mail und reicht Erinnern/Kalender/Erledigt durch", async () => {
    const ai = fakeAI();
    const store = await setup(ai);
    const first = store.getState().messages[0];
    if (!first) throw new Error("keine Mail");
    await store.selectMessage(first.id);
    await flush();
    expect(store.getState().actions).toMatchObject({ messageId: first.id, actions: [{ id: "a1", amount: "84,20 €" }] });
    await store.remind("a1", new Date("2026-10-14T07:00:00.000Z"));
    await store.addToCalendar("a1");
    await store.setActionStatus("a1", "done");
    expect(ai.calls).toEqual(expect.arrayContaining(["remind:a1:2026-10-14T07:00:00.000Z", "calendar:a1", "status:a1:done"]));
    // Wechsel zu einer anderen Mail: Karte der alten Mail verschwindet sofort
    const second = store.getState().messages[1];
    if (!second) throw new Error("keine zweite Mail");
    const opening = store.selectMessage(second.id);
    expect(store.getState().actions?.messageId ?? second.id).not.toBe(first.id);
    await opening;
  });

  it("Antwortvorschläge: nur auf Klick, Übernehmen öffnet „Antworten“ mit Anrede und Text; Wechsel verwirft sie", async () => {
    const ai = fakeAI();
    const store = await setup(ai);
    const [first, second] = store.getState().messages;
    if (!first || !second) throw new Error("keine Mails");
    await store.selectMessage(first.id);
    await flush();
    expect(ai.calls.some((c) => c.startsWith("replies:"))).toBe(false);
    await store.loadReplyDrafts();
    expect(store.getState().replies).toMatchObject({ messageId: first.id, busy: false, view: { greeting: "Hallo Jonas,", replies: [{ label: "Zusagen" }, { label: "Absagen" }] } });
    store.useReplyDraft(1, { wrote: () => "schrieb:", forwardHeader: () => "" });
    const compose = store.getState().compose;
    expect(compose?.mode).toBe("reply");
    expect(compose?.bodyText.startsWith("Hallo Jonas,\nda kann ich leider nicht.\n")).toBe(true);
    expect(ai.calls.filter((c) => c.startsWith("send"))).toEqual([]); // nichts verschickt
    store.closeCompose();
    await store.selectMessage(second.id);
    expect(store.getState().replies).toBeNull();
  });

  it("Antwortvorschläge: Fehler in der Karte (ohne Electron-Vorspann)", async () => {
    const store = await setup(fakeAI({ fail: "Noch kein KI-Modell gewählt" }));
    const first = store.getState().messages[0];
    if (!first) throw new Error("keine Mail");
    await store.selectMessage(first.id);
    await store.loadReplyDrafts();
    expect(store.getState().replies).toMatchObject({ busy: false, view: null, error: "Noch kein KI-Modell gewählt" });
    expect(store.getState().error).toBeNull();
  });

  it("Tagesüberblick: öffnen, Mail daraus öffnen schließt ihn; ohne KI-Schnittstelle nicht da", async () => {
    const ai = fakeAI();
    const store = await setup(ai);
    expect(store.canShowDigest).toBe(true);
    await store.openDigest();
    expect(store.getState().digest).toMatchObject({ busy: false, view: { counts: { newsletter: 2, flagged: 1 } } });
    const first = store.getState().messages[0];
    if (!first) throw new Error("keine Mail");
    await store.openFromDigest(first.id);
    expect(store.getState().digest).toBeNull();
    expect(store.getState().selectedMessageId).toBe(first.id);
    expect(new BrowserStore(new InMemoryMailRepository(createMockData())).canShowDigest).toBe(false);
  });

  it("„Weiter einordnen“ reicht durch und übernimmt den neuen Status", async () => {
    const ai = fakeAI();
    const store = await setup(ai);
    await store.resumeAI();
    expect(ai.calls).toContain("resume");
    expect(store.getState().ai?.ready).toBe(true);
  });

  it("Einordnung korrigieren: reicht durch, Rückmeldung mit Anzahl, gelernte Absender laden/vergessen", async () => {
    const ai = fakeAI();
    const store = await setup(ai);
    const first = store.getState().messages[0];
    if (!first) throw new Error("keine Mail");
    await store.selectMessage(first.id);
    await store.setMessageCategory(first.id, "newsletter", true);
    expect(ai.calls).toContain(`category:${first.id}:newsletter:true`);
    expect(store.getState().categoryNote).toMatchObject({ messageId: first.id, category: "newsletter", remembered: true, changed: 2 });
    expect(store.getState().learnedSenders).toHaveLength(1);
    await store.forgetSender("news@tsv.example");
    expect(ai.calls).toContain("forget:news@tsv.example");
    // Wechsel zu einer anderen Mail: Rückmeldung verschwindet
    const second = store.getState().messages[1];
    if (!second) throw new Error("keine zweite Mail");
    await store.selectMessage(second.id);
    expect(store.getState().categoryNote).toBeNull();
  });
});
