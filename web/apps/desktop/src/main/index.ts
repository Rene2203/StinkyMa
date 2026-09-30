import { app, BrowserWindow, ipcMain, Menu, nativeTheme, safeStorage, shell } from "electron";
import { join } from "node:path";
import { accountsApiMethods, createMockData, mailRepositoryMethods } from "@stinkyma/core";
import { MailService } from "@stinkyma/core/mail";
import { EncryptedFileSecretStore } from "@stinkyma/core/node";
import { MailWriter, openDatabase, seedIfEmpty, SqliteMailRepository } from "@stinkyma/core/sqlite";
import { buildMenu } from "./menu";

// Tests (und später portable Installationen) können einen eigenen Datenordner vorgeben.
if (process.env.STINKYMA_USER_DATA) app.setPath("userData", process.env.STINKYMA_USER_DATA);

// Nur eine Instanz: ein zweiter Start holt das vorhandene Fenster nach vorn.
const isPrimaryInstance = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let service: MailService | null = null;
let syncTimer: NodeJS.Timeout | null = null;

/** Abgleich alle 5 Minuten, solange die App läuft (IDLE für sofortige Zustellung folgt in W4). */
const syncIntervalMs = 5 * 60_000;

function dataPath(file: string): string {
  return join(app.getPath("userData"), file);
}

function setUpServices(): void {
  // Beim ersten Start enthält die Datenbank Beispielkonten; sie verschwinden, sobald ein echtes Konto eingerichtet wird.
  const db = openDatabase(process.env.STINKYMA_DB ?? dataPath("mail.sqlite"));
  seedIfEmpty(db, createMockData());

  // Nur für automatische Tests im Linux-Container ohne Schlüsselbund: unverschlüsselter Test-Speicher.
  // Unter Windows gilt immer DPAPI; ohne verfügbare Verschlüsselung wird nichts gespeichert.
  if (process.platform === "linux" && process.env.STINKYMA_TEST_PLAINTEXT_SECRETS === "1") {
    safeStorage.setUsePlainTextEncryption(true);
  }

  // Passwörter: mit Windows-DPAPI verschlüsselt (Electron safeStorage), an das Windows-Benutzerkonto gebunden.
  const secrets = new EncryptedFileSecretStore(dataPath("secrets.json"), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  });

  service = new MailService(new SqliteMailRepository(db), new MailWriter(db), secrets, {
    onChange: notifyRenderer,
  });
}

/** Die Oberfläche lädt neu, wenn sich Daten geändert haben (Abgleich, Aktionen, Konten). Gebündelt, um Flackern zu vermeiden. */
let notifyTimer: NodeJS.Timeout | null = null;
function notifyRenderer(): void {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    mainWindow?.webContents.send("mail:changed");
  }, 150);
}

function startSync(): void {
  void service?.syncNow();
  syncTimer = setInterval(() => void service?.syncNow(), syncIntervalMs);
}

/** IPC-Brücke: der Renderer darf nur die freigegebenen Methoden aufrufen – Mails lesen/ändern und Konten verwalten. */
function registerIpc(): void {
  const channels: [string, ReadonlySet<string>][] = [
    ["mail", new Set<string>(mailRepositoryMethods)],
    ["accounts", new Set<string>(accountsApiMethods)],
  ];
  for (const [channel, allowed] of channels) {
    ipcMain.handle(channel, async (event, method: unknown, args: unknown) => {
      if (event.senderFrame?.url && !isAppUrl(event.senderFrame.url)) throw new Error("Unbekannter Absender");
      if (typeof method !== "string" || !allowed.has(method) || !Array.isArray(args)) throw new Error("Ungültiger Aufruf");
      if (!service) throw new Error("Datenbank ist noch nicht bereit");
      const fn = (service as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!;
      return fn.apply(service, args);
    });
  }
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
  startSync();
});

app.on("before-quit", () => {
  if (syncTimer) clearInterval(syncTimer);
});
}
