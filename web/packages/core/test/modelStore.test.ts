import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CatalogModel } from "../src/index.js";
import { fileNameFromUrl, ModelChecksumError, ModelStore, toGbnfSchema } from "../src/llm/index.js";

const content = randomBytes(256 * 1024);
const vision = randomBytes(32 * 1024);
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

let server: Server;
let base = "";
let requests: { path: string; range: string | undefined }[] = [];
let honorRange = true;
/** Antwort nach so vielen Bytes abbrechen (simuliert Verbindungsabbruch). */
let cutAfter: number | null = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? "";
    requests.push({ path, range: req.headers.range });
    const data = path.endsWith("mmproj-F16.gguf") ? vision : path.endsWith("model.gguf") ? content : null;
    if (!data) {
      res.writeHead(404).end();
      return;
    }
    let start = 0;
    const match = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    if (match && honorRange) {
      start = Number(match[1]);
      res.writeHead(206, { "Content-Length": data.length - start, "Content-Range": `bytes ${start}-${data.length - 1}/${data.length}` });
    } else {
      res.writeHead(200, { "Content-Length": data.length });
    }
    const body = data.subarray(start);
    if (cutAfter !== null) {
      res.write(body.subarray(0, cutAfter));
      setTimeout(() => res.destroy(), 20);
      return;
    }
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stinkyma-models-"));
  requests = [];
  honorRange = true;
  cutAfter = null;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function model(overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    id: "test-model",
    name: "Testmodell",
    family: "qwen",
    paramsB: 1,
    quantization: "Q4_K_M",
    url: `${base}/repo/resolve/main/model.gguf`,
    sizeBytes: content.length,
    sha256: sha(content),
    minRamGb: 4,
    capabilities: ["text", "image"],
    license: "Apache-2.0",
    vision: { url: `${base}/repo/resolve/main/mmproj-F16.gguf`, sizeBytes: vision.length, sha256: sha(vision) },
    note: "",
    ...overrides,
  };
}

describe("ModelStore", () => {
  it("lädt, prüft und meldet das Modell als installiert", async () => {
    const store = new ModelStore(dir);
    expect(await store.status(model())).toEqual({ state: "missing" });
    const progress: number[] = [];
    const path = await store.download(model(), { onProgress: (p) => progress.push(p.receivedBytes) });
    expect(readFileSync(path).equals(content)).toBe(true);
    expect(progress.at(-1)).toBe(content.length);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(await store.status(model())).toEqual({ state: "installed", path, visionPath: null });
    // zweiter Aufruf lädt nichts erneut
    requests = [];
    await store.download(model());
    expect(requests).toHaveLength(0);
  });

  it("lädt den Bild-Baustein nur auf Wunsch, Fortschritt über beide Dateien", async () => {
    const store = new ModelStore(dir);
    let last = { receivedBytes: 0, totalBytes: 0 };
    await store.download(model(), { withVision: true, onProgress: (p) => (last = p) });
    expect(last).toEqual({ receivedBytes: content.length + vision.length, totalBytes: content.length + vision.length });
    const status = await store.status(model(), { withVision: true });
    expect(status.state).toBe("installed");
    expect(status.state === "installed" && status.visionPath?.endsWith(join("test-model", "mmproj-F16.gguf"))).toBe(true);
  });

  it("setzt einen abgebrochenen Download fort", async () => {
    const store = new ModelStore(dir);
    cutAfter = 100_000;
    await expect(store.download(model())).rejects.toThrow();
    const status = await store.status(model());
    expect(status.state).toBe("partial");
    const received = status.state === "partial" ? status.receivedBytes : 0;
    expect(received).toBeGreaterThan(0);

    cutAfter = null;
    requests = [];
    const path = await store.download(model());
    expect(requests[0]?.range).toBe(`bytes=${received}-`);
    expect(readFileSync(path).equals(content)).toBe(true);
  });

  it("beginnt von vorn, wenn der Server nicht fortsetzen kann", async () => {
    const store = new ModelStore(dir);
    cutAfter = 50_000;
    await expect(store.download(model())).rejects.toThrow();
    cutAfter = null;
    honorRange = false;
    const path = await store.download(model());
    expect(readFileSync(path).equals(content)).toBe(true);
  });

  it("verwirft Dateien mit falscher Prüfsumme", async () => {
    const store = new ModelStore(dir);
    const broken = model({ sha256: "0".repeat(64) });
    await expect(store.download(broken)).rejects.toBeInstanceOf(ModelChecksumError);
    expect(await store.status(broken)).toEqual({ state: "missing" });
  });

  it("bricht auf Wunsch ab und behält den Teil", async () => {
    const store = new ModelStore(dir);
    const controller = new AbortController();
    await expect(
      store.download(model(), {
        signal: controller.signal,
        onProgress: (p) => {
          if (p.receivedBytes > 0) controller.abort();
        },
      }),
    ).rejects.toThrow();
    expect((await store.status(model())).state).not.toBe("installed");
  });

  it("meldet Serverfehler verständlich", async () => {
    const store = new ModelStore(dir);
    await expect(store.download(model({ url: `${base}/fehlt/model-x.gguf` }))).rejects.toThrow(/HTTP 404/);
  });

  it("löscht ein Modell samt Teildateien", async () => {
    const store = new ModelStore(dir);
    await store.download(model(), { withVision: true });
    writeFileSync(join(dir, "anderes.txt"), "bleibt");
    await store.delete(model());
    expect(await store.status(model())).toEqual({ state: "missing" });
    expect(existsSync(join(dir, "anderes.txt"))).toBe(true);
  });

  it("lehnt unsichere Dateinamen und Kennungen ab", async () => {
    expect(fileNameFromUrl("https://huggingface.co/a/b/resolve/main/Qwen3.5-2B-Q4_K_M.gguf?download=true")).toBe("Qwen3.5-2B-Q4_K_M.gguf");
    expect(() => fileNameFromUrl("https://example.test/%2e%2e%2fboese")).toThrow();
    const store = new ModelStore(dir);
    expect(() => store.pathFor(model({ id: "../raus" }))).toThrow();
  });
});

describe("Grammatik-Schema", () => {
  it("übersetzt Aufzählungen, Listen und lässt Zahlengrenzen weg", () => {
    expect(
      toGbnfSchema({
        type: "object",
        properties: {
          category: { type: "string", enum: ["a", "b"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          points: { type: "array", items: { type: "string", maxLength: 10 }, maxItems: 4 },
        },
        required: ["category"],
        additionalProperties: false,
      }),
    ).toEqual({
      type: "object",
      properties: {
        category: { enum: ["a", "b"] },
        confidence: { type: "number" },
        points: { type: "array", items: { type: "string", maxLength: 10 }, maxItems: 4 },
      },
    });
  });
});
