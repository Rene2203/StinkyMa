import { describe, expect, it } from "vitest";
import { checkRule, createMockData, emptyRule, InMemoryMailRepository, interpretRuleWithRules, type MailRule, type RuleDefinition, type RulesApi } from "@stinkyma/core";
import { BrowserStore } from "../src/store.js";
import { describeRule } from "../src/components/RulesSection.js";
import { translator } from "../src/i18n.js";

function fakeRules() {
  const list: MailRule[] = [];
  const saved: { applyToExisting: boolean }[] = [];
  const folders = ["Verein"];
  const preview = (definition: RuleDefinition) => ({ ...checkRule(definition, { folders }), origin: null, matchCount: 2, samples: [] });
  const api: RulesApi = {
    list: async () => [...list],
    folders: async () => folders,
    interpret: async (text) => ({ ...interpretRuleWithRules(text, folders), matchCount: 2, samples: [] }),
    preview: async (definition) => preview(definition),
    save: async (input, applyToExisting) => {
      const { definition, problems } = checkRule(input.definition, { folders });
      if (problems.length) throw new Error("Error invoking remote method 'rules': Error: Die Regel braucht eine Bedingung.");
      const rule = { id: input.id ?? `r${list.length + 1}`, text: input.text, accountId: input.accountId, definition, enabled: true, createdAt: "2026-10-01T10:00:00Z" };
      const index = list.findIndex((r) => r.id === rule.id);
      if (index >= 0) list[index] = rule;
      else list.push(rule);
      saved.push({ applyToExisting });
      return rule;
    },
    setEnabled: async (id, enabled) => {
      const rule = list.find((r) => r.id === id);
      if (rule) rule.enabled = enabled;
    },
    remove: async (id) => {
      list.splice(list.findIndex((r) => r.id === id), 1);
    },
  };
  return { api, list, saved };
}

describe("Regeln in der Oberfläche", () => {
  it("Text → Entwurf mit Vorschau → von Hand ändern → speichern", async () => {
    const { api, list, saved } = fakeRules();
    const store = new BrowserStore(new InMemoryMailRepository(createMockData()), { rules: api });
    expect(store.getState().rules).toBeNull();
    await store.loadRules();
    expect(store.getState().rules).toEqual({ list: [], folders: ["Verein"], draft: null });

    await store.interpretRule("Mails vom Sportverein in Verein", null);
    let draft = store.getState().rules?.draft;
    expect(draft?.preview?.definition).toMatchObject({ from: ["Sportverein"], folder: "Verein" });
    expect(draft?.preview?.origin).toBe("rules");

    await store.changeRuleDraft({ ...draft!.preview!.definition, markRead: true });
    draft = store.getState().rules?.draft;
    expect(draft?.preview?.definition.markRead).toBe(true);
    expect(draft?.preview?.origin).toBe("rules"); // Herkunft bleibt sichtbar

    expect(await store.saveRuleDraft(true)).toBe(true);
    expect(saved).toEqual([{ applyToExisting: true }]);
    expect(store.getState().rules?.draft).toBeNull();
    expect(store.getState().rules?.list).toHaveLength(1);
    expect(list[0]?.text).toBe("Mails vom Sportverein in Verein");

    await store.setRuleEnabled("r1", false);
    expect(store.getState().rules?.list[0]?.enabled).toBe(false);
    await store.removeRule("r1");
    expect(store.getState().rules?.list).toEqual([]);
  });

  it("Fehler beim Speichern bleiben im Entwurf (ohne Electron-Vorspann)", async () => {
    const { api } = fakeRules();
    const store = new BrowserStore(new InMemoryMailRepository(createMockData()), { rules: api });
    await store.loadRules();
    await store.interpretRule("Mails vom Sportverein in Verein", null);
    await store.changeRuleDraft({ ...emptyRule, folder: "Verein" });
    expect(await store.saveRuleDraft(false)).toBe(false);
    expect(store.getState().rules?.draft?.error).toBe("Die Regel braucht eine Bedingung.");
  });

  it("beschreibt Regeln verständlich", () => {
    const t = translator("de");
    expect(describeRule({ ...emptyRule, from: ["tsv"], category: "newsletter", move: "archive", markRead: true }, t)).toEqual({
      when: "Absender enthält „tsv“ · Newsletter",
      then: "ins Archiv, als gelesen markieren",
    });
  });
});
