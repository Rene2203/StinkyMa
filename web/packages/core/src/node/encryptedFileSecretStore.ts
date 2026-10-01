import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SecretKey, SecretStore } from "../secrets.js";
import { secretKeyId } from "../secrets.js";

/** Verschlüsselt einzelne Werte. In der Windows-App: Electron `safeStorage` (DPAPI, an das Windows-Konto gebunden). */
export interface StringEncryptor {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(encrypted: Buffer): string;
}

export class SecretStoreUnavailableError extends Error {
  constructor() {
    super("Sicherer Speicher des Betriebssystems ist nicht verfügbar – Geheimnisse werden nicht gespeichert.");
  }
}

/**
 * Geheimnisse als verschlüsselte Einträge in einer JSON-Datei. Jeder Wert ist einzeln verschlüsselt;
 * Klartext landet nie auf der Platte. Ohne verfügbare Verschlüsselung wird nichts gespeichert.
 */
export class EncryptedFileSecretStore implements SecretStore {
  constructor(
    private readonly filePath: string,
    private readonly encryptor: StringEncryptor,
  ) {}

  async set(key: SecretKey, value: string): Promise<void> {
    if (!this.encryptor.isAvailable()) throw new SecretStoreUnavailableError();
    const entries = this.#read();
    entries[secretKeyId(key)] = this.encryptor.encrypt(value).toString("base64");
    this.#write(entries);
  }

  async get(key: SecretKey): Promise<string | null> {
    const encrypted = this.#read()[secretKeyId(key)];
    if (encrypted === undefined) return null;
    if (!this.encryptor.isAvailable()) throw new SecretStoreUnavailableError();
    return this.encryptor.decrypt(Buffer.from(encrypted, "base64"));
  }

  async remove(key: SecretKey): Promise<void> {
    const entries = this.#read();
    if (!(secretKeyId(key) in entries)) return;
    delete entries[secretKeyId(key)];
    this.#write(entries);
  }

  #read(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8")) as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  #write(entries: Record<string, string>): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, JSON.stringify(entries, null, 2), { mode: 0o600 });
    renameSync(temp, this.filePath); // atomar ersetzen
  }
}
