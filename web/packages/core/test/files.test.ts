import { describe, expect, it } from "vitest";
import { isRiskyAttachment, safeFilename } from "../src/index.js";

describe("Anhänge", () => {
  it("erkennt ausführbare und Makro-Dateien", () => {
    for (const name of ["setup.exe", "RECHNUNG.PDF.exe", "skript.ps1", "verknüpfung.lnk", "tabelle.xlsm", "archiv.iso"]) {
      expect(isRiskyAttachment(name), name).toBe(true);
    }
    for (const name of ["rechnung.pdf", "foto.jpg", "vertrag.docx", "liste.xlsx", "notiz.txt", "ohne-endung"]) {
      expect(isRiskyAttachment(name), name).toBe(false);
    }
  });

  it("macht Dateinamen sicher: keine Pfade, keine verbotenen Zeichen, keine reservierten Namen", () => {
    expect(safeFilename("..\\\\..\\\\Windows\\\\evil.pdf")).toBe("evil.pdf");
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename('Rechnung: "März"?.pdf')).toBe("Rechnung_ _März__.pdf");
    expect(safeFilename("CON.txt")).toBe("_CON.txt");
    expect(safeFilename(".versteckt")).toBe("versteckt");
    expect(safeFilename("")).toBe("Anhang");
  });
});
