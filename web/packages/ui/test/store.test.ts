import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryMailRepository, MockIds, createMockData, isFlagged, isRead, type MailRepository } from "@stinkyma/core";
import { BrowserStore, selectedMessage, showsAccountIndicator, sidebarItem, visibleMessages } from "../src/store.js";

describe("BrowserStore", () => {
  let repo: MailRepository;
  let store: BrowserStore;

  beforeEach(async () => {
    repo = new InMemoryMailRepository(createMockData(new Date("2026-09-29T10:00:00Z")));
    store = new BrowserStore(repo);
    await store.start();
  });

  it("Seitenleiste: Übersicht plus ein Abschnitt pro Konto", () => {
    const { sections } = store.getState();
    expect(sections).toHaveLength(4);
    expect(sections[0]?.items.map((i) => i.scope.kind)).toEqual(["unifiedInbox", "unread", "flagged"]);
    expect(sections.slice(1).map((s) => s.account?.id)).toEqual([MockIds.iCloud, MockIds.gmail, MockIds.work]);
    expect(sidebarItem(store.getState(), { kind: "unifiedInbox" })?.unreadCount).toBeGreaterThan(0);
  });

  it("startet mit dem gemeinsamen Posteingang", () => {
    const state = store.getState();
    expect(state.selectedScope.kind).toBe("unifiedInbox");
    expect(state.messages.length).toBeGreaterThan(10);
    expect(showsAccountIndicator(state)).toBe(true);
  });

  it("Ordnerwechsel lädt neu und blendet die Kontofarbe aus", async () => {
    await store.selectScope({ kind: "mailbox", mailboxId: MockIds.mailbox(MockIds.work, "drafts") });
    const state = store.getState();
    expect(state.messages).toHaveLength(1);
    expect(showsAccountIndicator(state)).toBe(false);
  });

  it("Mail öffnen lädt die Konversation und markiert als gelesen", async () => {
    const unread = store.getState().messages.find((m) => !isRead(m) && m.threadId === "mock-thread-relaunch")!;
    const before = sidebarItem(store.getState(), { kind: "unifiedInbox" })!.unreadCount;
    await store.selectMessage(unread.id);
    const state = store.getState();
    expect(state.thread).toHaveLength(3);
    expect(selectedMessage(state) && isRead(selectedMessage(state)!)).toBe(true);
    expect(sidebarItem(state, { kind: "unifiedInbox" })!.unreadCount).toBe(before - 1);
    expect(isRead((await repo.message(unread.id))!)).toBe(true);
  });

  it("„Ungelesen“: geöffnete Mail bleibt nach dem Neuladen sichtbar, andere gelesene gehen", async () => {
    await store.selectScope({ kind: "unread" });
    const [first, second] = store.getState().messages;
    await store.selectMessage(first!.id);
    await store.reload(); // wie nach „mail:changed“ vom Hauptprozess
    let state = store.getState();
    expect(state.selectedMessageId).toBe(first!.id);
    expect(state.messages.some((m) => m.id === first!.id)).toBe(true);
    expect(selectedMessage(state)).not.toBeNull();

    await store.selectMessage(second!.id);
    await store.reload();
    state = store.getState();
    expect(state.messages.some((m) => m.id === first!.id)).toBe(false);
    expect(state.messages.some((m) => m.id === second!.id)).toBe(true);
  });

  it("lädt Anhänge der Konversation", async () => {
    const invoice = store.getState().messages.find((m) => m.subject === "Nebenkostenabrechnung 2025")!;
    await store.selectMessage(invoice.id);
    expect(store.getState().attachmentsByMessageId[invoice.id]?.map((a) => a.filename)).toEqual(["Nebenkosten_2025.pdf"]);
  });

  it("markieren und gelesen/ungelesen umschalten", async () => {
    const message = store.getState().messages.find((m) => !isFlagged(m) && isRead(m))!;
    await store.toggleFlag(message.id);
    expect(isFlagged(store.getState().messages.find((m) => m.id === message.id)!)).toBe(true);
    await store.toggleRead(message.id);
    expect(isRead(store.getState().messages.find((m) => m.id === message.id)!)).toBe(false);
    expect(isFlagged((await repo.message(message.id))!)).toBe(true);
  });

  it("Archivieren wählt die nächste Mail", async () => {
    const list = store.getState().messages;
    await store.selectMessage(list[0]!.id);
    await store.archive([list[0]!.id]);
    const state = store.getState();
    expect(state.messages.some((m) => m.id === list[0]!.id)).toBe(false);
    expect(state.selectedMessageId).toBe(list[1]!.id);
    expect((await repo.message(list[0]!.id))?.mailboxId).toBe(MockIds.mailbox(list[0]!.accountId, "archive"));
  });

  it("Papierkorb bei der letzten Mail wählt die vorherige", async () => {
    const list = store.getState().messages;
    const last = list.at(-1)!;
    await store.selectMessage(last.id);
    await store.moveToTrash([last.id]);
    expect(store.getState().selectedMessageId).toBe(list.at(-2)!.id);
    expect((await repo.message(last.id))?.mailboxId).toBe(MockIds.mailbox(last.accountId, "trash"));
  });

  it("Tastatur-Navigation bleibt in den Grenzen der Liste", async () => {
    const list = store.getState().messages;
    await store.moveSelection(1);
    expect(store.getState().selectedMessageId).toBe(list[0]!.id);
    await store.moveSelection(-1);
    expect(store.getState().selectedMessageId).toBe(list[0]!.id);
    await store.moveSelection(1);
    expect(store.getState().selectedMessageId).toBe(list[1]!.id);
  });

  it("Suche filtert lokal", () => {
    store.setSearchText("nebenkosten");
    expect(visibleMessages(store.getState()).map((m) => m.subject)).toEqual(["Nebenkostenabrechnung 2025"]);
    store.setSearchText("petra");
    expect(visibleMessages(store.getState())).toHaveLength(2);
    store.setSearchText("   ");
    expect(visibleMessages(store.getState())).toHaveLength(store.getState().messages.length);
  });

  it("Fehler landen im Zustand statt abzustürzen", async () => {
    const failing = new BrowserStore({
      overview: () => Promise.reject(new Error("Datenbank nicht erreichbar")),
    } as unknown as MailRepository);
    expect(failing.canManageAccounts).toBe(false);
    await failing.loadSidebar();
    expect(failing.getState().error).toBe("Datenbank nicht erreichbar");
    failing.dismissError();
    expect(failing.getState().error).toBeNull();
  });

  it("reload behält die Auswahl und markiert nichts als gelesen", async () => {
    const message = store.getState().messages.find((m) => isRead(m))!;
    await store.selectMessage(message.id);
    const unreadBefore = sidebarItem(store.getState(), { kind: "unifiedInbox" })!.unreadCount;
    await store.reload();
    expect(store.getState().selectedMessageId).toBe(message.id);
    expect(store.getState().thread.length).toBeGreaterThan(0);
    expect(sidebarItem(store.getState(), { kind: "unifiedInbox" })!.unreadCount).toBe(unreadBefore);
  });

  it("Abgleich und Konten über die Konto-Schnittstelle", async () => {
    const calls: string[] = [];
    const accounts = {
      syncNow: async () => { calls.push("sync"); },
      syncStatus: async () => ({ running: false, lastRunAt: "2026-09-30T10:00:00.000Z" }),
      testConnection: async () => ({ ok: true as const }),
      addAccount: async () => { calls.push("add"); return (await repo.accounts())[0]!; },
      removeAccount: async (id: string) => { calls.push(`remove:${id}`); },
    };
    const managed = new BrowserStore(repo, { accounts });
    await managed.start();
    expect(managed.canManageAccounts).toBe(true);
    expect(managed.getState().lastSyncAt).toBe("2026-09-30T10:00:00.000Z");
    await managed.syncNow();
    await managed.removeAccount(MockIds.gmail);
    expect(calls).toEqual(["sync", `remove:${MockIds.gmail}`]);
    expect(managed.getState().syncing).toBe(false);
  });

  it("Zähler sinken sofort beim Öffnen, noch bevor gespeichert ist", async () => {
    let release: () => void = () => undefined;
    const slow = new Proxy(repo, {
      get(target, prop, receiver) {
        if (prop === "setFlag") {
          return (...args: Parameters<MailRepository["setFlag"]>) =>
            new Promise<void>((resolve) => { release = () => resolve(target.setFlag(...args)); });
        }
        return Reflect.get(target, prop, receiver).bind(target);
      },
    });
    const s = new BrowserStore(slow);
    await s.start();
    const unread = s.getState().messages.find((m) => !isRead(m))!;
    const before = sidebarItem(s.getState(), { kind: "unifiedInbox" })!.unreadCount;
    const opening = s.selectMessage(unread.id);
    await new Promise((r) => setTimeout(r, 20));
    expect(sidebarItem(s.getState(), { kind: "unifiedInbox" })!.unreadCount).toBe(before - 1);
    expect(isRead(s.getState().messages.find((m) => m.id === unread.id)!)).toBe(true);
    release();
    await opening;
    expect(sidebarItem(s.getState(), { kind: "unifiedInbox" })!.unreadCount).toBe(before - 1);
  });

  it("Archivieren nimmt die Mail sofort aus der Liste", async () => {
    let release: () => void = () => undefined;
    const slow = new Proxy(repo, {
      get(target, prop, receiver) {
        if (prop === "move") {
          return (...args: Parameters<MailRepository["move"]>) =>
            new Promise<void>((resolve) => { release = () => resolve(target.move(...args)); });
        }
        return Reflect.get(target, prop, receiver).bind(target);
      },
    });
    const s = new BrowserStore(slow);
    await s.start();
    const first = s.getState().messages[0]!;
    const archiving = s.archive([first.id]);
    expect(s.getState().messages.some((m) => m.id === first.id)).toBe(false);
    release();
    await archiving;
    expect(s.getState().messages.some((m) => m.id === first.id)).toBe(false);
  });
});
