import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, shell } from "electron";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  accountsApiMethods,
  attachmentFilesMethods,
  createMockData,
  isRiskyAttachment,
  mailRepositoryMethods,
  safeFilename,
  type AttachmentFiles,
} from "@stinkyma/core";
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

/** Geöffnete Anhänge landen in einem eigenen Temp-Ordner, der beim Start geleert wird. */
function attachmentTempDir(): string {
  return join(app.getPath("temp"), "StinkyMa-Anhaenge");
}

/** Anhänge öffnen (Standardprogramm) und speichern (Dialog). Ausführbare Dateien werden nie geöffnet. */
const attachmentFiles: AttachmentFiles = {
  async open(attachmentId: string) {
    if (!service) throw new Error("Datenbank ist noch nicht bereit");
    const attachment = await service.attachmentContent(attachmentId);
    const filename = safeFilename(attachment.filename);
    if (isRiskyAttachment(filename)) {
      throw new Error(`„${filename}“ kann Programme starten und wird aus Sicherheitsgründen nicht geöffnet. Nur speichern ist möglich.`);
    }
    const dir = join(attachmentTempDir(), randomUUID());
    mkdirSync(dir, { recursive: true });
    const path = join(dir, filename);
    writeFileSync(path, attachment.content);
    const error = await shell.openPath(path);
    if (error) throw new Error(`Der Anhang konnte nicht geöffnet werden: ${error}`);
  },
  async save(attachmentId: string) {
    if (!service) throw new Error("Datenbank ist noch nicht bereit");
    const attachment = await service.attachmentContent(attachmentId);
    const options = { defaultPath: join(app.getPath("downloads"), safeFilename(attachment.filename)) };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    writeFileSync(result.filePath, attachment.content);
    return true;
  },
};

/** IPC-Brücke: der Renderer darf nur die freigegebenen Methoden aufrufen – Mails lesen/ändern, Konten, Anhänge. */
function registerIpc(): void {
  const channels: [string, ReadonlySet<string>, () => object | null][] = [
    ["mail", new Set<string>(mailRepositoryMethods), () => service],
    ["accounts", new Set<string>(accountsApiMethods), () => service],
    ["files", new Set<string>(attachmentFilesMethods), () => attachmentFiles],
  ];
  for (const [channel, allowed, target] of channels) {
    ipcMain.handle(channel, async (event, method: unknown, args: unknown) => {
      if (event.senderFrame?.url && !isAppUrl(event.senderFrame.url)) throw new Error("Unbekannter Absender");
      if (typeof method !== "string" || !allowed.has(method) || !Array.isArray(args)) throw new Error("Ungültiger Aufruf");
      const receiver = target();
      if (!receiver) throw new Error("Datenbank ist noch nicht bereit");
      const fn = (receiver as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!;
      return fn.apply(receiver, args);
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
  // Beim letzten Mal geöffnete Anhänge aufräumen (liegen nur temporär auf der Platte).
  rmSync(attachmentTempDir(), { recursive: true, force: true });
  setUpServices();
  registerIpc();
  Menu.setApplicationMenu(buildMenu(app.getLocale()));
  createWindow();
  startSync();
});

app.on("before-quit", () => {
  if (syncTimer) clearInterval(syncTimer);
  if (notifyTimer) clearTimeout(notifyTimer);
  // Offene IMAP-Verbindungen sofort trennen, damit die App ohne Verzögerung beendet wird.
  service?.dispose();
});
}
