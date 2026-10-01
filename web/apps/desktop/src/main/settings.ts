import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { normalizeAppSettings, type AppSettings } from "@stinkyma/core";

/** Einstellungen der Windows-App als kleine JSON-Datei im Benutzerordner (keine Geheimnisse, keine Mail-Inhalte). */
export class SettingsFile {
  #settings: AppSettings;
  #extra: Record<string, unknown>;
  #ai: unknown;

  constructor(private readonly path: string) {
    let raw: Record<string, unknown> = {};
    try {
      if (existsSync(path)) raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      raw = {}; // kaputte Datei: mit Standardwerten weiter
    }
    this.#settings = normalizeAppSettings(raw);
    this.#ai = raw.ai ?? null;
    this.#extra = typeof raw.internal === "object" && raw.internal ? (raw.internal as Record<string, unknown>) : {};
  }

  get settings(): AppSettings {
    return this.#settings;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.#settings = normalizeAppSettings({ ...this.#settings, ...patch });
    this.#write();
    return this.#settings;
  }

  /** Interne Merker (z. B. „Hinweis zum Infobereich schon gezeigt“), nicht in der Oberfläche einstellbar. */
  flag(name: string): boolean {
    return this.#extra[name] === true;
  }

  setFlag(name: string): void {
    this.#extra[name] = true;
    this.#write();
  }

  /** Interner Text-Merker (z. B. Tag des letzten Tagesüberblicks). */
  text(name: string): string | null {
    const value = this.#extra[name];
    return typeof value === "string" ? value : null;
  }

  setText(name: string, value: string): void {
    this.#extra[name] = value;
    this.#write();
  }

  /** KI-Einstellungen (Modellwahl usw.) – geprüft und vereinheitlicht im KI-Dienst. */
  get ai(): unknown {
    return this.#ai;
  }

  setAI(value: unknown): void {
    this.#ai = value;
    this.#write();
  }

  #write(): void {
    writeFileSync(this.path, JSON.stringify({ ...this.#settings, ai: this.#ai ?? undefined, internal: this.#extra }, null, 2));
  }
}
