import { describe, expect, it } from "vitest";
import { acceptSuggestion, currentToken } from "../src/components/AddressInput.js";

describe("Empfängerfeld", () => {
  it("findet den gerade getippten Teil – Kommas in Anführungszeichen zählen nicht", () => {
    expect(currentToken("jo")).toEqual({ start: 0, text: "jo" });
    expect(currentToken("anna@example.test, jo").text).toBe("jo");
    expect(currentToken('"Müller, Carl" <c@example.test>; be').text).toBe("be");
    expect(currentToken('"Müller, Ca').text).toBe('"Müller, Ca');
    expect(currentToken("anna@example.test, ").text).toBe("");
  });

  it("übernimmt den Vorschlag an der richtigen Stelle", () => {
    expect(acceptSuggestion("jo", { name: "Jonas Weber", address: "jonas@example.test" })).toBe("Jonas Weber <jonas@example.test>, ");
    expect(acceptSuggestion("anna@example.test, jo", { address: "jonas@example.test" })).toBe("anna@example.test, jonas@example.test, ");
  });
});
