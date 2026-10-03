import { describe, expect, it } from "vitest";
import { completionPrompt, parseCompletion, shouldComplete } from "../src/ai/complete.js";

// Testdaten erfunden.
describe("Autovervollständigung (W8.5)", () => {
  it("fragt nur nach einem fertigen Wort oder Satzzeichen", () => {
    expect(shouldComplete("Hallo Tom,\nich komme ")).toBe(true);
    expect(shouldComplete("Danke für die Info.")).toBe(true);
    expect(shouldComplete("Danke für die Inf")).toBe(false);
    expect(shouldComplete("Hallo Tom,\n")).toBe(false);
    expect(shouldComplete("Hi ")).toBe(false);
  });

  it("prüft die Modellantwort: eine Zeile, ein Satz, keine Wiederholung, keine erfundenen Zahlen oder Adressen", () => {
    const input = { before: "Hallo Tom,\nich komme gern ", after: "> Grillen am Samstag ab 18 Uhr?" };
    expect(parseCompletion("und bringe einen Salat mit.\nViele Grüße", input)).toBe("und bringe einen Salat mit.");
    expect(parseCompletion("„ich komme gern und bringe Brot mit.“", input)).toBe("und bringe Brot mit.");
    expect(parseCompletion("um 18 Uhr vorbei.", input)).toBe("um 18 Uhr vorbei.");
    expect(parseCompletion("um 19 Uhr vorbei.", input)).toBeNull();
    expect(parseCompletion("schreib mir an tom@example.test", input)).toBeNull();
    expect(parseCompletion("und bringe [Gericht] mit.", input)).toBeNull();
    expect(parseCompletion("-", input)).toBeNull();
    expect(parseCompletion("mir bitte Ersatz schicken?", { before: "Könnten Sie mir " })).toBe("bitte Ersatz schicken?");
    expect(parseCompletion("KEIN", input)).toBeNull();
    expect(parseCompletion("- und bringe Brot mit.", input)).toBe("und bringe Brot mit.");
    // Erfundene Zeitangabe in Worten; Samstag steht in der Mail und ist erlaubt
    expect(parseCompletion("um zwei Uhr.", input)).toBeNull();
    expect(parseCompletion("am Samstag.", input)).toBe("am Samstag.");
    // Neuer Satz bzw. Pronomen nach Artikel statt Fortsetzung
    expect(parseCompletion("Ich freue mich.", input)).toBeNull();
    expect(parseCompletion("ich Rechnung.", { before: "eine Frage zu meiner " })).toBeNull();
    expect(parseCompletion("Ich freue mich.", { before: "Danke. " })).toBe("Ich freue mich.");
    expect(parseCompletion("und bringe dann noch einen großen bunten Salat mit frischem Brot und etwas Obst vorbei", input)?.split(" ")).toHaveLength(12);
    // Nach einem Satzzeichen ohne Leerzeichen kommt eins dazu, vor Satzzeichen nicht
    expect(parseCompletion("Bis bald!", { before: "Klingt gut." })).toBe(" Bis bald!");
    expect(parseCompletion(", danke!", { before: "Passt" })).toBe(", danke!");
  });

  it("nimmt du/Sie aus dem Stilprofil und kürzt den Kontext", () => {
    const messages = completionPrompt({ before: "x".repeat(5000) + " Ich ", after: "y".repeat(5000) }, "Sie");
    expect(messages[0]?.content).toContain("gesiezt");
    expect(messages[1]?.content.length).toBeLessThan(2700);
  });
});
