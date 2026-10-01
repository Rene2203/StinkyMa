import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AIRouter, GrantPolicy, AINotConfiguredError, parseImageReading, readDocumentImages, type AIRequest, type CatalogModel, type AIImage } from "../src/index.js";
import { AIService, chatRequestBody, imageType, ModelStore, OpenAIChatClient, RuntimeStore, validatePageImages, type ManagedProvider } from "../src/llm/index.js";
import { AIResultStore, openDatabase, seedIfEmpty, SqliteMailRepository } from "../src/sqlite/index.js";
import { createMockData } from "../src/index.js";

// Testdaten erfunden.

const png: AIImage = { mimeType: "image/png", base64: Buffer.from("kein echtes Bild").toString("base64") };

describe("Bild lesen – Auswertung und Anfrage", () => {
  it("prüft die Antwort des Modells", () => {
    expect(parseImageReading('{"documentType": "invoice", "title": " Rechnung ", "summary": "Rechnung über 10 €", "text": "Zeile"}')).toEqual({ documentType: "invoice", title: "Rechnung", summary: "Rechnung über 10 €", text: "Zeile" });
    expect(parseImageReading('{"documentType": "quatsch", "summary": "Ein Foto", "text": ""}')).toMatchObject({ documentType: "other", title: "" });
    expect(parseImageReading('{"summary": "", "text": ""}')).toBeNull();
    expect(parseImageReading("kein json")).toBeNull();
  });

  it("schickt Bilder als data-URL vor dem Text, mit JSON-Schema und ohne Nachdenken", () => {
    const body = chatRequestBody({ task: "readImage", messages: [{ role: "system", content: "S" }, { role: "user", content: "Lies", images: [png] }], maxTokens: 10, jsonSchema: { type: "boolean" } });
    expect(body.messages).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${png.base64}` } }, { type: "text", text: "Lies" }] },
    ]);
    expect(body).toMatchObject({ max_tokens: 10, temperature: 0, stream: false, chat_template_kwargs: { enable_thinking: false }, response_format: { type: "json_schema", json_schema: { schema: { type: "boolean" } } } });
  });

  it("verweigert Bilder an Modelle ohne Bild-Baustein", async () => {
    const textOnly = { id: "t", displayName: "T", privacyClass: "onDevice" as const, contextWindow: 1, generate: async () => ({ text: "{}", providerId: "t", privacyClass: "onDevice" as const, durationMs: 1 }) };
    const router = new AIRouter({ providerFor: () => textOnly, policy: new GrantPolicy() });
    await expect(readDocumentImages(router, [png], { filename: "a.png", accountIds: ["a"] })).rejects.toBeInstanceOf(AINotConfiguredError);
  });

  it("liest höchstens drei Seiten", async () => {
    const requests: AIRequest[] = [];
    const vision = { id: "v", displayName: "V", privacyClass: "onDevice" as const, contextWindow: 1, acceptsImages: true, generate: async (r: AIRequest) => {
      requests.push(r);
      return { text: '{"documentType":"letter","title":"Brief","summary":"Ein Brief","text":"Hallo"}', providerId: "v", privacyClass: "onDevice" as const, durationMs: 4 };
    } };
    const router = new AIRouter({ providerFor: () => vision, policy: new GrantPolicy() });
    const result = await readDocumentImages(router, [png, png, png, png, png], { filename: "scan.pdf", accountIds: ["a"] });
    expect(result).toMatchObject({ documentType: "letter", origin: "onDevice", durationMs: 4 });
    expect(requests[0]?.messages[1]?.images).toHaveLength(3);
    expect(requests[0]?.messages[1]?.content).toContain("3 Seiten");
  });

  it("erkennt lesbare Bildformate und prüft Seitenbilder aus der Oberfläche", () => {
    expect(imageType("image/jpeg", "x")).toBe("image/jpeg");
    expect(imageType("application/octet-stream", "Foto.JPG")).toBe("image/jpeg");
    expect(imageType("image/heic", "IMG.heic")).toBeNull();
    expect(imageType("image/svg+xml", "logo.svg")).toBeNull();
    expect(validatePageImages([png])).toEqual([png]);
    expect(() => validatePageImages([png, png, png, png])).toThrow(/Höchstens 3/);
    expect(() => validatePageImages([{ mimeType: "image/gif", base64: "AAAA" }])).toThrow();
    expect(() => validatePageImages([{ mimeType: "image/png", base64: "<script>" }])).toThrow();
  });
});

// --- HTTP: Client und Laufzeit-Download gegen lokalen Testserver ---

let server: Server;
let base = "";
let lastAuth: string | undefined;
let archive = Buffer.alloc(0);

beforeAll(async () => {
  // Kleines Archiv mit einem „llama-server“ (nur Platzhalter) – wie die echte Linux-Ausgabe in einem Unterordner
  const source = mkdtempSync(join(tmpdir(), "stinkyma-rt-src-"));
  mkdirSync(join(source, "llama-b0"));
  writeFileSync(join(source, "llama-b0", "llama-server"), "#!/bin/sh\n");
  writeFileSync(join(source, "llama-b0", "llama-server.exe"), "MZ");
  execFileSync("tar", ["-czf", join(source, "rt.tar.gz"), "-C", source, "llama-b0"]);
  archive = readFileSync(join(source, "rt.tar.gz"));
  rmSync(source, { recursive: true, force: true });

  server = createServer((req, res) => {
    lastAuth = req.headers.authorization;
    if (req.url === "/rt.tar.gz") {
      res.writeHead(200, { "Content-Length": archive.length }).end(archive);
      return;
    }
    if (req.url === "/v1/chat/completions") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body) as { messages: unknown[] };
        if (parsed.messages.length === 0) {
          res.writeHead(400).end("Fehler mit Inhalt: GEHEIMER MAILTEXT");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }], usage: { completion_tokens: 3 } }));
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

describe("OpenAIChatClient", () => {
  it("schickt den Schlüssel mit und liest die Antwort", async () => {
    const client = new OpenAIChatClient({ baseUrl: `${base}/`, apiKey: "geheim" });
    await expect(client.complete({ task: "categorize", messages: [{ role: "user", content: "Hallo" }], maxTokens: 5 })).resolves.toEqual({ text: '{"ok":true}', tokensOut: 3 });
    expect(lastAuth).toBe("Bearer geheim");
  });

  it("gibt Fehlertexte des Servers nicht weiter (sie können Mail-Inhalte enthalten)", async () => {
    const client = new OpenAIChatClient({ baseUrl: base });
    const error = await client.complete({ task: "categorize", messages: [], maxTokens: 5 }).catch((e: Error) => e);
    expect(String(error)).toMatch(/HTTP 400/);
    expect(String(error)).not.toMatch(/GEHEIM/);
  });
});

describe("RuntimeStore", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stinkyma-rt-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const asset = () => ({ url: `${base}/rt.tar.gz`, sizeBytes: archive.length, sha256: createHash("sha256").update(archive).digest("hex"), archive: "tar.gz" as const });

  it.skipIf(process.platform === "win32")("lädt, prüft und entpackt die Laufzeit; danach kein zweiter Download", async () => {
    const store = new RuntimeStore(dir, { asset: asset() });
    expect(await store.serverPath()).toBeNull();
    const progress: number[] = [];
    const path = await store.download({ onProgress: (p) => progress.push(p.receivedBytes) });
    expect(path.endsWith(join("llama-b0", "llama-server"))).toBe(true);
    expect(await store.serverPath()).toBe(path);
    expect(progress.at(-1)).toBe(archive.length);
    expect(existsSync(join(dir, "llama-b11320.tar.gz"))).toBe(false); // Archiv wird aufgeräumt
    await store.delete();
    expect(await store.serverPath()).toBeNull();
  });

  it("verwirft eine Laufzeit mit falscher Prüfsumme", async () => {
    const store = new RuntimeStore(dir, { asset: { ...asset(), sha256: "0".repeat(64) } });
    await expect(store.download()).rejects.toThrow(/Prüfsumme/);
    expect(await store.serverPath()).toBeNull();
  });

  it("kennt die festen Laufzeiten für Windows und Linux", () => {
    expect(new RuntimeStore(dir, { platform: "win32-x64" }).asset?.url).toMatch(/win-vulkan-x64\.zip$/);
    expect(new RuntimeStore(dir, { platform: "linux-x64" }).asset?.archive).toBe("tar.gz");
    expect(new RuntimeStore(dir, { platform: "sunos-sparc" }).asset).toBeNull();
  });
});

// --- KI-Dienst: Bilder lesen, nie zwei Modelle gleichzeitig im Speicher ---

class FakeEngine implements ManagedProvider {
  readonly privacyClass = "onDevice" as const;
  readonly contextWindow = 4096;
  loaded = false;
  log: string[];
  constructor(readonly id: string, readonly acceptsImages: boolean, log: string[]) {
    this.log = log;
  }
  get displayName() {
    return this.id;
  }
  async generate(request: AIRequest) {
    this.loaded = true;
    this.log.push(`${this.id}:${request.task}`);
    const text = request.task === "readImage"
      ? '{"documentType":"invoice","title":"Rechnung","summary":"Rechnung über 49,90 €","text":"Gesamt 49,90 €"}'
      : request.task === "categorize" ? '{"category":"work","confidence":0.6}' : '{"summary":"S","openPoints":[],"waitingOn":"nobody"}';
    return { text, providerId: this.id, privacyClass: this.privacyClass, durationMs: 5 };
  }
  async unload() {
    if (this.loaded) this.log.push(`${this.id}:entladen`);
    this.loaded = false;
  }
  async dispose() {
    await this.unload();
  }
}

describe("AIService – Bilder", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stinkyma-vision-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const model: CatalogModel = {
    id: "bild", name: "Bildmodell", family: "gemma", paramsB: 2, quantization: "Q4_K_M", url: "https://models.example/bild.gguf", sizeBytes: 4,
    sha256: "0".repeat(64), minRamGb: 4, capabilities: ["text", "image"], license: "Apache-2.0", note: "",
    vision: { url: "https://models.example/mmproj-F16.gguf", sizeBytes: 3, sha256: "0".repeat(64) },
  };

  function setup(options: { vision?: boolean; installVision?: boolean; installRuntime?: boolean } = {}) {
    const root = mkdtempSync(join(dir, "setup-"));
    const db = openDatabase(":memory:");
    seedIfEmpty(db, createMockData(new Date()));
    const repository = new SqliteMailRepository(db);
    const store = new ModelStore(join(root, "models"));
    mkdirSync(join(root, "models", "bild"), { recursive: true });
    writeFileSync(store.pathFor(model), "gguf");
    if (options.installVision ?? true) writeFileSync(store.pathFor(model, model.vision), "mm");
    const runtimeDir = join(root, "runtime");
    if (options.installRuntime ?? true) {
      mkdirSync(join(runtimeDir, "b11320"), { recursive: true });
      writeFileSync(join(runtimeDir, "b11320", process.platform === "win32" ? "llama-server.exe" : "llama-server"), "");
      writeFileSync(join(runtimeDir, "b11320", ".complete"), "b11320");
    }
    const log: string[] = [];
    const engines: FakeEngine[] = [];
    const results = new AIResultStore(db);
    const service = new AIService({
      store,
      results,
      runtime: new RuntimeStore(runtimeDir, { asset: { url: `${base}/rt.tar.gz`, sizeBytes: 100, sha256: "0".repeat(64), archive: "tar.gz" } }),
      thread: (id) => repository.thread(id),
      ownAddresses: async () => [],
      settings: { load: () => ({ enabled: true, modelId: "bild", autoCategorize: false, vision: options.vision ?? true }), save: () => undefined },
      ramGb: 8,
      catalog: [model],
      createProvider: () => {
        const e = new FakeEngine("text", false, log);
        engines.push(e);
        return e;
      },
      createVisionProvider: () => {
        const e = new FakeEngine("bild", true, log);
        engines.push(e);
        return e;
      },
      attachmentContent: async (id) => {
        const row = db.prepare("SELECT filename, mimeType FROM attachment WHERE id = ?").get(id) as { filename: string; mimeType: string };
        return { ...row, content: Buffer.from("bilddaten") };
      },
    });
    const attachment = (where: string) => {
      const row = db.prepare(`SELECT id FROM attachment WHERE ${where} LIMIT 1`).get() as { id: string } | undefined;
      if (!row) throw new Error("kein passender Testanhang");
      return row.id;
    };
    return { db, service, log, engines, results, attachment };
  }

  it("Status: bereit, wenn Bild-Baustein und Laufzeit da sind; sonst fehlende Größe", async () => {
    expect((await setup().service.status()).vision).toEqual({ state: "ready", missingBytes: 0 });
    expect((await setup({ installVision: false, installRuntime: false }).service.status()).vision).toEqual({ state: "missing", missingBytes: 103 });
  });

  it("liest einen Bildanhang, speichert das Ergebnis und macht den Text durchsuchbar", async () => {
    const { service, db, attachment } = setup();
    db.prepare("UPDATE attachment SET filename = 'Kassenbon.jpg', mimeType = 'image/jpeg' WHERE id = ?").run(attachment("1 = 1"));
    const id = attachment("filename = 'Kassenbon.jpg'");
    const view = await service.readAttachment(id);
    expect(view).toMatchObject({ documentType: "invoice", summary: "Rechnung über 49,90 €", origin: "onDevice", modelName: "Bildmodell" });
    expect(await service.attachmentReading(id)).toMatchObject({ text: "Gesamt 49,90 €" });
    const indexed = db.prepare("SELECT text, source FROM attachmentText WHERE attachmentId = ?").get(id) as { text: string; source: string };
    expect(indexed.source).toBe("vision");
    expect(indexed.text).toContain("49,90");
  });

  it("überschreibt echten PDF-Text im Suchindex nicht", async () => {
    const { service, db, attachment } = setup();
    db.prepare("UPDATE attachment SET filename = 'Vertrag.pdf', mimeType = 'application/pdf' WHERE id = ?").run(attachment("1 = 1"));
    const id = attachment("filename = 'Vertrag.pdf'");
    db.prepare("INSERT INTO attachmentText (attachmentId, text, source) VALUES (?, 'Originaltext aus dem PDF', 'pdf')").run(id);
    await service.readAttachment(id, [png]);
    expect((db.prepare("SELECT text FROM attachmentText WHERE attachmentId = ?").get(id) as { text: string }).text).toBe("Originaltext aus dem PDF");
    expect(await service.attachmentReading(id)).not.toBeNull();
  });

  it("lehnt nicht lesbare Formate ab und verlangt die Einstellung", async () => {
    const { service, db, attachment } = setup();
    db.prepare("UPDATE attachment SET filename = 'Foto.heic', mimeType = 'image/heic' WHERE id = ?").run(attachment("1 = 1"));
    await expect(service.readAttachment(attachment("filename = 'Foto.heic'"))).rejects.toThrow(/Bildformat/);
    const off = setup({ vision: false });
    await expect(off.service.readAttachment(off.attachment("1 = 1"), [png])).rejects.toThrow(/ausgeschaltet/);
    const missing = setup({ installRuntime: false });
    await expect(missing.service.readAttachment(missing.attachment("1 = 1"), [png])).rejects.toThrow(/fehlen noch Dateien/);
  });

  it("hat nie Text- und Bildmodell gleichzeitig im Speicher", async () => {
    const { service, log, db, attachment } = setup();
    const { threadId } = db.prepare("SELECT threadId FROM message LIMIT 1").get() as { threadId: string };
    await service.readAttachment(attachment("1 = 1"), [png]);
    // Zusammenfassen braucht das Textmodell → Bildmodell wird vorher entladen
    await service.summarize(threadId);
    await service.readAttachment(attachment("1 = 1"), [png]);
    expect(log).toEqual(["bild:readImage", "bild:entladen", "text:summarize", "text:entladen", "bild:readImage"]);
  });
});
