import { contextBridge, ipcRenderer } from "electron";

// Sichere Brücke zum Main-Prozess. Der Renderer sieht nur `window.stinkyma` – kein Node.js, kein Dateizugriff.
const mailMethods = ["accounts", "mailboxes", "messages", "thread", "message", "attachments", "unreadCount", "overview", "setFlag", "move",
  "remoteContentExceptions", "addRemoteContentException", "removeRemoteContentException", "send", "reopenOutgoing", "saveDraft", "deleteDraft", "openDraft", "suggestAddresses", "setSignature", "search", "setScreener",
  "setSyncDays", "decideSender"];
const accountMethods = ["addAccount", "addOAuthAccount", "reauthorize", "oauthProviders", "testConnection", "removeAccount", "syncNow", "syncStatus"];
const fileMethods = ["open", "save", "read"];
const settingsMethods = ["get", "update", "available"];
const rulesMethods = ["list", "folders", "interpret", "preview", "save", "setEnabled", "remove"];
const cleanupMethods = ["groups", "groupMails", "trash", "check", "unsubscribeInfo", "unsubscribe"];
const subscriptionsMethods = ["list", "scan", "addFromMail", "merge", "update", "setStatus", "remind", "cancelReminder"];
const categoriesMethods = ["list", "save", "remove", "assign"];
const receiptsMethods = ["list", "scan", "addFromMail", "update", "setStatus", "addCategory", "removeCategory", "remind", "cancelReminder", "export"];
const aiMethods = ["status", "update", "download", "cancelDownload", "deleteModel", "cachedSummary", "summarize", "downloadVision", "attachmentReading", "readAttachment", "messageActions", "setActionStatus", "remind", "cancelReminder", "addToCalendar", "replyDrafts", "dailyDigest", "resume", "setCategory", "learnedSenders", "forgetSender"];

const bridge = (channel: string, methods: string[]) =>
  Object.fromEntries(methods.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(channel, method, args)]));

contextBridge.exposeInMainWorld("stinkyma", {
  mail: bridge("mail", mailMethods),
  accounts: bridge("accounts", accountMethods),
  files: bridge("files", fileMethods),
  settings: bridge("settings", settingsMethods),
  ai: bridge("ai", aiMethods),
  rules: bridge("rules", rulesMethods),
  cleanup: bridge("cleanup", cleanupMethods),
  subscriptions: bridge("subscriptions", subscriptionsMethods),
  categories: bridge("categories", categoriesMethods),
  receipts: bridge("receipts", receiptsMethods),
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
  /** Tagesüberblick-Benachrichtigung angeklickt. */
  onOpenDigest: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("digest:open", listener);
    return () => ipcRenderer.removeListener("digest:open", listener);
  },
  /** KI-Status (Download-Fortschritt, Einordnung) hat sich geändert. */
  onAIStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on("ai:status", listener);
    return () => ipcRenderer.removeListener("ai:status", listener);
  },
  /** Fremde Seite in einem Fenster innerhalb der App (Rahmen in der Oberfläche, Seite abgeschottet im Main-Prozess). */
  webPanel: {
    open: (url: string) => ipcRenderer.invoke("webPanel:open", url),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.send("webPanel:bounds", bounds),
    close: () => ipcRenderer.invoke("webPanel:close"),
    openExternal: (url: string) => ipcRenderer.invoke("webPanel:openExternal", url),
    subscribe: (callback: (state: unknown) => void) => {
      const listener = (_event: unknown, state: unknown) => callback(state);
      ipcRenderer.on("webPanel:state", listener);
      return () => ipcRenderer.removeListener("webPanel:state", listener);
    },
  },
  platform: process.platform,
});
