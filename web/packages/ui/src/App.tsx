import type { MailRepository } from "@stinkyma/core";
import { useEffect, useMemo } from "react";
import { MessageDetail } from "./components/MessageDetail.js";
import { MessageList } from "./components/MessageList.js";
import { Sidebar } from "./components/Sidebar.js";
import { UiContext, useBrowserState, useUi } from "./context.js";
import { translator, type Locale } from "./i18n.js";
import { BrowserStore, selectedMessage } from "./store.js";

export interface AppProps {
  repository: MailRepository;
  locale: Locale;
}

/** Drei-Spalten-Layout: Postfächer │ Mail-Liste │ Konversation. */
export function App({ repository, locale }: AppProps) {
  const store = useMemo(() => new BrowserStore(repository), [repository]);
  const value = useMemo(() => ({ store, t: translator(locale), locale }), [store, locale]);

  useEffect(() => {
    void store.start();
  }, [store]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <UiContext.Provider value={value}>
      <Shell />
    </UiContext.Provider>
  );
}

function Shell() {
  const { store, t } = useUi();
  const state = useBrowserState();
  useKeyboardShortcuts();

  return (
    <div className="app">
      <Sidebar />
      <MessageList />
      <MessageDetail />
      {state.error && (
        <div className="error-banner" role="alert">
          <strong>{t("error.title")}</strong>
          <span>{state.error}</span>
          <button type="button" onClick={() => store.dismissError()}>{t("error.dismiss")}</button>
        </div>
      )}
    </div>
  );
}

/** Tastaturkürzel wie in Spark/Gmail. Nicht aktiv, solange ein Eingabefeld den Fokus hat. */
function useKeyboardShortcuts() {
  const { store } = useUi();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const message = selectedMessage(store.getState());
      switch (event.key) {
        case "ArrowDown":
        case "j":
          event.preventDefault();
          void store.moveSelection(1);
          break;
        case "ArrowUp":
        case "k":
          event.preventDefault();
          void store.moveSelection(-1);
          break;
        case "e":
          if (message) void store.archive([message.id]);
          break;
        case "Delete":
        case "#":
          if (message) void store.moveToTrash([message.id]);
          break;
        case "s":
          if (message) void store.toggleFlag(message.id);
          break;
        case "u":
          if (message) void store.toggleRead(message.id);
          break;
        case "Escape":
          void store.selectMessage(null);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store]);

  // Ausgewählte Zeile beim Blättern mit der Tastatur sichtbar halten.
  const { selectedMessageId } = useBrowserState();
  useEffect(() => {
    if (!selectedMessageId) return;
    document.querySelector(`[data-message-id="${CSS.escape(selectedMessageId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedMessageId]);
}
