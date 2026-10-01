import { session, shell, WebContentsView, type BrowserWindow } from "electron";

// Fremde Webseite (z. B. Abmelde-Seite eines Newsletters) in einem Fenster innerhalb der App. Den Rahmen (verschiebbar,
// Hintergrund abgedunkelt) zeichnet die Oberfläche; hier liegt nur die Seite selbst – streng abgeschottet:
// - eigener Prozess mit Sandbox, kein Node, kein Preload, kein Zugriff auf die App
// - eigene Sitzung nur im Arbeitsspeicher: Cookies und Daten sind beim Schließen weg
// - nur https; keine Popups (öffnen im Standardbrowser), keine Downloads, keine Berechtigungen (Kamera, Standort …)

export interface WebPanelState {
  url: string;
  title: string;
  loading: boolean;
  error: string | null;
}

const partition = "webpanel"; // ohne „persist:“ = nur im Arbeitsspeicher

let view: WebContentsView | null = null;
let sessionPrepared = false;

function prepareSession(): void {
  if (sessionPrepared) return;
  sessionPrepared = true;
  const s = session.fromPartition(partition);
  s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  s.setPermissionCheckHandler(() => false);
  s.on("will-download", (event) => event.preventDefault());
}

export function isWebPanelUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function openWebPanel(win: BrowserWindow, url: string, onState: (state: WebPanelState | null) => void): void {
  if (!isWebPanelUrl(url)) throw new Error("Nur verschlüsselte Seiten (https) können geöffnet werden.");
  closeWebPanel(win);
  prepareSession();
  const panel = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition, javascript: true, webviewTag: false, spellcheck: false },
  });
  view = panel;
  panel.setBounds({ x: 0, y: 0, width: 0, height: 0 }); // sichtbar erst, wenn die Oberfläche den Platz meldet
  panel.setBackgroundColor("#ffffff");
  win.contentView.addChildView(panel);
  const wc = panel.webContents;
  const state: WebPanelState = { url, title: "", loading: true, error: null };
  const emit = () => {
    if (view === panel) onState({ ...state });
  };
  wc.setWindowOpenHandler(({ url: target }) => {
    if (isWebPanelUrl(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, target) => {
    if (!isWebPanelUrl(target)) event.preventDefault();
  });
  wc.on("will-redirect", (event, target) => {
    if (!isWebPanelUrl(target)) event.preventDefault();
  });
  wc.on("did-start-loading", () => {
    state.loading = true;
    state.error = null;
    emit();
  });
  wc.on("did-stop-loading", () => {
    state.loading = false;
    emit();
  });
  wc.on("did-navigate", (_event, target) => {
    state.url = target;
    emit();
  });
  wc.on("page-title-updated", (_event, title) => {
    state.title = title.slice(0, 200);
    emit();
  });
  wc.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = abgebrochen (z. B. weitergeleitet)
    state.loading = false;
    state.error = description || `Fehler ${code}`;
    emit();
  });
  emit();
  void wc.loadURL(url).catch(() => undefined);
}

export function setWebPanelBounds(bounds: { x: number; y: number; width: number; height: number }): void {
  if (!view) return;
  const clean = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
  view.setBounds({ x: clean(bounds.x), y: clean(bounds.y), width: clean(bounds.width), height: clean(bounds.height) });
}

export function closeWebPanel(win: BrowserWindow | null): void {
  const panel = view;
  if (!panel) return;
  view = null;
  try {
    win?.contentView.removeChildView(panel);
  } catch {
    // Fenster schon zu
  }
  panel.webContents.close();
  // Sitzung leeren: nichts von der fremden Seite bleibt zurück
  void session.fromPartition(partition).clearStorageData().catch(() => undefined);
}
