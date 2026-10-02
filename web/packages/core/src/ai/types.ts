// KI-Kern: Gemeinsame Typen (Spezifikation 5.0/5.1). Plattformneutral – Windows, Server und später iPad
// liefern nur die Anbieter (lokales Modell, eigener Server, Cloud).

/** Wo ein Ergebnis berechnet wird – entscheidet, ob Mail-Inhalte das Gerät verlassen. */
export type PrivacyClass = "onDevice" | "ownServer" | "cloud";

/** Aufgaben der KI (5.5). Weitere folgen in späteren Phasen. */
export type AITask = "categorize" | "summarize" | "readImage" | "extractActions" | "parseRule" | "draftReply" | "extractSubscription" | "userCategory" | "extractReceipt" | "extractPromises";

/** Bild als Eingabe (Foto, Scan, Bildschirmfoto) – nur für Modelle mit Bild-Baustein. */
export interface AIImage {
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/bmp";
  base64: string;
}

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** Bilder zu dieser Nachricht (vor dem Text). */
  images?: AIImage[];
}

/** Vereinfachtes JSON-Schema für strukturierte Ausgaben (lokale Modelle erzwingen es per Grammatik). */
export type JsonSchema =
  | { type: "object"; properties: Record<string, JsonSchema>; required?: string[]; additionalProperties?: false }
  | { type: "array"; items: JsonSchema; maxItems?: number }
  | { type: "string"; enum?: readonly string[]; maxLength?: number }
  | { type: "number"; minimum?: number; maximum?: number }
  | { type: "boolean" };

export interface AIRequest {
  task: AITask;
  messages: AIMessage[];
  /** Strukturierte Ausgabe erzwingen (wenn der Anbieter es kann) – sonst nur angefragt. */
  jsonSchema?: JsonSchema;
  maxTokens: number;
  temperature?: number;
}

export interface AIResponse {
  text: string;
  providerId: string;
  privacyClass: PrivacyClass;
  durationMs: number;
  /** Erzeugte Tokens (falls bekannt) – für Geschwindigkeitsmessungen. */
  tokensOut?: number;
}

/** Ein KI-Anbieter (lokales Modell, Heimserver, Cloud). Alle KI-Funktionen sprechen nur mit dieser Schnittstelle. */
export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly privacyClass: PrivacyClass;
  /** Versteht Bilder in `AIMessage.images`. */
  readonly acceptsImages?: boolean;
  /** Kontextlänge in Tokens (Eingabe + Ausgabe). */
  readonly contextWindow: number;
  generate(request: AIRequest, signal?: AbortSignal): Promise<AIResponse>;
}

/** Das Ergebnis wurde nicht berechnet, weil der Anbieter für dieses Konto/diese Aufgabe nicht freigegeben ist. */
export class AIBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIBlockedError";
  }
}

/** Für die Aufgabe ist kein (passender) Anbieter eingerichtet – z. B. noch kein Modell heruntergeladen. */
export class AINotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AINotConfiguredError";
  }
}

/** Das Modell hat nicht rechtzeitig geantwortet (hängt) – es wird verworfen und bei Bedarf neu geladen. */
export class AITimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AITimeoutError";
  }
}
