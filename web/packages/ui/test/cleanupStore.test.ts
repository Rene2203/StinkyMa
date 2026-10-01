import { describe, expect, it } from "vitest";
import { createMockData, InMemoryMailRepository, type CleanupApi, type CleanupGroup, type CleanupMail, type RuleInput, type RulesApi } from "@stinkyma/core";
import { BrowserStore, cleanupSelected } from "../src/store.js";

const mail = (id: string, protect: CleanupMail["protect"] = null): CleanupMail => ({
  id, accountId: "a", from: { name: "Shop", address: "deals@shop.example" }, subject: `Mail ${id}`, date: "2026-09-20T10:00:00.000Z", unread: true, category: null, protect,
});
const group: CleanupGroup = { key: "deals@shop.example", groupBy: "address", name: "Shop", count: 3, unread: 3, protectedCount: 1, uncategorized: 3, newest: "2026-09-20", oldest: "2026-09-01", addresses: 1 };

function setup() {
  const trashed: string[][] = [];
  const queries: string[] = [];
  let mails = [mail("1"), mail("2"), mail("3", "invoice")];
  const cleanup: CleanupApi = {
    groups: async (q) => (queries.push(`${q.groupBy}:${q.accountId ?? "alle"}`), mails.length ? [{ ...group, count: mails.length }] : []),
    groupMails: async () => mails,
    trash: async (ids) => {
      trashed.push(ids);
      mails = mails.filter((m) => !ids.includes(m.id));
      return { moved: ids.length };
    },
    check: async () => ({ queued: 3 }),
  };
  const saved: RuleInput[] = [];
  const rules = {
    list: async () => [], folders: async () => [], interpret: async () => { throw new Error("nicht gebraucht"); }, preview: async () => { throw new Error("nicht gebraucht"); },
    save: async (input: RuleInput) => (saved.push(input), { id: "r1", text: input.text, accountId: input.accountId, definition: input.definition, enabled: true, createdAt: "" }),
    setEnabled: async () => undefined, remove: async () => undefined,
  } satisfies RulesApi;
  const store = new BrowserStore(new InMemoryMailRepository(createMockData(new Date("2026-09-29T10:00:00Z"))), { cleanup, rules });
  return { store, trashed, saved, queries };
}

describe("Aufräumen (Store)", () => {
  it("Vorschlag: alles außer Geschütztem; Häkchen umschalten; erst auf Klick in den Papierkorb, optional mit Regel", async () => {
    const { store, trashed, saved, queries } = setup();
    expect(store.canCleanup).toBe(true);
    await store.openCleanup();
    expect(store.getState().cleanup?.groups).toHaveLength(1);
    await store.selectCleanupGroup("deals@shop.example");
    const state = () => store.getState().cleanup!;
    const selected = () => state().group!.mails!.filter((m) => cleanupSelected(state(), m)).map((m) => m.id);
    expect(selected()).toEqual(["1", "2"]);
    expect(trashed).toEqual([]); // nichts ohne Klick

    store.toggleCleanupMail("2", false);
    store.toggleCleanupMail("3", true);
    expect(selected()).toEqual(["1", "3"]);
    store.setCleanupAll(null);
    expect(selected()).toEqual(["1", "2"]);

    await store.trashCleanupSelection(true);
    expect(trashed).toEqual([["1", "2"]]);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.definition).toMatchObject({ from: ["deals@shop.example"], move: "trash" });
    expect(state().note).toEqual({ kind: "trashed", count: 2, key: "deals@shop.example", rule: true });
    expect(state().group).toBeNull();
    expect(state().groups?.[0]?.count).toBe(1);

    await store.setCleanupView({ groupBy: "domain" });
    expect(queries.at(-1)).toBe("domain:alle");
    store.closeCleanup();
    expect(store.getState().cleanup).toBeNull();
  });

  it("„KI prüfen“ meldet, wie viele eingeordnet werden", async () => {
    const { store } = setup();
    await store.openCleanup();
    await store.selectCleanupGroup("deals@shop.example");
    await store.checkCleanupGroup();
    expect(store.getState().cleanup?.note).toEqual({ kind: "checking", count: 3 });
  });

  it("ohne Aufräum-Schnittstelle (z. B. Beispieldaten im Browser) gibt es den Knopf nicht", async () => {
    const store = new BrowserStore(new InMemoryMailRepository(createMockData(new Date())));
    expect(store.canCleanup).toBe(false);
    await store.openCleanup();
    expect(store.getState().cleanup).toBeNull();
  });
});
