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

export type AttachmentTextSource = "pdf" | "text";

/** Lässt sich aus diesem Anhang Text lesen? (PDF und einfache Textformate) */
export function isExtractable(filename: string, mimeType: string, size: number): boolean {
  if (size <= 0 || size > maxExtractBytes) return false;
  return sourceFor(filename, mimeType) !== null;
}

function sourceFor(filename: string, mimeType: string): AttachmentTextSource | null {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (mimeType.startsWith("text/") && !mimeType.includes("html")) return "text";
  if (["txt", "csv", "md", "log"].includes(extension)) return "text";
  return null;
}

/** Liest den Text; `null`, wenn es nichts zu lesen gibt oder das Lesen scheitert (beschädigt, verschlüsselt, zu langsam). */
export async function extractAttachmentText(attachment: {
  filename: string;
  mimeType: string;
  content: Buffer;
}): Promise<{ text: string; source: AttachmentTextSource } | null> {
  const source = sourceFor(attachment.filename, attachment.mimeType);
  if (!source || attachment.content.length > maxExtractBytes) return null;
  try {
    const text = source === "pdf" ? await withTimeout(pdfText(attachment.content)) : attachment.content.toString("utf8");
    const cleaned = text.replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxTextLength);
    return cleaned ? { text: cleaned, source } : null;
  } catch {
    return null;
  }
}

async function pdfText(content: Buffer): Promise<string> {
  // Nur Text lesen: keine Schriften laden, kein Rendern (PDF.js führt keine Skripte aus PDFs aus).
  const pdf = await getDocumentProxy(new Uint8Array(content), { disableFontFace: true });
  try {
    const pages: string[] = [];
    for (let number = 1; number <= Math.min(pdf.numPages, maxPdfPages); number++) {
      const page = await pdf.getPage(number);
      const textContent = await page.getTextContent();
      pages.push(textContent.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      page.cleanup();
    }
    return pages.join("\n\n");
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
