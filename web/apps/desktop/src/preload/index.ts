import { contextBridge, ipcRenderer } from "electron";

// Sichere Brücke zum Main-Prozess: der Renderer sieht nur `window.stinkyma.mail.<methode>(...)`.
// Kein Node.js, kein Dateizugriff im Renderer.
const methods = ["accounts", "mailboxes", "messages", "thread", "message", "attachments", "unreadCount", "setFlag", "move"];

const mail = Object.fromEntries(
  methods.map((method) => [method, (...args: unknown[]) => ipcRenderer.invoke("mail", method, args)]),
);

contextBridge.exposeInMainWorld("stinkyma", { mail, platform: process.platform });
