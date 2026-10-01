import type { MailAction } from "./actions.js";
import type { CatalogModel, ModelCapability } from "./catalog.js";
import type { DocumentType } from "./prompts.js";
import type { ResultOrigin } from "./tasks.js";
import type { AIImage } from "./types.js";

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
  /** Bilder und Scans verstehen (lädt Bild-Baustein und Bild-Laufzeit nach). */
  vision: boolean;
}

export const defaultAISettings: AISettings = { enabled: false, modelId: null, autoCategorize: true, useGpu: true, vision: false };

export function normalizeAISettings(raw: unknown): AISettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaultAISettings.enabled,
    modelId: typeof value.modelId === "string" && value.modelId ? value.modelId : null,
    autoCategorize: typeof value.autoCategorize === "boolean" ? value.autoCategorize : defaultAISettings.autoCategorize,
    useGpu: typeof value.useGpu === "boolean" ? value.useGpu : defaultAISettings.useGpu,
    vision: typeof value.vision === "boolean" ? value.vision : defaultAISettings.vision,
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
  download: { kind: "model" | "vision"; modelId: string; receivedBytes: number; totalBytes: number } | null;
  /**
   * Bilder verstehen: „unavailable“ = gewähltes Modell oder dieses System kann es nicht; „missing“ = Bild-Baustein
   * bzw. Laufzeit fehlen noch (`missingBytes` zu laden); „ready“ = einsatzbereit.
   */
  vision: { state: "unavailable" | "missing" | "downloading" | "ready"; missingBytes: number };
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

/** Ergebnis „Mit KI lesen“ für einen Anhang (Bild oder gescanntes PDF). */
export interface AttachmentReadingView {
  attachmentId: string;
  documentType: DocumentType;
  title: string;
  summary: string;
  text: string;
  origin: Exclude<ResultOrigin, "rules">;
  modelName: string;
  createdAt: string;
  durationMs: number;
}

/** Größte Bildgröße (Base64-Zeichen) je Seite, die die Oberfläche schicken darf. */
export const maxPageImageChars = 8_000_000;

/** Erkannte Aktion für die Anzeige (Karte über der Mail). */
export interface ActionView extends MailAction {
  id: string;
  messageId: string;
  status: "open" | "done" | "dismissed";
  origin: ResultOrigin;
  /** Geplante Erinnerung (falls gesetzt) */
  reminder: { id: string; dueDate: string } | null;
}

export interface MessageActionsView {
  messageId: string;
  actions: ActionView[];
  /** Woher: Gerät/Server/Cloud oder Regeln; null = nicht untersucht (z. B. gesendete Mail, Newsletter) */
  origin: ResultOrigin | null;
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
  /** Bild-Baustein und Bild-Laufzeit laden (Fortschritt über Status-Meldungen). */
  downloadVision(): Promise<void>;
  /** Gespeichertes Leseergebnis eines Anhangs – oder null. */
  attachmentReading(attachmentId: string): Promise<AttachmentReadingView | null>;
  /**
   * Anhang mit KI lesen (nur auf Klick). Bilder liest der Dienst selbst; für PDFs schickt die Oberfläche die
   * gerenderten Seiten (höchstens 3). Der gelesene Text wird durchsuchbar.
   */
  readAttachment(attachmentId: string, pageImages?: AIImage[]): Promise<AttachmentReadingView>;
  /**
   * Termine, Fristen, To-dos und Zahlungen einer Mail. Beim ersten Öffnen erkannt (Modell, sonst Regeln) und
   * gespeichert; danach sofort.
   */
  messageActions(messageId: string): Promise<MessageActionsView>;
  setActionStatus(actionId: string, status: "open" | "done" | "dismissed"): Promise<void>;
  /** Erinnerung (Windows-Benachrichtigung) zum Zeitpunkt `dueIso` (ISO-8601). */
  remind(actionId: string, dueIso: string): Promise<void>;
  cancelReminder(reminderId: string): Promise<void>;
  /** Kalendereintrag (.ics) erzeugen und mit dem Standard-Kalender öffnen. */
  addToCalendar(actionId: string): Promise<void>;
}

export const aiMethods = ["status", "update", "download", "cancelDownload", "deleteModel", "cachedSummary", "summarize", "downloadVision", "attachmentReading", "readAttachment", "messageActions", "setActionStatus", "remind", "cancelReminder", "addToCalendar"] as const satisfies readonly (keyof AIApi)[];
