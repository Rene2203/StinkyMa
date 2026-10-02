// Belegordner (W7.2): was die Oberfläche sieht und tun kann. Plattformneutral (IPC in Windows, später HTTP).

export type ReceiptStatus = "active" | "dismissed";

export interface StoredReceipt {
  id: string;
  accountId: string;
  /** Mail, aus der der Beleg stammt – null, wenn sie nicht mehr in StinkyMail liegt */
  messageId: string | null;
  merchant: string;
  /** YYYY-MM-DD */
  date: string;
  grossCents: number | null;
  netCents: number | null;
  vatCents: number | null;
  currency: string;
  invoiceNumber: string | null;
  dueDate: string | null;
  category: string | null;
  quote: string;
  /** Gründe für „bitte prüfen“ – leer, wenn alles im Text gefunden wurde */
  review: string[];
  status: ReceiptStatus;
  origin: "rules" | "onDevice" | "ownServer" | "cloud" | "user";
  userEdited: boolean;
  mailSubject: string;
  mailFrom: string;
  mailDate: string;
  /** PDF-/Bild-Anhänge der Mail (für Öffnen und Export) */
  attachments: { id: string; filename: string }[];
  reminder: { id: string; dueDate: string } | null;
}

export interface ReceiptEdit {
  merchant?: string;
  date?: string;
  grossCents?: number | null;
  netCents?: number | null;
  vatCents?: number | null;
  invoiceNumber?: string | null;
  dueDate?: string | null;
  category?: string | null;
  /** Kategorie für diesen Händler merken (künftige Belege) */
  rememberCategory?: boolean;
}

export interface ReceiptsView {
  /** Belege des gewählten Jahres (null = alle), neueste zuerst */
  items: StoredReceipt[];
  /** Jahre mit Belegen, neuestes zuerst */
  years: number[];
  categories: string[];
  /** Summen (brutto) je Kategorie im gewählten Zeitraum, ohne Ausgeblendetes; „“ = ohne Kategorie */
  totals: { category: string; cents: number; count: number }[];
  scanning: { done: number; total: number } | null;
  modelReady: boolean;
}

export interface ReceiptsApi {
  list(year: number | null): Promise<ReceiptsView>;
  /** Mails durchsuchen: Regeln sofort, das lokale Modell im Hintergrund. `recheck`: auch schon Geprüftes. */
  scan(options?: { recheck?: boolean }): Promise<{ found: number }>;
  /** „Als Beleg übernehmen“ von Hand */
  addFromMail(messageId: string): Promise<StoredReceipt>;
  update(id: string, edit: ReceiptEdit): Promise<StoredReceipt>;
  setStatus(id: string, status: ReceiptStatus): Promise<void>;
  addCategory(name: string): Promise<string[]>;
  removeCategory(name: string): Promise<string[]>;
  /** Erinnerung `daysBefore` Tage vor der Zahlungsfrist */
  remind(id: string, daysBefore: number): Promise<StoredReceipt>;
  cancelReminder(id: string): Promise<StoredReceipt>;
  /** Export eines Jahres (null = alle): ZIP mit Beleg-PDFs und CSV-Übersicht. Fragt nach dem Speicherort. */
  export(year: number | null): Promise<{ saved: boolean; count: number; missingFiles: number }>;
}

export const receiptsApiMethods = ["list", "scan", "addFromMail", "update", "setStatus", "addCategory", "removeCategory", "remind", "cancelReminder", "export"] as const satisfies readonly (keyof ReceiptsApi)[];

/** Cent → „1.299,00“ (deutsches Format, ohne Währung) */
export function formatCents(cents: number | null): string {
  if (cents === null) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${euros},${String(abs % 100).padStart(2, "0")}`;
}

/** Eingabe des Nutzers („1.299,00“, „59.00“, „48“) → Cent; leer → null */
export function centsFromInput(input: string): number | null {
  const clean = input.replace(/[€\s]|eur/gi, "");
  if (!clean) return null;
  const decimal = /[.,](\d{1,2})$/.exec(clean);
  const whole = (decimal ? clean.slice(0, -decimal[0].length) : clean).replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole)) throw new Error("Bitte einen Betrag wie 12,99 eingeben.");
  return Number(whole) * 100 + (decimal ? Number((decimal[1] ?? "0").padEnd(2, "0")) : 0);
}

function csvField(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV-Übersicht (Semikolon, deutsches Zahlenformat, mit BOM – öffnet in Excel ohne Umwege). */
export function receiptsCsv(receipts: readonly StoredReceipt[], fileNames: ReadonlyMap<string, string[]>): string {
  const header = ["Datum", "Händler", "Kategorie", "Brutto", "Netto", "MwSt", "Währung", "Rechnungsnummer", "Zahlungsfrist", "Bitte prüfen", "Dateien", "Betreff der Mail"];
  const rows = receipts.map((r) =>
    [
      r.date.split("-").reverse().join("."),
      r.merchant,
      r.category ?? "",
      formatCents(r.grossCents),
      formatCents(r.netCents),
      formatCents(r.vatCents),
      r.currency,
      r.invoiceNumber ?? "",
      r.dueDate ? r.dueDate.split("-").reverse().join(".") : "",
      r.review.join(" / "),
      (fileNames.get(r.id) ?? []).join(", "),
      r.mailSubject,
    ].map(csvField).join(";"),
  );
  return `﻿${[header.join(";"), ...rows].join("\r\n")}\r\n`;
}

/** Dateiname im Export: „2026-09-28 Technikhaus Nord – Rechnung.pdf“ (ohne verbotene Zeichen, eindeutig). */
export function exportFileName(receipt: Pick<StoredReceipt, "date" | "merchant">, original: string, taken: Set<string>): string {
  const extension = /\.[a-z0-9]{1,5}$/i.exec(original)?.[0] ?? "";
  const base = `${receipt.date} ${receipt.merchant} – ${original.replace(/\.[a-z0-9]{1,5}$/i, "")}`.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
  let name = `${base}${extension}`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})${extension}`;
  taken.add(name.toLowerCase());
  return name;
}
