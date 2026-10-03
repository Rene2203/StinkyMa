import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chunkMail, fuseRankings, keywordQuery, normalizeVector, parseAsk, type Account } from "../src/index.js";
import { AskService, type Embedder } from "../src/llm/index.js";
import { EmbeddingStore, MailWriter, openDatabase } from "../src/sqlite/index.js";

// Testdaten erfunden.
describe("Frag dein Postfach: Bausteine", () => {
  it("Volltext-Anfrage aus Inhaltswörtern, ODER-verknüpft mit Präfix", () => {
    expect(keywordQuery("Wann hat der Vermieter die Nebenkosten geschickt?")).toBe('"vermieter"* OR "nebenkosten"* OR "geschickt"*');
    expect(keywordQuery("Was ist das?")).toBe("");
  });

  it("Rangfolgen zusammenführen, Textstücke, Antwort mit gültigen Quellen", () => {
    expect(fuseRankings([["a", "b", "c"], ["c", "a"]])[0]).toBe("a");
    const chunks = chunkMail("Abrechnung", "Text ".repeat(600), [{ filename: "Abrechnung.pdf", text: "Nebenkosten 2025 Nachzahlung 142,30 € ".repeat(5) }]);
    expect(chunks.filter((c) => c.source === "mail").length).toBeGreaterThan(1);
    expect(chunks.at(-1)?.source).toBe("Abrechnung.pdf");
    expect(parseAsk(JSON.stringify({ antwort: "Am 12.09. [2], siehe auch [9].", quellen: [2, 7] }), [1, 2, 3])).toEqual({ answer: "Am 12.09. [2], siehe auch [9].", cited: [2] });
    const v = normalizeVector([3, 4, 0, 0], 2);
    expect([...v].map((x) => x.toFixed(1))).toEqual(["0.6", "0.8"]);
  });
});

/** Einfaches Bag-of-Words-Embedding für Tests: Wörter auf feste Dimensionen */
class WordEmbedder implements Embedder {
  calls = 0;
  async embed(text: string): Promise<number[]> {
    this.calls++;
    const v = new Array(64).fill(0) as number[];
    const body = text.replace(/^(title: .*? \| text: |task: search result \| query: )/, "");
    for (const word of body.toLowerCase().split(/[^a-zäöüß]+/).filter((w) => w.length > 3)) {
      let h = 0;
      for (const ch of word.slice(0, 6)) h = (h * 31 + ch.charCodeAt(0)) % 64;
      v[h] = (v[h] ?? 0) + 1;
    }
    return v;
  }
  async dispose() {}
}

function setup() {
  const db = openDatabase(":memory:");
  const writer = new MailWriter(db);
  const account: Account = {
    id: "acc", email: "anna@example.test", displayName: "Anna", provider: "imap", username: "anna@example.test",
    imapHost: "imap.example.test", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.example.test", smtpPort: 465, smtpSecurity: "tls",
    authType: "password", color: "blue", aiCloudAllowed: false, sortOrder: 0,
  };
  writer.insertAccount(account);
  writer.upsertMailbox({ id: "acc/inbox", accountId: "acc", name: "INBOX", role: "inbox" });
  writer.upsertMailbox({ id: "acc/trash", accountId: "acc", name: "Trash", role: "trash" });
  let uid = 0;
  const add = (from: string, subject: string, body: string, box = "acc/inbox") => {
    uid++;
    writer.insertMessage({
      id: `${box}#1:${uid}`, accountId: "acc", mailboxId: box, uid, messageId: `<q${uid}@example.test>`, threadId: `t${uid}`, threadSubject: subject,
      from: { name: null, address: from }, to: [{ name: "Anna", address: "anna@example.test" }], cc: [], subject, date: `2026-09-${String(10 + uid).padStart(2, "0")}T08:00:00.000Z`,
      snippet: body.slice(0, 80), bodyText: body, bodyHtml: null, flags: 0, attachments: [],
    });
  };
  add("hausverwaltung@ruhig.example", "Nebenkostenabrechnung 2025", "Anbei die Nebenkostenabrechnung 2025. Nachzahlung 142,30 Euro bis 15.11.");
  add("jonas@mailbox.example", "Grillen", "Kommst du Samstag zum Grillen? Bring Salat mit.");
  add("shop@versand.example", "Versand", "Ihre Bestellung wurde versendet.");
  add("hausverwaltung@ruhig.example", "Alte Abrechnung", "Nebenkostenabrechnung 2024 im Papierkorb.", "acc/trash");
  const dir = mkdtempSync(join(tmpdir(), "ask-"));
  return { db, store: new EmbeddingStore(db), dir };
}

describe("Frag dein Postfach: Dienst", () => {
  it("ohne Embedding-Modell: Volltext; Antwort nur aus Quellen, Papierkorb zählt nicht", async () => {
    const { store, dir } = setup();
    const seen: string[][] = [];
    const service = new AskService({
      store, modelDirectory: dir, createEmbedder: () => new WordEmbedder(),
      answer: async (question, sources) => {
        seen.push(sources.map((s) => s.header));
        return { answer: "Am 11.09. kam die Nebenkostenabrechnung 2025 [1].", cited: [1], origin: "onDevice" };
      },
    });
    const result = await service.ask("Wann kam die Nebenkostenabrechnung?");
    expect(result.search).toEqual({ semantic: false, keyword: true });
    expect(result.sources.map((s) => s.subject)).toEqual(["Nebenkostenabrechnung 2025"]);
    expect(result).toMatchObject({ answer: "Am 11.09. kam die Nebenkostenabrechnung 2025 [1].", cited: [1] });
    expect(seen[0]?.[0]).toContain("Nebenkostenabrechnung 2025");
    expect((await service.status()).model.state).toBe("missing");
  });

  it("mit Embedding-Modell: indexiert im Hintergrund, findet nach Bedeutung, Absender-Beschränkung", async () => {
    const { store, dir } = setup();
    writeFileSync(join(dir, "embeddinggemma-300M-Q8_0.gguf"), "fake");
    const embedder = new WordEmbedder();
    const service = new AskService({ store, modelDirectory: dir, createEmbedder: () => embedder });
    service.startIndexing();
    await service.idle();
    const status = await service.status();
    expect(status).toMatchObject({ indexed: 3, total: 3, model: { state: "ready" } });
    const result = await service.ask("Salat zum Grillen am Samstag");
    expect(result.search.semantic).toBe(true);
    expect(result.sources[0]?.subject).toBe("Grillen");
    expect(result.answer).toBeNull(); // kein Sprachmodell: nur Fundstellen
    const onlyLandlord = await service.ask("Grillen", { sender: "hausverwaltung@ruhig.example" });
    expect(onlyLandlord.sources.every((s) => s.from.includes("hausverwaltung"))).toBe(true);
    // Neue Mail → nur diese wird nachindexiert
    const before = embedder.calls;
    service.startIndexing();
    await service.idle();
    expect(embedder.calls).toBe(before);
  });
});
