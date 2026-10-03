import { describe, expect, it } from "vitest";
import { supportsQ8Cache } from "../src/llm/llamaProvider.js";

describe("Q8_0-Zwischenspeicher nur, wenn das Modell ihn kann", () => {
  it("prüft die Kopfgröße aus den GGUF-Metadaten (durch 32 teilbar)", () => {
    expect(supportsQ8Cache({ general: { architecture: "gemma4" }, gemma4: { attention: { key_length: 256 } } })).toBe(true);
    expect(supportsQ8Cache({ general: { architecture: "llama" }, llama: { embedding_length: 2048, attention: { head_count: 16 } } })).toBe(true);
    // Winziges Testmodell: 64 / 8 = 8
    expect(supportsQ8Cache({ general: { architecture: "llama" }, llama: { embedding_length: 64, attention: { head_count: 8 } } })).toBe(false);
    expect(supportsQ8Cache({})).toBe(false);
  });
});
