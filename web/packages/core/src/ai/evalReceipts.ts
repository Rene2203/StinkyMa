import type { EvalMail } from "./evalSet.js";

// Testsatz „Belegordner“ (W7.2, geschrieben am 02.10.2026 vor der Erkennung). Alle Mails, Firmen und Nummern erfunden,
// Mail vom Mittwoch, 30.09.2026 (siehe evalMailToMessage). Erwartet wird nur, was in Mail oder Anhang steht.
// Beträge in Cent. `date`: Rechnungs-/Belegdatum, sonst das Datum der Mail. Kategorie nur, wo sie eindeutig ist.

export const receiptCategoryDefaults = [
  "Arbeitsmittel",
  "Handwerker & Dienstleistungen",
  "Spenden",
  "Versicherungen",
  "Gesundheit",
  "Haushalt & Einkauf",
  "Fahrtkosten & Reisen",
  "Sonstiges",
] as const;

export interface EvalReceiptExpected {
  /** Wortteil des Händlernamens */
  merchant: string;
  date: string;
  grossCents: number;
  netCents?: number;
  vatCents?: number;
  invoiceNumber?: string;
  dueDate?: string;
  category?: (typeof receiptCategoryDefaults)[number];
}

export interface EvalReceiptCase {
  mail: Omit<EvalMail, "expected">;
  /** Text aus dem PDF-Anhang (wie ihn die App beim Abgleich speichert) */
  attachmentText?: string;
  /** null: kein Beleg (Falle) */
  expected: EvalReceiptExpected | null;
}

const r = (id: string, name: string, address: string, subject: string, body: string, expected: EvalReceiptExpected | null, attachmentText?: string): EvalReceiptCase => ({
  mail: { id, from: { name, address }, subject, body, ...(attachmentText ? { attachments: ["Rechnung.pdf"] } : {}) },
  ...(attachmentText ? { attachmentText } : {}),
  expected,
});

export const evalReceiptCases: EvalReceiptCase[] = [
  r("rc01", "Technikhaus Nord", "rechnung@technikhaus-nord.example", "Ihre Rechnung RE-2026-11873",
    "Guten Tag, vielen Dank für Ihren Einkauf. Ihre Rechnung finden Sie im Anhang.",
    { merchant: "Technikhaus", date: "2026-09-28", grossCents: 129900, netCents: 109160, vatCents: 20740, invoiceNumber: "RE-2026-11873", category: "Arbeitsmittel" },
    "Technikhaus Nord GmbH Rechnung Rechnungsnummer: RE-2026-11873 Rechnungsdatum: 28.09.2026 1 x Notebook ProBook 14 Nettobetrag 1.091,60 € zzgl. 19 % MwSt. 207,40 € Gesamtbetrag 1.299,00 € Bezahlt per PayPal."),
  r("rc02", "Heizung Schröder", "buero@heizung-schroeder.example", "Rechnung Heizungswartung",
    "Sehr geehrte Frau Beispiel, anbei unsere Rechnung Nr. 2026-0412 vom 25.09.2026 für die Wartung Ihrer Gastherme. Arbeitskosten 142,00 €, Material 38,50 €, zzgl. 19 % MwSt. 34,30 €, Gesamtbetrag 214,80 €. Zahlbar bis 09.10.2026 ohne Abzug.",
    { merchant: "Schröder", date: "2026-09-25", grossCents: 21480, vatCents: 3430, invoiceNumber: "2026-0412", dueDate: "2026-10-09", category: "Handwerker & Dienstleistungen" }),
  r("rc03", "Tierhilfe Musterstadt e.V.", "spenden@tierhilfe-musterstadt.example", "Ihre Zuwendungsbestätigung",
    "Liebe Anna, herzlichen Dank für Ihre Spende über 50,00 € vom 12.09.2026. Die Zuwendungsbestätigung für das Finanzamt finden Sie im Anhang.",
    { merchant: "Tierhilfe", date: "2026-09-12", grossCents: 5000, category: "Spenden" }),
  r("rc04", "Apotheke am Markt", "kasse@apotheke-am-markt.example", "Ihr Kassenbeleg",
    "Ihr digitaler Kassenbeleg vom 29.09.2026: Ibuprofen 400, Nasenspray. Summe 14,85 € (inkl. 7 % MwSt. 0,97 €). Bezahlt mit Karte.",
    { merchant: "Apotheke", date: "2026-09-29", grossCents: 1485, vatCents: 97, category: "Gesundheit" }),
  r("rc05", "Wohnwelt Online", "service@wohnwelt-online.example", "Bestellbestätigung 778120",
    "Vielen Dank für Ihre Bestellung 778120 vom 27.09.2026! Artikel: Stehlampe Lino (1x) 89,99 €, Versand 4,95 €. Gesamtsumme: 94,94 €. Die Lieferung erfolgt in 3–5 Werktagen.",
    { merchant: "Wohnwelt", date: "2026-09-27", grossCents: 9494, category: "Haushalt & Einkauf" }),
  r("rc06", "Bahn-Tickets", "tickets@bahn-tickets.example", "Ihre Buchung und Rechnung",
    "Ihre Fahrkarte München Hbf – Nürnberg Hbf am 14.10.2026. Preis: 39,90 € (inkl. 7 % MwSt.). Rechnungsnummer 5512-883-2026.",
    { merchant: "Bahn", date: "2026-09-30", grossCents: 3990, invoiceNumber: "5512-883-2026", category: "Fahrtkosten & Reisen" }),
  r("rc07", "Stadtwerke Musterstadt", "rechnung@stadtwerke-musterstadt.example", "Ihre Jahresabrechnung Strom 2026",
    "Ihre Jahresabrechnung vom 22.09.2026, Rechnungsnummer 4400112233. Verbrauch 2.410 kWh. Gesamtbetrag 912,40 €. Nach Abzug Ihrer Abschläge (870,00 €) ergibt sich eine Nachzahlung von 42,40 €, fällig am 15.10.2026.",
    { merchant: "Stadtwerke", date: "2026-09-22", grossCents: 91240, invoiceNumber: "4400112233", dueDate: "2026-10-15", category: "Haushalt & Einkauf" }),
  r("rc08", "Softwareladen", "orders@softwareladen.example", "Receipt for your order #SL-48122",
    "Thanks for your purchase! Order #SL-48122 on September 26, 2026. PhotoKit Pro license (1 year): €59.00. VAT (19%): €9.42 included. Total paid: €59.00.",
    { merchant: "Softwareladen", date: "2026-09-26", grossCents: 5900, vatCents: 942, invoiceNumber: "SL-48122", category: "Arbeitsmittel" }),
  r("rc09", "KfzSicher Versicherung", "kunden@kfzsicher.example", "Beitragsrechnung 2027",
    "Ihre Beitragsrechnung für die Kfz-Haftpflicht, Versicherungsschein KH-55120. Jahresbeitrag 2027: 412,80 € (inkl. 19 % Versicherungsteuer). Der Betrag wird am 02.01.2027 abgebucht.",
    { merchant: "KfzSicher", date: "2026-09-30", grossCents: 41280, dueDate: "2027-01-02", category: "Versicherungen" }),
  r("rc10", "Malerbetrieb Farbig", "info@malerbetrieb-farbig.example", "Schlussrechnung Wohnzimmer",
    "Hallo Frau Beispiel, wie besprochen die Schlussrechnung für die Malerarbeiten im Wohnzimmer.",
    { merchant: "Farbig", date: "2026-09-24", grossCents: 107100, netCents: 90000, vatCents: 17100, invoiceNumber: "SR-0921", dueDate: "2026-10-08", category: "Handwerker & Dienstleistungen" },
    "Malerbetrieb Farbig Schlussrechnung Nr. SR-0921 Datum 24.09.2026 Malerarbeiten Wohnzimmer Lohnanteil 720,00 € Material 180,00 € Netto 900,00 € MwSt 19 % 171,00 € Brutto 1.071,00 € Bitte überweisen Sie den Betrag bis zum 08.10.2026."),
  r("rc11", "Taxi Sonne", "beleg@taxi-sonne.example", "Ihre Fahrtquittung",
    "Fahrt am 18.09.2026, Hauptbahnhof → Messe. Fahrpreis 23,60 €, Trinkgeld 2,40 €, gesamt 26,00 €. Vielen Dank!",
    { merchant: "Taxi", date: "2026-09-18", grossCents: 2600, category: "Fahrtkosten & Reisen" }),
  r("rc12", "Zahnarztpraxis Lächeln", "abrechnung@praxis-laecheln.example", "Privatrechnung Zahnreinigung",
    "Anbei Ihre Rechnung für die professionelle Zahnreinigung vom 10.09.2026 über 96,00 €. Rechnungsnummer PZR-3381. Bitte überweisen Sie den Betrag innerhalb von 30 Tagen.",
    { merchant: "Lächeln", date: "2026-09-10", grossCents: 9600, invoiceNumber: "PZR-3381", category: "Gesundheit" }),
  r("rc13", "Paketladen24", "noreply@paketladen24.example", "Zahlungsbestätigung",
    "Wir haben Ihre Zahlung über 18,49 € für die Bestellung PL-90012 erhalten. Ihre Bestellung wird jetzt verpackt.",
    { merchant: "Paketladen", date: "2026-09-30", grossCents: 1849, invoiceNumber: "PL-90012" }),
  r("rc14", "Druckerpatronen-Shop", "rechnung@patronen-shop.example", "Rechnung zu Ihrer Bestellung",
    "Rechnung 2026/7781 vom 21.09.2026. 2 x Tintenpatrone Schwarz XL à 17,95 €. Zwischensumme 35,90 €, Versand 0,00 €. Rechnungsbetrag 35,90 €. Der Betrag wurde per Lastschrift eingezogen.",
    { merchant: "Patronen", date: "2026-09-21", grossCents: 3590, invoiceNumber: "2026/7781", category: "Arbeitsmittel" }),
  // Fallen: kein Beleg
  r("rc15", "Wohnwelt Online", "news@wohnwelt-online.example", "Herbst-Sale: bis zu 40 % sparen",
    "Sofas ab 499,00 €, Stehlampen ab 39,99 €. Nur bis Sonntag! Jetzt shoppen.", null),
  r("rc16", "Heizung Schröder", "buero@heizung-schroeder.example", "Angebot neue Heizungspumpe",
    "Sehr geehrte Frau Beispiel, für den Tausch der Heizungspumpe bieten wir Ihnen an: 480,00 € zzgl. MwSt. Das Angebot gilt 30 Tage.", null),
  r("rc17", "Paketdienst", "noreply@paketdienst.example", "Ihr Paket ist unterwegs",
    "Ihre Sendung 0034 5521 9900 wird morgen zwischen 10 und 14 Uhr zugestellt.", null),
  r("rc18", "PayFix Sicherheit", "security@payfix-konto.example", "Offene Rechnung – Konto wird gesperrt",
    "Ihre Rechnung über 249,99 € ist überfällig. Begleichen Sie den Betrag innerhalb von 24 Stunden über den folgenden Link, sonst wird Ihr Konto gesperrt.", null),
  r("rc19", "Lena", "lena@mailbox.example", "Pizza gestern",
    "Hey, du schuldest mir noch 12,50 € von der Pizza gestern 😄 Überweis einfach, wenn's passt.", null),
  r("rc20", "Bank Musterstadt", "service@bank-musterstadt.example", "Ihr Kontoauszug September",
    "Ihr Kontoauszug für September steht im Online-Banking bereit. Kontostand am 30.09.: 2.431,18 €.", null),
];

// Kontrollsatz (geschrieben am 02.10.2026 nach dem Testsatz, vor der Erkennung): andere Formulierungen, mehr Englisch,
// Beträge nur im PDF, Stornos.
export const evalReceiptHoldout: EvalReceiptCase[] = [
  r("rh01", "Büromöbel Ergo", "invoice@ergo-bueromoebel.example", "Invoice INV-55821",
    "Please find attached your invoice. Thank you for your order.",
    { merchant: "Ergo", date: "2026-09-23", grossCents: 54900, netCents: 46134, vatCents: 8766, invoiceNumber: "INV-55821", dueDate: "2026-10-07", category: "Arbeitsmittel" },
    "Büromöbel Ergo GmbH INVOICE INV-55821 Invoice date 23/09/2026 Ergonomic desk chair 1 pc Net amount EUR 461.34 VAT 19% EUR 87.66 Total EUR 549.00 Payment due by 07/10/2026."),
  r("rh02", "Gärtnerei Grün", "kontakt@gaertnerei-gruen.example", "Rechnung Gartenpflege September",
    "Hallo, hier unsere Rechnung für die Gartenpflege im September: 6 Stunden à 38,00 € = 228,00 € netto, zzgl. 19 % USt. 43,32 €, gesamt 271,32 €. Rechnungsnr. GP-0926. Zahlungsziel: 14 Tage.",
    { merchant: "Grün", date: "2026-09-30", grossCents: 27132, netCents: 22800, vatCents: 4332, invoiceNumber: "GP-0926", category: "Handwerker & Dienstleistungen" }),
  r("rh03", "Kinderhilfswerk", "service@kinderhilfswerk.example", "Danke für Ihre Spende",
    "Wir bestätigen den Eingang Ihrer Spende in Höhe von 100,00 € am 05.09.2026. Eine Sammelbestätigung erhalten Sie im Januar.",
    { merchant: "Kinderhilfswerk", date: "2026-09-05", grossCents: 10000, category: "Spenden" }),
  r("rh04", "Optiker Klarblick", "info@klarblick.example", "Ihre Rechnung",
    "Vielen Dank für Ihren Besuch.",
    { merchant: "Klarblick", date: "2026-09-19", grossCents: 31800, invoiceNumber: "KB-19092", category: "Gesundheit" },
    "Optiker Klarblick Rechnung KB-19092 vom 19.09.2026 Gleitsichtgläser 2 Stück 278,00 € Fassung 40,00 € Summe 318,00 € inkl. 19 % MwSt. Betrag dankend erhalten."),
  r("rh05", "Hausrat Plus", "post@hausrat-plus.example", "Ihre Beitragsrechnung",
    "Für Ihre Hausratversicherung (Vertrag HR-77213) wird der Jahresbeitrag von 118,60 € am 01.11.2026 fällig.",
    { merchant: "Hausrat", date: "2026-09-30", grossCents: 11860, dueDate: "2026-11-01", category: "Versicherungen" }),
  r("rh06", "Mietwagen Flink", "billing@flink-rent.example", "Your rental receipt",
    "Rental 12–15 Sep 2026, Lisbon Airport. Total charged: €186.40 incl. VAT. Receipt no. FR-7720.",
    { merchant: "Flink", date: "2026-09-30", grossCents: 18640, invoiceNumber: "FR-7720", category: "Fahrtkosten & Reisen" }),
  r("rh07", "Baumarkt Hammer", "kassenbon@baumarkt-hammer.example", "Ihr digitaler Kassenbon",
    "Einkauf am 26.09.2026 in Filiale Musterstadt: Akkuschrauber 79,99 €, Bits-Set 12,99 €. Summe 92,98 €. Gezahlt: EC-Karte.",
    { merchant: "Hammer", date: "2026-09-26", grossCents: 9298, category: "Haushalt & Einkauf" }),
  r("rh08", "Streamflix", "no-reply@streamflix.example", "Deine Zahlung ist eingegangen",
    "Danke! Wir haben deine Zahlung von 12,99 € für Oktober erhalten. Rechnung Nr. SF-2026-10-4471.",
    { merchant: "Streamflix", date: "2026-09-30", grossCents: 1299, invoiceNumber: "SF-2026-10-4471" }),
  // Fallen
  r("rh09", "Wohnwelt Online", "service@wohnwelt-online.example", "Stornierung Ihrer Bestellung 778344",
    "Ihre Bestellung 778344 wurde wie gewünscht storniert. Es wurde nichts berechnet.", null),
  r("rh10", "Gärtnerei Grün", "kontakt@gaertnerei-gruen.example", "Kostenvoranschlag Heckenschnitt",
    "Für den Heckenschnitt schätzen wir ca. 4 Stunden, also rund 180 € netto. Sollen wir den Termin einplanen?", null),
  r("rh11", "Steuerberater Kunz", "kanzlei@kunz-steuer.example", "Fehlende Belege",
    "Für Ihre Steuererklärung fehlen uns noch die Belege für Handwerkerleistungen. Bitte bis 15.10. nachreichen.", null),
  r("rh12", "Paketladen24", "deals@paketladen24.example", "Nur heute: 20 % auf alles",
    "Mit dem Code HERBST20 sparst du 20 % – Mindestbestellwert 30,00 €.", null),
];

// Kontrollsatz 2 (geschrieben am 02.10.2026, NACH dem Feinschliff der Regeln an Test- und Kontrollsatz, ohne danach
// etwas anzupassen): unordentlich wie echte Mails – PDF-Tabellen ohne Satzzeichen, Beträge ohne €, ISO-Daten,
// Leistungs- statt Rechnungsdatum, „Subtotal/Tax/Total“, Abkürzungen.
export const evalReceiptHoldout2: EvalReceiptCase[] = [
  r("rx01", "Elektro Funke", "rechnungen@elektro-funke.example", "Rg. 26-1188",
    "Anbei Rg. 26-1188. Mfg Elektro Funke",
    { merchant: "Funke", date: "2026-09-17", grossCents: 35700, netCents: 30000, vatCents: 5700, invoiceNumber: "26-1188", dueDate: "2026-10-01", category: "Handwerker & Dienstleistungen" },
    "ELEKTRO FUNKE Meisterbetrieb\nRg.-Nr. 26-1188\nRg.-Datum 17.09.2026\nLeistungsdatum 11.09.2026\nPos Bezeichnung Menge EP GP\n1 Austausch Sicherungskasten 1 300,00 300,00\nSumme netto 300,00\nUSt 19% 57,00\nRechnungsbetrag 357,00 EUR\nZahlbar bis 01.10.2026"),
  r("rx02", "Kiosk & Mehr", "bon@kioskundmehr.example", "Kassenbon",
    "Bon 0815 | 2026-09-28 18:42 | Zeitschrift 6,90 | Getränk 2,50 | SUMME EUR 9,40 | BAR",
    { merchant: "Kiosk", date: "2026-09-28", grossCents: 940 }),
  r("rx03", "PixelCloud", "billing@pixelcloud.example", "Your receipt from PixelCloud #2041-7731",
    "Receipt #2041-7731\nDate paid: Sep 21, 2026\nPixelCloud Storage 2 TB – annual\nSubtotal €83.19\nTax (19%) €15.81\nTotal €99.00\nAmount paid €99.00",
    { merchant: "PixelCloud", date: "2026-09-21", grossCents: 9900, netCents: 8319, vatCents: 1581, invoiceNumber: "2041-7731", category: "Arbeitsmittel" }),
  r("rx04", "Tierarztpraxis Pfote", "praxis@tierarzt-pfote.example", "Rechnung für Bello",
    "Liebe Familie Beispiel, im Anhang die Rechnung für die Impfung von Bello. Liebe Grüße!",
    { merchant: "Pfote", date: "2026-09-15", grossCents: 8743, invoiceNumber: "TA-55021" },
    "Tierarztpraxis Pfote Rechnung TA-55021 15.09.2026 Patient: Bello (Hund) Impfung SHPPiL 1 x 61,04 Untersuchung 1 x 12,43 Zwischensumme 73,47 MwSt 19% 13,96 Endbetrag 87,43"),
  r("rx05", "Online-Druckerei Blatt", "service@druckerei-blatt.example", "Bestellung versendet + Rechnung",
    "Ihre Bestellung 4471-B (500 Visitenkarten) wurde heute versendet. Rechnungsbetrag: 34,51 Euro, bereits bezahlt per Kreditkarte. Sendungsnummer 00340012.",
    { merchant: "Blatt", date: "2026-09-30", grossCents: 3451, category: "Arbeitsmittel" }),
  r("rx06", "Fitnessstudio Kraftwerk", "abrechnung@kraftwerk-fitness.example", "Beitragsquittung September",
    "Hiermit quittieren wir den Eingang Ihres Mitgliedsbeitrags für September 2026 in Höhe von 29,90 €. Abgebucht am 01.09.2026.",
    { merchant: "Kraftwerk", date: "2026-09-01", grossCents: 2990 }),
  // Fallen
  r("rx07", "Online-Druckerei Blatt", "service@druckerei-blatt.example", "Ihr Warenkorb wartet",
    "Sie haben noch 500 Visitenkarten (34,51 €) im Warenkorb. Jetzt bestellen und 10 % sparen!", null),
  r("rx08", "Elektro Funke", "rechnungen@elektro-funke.example", "Zahlungserinnerung Rg. 26-1131",
    "Sehr geehrte Frau Beispiel, zu unserer Rechnung 26-1131 vom 20.08.2026 über 128,52 € konnten wir noch keinen Zahlungseingang feststellen. Bitte überweisen Sie den Betrag bis 10.10.2026.", null),
  r("rx09", "Kollegin Sara", "sara@beispiel-agentur.example", "Belege Dienstreise",
    "Hi Anna, kannst du mir die Belege von der Dienstreise (Hotel 312 €, Bahn 89 €) bis Freitag schicken? Danke!", null),
  r("rx10", "Shop-Bewertung", "feedback@shop-bewertung.example", "Wie war Ihre Bestellung?",
    "Sie haben am 27.09.2026 eine Stehlampe für 89,99 € gekauft. Wie zufrieden sind Sie? Bewerten Sie jetzt!", null),
];
