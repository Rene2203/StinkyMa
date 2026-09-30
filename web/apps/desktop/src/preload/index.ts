import { contextBridge, ipcRenderer } from "electron";

// Sichere Brücke zum Main-Prozess. Der Renderer sieht nur `window.stinkyma` – kein Node.js, kein Dateizugriff.
const mailMethods = ["accounts", "mailboxes", "messages", "thread", "message", "attachments", "unreadCount", "overview", "setFlag", "move",
  "remoteContentExceptions", "addRemoteContentException", "removeRemoteContentException", "send", "reopenOutgoing", "saveDraft", "deleteDraft", "openDraft", "suggestAddresses", "setSignature"];
const accountMethods = ["addAccount", "testConnection", "removeAccount", "syncNow", "syncStatus"];
const fileMethods = ["open", "save"];

const bridge = (channel: string, methods: string[]) =>
  Object.fromEntries(methods.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke(channel, method, args)]));

contextBridge.exposeInMainWorld("stinkyma", {
  mail: bridge("mail", mailMethods),
  accounts: bridge("accounts", accountMethods),
  files: bridge("files", fileMethods),
  /** Meldet Änderungen (neue Mails, Abgleich, Konten). Gibt eine Abmelde-Funktion zurück. */
  onMailChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("mail:changed", listener);
    return () => ipcRenderer.removeListener("mail:changed", listener);
  },
  platform: process.platform,
});
