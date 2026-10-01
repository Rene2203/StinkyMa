import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { CatalogModel } from "../ai/catalog.js";

// Modelle herunterladen, prüfen und verwalten. Große Dateien (1–5 GB): Abbruch und Fortsetzen müssen gehen,
// und eine Datei gilt erst als installiert, wenn ihre SHA-256-Prüfsumme stimmt.

export interface ModelFile {
  url: string;
  sizeBytes: number;
  sha256: string;
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number;
}

export type ModelStatus =
  | { state: "missing" }
  | { state: "partial"; receivedBytes: number; totalBytes: number }
  | { state: "installed"; path: string; visionPath: string | null };

export class ModelChecksumError extends Error {
  constructor(filename: string) {
    super(`Die Datei „${filename}“ ist beschädigt (Prüfsumme stimmt nicht) und wurde gelöscht. Bitte erneut laden.`);
    this.name = "ModelChecksumError";
  }
}

/** Dateiname aus der Download-Adresse (ohne Abfrageteil). */
export function fileNameFromUrl(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? "");
  if (!/^[\w.-]+$/.test(name)) throw new Error("Ungültiger Dateiname in der Modell-Adresse.");
  return name;
}

export class ModelStore {
  constructor(
    /** Ordner für Modelle (z. B. %APPDATA%/StinkyMa/models). */
    private readonly directory: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Je Modell ein Unterordner – mehrere Modelle haben gleich benannte Bild-Bausteine (`mmproj-F16.gguf`). */
  #folder(model: CatalogModel): string {
    if (!/^[\w.-]+$/.test(model.id)) throw new Error("Ungültige Modell-Kennung.");
    return join(this.directory, model.id);
  }

  pathFor(model: CatalogModel, file: ModelFile = model): string {
    return join(this.#folder(model), fileNameFromUrl(file.url));
  }

  async status(model: CatalogModel, options: { withVision?: boolean } = {}): Promise<ModelStatus> {
    const files: ModelFile[] = options.withVision && model.vision ? [model, model.vision] : [model];
    let received = 0;
    let complete = true;
    for (const file of files) {
      const path = this.pathFor(model, file);
      if (await isFile(path)) {
        received += file.sizeBytes;
        continue;
      }
      complete = false;
      received += (await fileSize(`${path}.part`)) ?? 0;
    }
    if (complete) {
      return { state: "installed", path: this.pathFor(model), visionPath: model.vision && (await isFile(this.pathFor(model, model.vision))) ? this.pathFor(model, model.vision) : null };
    }
    const total = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    return received > 0 ? { state: "partial", receivedBytes: received, totalBytes: total } : { state: "missing" };
  }

  /**
   * Lädt das Modell (und auf Wunsch den Bild-Baustein). Setzt einen abgebrochenen Download fort (HTTP-Range).
   * Fortschritt über alle Dateien zusammen. Abbruch über `signal` lässt die Teildatei für später liegen.
   */
  async download(model: CatalogModel, options: { withVision?: boolean; signal?: AbortSignal; onProgress?: (progress: DownloadProgress) => void } = {}): Promise<string> {
    const files: ModelFile[] = options.withVision && model.vision ? [model, model.vision] : [model];
    const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    let doneBefore = 0;
    await mkdir(this.#folder(model), { recursive: true });
    for (const file of files) {
      const target = this.pathFor(model, file);
      if (!(await isFile(target))) {
        await this.#downloadFile(file, target, options.signal, (received) => options.onProgress?.({ receivedBytes: doneBefore + received, totalBytes }));
      }
      doneBefore += file.sizeBytes;
      options.onProgress?.({ receivedBytes: doneBefore, totalBytes });
    }
    return this.pathFor(model);
  }

  #downloadFile(file: ModelFile, target: string, signal: AbortSignal | undefined, onProgress: (received: number) => void): Promise<void> {
    return downloadVerified(this.fetchImpl, file, target, signal, onProgress);
  }

  /** Modell samt Teildateien und Bild-Baustein löschen. */
  async delete(model: CatalogModel): Promise<void> {
    await rm(this.#folder(model), { recursive: true, force: true });
  }
}

async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function isFile(path: string): Promise<boolean> {
  return existsSync(path) && (await stat(path)).isFile();
}

/**
 * Lädt eine Datei mit bekannter Größe und SHA-256 nach `target` (über `target.part`, fortsetzbar per HTTP-Range).
 * Erst nach bestandener Prüfung erscheint die Datei unter ihrem Namen.
 */
export async function downloadVerified(
  fetchImpl: typeof fetch,
  file: ModelFile,
  target: string,
  signal: AbortSignal | undefined,
  onProgress: (received: number) => void,
): Promise<void> {
  const partial = `${target}.part`;
  let offset = (await fileSize(partial)) ?? 0;
  if (offset > file.sizeBytes) {
    await rm(partial, { force: true });
    offset = 0;
  }
  const hash = createHash("sha256");
  if (offset > 0) {
    // Schon geladenen Teil in die Prüfsumme aufnehmen
    for await (const chunk of createReadStream(partial)) hash.update(chunk as Buffer);
  }

  if (offset < file.sizeBytes) {
    const response = await fetchImpl(file.url, {
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
      redirect: "follow",
      signal,
    });
    if (offset > 0 && response.status === 200) {
      // Server kann nicht fortsetzen → von vorn
      offset = 0;
      hash.destroy();
      await rm(partial, { force: true });
      return downloadVerified(fetchImpl, file, target, signal, onProgress);
    }
    if (!(response.ok || response.status === 206) || !response.body) {
      throw new Error(`Download fehlgeschlagen (HTTP ${response.status}).`);
    }
    let received = offset;
    onProgress(received);
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        hash.update(chunk);
        onProgress(received);
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), counter, createWriteStream(partial, { flags: offset > 0 ? "a" : "w" }), { signal });
    if (received !== file.sizeBytes) {
      if (received > file.sizeBytes) await rm(partial, { force: true });
      throw new Error("Download unvollständig – bitte erneut versuchen (wird fortgesetzt).");
    }
  }

  if (hash.digest("hex") !== file.sha256) {
    await rm(partial, { force: true });
    throw new ModelChecksumError(fileNameFromUrl(file.url));
  }
  await rename(partial, target);
}
