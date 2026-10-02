import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, safeStorage, shell, Tray } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { totalmem } from "node:os";
import { join } from "node:path";
import {
  aiMethods,
  digestCounts,
  digestDue,
  localDay,
  rulesApiMethods,
  cleanupApiMethods,
  subscriptionsApiMethods,
  oauthProviders,
  refreshTokens,
  type OAuthClient,
  type OAuthProviderConfig,
  type OAuthProviderId,
  accountsApiMethods,
  appSettingsMethods,
  attachmentFilesMethods,
  createMockData,
  isRiskyAttachment,
  previewKind,
  previewLimitBytes,
  displayName,
  mailRepositoryMethods,
  safeFilename,
  type AppSettings,
  type AppSettingsApi,
  type AttachmentFiles,
  type Message,
} from "@stinkyma/core";
import { CleanupService, MailService, RuleService, type OAuthBroker } from "@stinkyma/core/mail";
import { AIService, ModelStore, RuntimeStore, SubscriptionService } from "@stinkyma/core/llm";
import { EncryptedFileSecretStore, signInWithLoopback } from "@stinkyma/core/node";
import { ActionStore, AIResultStore, CleanupStore, DigestStore, SubscriptionStore, MailWriter, openDatabase, RuleStore, seedIfEmpty, SqliteMailRepository } from "@stinkyma/core/sqlite";
import { buildMenu } from "./menu";
import { trayIconDataUrl, trayIconUnreadDataUrl, windowIconDataUrl } from "./icons";
import { SettingsFile } from "./settings";
import { closeWebPanel, openWebPanel, setWebPanelBounds } from "./webPanel";

// Tests (und später portable Installationen) können einen eigenen Datenordner vorgeben.
if (process.env.STINKYMA_USER_DATA) app.setPath("userData", process.env.STINKYMA_USER_DATA);
else app.setPath("userData", userDataFolder());
app.setName("StinkyMail");

/**
 * Datenordner. Die App hieß bis Oktober 2026 „StinkyMa“: Wer schon Daten hat (Konten, verschlüsselte Passwörter, Mails,
 * Modelle), behält den bisherigen Ordner – sonst wären nach dem Update alle Konten weg. Neu: %APPDATA%/StinkyMail.
 */
function userDataFolder(): string {
  const appData = app.getPath("appData");
  const earlier = [join(appData, "StinkyMa"), join(appData, "@stinkyma", "desktop")].find((dir) => existsSync(join(dir, "mail.sqlite")));
  return earlier ?? join(appData, "StinkyMail");
}

// Nur eine Instanz: ein zweiter Start holt das vorhandene Fenster nach vorn.
const isPrimaryInstance = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let service: MailService | null = null;
let ai: AIService | null = null;
let rules: RuleService | null = null;
let cleanup: CleanupService | null = null;
let subscriptions: SubscriptionService | null = null;
let syncTimer: NodeJS.Timeout | null = null;
let reminderTimer: NodeJS.Timeout | null = null;
let tray: Tray | null = null;
let settings: SettingsFile | null = null;
/** Wird gerade wirklich beendet (Menü „Beenden“, Abmelden)? Sonst schließt das Fenster nur in den Infobereich. */
let quitting = false;
/** Mit Windows gestartet: nur im Infobereich, ohne Fenster. */
const startHidden = process.argv.includes("--hidden");
const german = () => app.getLocale().startsWith("de");

/**
 * Vollständiger Abgleich aller Ordner alle 15 Minuten. Neue Mails im Posteingang kommen sofort über die
 * Wächter-Verbindung (IMAP IDLE) – der Intervall-Abgleich ist nur das Sicherheitsnetz.
 */
const syncIntervalMs = 15 * 60_000;

function dataPath(file: string): string {
  return join(app.getPath("userData"), file);
}

/**
 * Nur für automatische Tests: Anmeldeseite/Token-Endpunkt eines Test-Anbieters und GreenMail statt Gmail.
 * JSON: { authorizeUrl, tokenUrl, imap: {host, port, security}, smtp: {host, port, security} }.
 */
const testOAuth = (() => {
  try {
    return process.env.STINKYMA_TEST_OAUTH ? (JSON.parse(process.env.STINKYMA_TEST_OAUTH) as {
      authorizeUrl: string; tokenUrl: string;
      imap: { host: string; port: number; security: "tls" | "starttls" | "none" };
      smtp: { host: string; port: number; security: "tls" | "starttls" | "none" };
    }) : null;
  } catch {
    return null;
  }
})();

/** Anmeldung per Browser (OAuth) mit der in den Optionen hinterlegten App-Registrierung. */
const oauthBroker: OAuthBroker = {
  configured() {
    const clients = settings?.settings.oauthClients;
    const list: OAuthProviderId[] = [];
    if (clients?.google.clientId) list.push("google");
    if (clients?.microsoft.clientId) list.push("microsoft");
    return list;
  },
  async signIn(providerId, loginHint) {
    const { provider, client } = oauthSetup(providerId);
    const tokens = await signInWithLoopback({
      provider,
      client,
      loginHint,
      // Test: der „Browser“ folgt nur der Weiterleitung des Test-Anbieters
      openBrowser: testOAuth ? async (url) => void (await fetch(url, { redirect: "follow" })) : (url) => shell.openExternal(url),
    });
    showWindow();
    return tokens;
  },
  refresh(providerId, refreshToken) {
    const { provider, client } = oauthSetup(providerId);
    return refreshTokens(provider, client, refreshToken);
  },
};

function oauthSetup(providerId: OAuthProviderId): { provider: OAuthProviderConfig; client: OAuthClient } {
  const clients = settings?.settings.oauthClients;
  const client: OAuthClient | null =
    providerId === "google"
      ? clients?.google.clientId ? { clientId: clients.google.clientId, clientSecret: clients.google.clientSecret || undefined } : null
      : clients?.microsoft.clientId ? { clientId: clients.microsoft.clientId } : null;
  if (!client) throw new Error("Für diesen Anbieter ist keine App-Registrierung hinterlegt (Optionen → Anmeldung per Browser).");
  const base = oauthProviders[providerId];
  const provider = testOAuth ? { ...base, authorizeUrl: testOAuth.authorizeUrl, tokenUrl: testOAuth.tokenUrl } : base;
  return { provider, client };
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

  const repository = new SqliteMailRepository(db);
  service = new MailService(repository, new MailWriter(db), secrets, {
    oauth: oauthBroker,
    ...(testOAuth ? { oauthServers: { imap: testOAuth.imap, smtp: testOAuth.smtp } } : {}),
    onChange: notifyRenderer,
    onNewMail: (_accountId, messages) => showNewMailNotification(messages),
    // Regeln (W6.4) laufen vor der Benachrichtigung – Weggeräumtes meldet sich nicht
    onArrived: async (_accountId, messageIds) => {
      await rules?.arrived(messageIds);
      // Neue Mails gleich nach Abos durchsuchen (Regeln sofort, KI im Hintergrund)
      void subscriptions?.scan().catch(() => undefined);
    },
  });

  // KI: Modelle im Benutzerordner, alles läuft auf diesem Rechner. Ohne gewähltes Modell passiert nichts.
  const settingsFile = settings;
  ai = new AIService({
    store: new ModelStore(dataPath("models")),
    // Bild-Laufzeit (llama-server) erst bei Bedarf – „Bilder und Scans verstehen“ in den Optionen
    runtime: new RuntimeStore(dataPath("runtime")),
    attachmentContent: (attachmentId) => {
      if (!service) throw new Error("Datenbank ist noch nicht bereit");
      return service.attachmentContent(attachmentId);
    },
    results: new AIResultStore(db),
    actions: new ActionStore(db, () => randomUUID()),
    digest: new DigestStore(db),
    message: (messageId) => repository.message(messageId),
    onActionsUpdated: () => notifyRenderer(),
    // Kalendereintrag: .ics im Temp-Ordner ablegen und mit dem Standardprogramm (Outlook, Kalender) öffnen
    openCalendarFile: async (ics, filename) => {
      const dir = join(app.getPath("temp"), "StinkyMail-Kalender");
      mkdirSync(dir, { recursive: true });
      const path = join(dir, safeFilename(filename));
      writeFileSync(path, ics, "utf8");
      const error = await shell.openPath(path);
      if (error) throw new Error(`Der Kalender konnte nicht geöffnet werden: ${error}`);
    },
    thread: (threadId) => repository.thread(threadId),
    ownAddresses: async () => (await repository.accounts()).map((account) => account.email),
    settings: { load: () => settingsFile?.ai ?? null, save: (next) => settingsFile?.setAI(next) },
    ramGb: Math.round(totalmem() / 2 ** 30),
    onStatus: (status) => mainWindow?.webContents.send("ai:status", status),
    onCategorized: () => {
      notifyRenderer();
      // Regeln, die auf die Einordnung warten („Newsletter ins Archiv“)
      void rules?.processQueue();
    },
  });

  // Regeln in normaler Sprache: mit dem lokalen Modell gelesen, falls bereit – sonst einfache Regeln
  const mailService = service;
  const aiService = ai;
  rules = new RuleService(new RuleStore(db), mailService, {
    interpret: (text, folders, accountIds) => aiService.interpretRule(text, folders, accountIds),
    accountIds: async () => (await repository.accounts()).map((a) => a.id),
    newId: () => randomUUID(),
  });

  // Aufräumen: große Absender/Domains, löschen nur auf Klick; „KI prüfen“ ordnet die Gruppe vorrangig ein
  cleanup = new CleanupService(new CleanupStore(db), mailService, { categorize: (ids) => aiService.categorizeMessages(ids) });

  // Verträge & Abos (W7.1): Regeln sofort, lokales Modell (falls bereit) im Hintergrund; kündigt nie selbst
  subscriptions = new SubscriptionService({
    store: new SubscriptionStore(db, () => randomUUID()),
    extract: (message, attachmentText) => aiService.extractSubscription(message, attachmentText),
    modelReady: () => aiService.modelReady(),
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
    void updateTrayBadge();
    // Neue Mails einordnen (falls eingeschaltet) – läuft nacheinander im Hintergrund, Mehrfachaufrufe bündeln sich.
    ai?.categorizeInBackground();
  }, 150);
}

function startSync(): void {
  void service?.syncNow().finally(() => service?.startWatching());
  syncTimer = setInterval(() => void service?.syncNow(), syncIntervalMs);
  // Erinnerungen: jede halbe Minute fällige melden (auch wenn das Fenster im Infobereich ist)
  checkReminders();
  reminderTimer = setInterval(checkReminders, 30_000);
}

/** Fällige Erinnerungen als Windows-Benachrichtigung; Klick öffnet die Mail. */
function checkReminders(): void {
  void checkDigest();
  const due = ai?.takeDueReminders() ?? [];
  if (due.length === 0 || !Notification.isSupported()) return;
  const de = german();
  const minimal = settings?.settings.notifications === "minimal";
  for (const reminder of due) {
    // Erinnerungen hat der Nutzer selbst gesetzt – sie kommen auch bei „Benachrichtigungen aus“ (nur nicht mit Inhalt bei „minimal“)
    const notification = new Notification({
      title: de ? "Erinnerung" : "Reminder",
      body: minimal ? (de ? "Eine Erinnerung ist fällig." : "A reminder is due.") : reminder.text,
    });
    notification.on("click", () => {
      showWindow();
      if (reminder.messageId) mainWindow?.webContents.send("mail:open", reminder.messageId);
    });
    notification.show();
  }
}

/** Tagesüberblick (W6.6) als Benachrichtigung zur eingestellten Uhrzeit – einmal am Tag, nur Zahlen. Klick öffnet ihn. */
async function checkDigest(): Promise<void> {
  const time = settings?.settings.digestTime;
  if (!time || !ai || !settings || !Notification.isSupported()) return;
  const now = new Date();
  if (!digestDue(now, time, settings.text("digestShownDay"))) return;
  settings.setText("digestShownDay", localDay(now));
  try {
    const counts = digestCounts(await ai.dailyDigest());
    const de = german();
    const parts = de
      ? [counts.dueToday && `${counts.dueToday} heute fällig`, counts.overdue && `${counts.overdue} überfällig`, counts.important && `${counts.important} neue wichtige Mails`, counts.waiting && `${counts.waiting}× wartet auf dich`]
      : [counts.dueToday && `${counts.dueToday} due today`, counts.overdue && `${counts.overdue} overdue`, counts.important && `${counts.important} new important emails`, counts.waiting && `${counts.waiting}× waiting on you`];
    const body = parts.filter(Boolean).join(" · ") || (de ? "Nichts Dringendes – schönen Tag!" : "Nothing urgent – have a nice day!");
    const notification = new Notification({ title: de ? "Dein Tagesüberblick" : "Your daily overview", body });
    notification.on("click", () => {
      showWindow();
      mainWindow?.webContents.send("digest:open");
    });
    notification.show();
  } catch {
    // Tagesüberblick ist ein Extra – Fehler halten nichts auf.
  }
}

/**
 * Windows-Benachrichtigung für neue Mails – nur Absender und Betreff, nie der Inhalt. Nicht, solange das
 * Fenster im Vordergrund ist (dann sieht man die Mail ohnehin). Klick öffnet die Mail.
 */
function showNewMailNotification(messages: Message[]): void {
  const mode = settings?.settings.notifications ?? "full";
  if (mode === "off" || !Notification.isSupported() || mainWindow?.isFocused()) return;
  const [first] = messages;
  if (!first) return;
  const de = german();
  const count = messages.length;
  const notification =
    mode === "minimal"
      ? new Notification({ title: "StinkyMail", body: de ? (count === 1 ? "Neue Mail" : `${count} neue Mails`) : count === 1 ? "New email" : `${count} new emails` })
      : count === 1
        ? new Notification({ title: displayName(first.from), body: first.subject || (de ? "(kein Betreff)" : "(no subject)") })
        : new Notification({
            title: "StinkyMail",
            body: de ? `${count} neue Mails – zuletzt von ${displayName(first.from)}` : `${count} new emails – latest from ${displayName(first.from)}`,
          });
  notification.on("click", () => {
    showWindow();
    mainWindow?.webContents.send("mail:open", first.id);
  });
  notification.show();
}

function showWindow(): void {
  if (!mainWindow) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// --- Infobereich (Tray) ---

function createTray(): void {
  if (tray) return;
  tray = new Tray(nativeImage.createFromDataURL(trayIconDataUrl));
  tray.setToolTip("StinkyMail");
  const de = german();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: de ? "StinkyMail öffnen" : "Open StinkyMail", click: () => showWindow() },
      { label: de ? "Jetzt abrufen" : "Check now", click: () => void service?.syncNow() },
      { type: "separator" },
      { label: de ? "Beenden" : "Quit", click: () => quitApp() },
    ]),
  );
  tray.on("click", () => showWindow());
  void updateTrayBadge();
}

function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

/** Symbol im Infobereich zeigt, ob ungelesene Mails im Posteingang liegen (Anzahl im Tooltip). */
async function updateTrayBadge(): Promise<void> {
  if (!tray || !service) return;
  try {
    const unread = (await service.overview()).counts.unifiedInbox;
    if (!tray) return;
    tray.setImage(nativeImage.createFromDataURL(unread > 0 ? trayIconUnreadDataUrl : trayIconDataUrl));
    tray.setToolTip(unread > 0 ? `StinkyMail – ${unread} ${german() ? "ungelesen" : "unread"}` : "StinkyMail");
  } catch {
    // Datenbank kurz nicht erreichbar – beim nächsten Mal
  }
}

function quitApp(): void {
  quitting = true;
  app.quit();
}

// --- App-Einstellungen ---

const loginItemSupported = process.platform === "win32" || process.platform === "darwin";

function applyLoginItem(value: AppSettings): void {
  if (!loginItemSupported) return;
  app.setLoginItemSettings({ openAtLogin: value.launchAtLogin, args: ["--hidden"] });
}

const appSettingsApi: AppSettingsApi = {
  async get() {
    return settings!.settings;
  },
  async update(patch) {
    const next = settings!.update(patch);
    if ("launchAtLogin" in patch) applyLoginItem(next);
    if ("closeToTray" in patch) (next.closeToTray ? createTray : destroyTray)();
    return next;
  },
  async available() {
    return { closeToTray: true, launchAtLogin: loginItemSupported, notifications: Notification.isSupported(), oauthClients: true, digestTime: Notification.isSupported() };
  },
};

/** Geöffnete Anhänge landen in einem eigenen Temp-Ordner, der beim Start geleert wird. */
function attachmentTempDir(): string {
  return join(app.getPath("temp"), "StinkyMail-Anhaenge");
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
  async read(attachmentId: string) {
    if (!service) throw new Error("Datenbank ist noch nicht bereit");
    const attachment = await service.attachmentContent(attachmentId);
    if (!previewKind(attachment.filename, attachment.mimeType)) throw new Error("Dieses Format kann StinkyMail nicht selbst anzeigen.");
    if (attachment.content.length > previewLimitBytes) throw new Error("Der Anhang ist zu groß für die Vorschau – bitte mit dem Standardprogramm öffnen.");
    return { filename: attachment.filename, mimeType: attachment.mimeType, contentBase64: attachment.content.toString("base64") };
  },
};

/** IPC-Brücke: der Renderer darf nur die freigegebenen Methoden aufrufen – Mails lesen/ändern, Konten, Anhänge, KI. */
function registerIpc(): void {
  // Fremde Seite im Fenster innerhalb der App (Abmelde-Seiten) – Rahmen zeichnet die Oberfläche
  const fromApp = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => !event.senderFrame?.url || isAppUrl(event.senderFrame.url);
  ipcMain.handle("webPanel:open", (event, url: unknown) => {
    if (!fromApp(event) || typeof url !== "string" || !mainWindow) throw new Error("Ungültiger Aufruf");
    const win = mainWindow;
    openWebPanel(win, url, (state) => win.webContents.send("webPanel:state", state));
  });
  ipcMain.on("webPanel:bounds", (event, bounds: unknown) => {
    if (!fromApp(event) || !bounds || typeof bounds !== "object") return;
    const b = bounds as Record<string, unknown>;
    setWebPanelBounds({ x: Number(b.x), y: Number(b.y), width: Number(b.width), height: Number(b.height) });
  });
  ipcMain.handle("webPanel:close", (event) => {
    if (fromApp(event)) closeWebPanel(mainWindow);
  });
  ipcMain.handle("webPanel:openExternal", async (event, url: unknown) => {
    if (fromApp(event) && typeof url === "string" && url.startsWith("https://")) await shell.openExternal(url);
  });

  const channels: [string, ReadonlySet<string>, () => object | null][] = [
    ["mail", new Set<string>(mailRepositoryMethods), () => service],
    ["accounts", new Set<string>(accountsApiMethods), () => service],
    ["files", new Set<string>(attachmentFilesMethods), () => attachmentFiles],
    ["settings", new Set<string>(appSettingsMethods), () => (settings ? appSettingsApi : null)],
    ["ai", new Set<string>(aiMethods), () => ai],
    ["rules", new Set<string>(rulesApiMethods), () => rules],
    ["cleanup", new Set<string>(cleanupApiMethods), () => cleanup],
    ["subscriptions", new Set<string>(subscriptionsApiMethods), () => subscriptions],
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
    title: "StinkyMail",
    icon: nativeImage.createFromDataURL(windowIconDataUrl),
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

  mainWindow.once("ready-to-show", () => {
    if (!startHidden) mainWindow?.show();
  });

  // Schließen = im Infobereich weiterlaufen (Mails kommen weiter an), sofern eingestellt.
  mainWindow.on("close", (event) => {
    if (quitting || !settings?.settings.closeToTray || !tray) return;
    event.preventDefault();
    mainWindow?.hide();
    if (!settings.flag("trayHintShown") && Notification.isSupported()) {
      settings.setFlag("trayHintShown");
      new Notification({
        title: "StinkyMail",
        body: german()
          ? "StinkyMail läuft im Infobereich weiter. Beenden über das Symbol unten rechts – oder in den Optionen abschalten."
          : "StinkyMail keeps running in the notification area. Quit via the tray icon – or turn this off in Options.",
      }).show();
    }
  });
  mainWindow.on("closed", () => {
    closeWebPanel(null);
    mainWindow = null;
  });

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
app.on("second-instance", () => showWindow());

app.on("window-all-closed", () => {
  // Mit Infobereich läuft die App weiter; sonst beenden (außer macOS-Konvention).
  if (tray && !quitting) return;
  if (process.platform !== "darwin") app.quit();
});

app.whenReady().then(() => {
  app.setAppUserModelId("de.stinkyma.app");
  // Beim letzten Mal geöffnete Anhänge aufräumen (liegen nur temporär auf der Platte).
  rmSync(attachmentTempDir(), { recursive: true, force: true });
  settings = new SettingsFile(dataPath("settings.json"));
  applyLoginItem(settings.settings);
  setUpServices();
  registerIpc();
  Menu.setApplicationMenu(buildMenu(app.getLocale()));
  createWindow();
  if (settings.settings.closeToTray) createTray();
  startSync();
});

app.on("before-quit", () => {
  quitting = true;
  if (syncTimer) clearInterval(syncTimer);
  if (reminderTimer) clearInterval(reminderTimer);
  if (notifyTimer) clearTimeout(notifyTimer);
  // Offene IMAP-Verbindungen sofort trennen, damit die App ohne Verzögerung beendet wird.
  service?.dispose();
  void ai?.dispose();
  destroyTray();
});
}
