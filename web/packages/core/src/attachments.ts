// Anhänge verstehen (W9, Spezifikation 7.8): Risiko-Kennzeichen und Vorfilter per Code („Stufe 0“), Relevanz-Status und
// Regeln je Absender. Erst entscheiden, dann lesen: AGB, Logos und Standardtexte verstopfen sonst das kleine
// Kontextfenster eines ~3B-Modells. Plattformneutral (kein Node, kein DOM).

import type { Attachment, AttachmentRelevance } from "./models.js";

/** Bits in `attachment.riskFlags` */
export const AttachmentRisk = {
  /** Programm oder Skript (.exe, .js, .vbs, .lnk, .iso …) */
  executable: 1,
  /** Office mit Makros (.docm, .xlsm, .pptm) */
  macro: 2,
  /** Doppelte Endung („Rechnung.pdf.exe“) */
  doubleExtension: 4,
  /** Verschlüsseltes Archiv (klassisch, um Virenscanner zu umgehen) */
  encryptedArchive: 8,
  /** HTML-Anhang mit Anmeldeformular */
  htmlLoginForm: 16,
} as const;

const executable = new Set([
  "exe", "com", "bat", "cmd", "msi", "msp", "msix", "appx", "scr", "pif", "cpl", "hta", "jar", "js", "jse", "vbs", "vbe",
  "wsf", "wsh", "ps1", "psm1", "lnk", "reg", "inf", "dll", "sys", "iso", "img", "vhd", "vhdx", "url", "application", "gadget",
  "chm", "xll", "xlam", "sh", "app", "command", "pkg", "dmg", "apk",
]);
const macro = new Set(["docm", "xlsm", "pptm", "dotm", "xltm", "potm"]);
const harmlessLooking = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|txt|rtf|csv|zip)$/i;

/**
 * Risiko-Kennzeichen eines Anhangs. `content` (falls vorhanden) wird nur auf Verschlüsselung (ZIP) und
 * Anmeldeformulare (HTML) geprüft – nie ausgeführt.
 */
export function attachmentRiskFlags(filename: string, mimeType: string, content?: Uint8Array): number {
  const name = filename.toLowerCase().trim();
  const extension = name.split(".").pop() ?? "";
  let flags = 0;
  if (executable.has(extension)) flags |= AttachmentRisk.executable;
  if (macro.has(extension)) flags |= AttachmentRisk.macro;
  const stem = name.slice(0, Math.max(0, name.length - extension.length - 1));
  if (flags & AttachmentRisk.executable && harmlessLooking.test(stem)) flags |= AttachmentRisk.doubleExtension;
  if (content && (extension === "zip" || mimeType === "application/zip") && zipIsEncrypted(content)) flags |= AttachmentRisk.encryptedArchive;
  if (content && (/^html?$/.test(extension) || mimeType === "text/html")) {
    const html = new TextDecoder("utf-8", { fatal: false }).decode(content.subarray(0, 500_000)).toLowerCase();
    if (/<form\b/.test(html) && /type\s*=\s*["']?password/.test(html)) flags |= AttachmentRisk.htmlLoginForm;
  }
  return flags;
}

/** ZIP: Bit 0 des „general purpose flag“ in einem lokalen Datei-Kopf = verschlüsselt (ZipCrypto oder AES). */
export function zipIsEncrypted(content: Uint8Array): boolean {
  const limit = Math.min(content.length - 30, 5_000_000);
  for (let i = 0; i <= limit; i++) {
    if (content[i] === 0x50 && content[i + 1] === 0x4b && content[i + 2] === 0x03 && content[i + 3] === 0x04) {
      if (((content[i + 6] ?? 0) & 1) === 1) return true;
      const nameLength = (content[i + 26] ?? 0) | ((content[i + 27] ?? 0) << 8);
      const extraLength = (content[i + 28] ?? 0) | ((content[i + 29] ?? 0) << 8);
      const compressed = (content[i + 18] ?? 0) | ((content[i + 19] ?? 0) << 8) | ((content[i + 20] ?? 0) << 16) | ((content[i + 21] ?? 0) << 24);
      // Zum nächsten Kopf springen, wenn die Größe bekannt ist (sonst Byte für Byte weitersuchen)
      if (compressed > 0) i += 29 + nameLength + extraLength + compressed;
    }
  }
  return false;
}

/** Warnungen für die Oberfläche und den Phishing-Check */
export function riskReasons(flags: number): string[] {
  const reasons: string[] = [];
  if (flags & AttachmentRisk.doubleExtension) reasons.push("doppelte Endung – ein Programm, das sich als Dokument tarnt");
  else if (flags & AttachmentRisk.executable) reasons.push("Programm oder Skript");
  if (flags & AttachmentRisk.macro) reasons.push("Office-Datei mit Makros");
  if (flags & AttachmentRisk.encryptedArchive) reasons.push("verschlüsseltes Archiv (Virenscanner können nicht hineinsehen)");
  if (flags & AttachmentRisk.htmlLoginForm) reasons.push("HTML-Datei mit Anmeldeformular");
  return reasons;
}

// --- Stufe 0: Vorfilter ohne KI ---

export interface Prefilter {
  relevance: AttachmentRelevance;
  documentType: string | null;
  reason: string;
}

const standardDocument = /\b(agb|allgemeine[ _-]?geschäftsbedingungen|geschaeftsbedingungen|datenschutz|datenschutzhinweise?|datenschutzerklärung|privacy|widerruf|widerrufsbelehrung|widerrufsformular|impressum|terms|nutzungsbedingungen|informationspflichten|vorvertragliche|produktinformationsblatt|newsletter)\b/i;
const layoutImage = /^(image\d{2,4}|logo|banner|header|footer|signatur|signature|facebook|twitter|instagram|linkedin|xing|youtube|icon|spacer|outlook-?\w*)[\w-]*\.(png|jpe?g|gif|bmp|webp)$/i;

/**
 * Was der Code ohne KI entscheiden kann: Bilder aus Signatur/Layout, Standardtexte (AGB, Datenschutz, Widerruf),
 * Kalender- und Kontaktdateien. `null`: muss die KI (oder die Regel-Prüfung) beurteilen.
 */
export function prefilterAttachment(attachment: Pick<Attachment, "filename" | "mimeType" | "size" | "isInline" | "contentId">): Prefilter | null {
  const name = attachment.filename.trim();
  const isImage = attachment.mimeType.startsWith("image/") || /\.(png|jpe?g|gif|bmp|webp|heic|tiff?)$/i.test(name);
  if (isImage && (attachment.isInline || attachment.contentId) && attachment.size < 60_000) {
    return { relevance: "irrelevant", documentType: "Bild", reason: "Bild aus Signatur oder Layout der Mail" };
  }
  if (isImage && (layoutImage.test(name) || attachment.size < 20_000)) {
    return { relevance: "irrelevant", documentType: "Bild", reason: "kleines Bild (Logo, Symbol)" };
  }
  if (standardDocument.test(name.replace(/[_.-]+/g, " "))) {
    return { relevance: "irrelevant", documentType: "Standardtext", reason: "Standardtext (AGB, Datenschutz, Widerruf o. Ä.)" };
  }
  if (/\.(ics|vcs)$/i.test(name) || attachment.mimeType === "text/calendar") {
    return { relevance: "supporting", documentType: "Einladung", reason: "Kalendereinladung (wird ohne KI gelesen)" };
  }
  if (/\.vcf$/i.test(name) || attachment.mimeType === "text/vcard" || attachment.mimeType === "text/x-vcard") {
    return { relevance: "supporting", documentType: "Kontakt", reason: "Kontaktdatei" };
  }
  if (/\.(p7s|asc|sig)$/i.test(name) || attachment.mimeType === "application/pkcs7-signature" || attachment.mimeType === "application/pgp-signature") {
    return { relevance: "irrelevant", documentType: "Signatur", reason: "digitale Signatur der Mail" };
  }
  return null;
}

// --- Status für die Oberfläche und Entscheidungen des Nutzers ---

export type AttachmentDecision = "read" | "ignore";

/** „Anhänge dieser Art von diesem Absender immer lesen/ignorieren“ */
export interface AttachmentRule {
  id: string;
  sender: string;
  /** Dokumentart („Rechnung“) oder – ohne Art – Dateiname ohne Zahlen („Kontoauszug_.pdf“) */
  match: string;
  decision: AttachmentDecision;
  createdAt: string;
}

/** Schlüssel einer Regel: Dokumentart, sonst Dateiname ohne Ziffern (Monats-Rechnungen haben wechselnde Nummern). */
export function attachmentRuleKey(attachment: Pick<Attachment, "filename" | "documentType">): string {
  if (attachment.documentType && attachment.documentType !== "Sonstiges") return attachment.documentType;
  return attachment.filename.toLowerCase().replace(/\d+/g, "").replace(/[\s_-]+/g, "_");
}

export interface AttachmentsApi {
  /** „Trotzdem lesen“ (liest sofort) oder „ist unwichtig“; `remember`: für diese Art von diesem Absender merken */
  decide(attachmentId: string, decision: AttachmentDecision, remember: boolean): Promise<void>;
  rules(): Promise<AttachmentRule[]>;
  removeRule(id: string): Promise<void>;
  /** Anhänge prüfen: neue (bzw. mit `recheck` auch schon geprüfte) – Code sofort, KI im Hintergrund */
  scan(options?: { recheck?: boolean }): Promise<{ checked: number }>;
  /**
   * Passwortgeschütztes PDF entsperren: ohne Passwort werden das gemerkte Passwort des Absenders und Kandidaten aus den
   * Mails ausprobiert; mit Passwort nur dieses. `remember`: für diesen Absender merken (Windows: DPAPI).
   */
  unlock(attachmentId: string, options?: { password?: string; remember?: boolean }): Promise<UnlockResult>;
}

export const attachmentsApiMethods = ["decide", "rules", "removeRule", "scan", "unlock"] as const satisfies readonly (keyof AttachmentsApi)[];

// --- Passwortgeschützte Anhänge (W9.3, Spezifikation 7.8.2) ---

/** Ergebnis von „Entsperren“ – das Passwort selbst verlässt den Hauptprozess nie. */
export interface UnlockResult {
  unlocked: boolean;
  /** Woher das passende Passwort kam */
  source: "remembered" | "mail" | "entered" | null;
  /** Wie viele Kandidaten ausprobiert wurden */
  tried: number;
}

const passwordCue = /\b(passwort|kennwort|password|passcode|pin|zugangscode|öffnungscode|code zum öffnen|geschützt|passwortgeschützt|verschlüsselt|protected)\b/i;
const numberCue = /\b(kundennummer|kunden-nr\.?|vertragsnummer|vertrags-nr\.?|mitgliedsnummer|versicherungsnummer|personalnummer|postleitzahl)\b\s*:?\s*([A-Z0-9][A-Z0-9-]{3,19})/gi;

/**
 * Kandidaten für ein Anhang-Passwort aus Mailtexten: „Passwort: X“, „Das Kennwort lautet X“, „PIN 1234“; nennt eine Mail
 * das Passwort-Thema, zusätzlich Kunden-/Vertragsnummern („Das Passwort ist Ihre Kundennummer“). Höchstens 10, ohne Doppelte.
 */
export function passwordCandidates(texts: string[]): string[] {
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    const value = (raw ?? "").trim().replace(/^[„“"'»«(]+|[„“"'»«).,;:!?]+$/g, "");
    if (value.length < 4 || value.length > 40 || /^(lautet|ist|is|für|fuer|der|die|das|ihre?|your|the|wird|erhalten|separat|gesondert)$/i.test(value)) return;
    if (!out.includes(value)) out.push(value);
  };
  for (const text of texts) {
    if (!passwordCue.test(text)) continue;
    // „Passwort (für das Dokument) lautet/ist/: X“
    const withVerb = /\b(?:passwort|kennwort|password|passcode|pin|zugangscode|öffnungscode)\b[^\n:=.]{0,50}?(?:\blautet\b|\bist\b|\bis\b|:|=)\s*(?:\n\s*)?[„"'»]?([^\s„“"'»«<>]{4,40})/gi;
    for (const match of text.matchAll(withVerb)) push(match[1]);
    // „PIN 4711-AB“ bzw. Passwort in der nächsten Zeile – nur Zeichenfolgen mit Ziffer (sonst ist es ein normales Wort)
    const bare = /\b(?:passwort|kennwort|password|pin)\b\s*(?:\n\s*)?([A-Za-z0-9][^\s„“"'»«<>]{3,39})/gi;
    for (const match of text.matchAll(bare)) if (/\d/.test(match[1] ?? "")) push(match[1]);
    for (const match of text.matchAll(numberCue)) if (/\d/.test(match[2] ?? "")) push(match[2]);
  }
  return out.slice(0, 10);
}
