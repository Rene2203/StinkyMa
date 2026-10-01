import { contextBridge, ipcRenderer } from "electron";

// Sichere Brücke zum Main-Prozess. Der Renderer sieht nur `window.stinkyma` – kein Node.js, kein Dateizugriff.
const mailMethods = ["accounts", "mailboxes", "messages", "thread", "message", "attachments", "unreadCount", "overview", "setFlag", "move",
  "remoteContentExceptions", "addRemoteContentException", "removeRemoteContentException", "send", "reopenOutgoing", "saveDraft", "deleteDraft", "openDraft", "suggestAddresses", "setSignature", "search"];
const accountMethods = ["addAccount", "addOAuthAccount", "reauthorize", "oauthProviders", "testConnection", "removeAccount", "syncNow", "syncStatus"];
const fileMethods = ["open", "save", "read"];
const settingsMethods = ["get", "update", "available"];
const aiMethods = ["status", "update", "download", "cancelDownload", "deleteModel", "cachedSummary", "summarize", "downloadVision", "attachmentReading", "readAttachment"];

const bridge = (channel: string, methods: string[]) =>
  Object.fromEntries(methods.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(channel, method, args)]));

contextBridge.exposeInMainWorld("stinkyma", {
  mail: bridge("mail", mailMethods),
  accounts: bridge("accounts", accountMethods),
  files: bridge("files", fileMethods),
  settings: bridge("settings", settingsMethods),
  ai: bridge("ai", aiMethods),
  /** Meldet Änderungen (neue Mails, Abgleich, Konten). Gibt eine Abmelde-Funktion zurück. */
  onMailChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("mail:changed", listener);
    return () => ipcRenderer.removeListener("mail:changed", listener);
  },
  /** Benachrichtigung angeklickt: diese Mail öffnen. */
  onOpenMessage: (callback: (messageId: string) => void) => {
    const listener = (_event: unknown, messageId: unknown) => {
      if (typeof messageId === "string") callback(messageId);
    };
    ipcRenderer.on("mail:open", listener);
    return () => ipcRenderer.removeListener("mail:open", listener);
  },
  /** KI-Status (Download-Fortschritt, Einordnung) hat sich geändert. */
  onAIStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on("ai:status", listener);
    return () => ipcRenderer.removeListener("ai:status", listener);
  },
  platform: process.platform,
});
