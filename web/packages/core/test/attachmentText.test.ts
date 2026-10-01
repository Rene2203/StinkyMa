import { describe, expect, it } from "vitest";
import { extractAttachmentText, isExtractable, maxExtractBytes } from "../src/mail/index.js";
import { minimalPdf } from "./fixtures.js";

describe("Text aus Anhängen", () => {
  it("liest Text aus einem PDF", async () => {
    const result = await extractAttachmentText({ filename: "Rechnung.pdf", mimeType: "application/pdf", content: minimalPdf("Rechnung Nummer 4711 Stadtwerke") });
    expect(result).toEqual({ text: "Rechnung Nummer 4711 Stadtwerke", source: "pdf" });
  });

  it("liest Textdateien, ignoriert Bilder, HTML und Übergroßes", () => {
    expect(isExtractable("notiz.txt", "text/plain", 10)).toBe(true);
    expect(isExtractable("liste.csv", "application/octet-stream", 10)).toBe(true);
    expect(isExtractable("foto.jpg", "image/jpeg", 10)).toBe(false);
    expect(isExtractable("seite.html", "text/html", 10)).toBe(false);
    expect(isExtractable("riesig.pdf", "application/pdf", maxExtractBytes + 1)).toBe(false);
  });

  it("beschädigtes PDF: kein Text, kein Absturz", async () => {
    expect(await extractAttachmentText({ filename: "kaputt.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-1.4 kaputt") })).toBeNull();
  });
});
