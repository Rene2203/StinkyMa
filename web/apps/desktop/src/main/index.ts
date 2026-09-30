import { app, BrowserWindow, ipcMain, Menu, nativeTheme, safeStorage, shell } from "electron";
import { join } from "node:path";
import { createMockData, mailRepositoryMethods, type MailRepository } from "@stinkyma/core";
import { EncryptedFileSecretStore } from "@stinkyma/core/node";
import { openDatabase, seedIfEmpty, SqliteMailRepository } from "@stinkyma/core/sqlite";
import { buildMenu } from "./menu";

// Nur eine Instanz: ein zweiter Start holt das vorhandene Fenster nach vorn.
const isPrimaryInstance = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let repository: MailRepository | null = null;

function dataPath(file: string): string {
  return join(app.getPath("userData"), file);
}

function setUpServices(): void {
  // Phase W1: eigene Demo-Datenbank mit erfundenen Beispielmails. Echte Konten bekommen später eine eigene Datei.
  const db = openDatabase(process.env.STINKYMA_DB ?? dataPath("demo.sqlite"));
  seedIfEmpty(db, createMockData());
  repository = new SqliteMailRepository(db);

  // Passwörter & Tokens: mit Windows-DPAPI verschlüsselt (Electron safeStorage). Wird ab Phase W2 genutzt.
  const secrets = new EncryptedFileSecretStore(dataPath("secrets.json"), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  });
  void secrets;
}

/** IPC-Brücke: der Renderer darf nur die Methoden der MailRepository-Schnittstelle aufrufen. */
function registerIpc(): void {
  const allowed = new Set<string>(mailRepositoryMethods);
  ipcMain.handle("mail", async (event, method: unknown, args: unknown) => {
    if (event.senderFrame?.url && !isAppUrl(event.senderFrame.url)) throw new Error("Unbekannter Absender");
    if (typeof method !== "string" || !allowed.has(method) || !Array.isArray(args)) throw new Error("Ungültiger Aufruf");
    if (!repository) throw new Error("Datenbank ist noch nicht bereit");
    const fn = repository[method as keyof MailRepository] as (...a: unknown[]) => Promise<unknown>;
    return fn.apply(repository, args);
  });
}

function isAppUrl(url: string): boolean {
  return url.startsWith("file://") || (!!process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL));
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: "StinkyMa",
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1f1f1f" : "#ffffff",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Keine fremden Seiten im App-Fenster: Links öffnen im Standardbrowser, Navigation wird blockiert.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

if (!isPrimaryInstance) {
  app.quit();
} else {
  startApp();
}

function startApp(): void {
app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.whenReady().then(() => {
  app.setAppUserModelId("de.stinkyma.app");
  setUpServices();
  registerIpc();
  Menu.setApplicationMenu(buildMenu(app.getLocale()));
  createWindow();
});
}
