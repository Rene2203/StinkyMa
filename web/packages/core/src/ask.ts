// „Frag dein Postfach“ (W8.1): Fragen in normaler Sprache, Antwort mit Quellen. Plattformneutral.

export interface AskSource {
  /** Nummer in der Antwort ([1], [2] …) */
  n: number;
  messageId: string;
  subject: string;
  from: string;
  date: string;
  /** Fundstelle (Ausschnitt) */
  excerpt: string;
  /** aus einem Anhang (Dateiname) statt aus dem Mailtext */
  attachment: string | null;
}

export interface AskResult {
  question: string;
  /** Antwort des Modells (null: kein Modell bereit – dann nur die Fundstellen) */
  answer: string | null;
  /** Nummern der Quellen, auf die sich die Antwort stützt */
  cited: number[];
  sources: AskSource[];
  /** Welche Suche lief: nach Bedeutung (Embeddings) und/oder Wörtern (Volltext) */
  search: { semantic: boolean; keyword: boolean };
  durationMs: number;
}

export interface AskIndexStatus {
  /** Embedding-Modell: fehlt, wird geladen, bereit */
  model: { state: "missing" | "downloading" | "ready"; sizeBytes: number; receivedBytes: number; license: string };
  /** Indexierte Mails / alle Mails im Zeitraum */
  indexed: number;
  total: number;
  running: boolean;
}

export interface AskApi {
  /** Frage stellen; `sender`: nur Mails von/an diese Adresse (Steckbrief) */
  ask(question: string, options?: { sender?: string }): Promise<AskResult>;
  status(): Promise<AskIndexStatus>;
  /** Embedding-Modell laden (nur auf Klick) */
  downloadModel(): Promise<void>;
  deleteModel(): Promise<void>;
}

export const askApiMethods = ["ask", "status", "downloadModel", "deleteModel"] as const satisfies readonly (keyof AskApi)[];
