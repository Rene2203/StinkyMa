import { describe, expect, it } from "vitest";
import { checkRule, emptyRule, evalRuleCases, evalRuleFolders, parseRuleText, ruleEquals, ruleMatches } from "../src/index.js";

describe("Regeln aus Text (ohne KI)", () => {
  for (const c of evalRuleCases) {
    it(`${c.id}: ${c.text}`, () => {
      const { definition, problems } = checkRule(parseRuleText(c.text, evalRuleFolders), { folders: evalRuleFolders, text: c.text });
      expect(problems).toEqual([]);
      expect(ruleEquals(definition, c.expected), JSON.stringify(definition)).toBe(true);
    });
  }
});

describe("Regeln: Prüfung und Treffer", () => {
  const base = { from: { name: "TSV Musterstadt", address: "news@tsv-musterstadt.example" }, subject: "Vereinsnews Oktober", category: null, hasAttachments: false };

  it("verwirft Erfundenes, verlangt Bedingung und Aktion, kennt nur vorhandene Ordner", () => {
    const invented = checkRule({ ...emptyRule, from: ["bank.example"], move: "archive" }, { folders: [], text: "Mails von der Sparkasse archivieren" });
    expect(invented.definition.from).toEqual([]);
    expect(invented.problems).toEqual(expect.arrayContaining(["notInText", "noCondition"]));
    expect(checkRule({ ...emptyRule, from: ["tsv"] }, { folders: [] }).problems).toEqual(["noAction"]);
    const folder = checkRule({ ...emptyRule, from: ["tsv"], folder: "verein", move: "archive" }, { folders: ["Verein"] });
    expect(folder.definition).toMatchObject({ folder: "Verein", move: null });
    expect(checkRule({ ...emptyRule, from: ["tsv"], folder: "Gibtsnicht" }, { folders: ["Verein"] }).problems).toEqual(["unknownFolder", "noAction"]);
  });

  it("Absender trifft Name oder Adresse; Betreff, Anhang; Einordnung kann noch fehlen", () => {
    expect(ruleMatches({ ...emptyRule, from: ["tsv musterstadt"], move: "archive" }, base)).toBe(true);
    expect(ruleMatches({ ...emptyRule, from: ["tsv-musterstadt.example"], move: "archive" }, base)).toBe(true);
    expect(ruleMatches({ ...emptyRule, from: ["sparkasse"], move: "archive" }, base)).toBe(false);
    expect(ruleMatches({ ...emptyRule, subject: ["news"], hasAttachment: true, move: "archive" }, base)).toBe(false);
    expect(ruleMatches({ ...emptyRule, from: ["tsv"], category: "newsletter", move: "archive" }, base)).toBe("waiting");
    expect(ruleMatches({ ...emptyRule, from: ["tsv"], category: "newsletter", move: "archive" }, { ...base, category: "newsletter" })).toBe(true);
    expect(ruleMatches({ ...emptyRule, from: ["tsv"], category: "invoice", move: "archive" }, { ...base, category: "newsletter" })).toBe(false);
  });
});

describe("Regeln: verschachtelte Ordner", () => {
  it("findet „INBOX/Verein“ über den letzten Teil, voller Name geht vor", () => {
    const folders = ["INBOX/Verein", "Archiv.Steuer"];
    const parsed = checkRule(parseRuleText("Mails vom Sportverein in Verein", folders), { folders, text: "Mails vom Sportverein in Verein" });
    expect(parsed.definition.folder).toBe("INBOX/Verein");
    expect(checkRule({ ...emptyRule, from: ["x"], folder: "steuer" }, { folders }).definition.folder).toBe("Archiv.Steuer");
    expect(checkRule({ ...emptyRule, from: ["x"], folder: "Verein" }, { folders: ["Verein", "INBOX/Verein"] }).definition.folder).toBe("Verein");
  });
});
