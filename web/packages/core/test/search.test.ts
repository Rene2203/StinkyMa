import { describe, expect, it } from "vitest";
import { foldText, ftsExpression, parseSearchQuery } from "../src/index.js";

describe("Suchanfrage", () => {
  it("zerlegt Wörter, Wortgruppen und von:/from:", () => {
    expect(parseSearchQuery('rechnung "neue adresse" von:stadtwerke FROM:anna')).toEqual({
      terms: ["rechnung", "neue adresse"],
      from: ["stadtwerke", "anna"],
    });
    expect(parseSearchQuery("   ")).toEqual({ terms: [], from: [] });
  });

  it("FTS5: alles als Phrase mit Wortanfang, Anführungszeichen verdoppelt", () => {
    expect(ftsExpression(parseSearchQuery('a"b von:x'))).toBe('"a""b"* AND {fromName fromAddress} : "x"*');
    expect(ftsExpression(parseSearchQuery("AND OR NOT"))).toBe('"AND"* AND "OR"* AND "NOT"*');
  });

  it("vergleicht ohne Akzente und Groß/klein", () => {
    expect(foldText("Grüße ÉTÉ")).toBe("gruße ete"); // ß bleibt (wie im FTS5-Index)
  });
});
