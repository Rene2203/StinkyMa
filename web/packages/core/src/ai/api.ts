import type { CatalogModel, ModelCapability } from "./catalog.js";
import type { ResultOrigin } from "./tasks.js";

// Schnittstelle Oberfläche ↔ KI-Dienst (Windows: IPC zum Hauptprozess, später Server: HTTP). Plattformneutral.

/** Nur die letzten Tage automatisch einordnen – beim ersten Einschalten nicht das ganze Postfach durchrechnen. */
export const categorizeWindowDays = 14;

export interface AISettings {
  /** KI-Funktionen an/aus. Aus = kein Modell im Speicher, keine Verarbeitung. */
  enabled: boolean;
  /** Gewähltes lokales Modell (Katalog-ID). */
  modelId: string | null;
  /** Neue Mails im Posteingang automatisch einordnen (im Hintergrund, nacheinander). */
  autoCategorize: boolean;
  /** Grafikkarte nutzen, falls vorhanden. */
  useGpu: boolean;
}

export const defaultAISettings: AISettings = { enabled: false, modelId: null, autoCategorize: true, useGpu: true };

export function normalizeAISettings(raw: unknown): AISettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaultAISettings.enabled,
    modelId: typeof value.modelId === "string" && value.modelId ? value.modelId : null,
    autoCategorize: typeof value.autoCategorize === "boolean" ? value.autoCategorize : defaultAISettings.autoCategorize,
    useGpu: typeof value.useGpu === "boolean" ? value.useGpu : defaultAISettings.useGpu,
  };
}

export interface AIModelInfo {
  id: string;
  name: string;
  family: CatalogModel["family"];
  paramsB: number;
  sizeBytes: number;
  minRamGb: number;
  capabilities: ModelCapability[];
  note: string;
  /** Vom Messlauf empfohlen. */
  recommended: boolean;
  /** Passt in den Arbeitsspeicher dieses Rechners. */
  fits: boolean;
  state: "missing" | "partial" | "downloading" | "installed";
  receivedBytes: number;
}

export interface AIStatus {
  settings: AISettings;
  models: AIModelInfo[];
  /** Arbeitsspeicher des Rechners (GB, gerundet). */
  ramGb: number;
  /** Ist ein Modell gewählt, geladen bzw. ladbar und die KI an? */
  ready: boolean;
  download: { modelId: string; receivedBytes: number; totalBytes: number } | null;
  /** Hintergrund-Einordnung: noch offene Mails (null = läuft nicht). */
  categorizing: { remaining: number } | null;
  /** Letzter Fehler (Download, Laden des Modells) – verständlich, ohne Mail-Inhalte. */
  error: string | null;
}

/** Zusammenfassung für die Anzeige. */
export interface SummaryView {
  threadId: string;
  summary: string;
  openPoints: string[];
  waitingOn: "me" | "others" | "nobody";
  origin: Exclude<ResultOrigin, "rules">;
  modelName: string;
  createdAt: string;
  /** Seit der Zusammenfassung sind neue Mails dazugekommen. */
  stale: boolean;
}

export interface AIApi {
  status(): Promise<AIStatus>;
  update(patch: Partial<AISettings>): Promise<AIStatus>;
  /** Startet den Download (setzt einen abgebrochenen fort). Fortschritt über Status-Meldungen. */
  download(modelId: string): Promise<void>;
  cancelDownload(): Promise<void>;
  deleteModel(modelId: string): Promise<void>;
  /** Gespeicherte Zusammenfassung (ohne neu zu rechnen) – oder null. */
  cachedSummary(threadId: string): Promise<SummaryView | null>;
  /** Fasst die Konversation zusammen (nur auf ausdrücklichen Wunsch – Klick). */
  summarize(threadId: string): Promise<SummaryView>;
}

export const aiMethods = ["status", "update", "download", "cancelDownload", "deleteModel", "cachedSummary", "summarize"] as const satisfies readonly (keyof AIApi)[];
