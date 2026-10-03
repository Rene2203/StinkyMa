import type { AttachmentRelevance } from "../models.js";

// Test- und Kontrollsatz für die Anhang-Relevanzprüfung (W9.1). Alles erfunden; Adressen enden auf .example.
// `expect`: richtige Relevanz. Kontrollsatz geschrieben vor der Abstimmung, aber nicht zum Abstimmen benutzt.

export interface EvalAttachment {
  filename: string;
  mimeType: string;
  size: number;
  pageCount?: number;
  isInline?: boolean;
  contentId?: string | null;
  snippet?: string;
  expect: AttachmentRelevance;
}

export interface EvalAttachmentCase {
  id: string;
  from: string;
  subject: string;
  body: string;
  attachments: EvalAttachment[];
}

const pdf = "application/pdf";
const png = "image/png";
const jpg = "image/jpeg";
const agb = (name = "AGB.pdf"): EvalAttachment => ({ filename: name, mimeType: pdf, size: 180_000, pageCount: 6, snippet: "Allgemeine Geschäftsbedingungen § 1 Geltungsbereich Diese AGB gelten für alle Verträge …", expect: "irrelevant" });
const logo = (name = "image001.png"): EvalAttachment => ({ filename: name, mimeType: png, size: 8_000, isInline: true, contentId: "logo@x", expect: "irrelevant" });

export const evalAttachmentCases: EvalAttachmentCase[] = [
  {
    id: "a01", from: "Stadtwerke Musterstadt <rechnung@stadtwerke.example>", subject: "Ihre Abschlagsrechnung Oktober",
    body: "Sehr geehrte Frau Beispiel,\nanbei erhalten Sie Ihre Abschlagsrechnung für Oktober. Der Betrag wird am 15.10. abgebucht.\nMit freundlichen Grüßen",
    attachments: [
      { filename: "Abschlag_2026-10.pdf", mimeType: pdf, size: 95_000, pageCount: 2, snippet: "Stadtwerke Musterstadt Abschlagsrechnung Nr. 88123 Abschlag Strom Oktober 84,20 €", expect: "central" },
      agb("AGB_Stadtwerke.pdf"), logo(),
    ],
  },
  {
    id: "a02", from: "Tom Krause <tom@freunde.example>", subject: "Fotos vom Grillabend",
    body: "Hi Anna,\nhier ein paar Fotos von Samstag! War ein schöner Abend.\nTom",
    attachments: [
      { filename: "IMG_2041.jpg", mimeType: jpg, size: 2_400_000, expect: "central" },
      { filename: "IMG_2042.jpg", mimeType: jpg, size: 2_100_000, expect: "central" },
    ],
  },
  {
    id: "a03", from: "Shop Newsletter <news@modeshop.example>", subject: "Herbst-Sale: bis zu 50 % Rabatt!",
    body: "Nur dieses Wochenende: Jacken, Schuhe und mehr bis zu 50 % reduziert. Jetzt shoppen!",
    attachments: [
      { filename: "Prospekt_Herbst.pdf", mimeType: pdf, size: 3_400_000, pageCount: 12, snippet: "Herbst-Sale Jacken ab 39,99 € Jetzt zugreifen Gutscheincode HERBST50", expect: "irrelevant" },
      logo("banner_sale.png"),
    ],
  },
  {
    id: "a04", from: "Hausverwaltung Klein <verwaltung@hv-klein.example>", subject: "Nebenkostenabrechnung 2025",
    body: "Guten Tag,\nim Anhang finden Sie die Nebenkostenabrechnung für 2025. Die Nachzahlung ist bis zum 30.11. fällig.\nFreundliche Grüße",
    attachments: [
      { filename: "NK-Abrechnung_2025_Whg3.pdf", mimeType: pdf, size: 240_000, pageCount: 4, snippet: "Nebenkostenabrechnung 2025 Wohnung 3 Nachzahlung 312,40 €", expect: "central" },
      { filename: "Datenschutzhinweise.pdf", mimeType: pdf, size: 90_000, pageCount: 2, snippet: "Informationen nach Art. 13 DSGVO", expect: "irrelevant" },
    ],
  },
  {
    id: "a05", from: "Lena Berg <lena@agentur.example>", subject: "Präsentation für Donnerstag",
    body: "Hallo Anna,\nhier schon mal die Präsentation für Donnerstag. Schau gern drüber, ob noch was fehlt.\nLG Lena",
    attachments: [{ filename: "Kundenpitch_v3.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", size: 4_800_000, expect: "central" }],
  },
  {
    id: "a06", from: "Versicherung AG <service@versicherung.example>", subject: "Ihre neue Police",
    body: "Sehr geehrte Frau Beispiel,\nvielen Dank für Ihr Vertrauen. Beigefügt erhalten Sie Ihren Versicherungsschein sowie die Versicherungsbedingungen.",
    attachments: [
      { filename: "Versicherungsschein_VS-777888.pdf", mimeType: pdf, size: 150_000, pageCount: 3, snippet: "Versicherungsschein Nr. VS-777888 Hausratversicherung Beitrag jährlich 98,40 €", expect: "central" },
      { filename: "Versicherungsbedingungen_VHB2024.pdf", mimeType: pdf, size: 900_000, pageCount: 40, snippet: "Allgemeine Hausrat Versicherungsbedingungen (VHB 2024) Abschnitt A § 1", expect: "supporting" },
      { filename: "Produktinformationsblatt.pdf", mimeType: pdf, size: 120_000, pageCount: 2, snippet: "Informationsblatt zu Versicherungsprodukten", expect: "irrelevant" },
    ],
  },
  {
    id: "a07", from: "Deutsche Bahn <noreply@bahn.example>", subject: "Ihre Fahrkarte für den 12.10.",
    body: "Ihre Buchung ist bestätigt. Ihr Online-Ticket finden Sie im Anhang. Gute Reise!",
    attachments: [{ filename: "Ticket_ABC123.pdf", mimeType: pdf, size: 70_000, pageCount: 1, snippet: "Online-Ticket Berlin Hbf → Hamburg Hbf 12.10.2026 ICE 1001", expect: "central" }],
  },
  {
    id: "a08", from: "Petra Schulz <p.schulz@moebelhaus.example>", subject: "Re: Angebot Website-Relaunch",
    body: "Hallo Frau Beispiel,\nkurze Frage vorab: Wäre ein Start im November realistisch?\nViele Grüße\nPetra Schulz",
    attachments: [logo("image002.png"), { filename: "linkedin.png", mimeType: png, size: 3_000, isInline: true, contentId: "li@x", expect: "irrelevant" }],
  },
  {
    id: "a09", from: "Steuerbüro Klar <kanzlei@steuerbuero.example>", subject: "Ihr Einkommensteuerbescheid 2025",
    body: "Guten Tag,\nder Bescheid ist eingegangen, wir haben ihn geprüft – alles korrekt. Den Bescheid haben wir angehängt.",
    attachments: [{ filename: "Scan_20261002.pdf", mimeType: pdf, size: 600_000, pageCount: 5, snippet: "Finanzamt Musterstadt Bescheid für 2025 über Einkommensteuer Erstattung 1.204,00 €", expect: "central" }],
  },
  {
    id: "a10", from: "Max Weber <max@beispiel-firma.example>", subject: "Protokoll und Folien",
    body: "Hi zusammen,\nanbei das Protokoll vom Montag. Die Folien hänge ich zur Vollständigkeit auch noch an.\nMax",
    attachments: [
      { filename: "Protokoll_Teammeeting.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 40_000, expect: "central" },
      { filename: "Folien_Montag.pdf", mimeType: pdf, size: 2_000_000, pageCount: 18, snippet: "Teammeeting KW 40 Agenda Status", expect: "supporting" },
    ],
  },
  {
    id: "a11", from: "Online-Shop <bestellung@techshop.example>", subject: "Ihre Bestellung 4711 wurde versandt",
    body: "Ihre Bestellung ist unterwegs. Die Rechnung finden Sie im Anhang. Widerrufsbelehrung und AGB ebenfalls anbei.",
    attachments: [
      { filename: "Rechnung_4711.pdf", mimeType: pdf, size: 60_000, pageCount: 1, snippet: "Rechnung Nr. 4711 USB-C Dock 89,99 € inkl. MwSt.", expect: "central" },
      { filename: "Widerrufsbelehrung.pdf", mimeType: pdf, size: 50_000, pageCount: 1, expect: "irrelevant" },
      agb(),
    ],
  },
  {
    id: "a12", from: "Kita Sonnenschein <leitung@kita.example>", subject: "Elternbrief Oktober",
    body: "Liebe Eltern,\nim Anhang der Elternbrief für Oktober mit allen Terminen. Bitte das Formular für den Ausflug bis Freitag unterschrieben abgeben.",
    attachments: [
      { filename: "Elternbrief_Oktober.pdf", mimeType: pdf, size: 200_000, pageCount: 2, snippet: "Elternbrief Oktober Termine 14.10. Laternenfest", expect: "central" },
      { filename: "Einverstaendnis_Ausflug.pdf", mimeType: pdf, size: 80_000, pageCount: 1, snippet: "Einverständniserklärung Ausflug Zoo Name des Kindes Unterschrift", expect: "central" },
    ],
  },
  {
    id: "a13", from: "Bank <info@bank.example>", subject: "Ihr Kontoauszug September",
    body: "Sehr geehrte Kundin,\nIhr Kontoauszug für September steht bereit und ist dieser Mail beigefügt.",
    attachments: [{ filename: "Kontoauszug_2026_09.pdf", mimeType: pdf, size: 110_000, pageCount: 3, snippet: "Kontoauszug 09/2026 Kontostand alt 2.340,12 €", expect: "central" }],
  },
  {
    id: "a14", from: "Jonas Weber <jonas.weber@post.example>", subject: "Grillabend am Samstag",
    body: "Hi Anna, wir grillen am Samstag ab 18 Uhr bei uns im Garten. Kommst du? Bring gern jemanden mit.",
    attachments: [{ filename: "einladung.ics", mimeType: "text/calendar", size: 1_200, expect: "supporting" }],
  },
  {
    id: "a15", from: "Recruiting <jobs@firma.example>", subject: "Bewerbung Werkstudentin – Ihre Unterlagen",
    body: "Hallo Frau Beispiel,\nvielen Dank für Ihre Bewerbung. Anbei sende ich Ihnen den Arbeitsvertrag zur Unterschrift sowie unseren Mitarbeiter-Newsletter.",
    attachments: [
      { filename: "Arbeitsvertrag_Beispiel.pdf", mimeType: pdf, size: 140_000, pageCount: 5, snippet: "Arbeitsvertrag zwischen der Firma GmbH und Anna Beispiel", expect: "central" },
      { filename: "Newsletter_Q3.pdf", mimeType: pdf, size: 1_900_000, pageCount: 8, snippet: "Mitarbeiter-Newsletter Q3 Sommerfest Neues aus den Teams", expect: "irrelevant" },
    ],
  },
  {
    id: "a16", from: "Handwerker Meier <info@meier-bad.example>", subject: "Kostenvoranschlag Badsanierung",
    body: "Guten Tag Frau Beispiel,\nwie besprochen erhalten Sie unseren Kostenvoranschlag. Bei Fragen melden Sie sich gern.",
    attachments: [
      { filename: "KV_2026-118.pdf", mimeType: pdf, size: 130_000, pageCount: 3, snippet: "Kostenvoranschlag Nr. 2026-118 Badsanierung Gesamt 8.400,00 €", expect: "central" },
      { filename: "Referenzen_Meier.pdf", mimeType: pdf, size: 2_500_000, pageCount: 10, snippet: "Unsere Referenzen Bäder aus der Region", expect: "supporting" },
    ],
  },
];

export const evalAttachmentControl: EvalAttachmentCase[] = [
  {
    id: "k01", from: "Zahnarztpraxis <praxis@zahnarzt.example>", subject: "Privatrechnung",
    body: "Sehr geehrte Patientin,\nanbei Ihre Rechnung für die Behandlung vom 22.09.",
    attachments: [
      { filename: "Re_2026_0815.pdf", mimeType: pdf, size: 80_000, pageCount: 1, snippet: "Liquidation nach GOZ Behandlung vom 22.09.2026 Betrag 145,30 €", expect: "central" },
      logo("praxislogo.png"),
    ],
  },
  {
    id: "k02", from: "Vermieter <vermieter@haus.example>", subject: "Mietvertrag zur Unterschrift",
    body: "Hallo Frau Beispiel,\nwie besprochen der Mietvertrag. Bitte unterschreiben und zurückschicken. Die Hausordnung liegt bei.",
    attachments: [
      { filename: "Mietvertrag_Wohnung_2OG.pdf", mimeType: pdf, size: 400_000, pageCount: 9, snippet: "Mietvertrag für Wohnraum zwischen …", expect: "central" },
      { filename: "Hausordnung.pdf", mimeType: pdf, size: 60_000, pageCount: 2, snippet: "Hausordnung Ruhezeiten 22–6 Uhr Treppenhausreinigung", expect: "supporting" },
    ],
  },
  {
    id: "k03", from: "Fitnessstudio <info@fit.example>", subject: "Neue Kurse im November",
    body: "Hallo! Ab November gibt es neue Kurse: Yoga, Spinning und mehr. Den Kursplan findest du im Anhang.",
    attachments: [{ filename: "Kursplan_November.pdf", mimeType: pdf, size: 500_000, pageCount: 1, snippet: "Kursplan November Montag 18:00 Yoga", expect: "central" }],
  },
  {
    id: "k04", from: "Airline <noreply@airline.example>", subject: "Your boarding pass",
    body: "Dear passenger, please find your boarding pass attached. Have a pleasant flight.",
    attachments: [
      { filename: "BoardingPass_XY123.pdf", mimeType: pdf, size: 90_000, pageCount: 1, snippet: "Boarding Pass Flight XY123 BER → LIS Seat 14C", expect: "central" },
      { filename: "Conditions_of_Carriage.pdf", mimeType: pdf, size: 700_000, pageCount: 22, snippet: "General Conditions of Carriage Article 1 Definitions", expect: "irrelevant" },
    ],
  },
  {
    id: "k05", from: "Sara Neumann <sara@freunde.example>", subject: "Rezept",
    body: "Hey, du wolltest doch das Rezept vom Kuchen – hier ist es :)",
    attachments: [{ filename: "Apfelkuchen.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 30_000, expect: "central" }],
  },
  {
    id: "k06", from: "Kanzlei Recht <post@kanzlei.example>", subject: "Ihre Angelegenheit – Schriftsatz",
    body: "Sehr geehrte Frau Beispiel,\nzur Kenntnisnahme übersenden wir den Schriftsatz der Gegenseite. Eine Stellungnahme ist nicht erforderlich.",
    attachments: [
      { filename: "Schriftsatz_Gegenseite.pdf", mimeType: pdf, size: 300_000, pageCount: 7, snippet: "In dem Rechtsstreit … nehmen wir Stellung wie folgt", expect: "central" },
      { filename: "Datenschutzinformation_Mandanten.pdf", mimeType: pdf, size: 70_000, pageCount: 2, expect: "irrelevant" },
    ],
  },
  {
    id: "k07", from: "Verein TSV <news@tsv.example>", subject: "Vereinsnachrichten Oktober",
    body: "Liebe Mitglieder, hier die Vereinsnachrichten für Oktober. Viel Spaß beim Lesen!",
    attachments: [{ filename: "Vereinsnachrichten_10.pdf", mimeType: pdf, size: 2_200_000, pageCount: 8, snippet: "Vereinsnachrichten Oktober Jahreshauptversammlung Ergebnisse", expect: "central" }],
  },
  {
    id: "k08", from: "Paketdienst <noreply@paket.example>", subject: "Ihr Paket kommt morgen",
    body: "Ihre Sendung 00340434 wird morgen zwischen 10 und 14 Uhr zugestellt.",
    attachments: [logo("paket_logo.png"), { filename: "facebook.png", mimeType: png, size: 2_500, isInline: true, contentId: "fb@x", expect: "irrelevant" }],
  },
];
