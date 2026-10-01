import { describe, expect, it } from "vitest";
import {
  AIBlockedError,
  AINotConfiguredError,
  AIRouter,
  GrantPolicy,
  categorizeMessage,
  cleanMailText,
  extractJson,
  modelCatalog,
  modelsForRam,
  parseCategory,
  parseSummary,
  ruleCategory,
  summarizeThread,
  threadForModel,
  truncate,
  type AIProvider,
  type AIRequest,
  type AITransferLog,
  type Message,
  type PrivacyClass,
} from "../src/index.js";

// Testdaten erfunden.

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    accountId: "a1",
    mailboxId: "inbox",
    threadId: "t1",
    from: { name: "Petra Schulz", address: "p.schulz@moebelhaus.example" },
    to: [{ name: "Anna", address: "anna@example.test" }],
    cc: [],
    subject: "Angebot Esstisch",
    date: "2026-09-29T08:00:00Z",
    snippet: "anbei das Angebot",
    bodyText: "Hallo Anna,\nanbei das Angebot für den Esstisch.\nViele Grüße\nPetra",
    flags: 0,
    hasAttachments: false,
    ...overrides,
  };
}

class FakeProvider implements AIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly contextWindow = 4096;
  readonly requests: AIRequest[] = [];
  constructor(
    readonly privacyClass: PrivacyClass,
    private readonly answers: string[],
  ) {
    this.id = `fake-${privacyClass}`;
    this.displayName = `Fake ${privacyClass}`;
  }
  async generate(request: AIRequest) {
    this.requests.push(request);
    const text = this.answers.length > 1 ? (this.answers.shift() ?? "") : (this.answers[0] ?? "");
    return { text, providerId: this.id, privacyClass: this.privacyClass, durationMs: 5 };
  }
}

const request: AIRequest = { task: "categorize", messages: [{ role: "user", content: "Hallo Welt" }], maxTokens: 10 };

function logger() {
  const entries: Parameters<AITransferLog["record"]>[0][] = [];
  return { entries, record: (entry: (typeof entries)[number]) => entries.push(entry) };
}

describe("AIRouter", () => {
  it("lässt On-Device immer zu – ohne Freigabe und ohne Übertragungsprotokoll", async () => {
    const provider = new FakeProvider("onDevice", ["ok"]);
    const log = logger();
    const router = new AIRouter({ providerFor: () => provider, policy: new GrantPolicy(), transferLog: log });
    const response = await router.run(request, { accountIds: ["a1", "a2"] });
    expect(response.text).toBe("ok");
    expect(log.entries).toHaveLength(0);
  });

  for (const privacyClass of ["ownServer", "cloud"] as const) {
    it(`blockiert ${privacyClass} ohne Freigabe und ruft den Anbieter nicht auf`, async () => {
      const provider = new FakeProvider(privacyClass, ["ok"]);
      const router = new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() });
      await expect(router.run(request, { accountIds: ["a1"] })).rejects.toBeInstanceOf(AIBlockedError);
      expect(provider.requests).toHaveLength(0);
    });
  }

  it("prüft die Freigabe je Konto und je Aufgabe", async () => {
    const provider = new FakeProvider("cloud", ["ok"]);
    const policy = new GrantPolicy([{ accountId: "a1", task: "categorize", privacyClass: "cloud" }]);
    const router = new AIRouter({ providerFor: () => provider, policy });
    await expect(router.run(request, { accountIds: ["a1"] })).resolves.toMatchObject({ text: "ok" });
    // anderes Konto
    await expect(router.run(request, { accountIds: ["a2"] })).rejects.toBeInstanceOf(AIBlockedError);
    // andere Aufgabe
    await expect(router.run({ ...request, task: "summarize" }, { accountIds: ["a1"] })).rejects.toBeInstanceOf(AIBlockedError);
    // Freigabe für „eigener Server“ gilt nicht für Cloud
    const serverOnly = new AIRouter({ providerFor: () => provider, policy: new GrantPolicy([{ accountId: "a1", task: "categorize", privacyClass: "ownServer" }]) });
    await expect(serverOnly.run(request, { accountIds: ["a1"] })).rejects.toBeInstanceOf(AIBlockedError);
  });

  it("blockiert, sobald eines von mehreren beteiligten Konten keine Freigabe hat", async () => {
    const provider = new FakeProvider("ownServer", ["ok"]);
    const policy = new GrantPolicy([{ accountId: "a1", task: "categorize", privacyClass: "ownServer" }]);
    const router = new AIRouter({ providerFor: () => provider, policy });
    await expect(router.run(request, { accountIds: ["a1", "a2"] })).rejects.toBeInstanceOf(AIBlockedError);
    expect(provider.requests).toHaveLength(0);
  });

  it("blockiert ohne Konto", async () => {
    const router = new AIRouter({ providerFor: () => new FakeProvider("onDevice", ["ok"]), policy: new GrantPolicy() });
    await expect(router.run(request, { accountIds: [] })).rejects.toBeInstanceOf(AIBlockedError);
  });

  it("weicht nie auf einen anderen Anbieter aus und meldet fehlende Einrichtung", async () => {
    const local = new FakeProvider("onDevice", ["lokal"]);
    const cloud = new FakeProvider("cloud", ["cloud"]);
    const router = new AIRouter({ providerFor: () => cloud, policy: new GrantPolicy() });
    await expect(router.run(request, { accountIds: ["a1"] })).rejects.toBeInstanceOf(AIBlockedError);
    expect(local.requests).toHaveLength(0);
    const none = new AIRouter({ providerFor: () => null, policy: new GrantPolicy() });
    await expect(none.run(request, { accountIds: ["a1"] })).rejects.toBeInstanceOf(AINotConfiguredError);
  });

  it("wendet den Datenschutz-Zwischenschritt an und protokolliert Übertragungen", async () => {
    const provider = new FakeProvider("cloud", ["Antwort"]);
    const log = logger();
    const router = new AIRouter({
      providerFor: () => provider,
      policy: new GrantPolicy([{ accountId: "a1", task: "categorize", privacyClass: "cloud" }]),
      guard: {
        outgoing: (r) => ({ ...r, messages: r.messages.map((m) => ({ ...m, content: m.content.replace("Welt", "[X]") })) }),
        incoming: (r) => ({ ...r, text: r.text.toUpperCase() }),
      },
      transferLog: log,
      now: () => new Date("2026-10-01T10:00:00Z"),
    });
    const response = await router.run(request, { accountIds: ["a1", "a1"] });
    expect(provider.requests[0]?.messages[0]?.content).toBe("Hallo [X]");
    expect(response.text).toBe("ANTWORT");
    expect(log.entries).toEqual([
      { at: "2026-10-01T10:00:00.000Z", providerId: "fake-cloud", privacyClass: "cloud", task: "categorize", accountIds: ["a1"], characters: 9 },
    ]);
  });
});

describe("Antworten auswerten", () => {
  it("findet JSON auch mit Text oder Codeblock drumherum", () => {
    expect(extractJson('Klar! ```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson("kein json")).toBeNull();
    expect(extractJson("{kaputt")).toBeNull();
  });

  it("prüft Kategorie und Konfidenz", () => {
    expect(parseCategory('{"category": "Invoice", "confidence": 0.9}')).toEqual({ category: "invoice", confidence: 0.9 });
    expect(parseCategory('{"category": "invoice", "confidence": 7}')).toEqual({ category: "invoice", confidence: 0.5 });
    expect(parseCategory('{"category": "rechnung"}')).toBeNull();
    expect(parseCategory("")).toBeNull();
  });

  it("prüft Zusammenfassungen", () => {
    expect(parseSummary('{"summary": " Kurz. ", "openPoints": ["A", "", 3, "B", "C", "D", "E"], "waitingOn": "me"}')).toEqual({
      summary: "Kurz.",
      openPoints: ["A", "B", "C", "D"],
      waitingOn: "me",
    });
    expect(parseSummary('{"summary": "x", "waitingOn": "wer?"}')).toEqual({ summary: "x", openPoints: [], waitingOn: "nobody" });
    expect(parseSummary('{"summary": "  "}')).toBeNull();
  });

  it("ordnet mit Regeln ein, wenn das Modell versagt", () => {
    expect(ruleCategory(message({ subject: "Ihre Rechnung 2026-09" })).category).toBe("invoice");
    expect(ruleCategory(message({ subject: "Einladung zur Besprechung", bodyText: "" })).category).toBe("appointment");
    expect(ruleCategory(message({ subject: "Neu", bodyText: "Hier abmelden" })).category).toBe("newsletter");
    expect(ruleCategory(message({ subject: "Ihr Konto wurde gesperrt", bodyText: "Verifizieren Sie sofort" })).category).toBe("spam_suspect");
    expect(ruleCategory(message({ subject: "Login", bodyText: "Neue Anmeldung", from: { name: null, address: "noreply@shop.example" } })).category).toBe("notification");
    expect(ruleCategory(message({ subject: "Hallo", bodyText: "Wie geht's?" }))).toEqual({ category: "personal", confidence: 0.2 });
  });
});

describe("Eingaben vorbereiten", () => {
  it("entfernt Zitate, Signatur und Fußzeilen", () => {
    const text = "Hallo Anna,\n\n\n\nhier   die Antwort.\n> altes Zitat\nAm 28.09.2026 schrieb Anna:\n> mehr Zitat";
    expect(cleanMailText(text, 1000)).toBe("Hallo Anna,\n\nhier die Antwort.");
    expect(cleanMailText("Text\n-- \nPetra Schulz\nTel 123", 1000)).toBe("Text");
    const newsletter = `${"Neue Angebote im Herbst. ".repeat(10)}\nNewsletter abbestellen | Impressum`;
    expect(cleanMailText(newsletter, 1000)).not.toMatch(/abbestellen/);
  });

  it("kürzt an einer sinnvollen Stelle", () => {
    expect(truncate("kurz", 10)).toBe("kurz");
    const long = "Erster Satz ist hier. Zweiter Satz ist auch da. Dritter folgt";
    expect(truncate(long, 50)).toBe("Erster Satz ist hier. Zweiter Satz ist auch da. […]");
  });

  it("gibt bei langen Konversationen den neuesten Mails Vorrang", () => {
    const thread = Array.from({ length: 12 }, (_, i) =>
      message({ id: `m${i}`, subject: `Nachricht ${i}`, date: `2026-09-${String(10 + i).padStart(2, "0")}T08:00:00Z`, bodyText: `Inhalt ${i} `.repeat(80) }),
    );
    const text = threadForModel(thread, 3000);
    expect(text).toContain("Betreff: Nachricht 11");
    expect(text).not.toContain("Betreff: Nachricht 0\n");
    expect(text).toMatch(/ältere Nachricht\(en\) ausgelassen/);
    expect(text.indexOf("Nachricht 10")).toBeLessThan(text.indexOf("Nachricht 11"));
  });
});

describe("Aufgaben", () => {
  const onDevice = (answers: string[]) => {
    const provider = new FakeProvider("onDevice", answers);
    return { provider, router: new AIRouter({ providerFor: () => provider, policy: new GrantPolicy() }) };
  };

  it("kategorisiert mit dem Modell", async () => {
    const { provider, router } = onDevice(['{"category": "work", "confidence": 0.8}']);
    const result = await categorizeMessage(router, message());
    expect(result).toMatchObject({ category: "work", confidence: 0.8, origin: "onDevice", providerId: "fake-onDevice" });
    expect(provider.requests[0]?.jsonSchema).toBeDefined();
    expect(provider.requests[0]?.messages[1]?.content).toContain("Betreff: Angebot Esstisch");
  });

  it("versucht es genau einmal neu und fällt dann auf Regeln zurück", async () => {
    const { provider, router } = onDevice(["Unsinn", '{"category": "invoice", "confidence": 0.7}']);
    expect(await categorizeMessage(router, message())).toMatchObject({ category: "invoice", origin: "onDevice", durationMs: 10 });
    expect(provider.requests[1]?.temperature).toBe(0);

    const broken = onDevice(["Unsinn"]);
    const result = await categorizeMessage(broken.router, message({ subject: "Rechnung" }));
    expect(result).toMatchObject({ category: "invoice", origin: "rules", providerId: null });
    expect(broken.provider.requests).toHaveLength(2);
  });

  it("gibt eine Blockade beim Kategorisieren weiter (keine Regeln als Tarnung)", async () => {
    const router = new AIRouter({ providerFor: () => new FakeProvider("cloud", ["{}"]), policy: new GrantPolicy() });
    await expect(categorizeMessage(router, message())).rejects.toBeInstanceOf(AIBlockedError);
  });

  it("fasst zusammen und prüft alle Konten der Konversation", async () => {
    const { router } = onDevice(['{"summary": "Petra schickt ein Angebot.", "openPoints": ["Angebot prüfen"], "waitingOn": "me"}']);
    const result = await summarizeThread(router, [message(), message({ id: "m2" })], { ownAddresses: ["anna@example.test"] });
    expect(result).toMatchObject({ summary: "Petra schickt ein Angebot.", openPoints: ["Angebot prüfen"], waitingOn: "me", origin: "onDevice" });

    const server = new FakeProvider("ownServer", ['{"summary": "x", "openPoints": [], "waitingOn": "nobody"}']);
    const partial = new AIRouter({ providerFor: () => server, policy: new GrantPolicy([{ accountId: "a1", task: "summarize", privacyClass: "ownServer" }]) });
    await expect(summarizeThread(partial, [message(), message({ id: "m2", accountId: "a2" })], { ownAddresses: [] })).rejects.toBeInstanceOf(AIBlockedError);
  });

  it("erfindet keine Zusammenfassung, wenn das Modell versagt", async () => {
    const { router } = onDevice(["Unsinn"]);
    await expect(summarizeThread(router, [message()], { ownAddresses: [] })).rejects.toThrow(/keine brauchbare Zusammenfassung/);
  });
});

describe("Modellkatalog", () => {
  it("enthält Gemma 4 und Qwen 3.5 mit Prüfsummen", () => {
    expect(modelCatalog.map((m) => m.id)).toEqual(expect.arrayContaining(["gemma-4-e2b-q4", "qwen-3.5-2b-q4"]));
    for (const model of modelCatalog) {
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(model.url).toMatch(/^https:\/\/huggingface\.co\//);
      expect(model.sizeBytes).toBeGreaterThan(500_000_000);
    }
  });

  it("schlägt nur Modelle vor, die in den Speicher passen", () => {
    const fitting = (ram: number) => modelsForRam(ram).filter((m) => m.fits).map((m) => m.model.id);
    expect(fitting(8)).toContain("gemma-4-e2b-q4");
    expect(fitting(8)).not.toContain("gemma-4-e4b-q4");
    expect(fitting(16)).toHaveLength(modelCatalog.length);
  });
});
