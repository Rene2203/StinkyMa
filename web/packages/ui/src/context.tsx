import { createContext, useContext, useSyncExternalStore } from "react";
import type { Locale, Translate } from "./i18n.js";
import type { BrowserState, BrowserStore } from "./store.js";

export interface UiContextValue {
  store: BrowserStore;
  t: Translate;
  locale: Locale;
}

export const UiContext = createContext<UiContextValue | null>(null);

export function useUi(): UiContextValue {
  const value = useContext(UiContext);
  if (!value) throw new Error("UiContext fehlt");
  return value;
}

export function useBrowserState(): BrowserState {
  const { store } = useUi();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
