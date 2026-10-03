import { inputBudget, truncate } from "./prepare.js";
import type { AIRouter } from "./router.js";
import { extractJson } from "./tasks.js";
import type { AIMessage, AIRequest, JsonSchema } from "./types.js";

// Komprimieren für kleine Kontextfenster (wie die Verdichtung bei großen Assistenten): Lange Texte werden in Abschnitte
// geteilt, jeder Abschnitt verdichtet (Map), die Ergebnisse zusammengesetzt und – falls immer noch zu lang – erneut
// verdichtet (Reduce). Beträge, Daten, Namen, Zusagen und offene Fragen sollen erhalten bleiben.

/** Text an Absatz-/Satzgrenzen in Stücke von höchstens `maxChars` teilen. */
export function splitIntoChunks(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "));
    const at = cut > maxChars * 0.5 ? cut + 1 : maxChars;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

const condenseSchema: JsonSchema = {
  type: "object",
  properties: { verdichtet: { type: "string", maxLength: 1500 } },
  required: ["verdichtet"],
  additionalProperties: false,
};

function condensePrompt(part: string, label: string): AIMessage[] {
  return [
    {
      role: "system",
      content: `Verdichte den folgenden Abschnitt (${label}) auf Deutsch auf höchstens 8 kurze Sätze.
Behalte genau: Beträge, Daten, Uhrzeiten, Namen, Zusagen („wer macht was bis wann“), Entscheidungen und offene Fragen. Lass Grußformeln und Wiederholungen weg. Erfinde nichts.
Antworte nur mit JSON: {"verdichtet": "..."}`,
    },
    { role: "user", content: part },
  ];
}

export interface CondenseOptions {
  accountIds: string[];
  /** Zielgröße (Zeichen) */
  targetChars?: number;
  /** Größe eines Abschnitts für einen Modellaufruf */
  chunkChars?: number;
  /** Wofür (für die Anweisung): „früherer Teil einer E-Mail-Konversation“, „Dokument“ … */
  label?: string;
  signal?: AbortSignal;
  /** Wie oft höchstens erneut verdichtet wird */
  maxRounds?: number;
}

/** Kürzt einen Text per Map-Reduce auf `targetChars`. Kurze Texte bleiben unverändert. Scheitert das Modell, wird gekürzt. */
export async function condense(router: AIRouter, text: string, options: CondenseOptions): Promise<string> {
  const target = options.targetChars ?? inputBudget.thread / 2;
  const chunkChars = options.chunkChars ?? Math.floor(inputBudget.thread * 0.6);
  let current = text.trim();
  for (let round = 0; round < (options.maxRounds ?? 3) && current.length > target; round++) {
    const parts: string[] = [];
    for (const chunk of splitIntoChunks(current, chunkChars)) {
      const request: AIRequest = {
        task: "summarize",
        messages: condensePrompt(chunk, options.label ?? "Text"),
        jsonSchema: condenseSchema,
        maxTokens: 500,
        temperature: 0,
      };
      let condensed: string | null = null;
      try {
        const response = await router.run(request, { accountIds: options.accountIds }, options.signal);
        const value = extractJson(response.text) as { verdichtet?: unknown } | null;
        if (value && typeof value.verdichtet === "string" && value.verdichtet.trim()) condensed = value.verdichtet.trim();
      } catch (error) {
        if (options.signal?.aborted) throw error;
      }
      // Ohne brauchbare Antwort: Anfang des Abschnitts statt nichts
      parts.push(condensed ?? truncate(chunk, Math.floor(chunkChars / 6)));
    }
    current = parts.join("\n\n");
  }
  return current.length > target ? truncate(current, target) : current;
}
