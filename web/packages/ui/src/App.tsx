import type { AccountsApi, AttachmentFiles, MailRepository } from "@stinkyma/core";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { MessageDetail } from "./components/MessageDetail.js";
import { OptionsDialog } from "./components/OptionsDialog.js";
import { composeLabels } from "./composeLabels.js";
import { MessageList } from "./components/MessageList.js";
import { Sidebar } from "./components/Sidebar.js";
import { UiContext, useBrowserState, useUi } from "./context.js";
import { translator, type Locale } from "./i18n.js";
import { BrowserStore, selectedMessage } from "./store.js";

// Das Mail-Fenster (mit Editor) wird erst beim ersten Öffnen geladen – schnellerer Start auf schwachen Rechnern.
const Composer = lazy(() => import("./components/Composer.js"));

export interface AppProps {
  repository: MailRepository;
  locale: Locale;
  /** Kontoverwaltung & Abgleich (Windows-App). Fehlt in der reinen Browser-Vorschau. */
  accounts?: AccountsApi;
  /** Anhänge öffnen/speichern (Windows-App). Fehlt in der reinen Browser-Vorschau. */
  files?: AttachmentFiles;
  /** Meldet Änderungen von außen (Abgleich, Aktionen); gibt eine Abmelde-Funktion zurück. */
  subscribeChanges?: (onChange: () => void) => () => void;
}

/** Drei-Spalten-Layout: Postfächer │ Mail-Liste │ Konversation. */
export function App({ repository, locale, accounts, files, subscribeChanges }: AppProps) {
  const store = useMemo(() => new BrowserStore(repository, { accounts, files }), [repository, accounts, files]);
  const value = useMemo(() => ({ store, t: translator(locale), locale }), [store, locale]);

  useEffect(() => {
    void store.start();
  }, [store]);

  useEffect(() => subscribeChanges?.(() => void store.reload()), [store, subscribeChanges]);

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
      {state.compose && (
        <Suspense fallback={null}>
          <Composer draft={state.compose} />
        </Suspense>
      )}
      {state.options && <OptionsDialog suggestion={state.options.suggestion} onClose={() => store.closeOptions()} />}
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
  const { store, t, locale } = useUi();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (document.querySelector("dialog[open]")) return; // Kürzel nicht im Dialog
      if (event.key === "F5") {
        event.preventDefault();
        void store.syncNow();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        store.openCompose("new", composeLabels(t, locale));
        return;
      }
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
        case "n":
          event.preventDefault();
          store.openCompose("new", composeLabels(t, locale));
          break;
        case "r":
          event.preventDefault();
          store.openCompose("reply", composeLabels(t, locale));
          break;
        case "a":
          event.preventDefault();
          store.openCompose("replyAll", composeLabels(t, locale));
          break;
        case "f":
          event.preventDefault();
          store.openCompose("forward", composeLabels(t, locale));
          break;
        case "Escape":
          void store.selectMessage(null);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store, t, locale]);

  // Ausgewählte Zeile beim Blättern mit der Tastatur sichtbar halten.
  const { selectedMessageId } = useBrowserState();
  useEffect(() => {
    if (!selectedMessageId) return;
    document.querySelector(`[data-message-id="${CSS.escape(selectedMessageId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedMessageId]);
}
