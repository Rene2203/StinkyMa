import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { downloadVerified, type DownloadProgress, type ModelFile } from "./modelStore.js";

// llama.cpp als eigenes Programm (llama-server) – nötig für Bilder (Bild-Baustein „mmproj“), was die eingebaute
// Laufzeit (node-llama-cpp) nicht kann. Wird erst geladen, wenn der Nutzer „Bilder verstehen“ einschaltet.
// Feste Version mit Prüfsumme: Es läuft nur genau das Programm, das wir getestet haben.

const run = promisify(execFile);

export interface RuntimeAsset extends ModelFile {
  archive: "zip" | "tar.gz";
}

export const llamaRuntimeVersion = "b11320";

const release = (file: string) => `https://github.com/ggml-org/llama.cpp/releases/download/${llamaRuntimeVersion}/${file}`;

/** Fertige Programme je Plattform. Windows: Vulkan-Ausgabe (enthält auch die CPU-Varianten). */
export const llamaRuntimeAssets: Partial<Record<string, RuntimeAsset>> = {
  "win32-x64": {
    url: release(`llama-${llamaRuntimeVersion}-bin-win-vulkan-x64.zip`),
    sizeBytes: 33_208_164,
    sha256: "20e11c93085112d15bad9716531954c6752024c023153c96b493349041ae5779",
    archive: "zip",
  },
  "linux-x64": {
    url: release(`llama-${llamaRuntimeVersion}-bin-ubuntu-x64.tar.gz`),
    sizeBytes: 17_544_875,
    sha256: "ef1856938dc1434138ce53688791eb0d2d64cf46e309a0942a12bba3366c0919",
    archive: "tar.gz",
  },
};

export class RuntimeStore {
  constructor(
    /** Ordner für Laufzeiten (z. B. %APPDATA%/StinkyMa/runtime). */
    private readonly directory: string,
    private readonly options: { platform?: string; fetchImpl?: typeof fetch; asset?: RuntimeAsset } = {},
  ) {}

  get asset(): RuntimeAsset | null {
    return this.options.asset ?? llamaRuntimeAssets[this.options.platform ?? `${process.platform}-${process.arch}`] ?? null;
  }

  get sizeBytes(): number {
    return this.asset?.sizeBytes ?? 0;
  }

  #versionDir(): string {
    return join(this.directory, llamaRuntimeVersion);
  }

  /** Pfad zu llama-server, wenn installiert. */
  async serverPath(): Promise<string | null> {
    if (!existsSync(join(this.#versionDir(), ".complete"))) return null;
    return findFile(this.#versionDir(), process.platform === "win32" ? "llama-server.exe" : "llama-server");
  }

  async download(options: { signal?: AbortSignal; onProgress?: (progress: DownloadProgress) => void } = {}): Promise<string> {
    const existing = await this.serverPath();
    if (existing) return existing;
    const asset = this.asset;
    if (!asset) throw new Error("Für dieses System gibt es noch keine Bild-Laufzeit.");
    await mkdir(this.directory, { recursive: true });
    const archive = join(this.directory, `llama-${llamaRuntimeVersion}.${asset.archive}`);
    await downloadVerified(this.options.fetchImpl ?? fetch, asset, archive, options.signal, (received) => options.onProgress?.({ receivedBytes: received, totalBytes: asset.sizeBytes }));
    const target = this.#versionDir();
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    // Entpacken mit dem tar des Betriebssystems (unter Windows 10/11 eingebaut, kann auch ZIP) – feste Pfade, kein Suchpfad.
    const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
    await run(tar, asset.archive === "zip" ? ["-xf", archive, "-C", target] : ["-xzf", archive, "-C", target]);
    await rm(archive, { force: true });
    const server = await findFile(target, process.platform === "win32" ? "llama-server.exe" : "llama-server");
    if (!server) {
      await rm(target, { recursive: true, force: true });
      throw new Error("Die Bild-Laufzeit ist unvollständig. Bitte erneut laden.");
    }
    await writeFile(join(target, ".complete"), llamaRuntimeVersion);
    return server;
  }

  async delete(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
  }
}

/** Datei im Ordner suchen (die Archive enthalten je nach Plattform einen Unterordner). */
async function findFile(directory: string, name: string, depth = 2): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return null;
  }
  if (entries.includes(name)) return join(directory, name);
  if (depth === 0) return null;
  for (const entry of entries) {
    const path = join(directory, entry);
    if ((await stat(path)).isDirectory()) {
      const found = await findFile(path, name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}
