import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { accountsApiMethods, aiMethods, appSettingsMethods, attachmentFilesMethods, mailRepositoryMethods, rulesApiMethods, cleanupApiMethods, subscriptionsApiMethods, userCategoriesApiMethods, receiptsApiMethods, promisesApiMethods, askApiMethods } from "@stinkyma/core";

// Der Preload listet die erlaubten Methoden fest auf (er soll den Kern nicht einbündeln).
// Dieser Test sorgt dafür, dass die Liste nicht von den Schnittstellen abweicht.
const preload = readFileSync(join(__dirname, "..", "src", "preload", "index.ts"), "utf8");

function listed(name: string): string[] {
  const match = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(preload);
  return [...(match?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
}

describe("Preload-Brücke", () => {
  it("reicht genau die Methoden von MailRepository durch", () => {
    expect(listed("mailMethods").sort()).toEqual([...mailRepositoryMethods].sort());
  });

  it("reicht genau die Methoden von AccountsApi durch", () => {
    expect(listed("accountMethods").sort()).toEqual([...accountsApiMethods].sort());
  });

  it("reicht genau die Methoden für Anhänge durch", () => {
    expect(listed("fileMethods").sort()).toEqual([...attachmentFilesMethods].sort());
  });

  it("reicht genau die Methoden für App-Einstellungen durch", () => {
    expect(listed("settingsMethods").sort()).toEqual([...appSettingsMethods].sort());
  });

  it("reicht genau die Methoden für die KI durch", () => {
    expect(listed("aiMethods").sort()).toEqual([...aiMethods].sort());
  });

  it("reicht genau die Methoden für Regeln durch", () => {
    expect(listed("rulesMethods").sort()).toEqual([...rulesApiMethods].sort());
  });

  it("reicht genau die Methoden für Abos & Verträge durch", () => {
    expect(listed("subscriptionsMethods").sort()).toEqual([...subscriptionsApiMethods].sort());
  });

  it("reicht genau die Methoden für eigene Kategorien durch", () => {
    expect(listed("categoriesMethods").sort()).toEqual([...userCategoriesApiMethods].sort());
  });

  it("reicht genau die Methoden für den Belegordner durch", () => {
    expect(listed("receiptsMethods").sort()).toEqual([...receiptsApiMethods].sort());
  });

  it("reicht genau die Methoden für den Versprechen-Tracker durch", () => {
    expect(listed("promisesMethods").sort()).toEqual([...promisesApiMethods].sort());
  });

  it("reicht genau die Methoden für „Frag dein Postfach“ durch", () => {
    expect(listed("askMethods").sort()).toEqual([...askApiMethods].sort());
  });

  it("reicht genau die Methoden fürs Aufräumen durch", () => {
    expect(listed("cleanupMethods").sort()).toEqual([...cleanupApiMethods].sort());
  });
});
