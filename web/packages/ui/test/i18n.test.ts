import { describe, expect, it } from "vitest";
import { pickLocale, translator } from "../src/i18n.js";
import { formatBytes } from "../src/format.js";

describe("Texte", () => {
  it("wählt Deutsch als Standard", () => {
    expect(pickLocale(["fr-FR"])).toBe("de");
    expect(pickLocale(["en-US", "de"])).toBe("en");
    expect(pickLocale(["de-AT"])).toBe("de");
  });

  it("setzt Platzhalter ein", () => {
    expect(translator("de")("list.noResults.text", { query: "xyz" })).toBe("Für „xyz“ wurde nichts gefunden.");
    expect(translator("en")("detail.pages", { count: 4 })).toBe("4 pages");
  });

  it("formatiert Dateigrößen", () => {
    expect(formatBytes(84_213, "de")).toBe("84,2 KB");
    expect(formatBytes(2_431_120, "de")).toBe("2,4 MB");
    expect(formatBytes(512, "en")).toBe("512 B");
  });
});
