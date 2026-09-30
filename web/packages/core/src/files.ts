// Anhänge öffnen und speichern. Die Umsetzung ist plattformabhängig (Windows-App: Dateidialog und
// Standardprogramm; später Browser: Download) – die Oberfläche kennt nur diese Schnittstelle.

export interface AttachmentFiles {
  /** Öffnet den Anhang mit dem Standardprogramm. Ausführbare Dateien werden nie geöffnet (nur speichern). */
  open(attachmentId: string): Promise<void>;
  /** Fragt nach einem Speicherort und speichert. `false`, wenn der Nutzer abbricht. */
  save(attachmentId: string): Promise<boolean>;
}

export const attachmentFilesMethods = ["open", "save"] as const satisfies readonly (keyof AttachmentFiles)[];

/** Endungen, die Programme starten oder Skripte ausführen können – nie per Doppelklick öffnen. */
const riskyExtensions = new Set([
  "exe", "com", "bat", "cmd", "msi", "msp", "msix", "appx", "scr", "pif", "cpl", "hta", "jar", "js", "jse", "vbs", "vbe",
  "wsf", "wsh", "ps1", "psm1", "lnk", "reg", "inf", "dll", "sys", "iso", "img", "vhd", "vhdx", "url", "application", "gadget",
  "chm", "xll", "xlam", "docm", "xlsm", "pptm", "dotm", "sh", "app", "command", "pkg", "dmg",
]);

export function isRiskyAttachment(filename: string): boolean {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  return riskyExtensions.has(extension);
}

/** Dateiname ohne Pfadanteile und ohne unter Windows verbotene Zeichen. */
export function safeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim();
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned);
  return (reserved ? `_${cleaned}` : cleaned).slice(0, 200) || "Anhang";
}

/** Anhang einer neuen Mail (Inhalt als Base64, damit er durch IPC/HTTP und in den Postausgang passt). */
export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  size: number;
  contentBase64: string;
}

/** Ab dieser Gesamtgröße lehnen viele Anbieter ab (iCloud/Gmail ~20–25 MB inkl. Kodierung). */
export const attachmentWarningBytes = 18 * 1024 * 1024;
/** Harte Grenze, damit die App auf schwachen Geräten nicht mit riesigen Dateien kämpft. */
export const attachmentLimitBytes = 40 * 1024 * 1024;
