import { describe, expect, it } from "vitest";
import { categorizeSchema, extractJson } from "../src/index.js";
import { LlamaCppProvider } from "../src/llm/index.js";

// Läuft nur mit echtem Modell: STINKYMA_TEST_MODEL=/pfad/zu/modell.gguf – z. B. Qwen3.5-2B-Q4_K_M.gguf oder in der
// CI das winzige stories260K.gguf (1 MB): Es prüft nicht die Qualität, sondern dass llama.cpp lädt, die Grammatik
// gültiges JSON erzwingt und Anfragen nacheinander laufen.
const modelPath = process.env.STINKYMA_TEST_MODEL;

describe.skipIf(!modelPath)("LlamaCppProvider (echtes Modell)", () => {
  it("antwortet im vorgegebenen JSON-Schema, nacheinander, und gibt Speicher frei", async () => {
    const provider = new LlamaCppProvider({ id: "test", displayName: "Test", modelPath: modelPath ?? "", gpu: false, idleUnloadMs: 0 });
    try {
      const request = (subject: string) => ({
        task: "categorize" as const,
        messages: [
          { role: "system" as const, content: 'Ordne die Mail einer Kategorie zu. Antworte nur mit JSON {"category": ..., "confidence": ...}.' },
          { role: "user" as const, content: `Betreff: ${subject}` },
        ],
        jsonSchema: categorizeSchema,
        // Winzige Testmodelle (CI) schreiben Zahlen Ziffer für Ziffer – genug Luft lassen
        maxTokens: 150,
      });
      // zwei Anfragen gleichzeitig: werden nacheinander abgearbeitet
      const [first, second] = await Promise.all([provider.generate(request("Ihre Rechnung 09/2026")), provider.generate(request("Grillen am Samstag?"))]);
      for (const response of [first, second]) {
        const value = extractJson(response.text) as { category?: unknown } | null;
        expect(typeof value?.category).toBe("string");
        expect(response.privacyClass).toBe("onDevice");
        expect(response.tokensOut).toBeGreaterThan(0);
      }
      expect(provider.isLoaded).toBe(true);
      await provider.unload();
      expect(provider.isLoaded).toBe(false);
      // lädt bei Bedarf neu
      await expect(provider.generate(request("Termin Dienstag 9 Uhr"))).resolves.toMatchObject({ providerId: "test" });
    } finally {
      await provider.dispose();
    }
  }, 180_000);

  it("meldet eine fehlende Modelldatei", async () => {
    const provider = new LlamaCppProvider({ id: "x", displayName: "X", modelPath: "/gibt/es/nicht.gguf", gpu: false });
    await expect(provider.generate({ task: "categorize", messages: [{ role: "user", content: "Hallo" }], maxTokens: 5 })).rejects.toThrow();
    await provider.dispose();
  });
});
