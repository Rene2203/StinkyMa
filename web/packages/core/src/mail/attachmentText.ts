import { inflateRawSync } from "node:zlib";
import { getDocumentProxy } from "unpdf";

// Text aus Anhängen für die Suche (und später die KI). Läuft beim Abgleich, wenn die Mail ohnehin komplett
// geladen ist – kein zusätzlicher Download. Grenzen schützen schwache Rechner (Maßstab: N97, Low-End-PC).

/** Größte Datei, aus der Text gelesen wird. */
export const maxExtractBytes = 15 * 1024 * 1024;
/** Höchstens so viele PDF-Seiten. */
export const maxPdfPages = 30;
/** Längster gespeicherter Text (Zeichen). */
export const maxTextLength = 200_000;
const timeoutMs = 10_000;

export type AttachmentTextSource = "pdf" | "text" | "office";

/** Lässt sich aus diesem Anhang Text lesen? (PDF und einfache Textformate) */
export function isExtractable(filename: string, mimeType: string, size: number): boolean {
  if (size <= 0 || size > maxExtractBytes) return false;
  return sourceFor(filename, mimeType) !== null;
}

function sourceFor(filename: string, mimeType: string): AttachmentTextSource | null {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (["docx", "pptx", "xlsx"].includes(extension) || mimeType.includes("openxmlformats-officedocument")) return "office";
  if (mimeType.startsWith("text/") && !mimeType.includes("html") && !mimeType.includes("calendar") && !mimeType.includes("vcard")) return "text";
  if (["txt", "csv", "md", "log"].includes(extension)) return "text";
  return null;
}

/** Liest den Text; `null`, wenn es nichts zu lesen gibt oder das Lesen scheitert (beschädigt, verschlüsselt, zu langsam). */
export async function extractAttachmentText(attachment: {
  filename: string;
  mimeType: string;
  content: Buffer;
}): Promise<{ text: string; source: AttachmentTextSource; pageCount?: number } | { locked: true } | null> {
  const source = sourceFor(attachment.filename, attachment.mimeType);
  if (!source || attachment.content.length > maxExtractBytes) return null;
  try {
    const read =
      source === "pdf" ? await withTimeout(pdfText(attachment.content))
      : source === "office" ? officeText(attachment.content)
      : { text: attachment.content.toString("utf8"), pageCount: undefined };
    const cleaned = cleanText(read.text);
    return cleaned ? { text: cleaned, source, ...(read.pageCount ? { pageCount: read.pageCount } : {}) } : null;
  } catch (error) {
    // Passwortgeschütztes PDF: merken, nicht als Fehler behandeln
    if (error instanceof Error && error.name === "PasswordException") return { locked: true };
    return null;
  }
}

/** Seiten werden mit einem Seitenvorschub (\f) getrennt – so kann „Frag den Anhang“ Seiten angeben. */
export const pageSeparator = "\f";

function cleanText(text: string): string {
  return text.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxTextLength);
}

/** Text eines passwortgeschützten PDFs mit Passwort lesen; `null` bei falschem Passwort. */
export async function extractLockedPdfText(content: Buffer, password: string): Promise<{ text: string; pageCount: number } | null> {
  try {
    const read = await withTimeout(pdfText(content, password));
    return { text: cleanText(read.text), pageCount: read.pageCount };
  } catch {
    return null;
  }
}

async function pdfText(content: Buffer, password?: string): Promise<{ text: string; pageCount: number }> {
  // Nur Text lesen: keine Schriften laden, kein Rendern (PDF.js führt keine Skripte aus PDFs aus).
  const pdf = await getDocumentProxy(new Uint8Array(content), { disableFontFace: true, ...(password !== undefined ? { password } : {}) });
  try {
    const pages: string[] = [];
    for (let number = 1; number <= Math.min(pdf.numPages, maxPdfPages); number++) {
      const page = await pdf.getPage(number);
      const textContent = await page.getTextContent();
      pages.push(textContent.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      page.cleanup();
    }
    return { text: pages.join(`\n${pageSeparator}\n`), pageCount: pdf.numPages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Zeitüberschreitung beim Lesen des Anhangs")), timeoutMs).unref?.()),
  ]);
}

// --- Word, PowerPoint, Excel (Office Open XML): ZIP mit XML-Dateien. Nur Text, nie Makros oder eingebettete Objekte. ---

const maxEntryBytes = 30 * 1024 * 1024;

/** Dateien eines ZIP (zentrales Verzeichnis), entpackt nur auf Anfrage. Schutz vor ZIP-Bomben durch Größengrenzen. */
export function zipEntries(content: Buffer): Map<string, () => Buffer | null> {
  const entries = new Map<string, () => Buffer | null>();
  // Ende des zentralen Verzeichnisses suchen (höchstens 64 KB Kommentar)
  let end = -1;
  for (let i = content.length - 22; i >= Math.max(0, content.length - 65_557); i--) {
    if (content.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return entries;
  const count = content.readUInt16LE(end + 10);
  let offset = content.readUInt32LE(end + 16);
  for (let n = 0; n < Math.min(count, 5000) && offset + 46 <= content.length; n++) {
    if (content.readUInt32LE(offset) !== 0x02014b50) break;
    const flags = content.readUInt16LE(offset + 8);
    const method = content.readUInt16LE(offset + 10);
    const compressedSize = content.readUInt32LE(offset + 20);
    const size = content.readUInt32LE(offset + 24);
    const nameLength = content.readUInt16LE(offset + 28);
    const extraLength = content.readUInt16LE(offset + 30);
    const commentLength = content.readUInt16LE(offset + 32);
    const local = content.readUInt32LE(offset + 42);
    const name = content.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.set(name, () => {
      if (flags & 1 || size > maxEntryBytes || local + 30 > content.length) return null; // verschlüsselt oder zu groß
      const dataStart = local + 30 + content.readUInt16LE(local + 26) + content.readUInt16LE(local + 28);
      const data = content.subarray(dataStart, dataStart + compressedSize);
      try {
        if (method === 0) return Buffer.from(data);
        if (method === 8) return inflateRawSync(data, { maxOutputLength: maxEntryBytes });
      } catch {
        return null;
      }
      return null;
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function xmlText(xml: string, paragraph: RegExp): string {
  return xml
    .replace(paragraph, "\n")
    .replace(/<w:tab\/>|<a:tab\/>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n");
}

/** Text aus DOCX (Absätze), PPTX (Folien als Seiten) oder XLSX (gemeinsame Zeichenketten). */
export function officeText(content: Buffer): { text: string; pageCount?: number } {
  const entries = zipEntries(content);
  const read = (name: string) => entries.get(name)?.()?.toString("utf8") ?? "";
  if (entries.has("word/document.xml")) return { text: xmlText(read("word/document.xml"), /<\/w:p>/g) };
  const slides = [...entries.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]));
  if (slides.length) return { text: slides.map((s) => xmlText(read(s), /<\/a:p>/g)).join(`\n${pageSeparator}\n`), pageCount: slides.length };
  if (entries.has("xl/sharedStrings.xml")) return { text: xmlText(read("xl/sharedStrings.xml"), /<\/si>/g) };
  return { text: "" };
}
