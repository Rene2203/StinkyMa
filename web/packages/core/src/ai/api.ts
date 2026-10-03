import type { CompletionInput, CompletionView } from "./complete.js";
import type { MessageCategory } from "../models.js";
import type { DigestView } from "../digest.js";
import type { AITask } from "./types.js";
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
  /**
   * Welche älteren Posteingangs-Mails zusätzlich eingeordnet werden. Neue Mails (letzte `categorizeWindowDays` Tage)
   * werden immer eingeordnet – sonst bliebe neue Post bei einem Zeitraum in der Vergangenheit liegen.
   */
  categorizeRange: CategorizeRange;
  /** Autovervollständigung beim Schreiben (W8.5): grauer Vorschlag, Tab übernimmt. */
  autocomplete: boolean;
}

export type CategorizeRange =
  | { kind: "recent" }
  | { kind: "days"; days: number }
  | { kind: "all" }
  /** Eigener Zeitraum, beide Tage einschließlich (JJJJ-MM-TT, Ortszeit) */
  | { kind: "custom"; from: string; to: string };

/** Zeitgrenzen für die Abfrage: `since` = neue Mails; dazu optional der Zeitraum [from, to) (ISO, UTC). */
export interface CategorizeWindow {
  since: string;
  from: string | null;
  to: string | null;
}

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime());

function normalizeRange(raw: unknown, legacyOlder: unknown): CategorizeRange {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (value.kind === "all") return { kind: "all" };
  if (value.kind === "days" && typeof value.days === "number" && value.days >= 1 && value.days <= 3650) return { kind: "days", days: Math.round(value.days) };
  if (value.kind === "custom" && isDay(value.from) && isDay(value.to)) {
    return value.from <= value.to ? { kind: "custom", from: value.from, to: value.to } : { kind: "custom", from: value.to, to: value.from };
  }
  if (value.kind === "recent") return { kind: "recent" };
  // frühere Einstellung „auch ältere Mails einordnen“
  return legacyOlder === true ? { kind: "all" } : { kind: "recent" };
}

/** Lokaler Tagesbeginn als ISO (UTC). */
function startOfDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toISOString();
}

export function categorizeWindow(range: CategorizeRange, now: Date): CategorizeWindow {
  const since = new Date(now.getTime() - categorizeWindowDays * 86_400_000).toISOString();
  switch (range.kind) {
    case "recent":
      return { since, from: null, to: null };
    case "all":
      return { since, from: "", to: null };
    case "days":
      return { since, from: new Date(now.getTime() - range.days * 86_400_000).toISOString(), to: null };
    case "custom": {
      const [y, m, d] = range.to.split("-").map(Number);
      const next = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1).toISOString();
      return { since, from: startOfDay(range.from), to: next };
    }
  }
}

export const defaultAISettings: AISettings = { enabled: false, modelId: null, autoCategorize: true, useGpu: true, vision: false, categorizeRange: { kind: "recent" }, autocomplete: true };

export function normalizeAISettings(raw: unknown): AISettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaultAISettings.enabled,
    modelId: typeof value.modelId === "string" && value.modelId ? value.modelId : null,
    autoCategorize: typeof value.autoCategorize === "boolean" ? value.autoCategorize : defaultAISettings.autoCategorize,
    useGpu: typeof value.useGpu === "boolean" ? value.useGpu : defaultAISettings.useGpu,
    vision: typeof value.vision === "boolean" ? value.vision : defaultAISettings.vision,
    categorizeRange: normalizeRange(value.categorizeRange, value.categorizeOlder),
    autocomplete: typeof value.autocomplete === "boolean" ? value.autocomplete : defaultAISettings.autocomplete,
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
  categorizing: { remaining: number; done: number; total: number } | null;
  /**
   * Was die KI gerade rechnet (für die Anzeige „arbeitet …“): Aufgabe, Beginn (ISO) und wie viele Aufgaben warten.
   * null = Leerlauf.
   */
  activity: { task: AITask; startedAt: string; waiting: number } | null;
  /** Noch nicht eingeordnete Posteingangs-Mails: im gewählten Zeitraum (werden eingeordnet) und außerhalb. */
  backlog: { recent: number; older: number };
  /** Letzter Fehler (Download, Laden des Modells) – verständlich, ohne Mail-Inhalte. */
  error: string | null;
  /** Autovervollständigung war auf diesem Rechner zu langsam und hat sich ausgeschaltet (bis sie wieder eingeschaltet wird). */
  autocompleteSlow?: boolean;
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

/** Antwortvorschläge zur geöffneten Mail (nur auf Klick, nicht gespeichert). */
export interface ReplyDraftsView {
  messageId: string;
  form: "du" | "Sie";
  greeting: string;
  replies: { kind: "agree" | "decline" | "ask"; label: string; text: string }[];
  modelName: string;
  durationMs: number;
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
  /** 2–3 Antwortvorschläge zur Mail (nur auf Klick). Leere Liste: das Modell lieferte nichts Brauchbares. */
  replyDrafts(messageId: string): Promise<ReplyDraftsView>;
  /** Tagesüberblick: Fälliges, wichtige ungelesene Mails, „wartet auf dich“ (ohne Modell, sofort). */
  dailyDigest(): Promise<DigestView>;
  /**
   * Einordnung von Hand korrigieren. `remember`: für künftige Mails dieses Absenders merken (ohne Modell) und andere,
   * von der KI eingeordnete Mails des Absenders gleich mit ändern. Gibt zurück, wie viele weitere Mails geändert wurden.
   */
  setCategory(messageId: string, category: MessageCategory | null, remember: boolean): Promise<{ changed: number }>;
  /** Gelernte Absender (aus Korrekturen) – zum Ansehen und Vergessen. */
  learnedSenders(): Promise<{ address: string; category: MessageCategory; learnedAt: string }[]>;
  forgetSender(address: string): Promise<void>;
  /** Nach einem Fehler: Fehler vergessen und die Einordnung neu anstoßen. */
  resume(): Promise<AIStatus>;
  /**
   * Fortsetzung des angefangenen Satzes (W8.5). `null`: aus, KI beschäftigt, nichts Brauchbares oder abgebrochen.
   * Eine neue Anfrage bricht die vorige ab.
   */
  complete(input: CompletionInput): Promise<CompletionView | null>;
  /** Laufende Vorschlags-Anfrage abbrechen (weitergetippt). */
  cancelCompletion(): Promise<void>;
}

export const aiMethods = ["status", "update", "download", "cancelDownload", "deleteModel", "cachedSummary", "summarize", "downloadVision", "attachmentReading", "readAttachment", "messageActions", "setActionStatus", "remind", "cancelReminder", "addToCalendar", "replyDrafts", "dailyDigest", "resume", "setCategory", "learnedSenders", "forgetSender", "complete", "cancelCompletion"] as const satisfies readonly (keyof AIApi)[];
