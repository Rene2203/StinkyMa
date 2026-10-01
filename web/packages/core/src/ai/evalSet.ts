import type { MessageCategory } from "../models.js";
import type { RuleDefinition } from "../rules.js";

// Deutscher Testsatz für die KI (Spezifikation 5.5/5.7). Alle Mails, Namen, Firmen und Beträge sind erfunden;
// Adressen enden auf .example. Dient dem Vergleich der Modelle (Messlauf) – im Repository und später in der App.
// Bewusst mit schwierigen Fällen: Phishing im Bank-Look, Newsletter mit „Rechnung“ im Text, Termine von Kollegen.

export interface EvalMail {
  id: string;
  from: { name: string; address: string };
  subject: string;
  body: string;
  attachments?: string[];
  expected: MessageCategory;
  /** Ebenfalls vertretbare Kategorien (Grenzfälle). */
  alsoOk?: MessageCategory[];
}

export interface EvalThread {
  id: string;
  ownAddress: string;
  mails: { from: { name: string; address: string }; date: string; subject: string; body: string }[];
  /** Muss in Zusammenfassung oder offenen Punkten vorkommen (Beträge, Daten, Namen – wortgetreu, ohne Groß/klein). */
  facts: string[];
  /** Darf nicht vorkommen (typische Erfindungen). */
  forbidden?: string[];
  waitingOn: "me" | "others" | "nobody";
}

const c = (
  id: string,
  expected: MessageCategory,
  name: string,
  address: string,
  subject: string,
  body: string,
  extra: { attachments?: string[]; alsoOk?: MessageCategory[] } = {},
): EvalMail => ({ id, from: { name, address }, subject, body, expected, ...extra });

export const evalMails: EvalMail[] = [
  // ——— personal ———
  c("p01", "personal", "Tom Wagner", "tom.wagner@mailbox.example", "Grillen am Samstag?", "Hi Anna,\nhast du Samstag Lust auf Grillen bei uns im Garten? Bring gern Lukas mit. Wir fangen so gegen sechs an.\nGruß Tom"),
  c("p02", "personal", "Mama", "gisela.beispiel@familie.example", "Fotos vom Urlaub", "Hallo mein Schatz,\nhier sind endlich die Fotos von Rügen. Papa lässt grüßen, sein Knie ist wieder besser.\nDicken Kuss, Mama", { attachments: ["IMG_2041.jpg", "IMG_2042.jpg"] }),
  c("p03", "personal", "Lena Hoffmann", "lena.h@web.example", "Danke für gestern!", "Liebe Anna,\nnochmal danke für den schönen Abend. Das Risotto war der Hammer – schickst du mir das Rezept?\nLiebe Grüße\nLena"),
  c("p04", "personal", "Jonas Kraus", "jonas.kraus@posteo.example", "Umzug – brauche Hilfe", "Hey,\nich ziehe Ende des Monats um und suche noch Leute zum Tragen. Hättest du am 28. Zeit? Pizza und Bier gehen auf mich.\nJonas", { alsoOk: ["appointment"] }),
  c("p05", "personal", "Oma Hilde", "hilde.beispiel@familie.example", "Geburtstag", "Liebe Anna,\nalles Gute zum Geburtstag! Ich habe dir eine Kleinigkeit geschickt, das Päckchen sollte bald da sein.\nDeine Oma"),
  c("p06", "personal", "Sarah Klein", "sarah.klein@gmx.example", "Re: Buchclub", "Ich bin durch mit dem Buch – das Ende fand ich ehrlich gesagt enttäuschend. Wollen wir als nächstes was Leichteres lesen?\nSarah"),
  c("p07", "personal", "Max Becker", "max.becker@mailbox.example", "Kannst du mir das Werkzeug zurückgeben?", "Servus Anna,\nich bräuchte die Bohrmaschine nächste Woche wieder. Kannst du sie am Wochenende vorbeibringen?\nMax"),
  c("p08", "personal", "Julia Schmitt", "julia.schmitt@web.example", "Baby ist da!", "Ihr Lieben,\nunsere kleine Emma ist am Dienstag um 4:12 Uhr auf die Welt gekommen, 3.240 g und 51 cm. Beiden geht es gut!\nJulia & Felix"),
  c("p09", "personal", "Peter Neumann", "peter.neumann@posteo.example", "Wanderung Harz", "Moin,\nwie wäre es mit der Brocken-Tour im Oktober? Ich hätte am 18. oder 25. Zeit. Sag mal, was dir besser passt.\nPeter", { alsoOk: ["appointment"] }),
  c("p10", "personal", "Kathrin Vogel", "kathrin.vogel@gmx.example", "Rezept wie versprochen", "Hallo Anna,\nanbei das Rezept für den Zwetschgenkuchen. Wichtig: den Teig über Nacht ruhen lassen!\nKathrin", { attachments: ["Zwetschgenkuchen.pdf"] }),
  c("p11", "personal", "Lukas Beispiel", "lukas@familie.example", "Einkauf", "Kannst du auf dem Heimweg noch Milch und Brot mitnehmen? Ich schaffe es heute nicht vor acht.\nKuss"),
  c("p12", "personal", "Nina Roth", "nina.roth@web.example", "Lange nichts gehört", "Hallo Anna,\nwie geht es dir? Ich habe neulich an unsere Studienzeit in Leipzig gedacht. Wir sollten mal wieder telefonieren!\nNina"),

  // ——— work ———
  c("w01", "work", "Dr. Michael Braun", "m.braun@ingenieurbuero-braun.example", "Angebot Projekt Hallendach", "Sehr geehrte Frau Beispiel,\nanbei unser Angebot für die Statik des Hallendachs. Bei Rückfragen stehe ich gern zur Verfügung.\nMit freundlichen Grüßen\nMichael Braun", { attachments: ["Angebot_2026-114.pdf"] }),
  c("w02", "work", "Sabine Krüger", "s.krueger@firma.example", "Re: Präsentation Q3", "Hallo Anna,\nich habe die Folien zu den Q3-Zahlen überarbeitet. Kannst du bis Donnerstag drüberschauen? Folie 7 bin ich mir unsicher.\nDanke, Sabine"),
  c("w03", "work", "Thomas Weber", "t.weber@firma.example", "Urlaubsvertretung", "Hi Anna,\nich bin vom 6. bis 17. Oktober im Urlaub. Könntest du in der Zeit die Anfragen von Kunde Hansen übernehmen? Übergabe-Notizen liegen im Projektordner.\nThomas"),
  c("w04", "work", "Elena Popescu", "e.popescu@kunde-hansen.example", "Lieferverzug Bauteile", "Sehr geehrte Frau Beispiel,\nleider verzögert sich die Lieferung der Bauteile um zwei Wochen. Bitte teilen Sie uns mit, ob das für Ihren Zeitplan problematisch ist.\nFreundliche Grüße\nElena Popescu"),
  c("w05", "work", "Personalabteilung", "personal@firma.example", "Ihre Zielvereinbarung 2027", "Liebe Frau Beispiel,\nbitte füllen Sie den Entwurf Ihrer Zielvereinbarung bis zum 31.10. aus und senden Sie ihn an Ihre Führungskraft.\nIhre Personalabteilung", { attachments: ["Zielvereinbarung_2027.docx"] }),
  c("w06", "work", "Frank Lehmann", "f.lehmann@firma.example", "Kurze Frage zum Budget", "Anna, haben wir für die Messe im Frühjahr schon Budget freigegeben bekommen? Der Standbauer will eine Zusage bis nächste Woche.\nFrank"),
  c("w07", "work", "Ahmet Yilmaz", "a.yilmaz@agentur-pixel.example", "Entwürfe Logo – Runde 2", "Hallo Frau Beispiel,\nanbei die überarbeiteten Logo-Entwürfe. Variante B haben wir wie besprochen in Blau umgesetzt. Wir freuen uns auf Ihr Feedback.\nBeste Grüße\nAhmet Yilmaz", { attachments: ["Logo_Runde2.pdf"] }),
  c("w08", "work", "Claudia Fischer", "c.fischer@firma.example", "Protokoll Teamrunde", "Hallo zusammen,\nanbei das Protokoll der heutigen Teamrunde. To-dos: Anna – Kundenliste aktualisieren, Frank – Messeplanung.\nClaudia", { attachments: ["Protokoll_Teamrunde.pdf"] }),
  c("w09", "work", "Bewerbung Marco Ricci", "marco.ricci@mailbox.example", "Bewerbung als Werkstudent", "Sehr geehrte Frau Beispiel,\nhiermit bewerbe ich mich auf die ausgeschriebene Stelle als Werkstudent im Marketing. Meine Unterlagen finden Sie im Anhang.\nMit freundlichen Grüßen\nMarco Ricci", { attachments: ["Lebenslauf.pdf", "Anschreiben.pdf"] }),
  c("w10", "work", "Jens Hartmann", "j.hartmann@kunde-nord.example", "Reklamation Auftrag 4471", "Guten Tag,\ndie gelieferten Schrauben haben das falsche Gewinde (M6 statt M8). Bitte um schnellstmöglichen Austausch.\nJens Hartmann\nEinkauf Kunde Nord GmbH"),
  c("w11", "work", "Sabine Krüger", "s.krueger@firma.example", "Vertrag Hansen – Freigabe?", "Anna, der Rahmenvertrag mit Hansen liegt bei der Rechtsabteilung. Sobald die grünes Licht geben, brauche ich deine Unterschrift.\nSabine"),
  c("w12", "work", "IT-Support", "it-support@firma.example", "Ihr Ticket #8812: Drucker 2. OG", "Hallo Frau Beispiel,\nder Drucker im 2. OG wurde repariert, das Ticket ist geschlossen. Melden Sie sich gern, falls es erneut Probleme gibt.\nIhr IT-Support", { alsoOk: ["notification"] }),

  // ——— newsletter ———
  c("n01", "newsletter", "Gartenwelt Shop", "news@gartenwelt.example", "Herbstzeit ist Pflanzzeit – 20 % auf Blumenzwiebeln", "Hallo Anna,\njetzt Tulpen und Narzissen setzen! Nur diese Woche 20 % auf alle Blumenzwiebeln.\nZum Shop\n\nNewsletter abbestellen | Impressum"),
  c("n02", "newsletter", "Radlerverein Musterstadt e.V.", "info@radlerverein.example", "Vereinsnachrichten Oktober", "Liebe Mitglieder,\ndie Saisonabschlussfahrt führt dieses Jahr an den Altmühlsee. Außerdem suchen wir noch Helfer für den Weihnachtsmarkt.\nEuer Vorstand\n\nVom Verteiler abmelden"),
  c("n03", "newsletter", "TechBlick Magazin", "redaktion@techblick.example", "Die Woche in der Technik: neue Akkus, schnelle Router", "Die wichtigsten Themen der Woche: Festkörperakkus im Test, WLAN 7 im Alltag, und warum Ihr Router ein Update braucht.\nWeiterlesen\n\nSie erhalten diese E-Mail, weil Sie unseren Newsletter abonniert haben. Abmelden"),
  c("n04", "newsletter", "ModeHaus Berger", "angebote@modehaus-berger.example", "Nur heute: Gratisversand auf alles", "Liebe Kundin,\nheute ohne Versandkosten bestellen – auch reduzierte Ware. Entdecken Sie die neue Herbstkollektion.\nAbmelden | Datenschutzerklärung"),
  c("n05", "newsletter", "Stadtbibliothek Musterstadt", "newsletter@stadtbibliothek.example", "Neu im Bestand und Veranstaltungen", "Neu bei uns: 120 Romane und die Hörbuch-Reihe „Krimis aus dem Norden“. Am 14.11. liest Autorin Ilse Brandt aus ihrem neuen Buch.\nNewsletter abbestellen"),
  c("n06", "newsletter", "Reiseglück", "deals@reiseglueck.example", "Last Minute Mallorca ab 299 €", "Sonne tanken im Oktober! 7 Nächte Mallorca inkl. Flug ab 299 € pro Person. Nur solange der Vorrat reicht.\nAbmelden"),
  c("n07", "newsletter", "Kochen mit Lisa", "lisa@kochblog.example", "5 schnelle Kürbisrezepte", "Hallo ihr Lieben,\ndiese Woche dreht sich alles um Kürbis – von Suppe bis Kuchen. Viel Spaß beim Nachkochen!\nEure Lisa\n\nAbmelden"),
  c("n08", "newsletter", "Elektro-Markt Profi", "service@elektro-profi.example", "Ihre Rechnung sparen: Energiespar-Wochen", "Sparen Sie bei Ihrer nächsten Stromrechnung: LED-Lampen jetzt 3 für 2. Angebot gültig bis Sonntag.\nNewsletter abbestellen | Impressum", { alsoOk: [] }),
  c("n09", "newsletter", "Bürgerverein Altstadt", "vorstand@buergerverein-altstadt.example", "Rundbrief Herbst", "Liebe Nachbarinnen und Nachbarn,\nder Brunnen am Marktplatz wird saniert, die Stadt hat Fördermittel zugesagt. Herzlichen Dank an alle Spender!\nIhr Bürgerverein"),
  c("n10", "newsletter", "Fitnessstudio Kraftwerk", "info@kraftwerk-fitness.example", "Neue Kurse im November", "Ab November neu: Rückenfit am Dienstag und Yoga am Sonntagmorgen. Jetzt in der App anmelden.\nKeine E-Mails mehr erhalten? Hier abmelden."),
  c("n11", "newsletter", "Weinhandel Rebstock", "news@rebstock.example", "Federweißer ist da!", "Frisch aus der Pfalz: Federweißer und Zwiebelkuchen. Abholung im Laden oder Lieferung ab 6 Flaschen.\nAbbestellen"),
  c("n12", "newsletter", "Online-Akademie Lernwerk", "kurse@lernwerk.example", "Black Week: alle Kurse 40 % günstiger", "Excel, Python, Fotografie – alle Onlinekurse jetzt 40 % günstiger. Nur bis Montag.\nAbmelden | Impressum"),

  // ——— notification ———
  c("x01", "notification", "Paketdienst Blitz", "noreply@blitz-paket.example", "Ihre Sendung ist unterwegs", "Hallo Anna Beispiel,\nIhre Sendung 0034 8812 7741 wird voraussichtlich morgen zwischen 10 und 14 Uhr zugestellt.\nSendung verfolgen"),
  c("x02", "notification", "Kontoservice Cloudspeicher", "no-reply@cloudspeicher.example", "Neue Anmeldung auf Ihrem Konto", "Wir haben eine neue Anmeldung von Windows, Musterstadt, festgestellt. Waren Sie das? Falls nicht, ändern Sie bitte Ihr Passwort in den Kontoeinstellungen.", { alsoOk: ["spam_suspect"] }),
  c("x03", "notification", "Onlineshop Allerlei", "bestellung@allerlei-shop.example", "Bestellbestätigung Nr. 300-551", "Vielen Dank für Ihre Bestellung!\n1 x Wasserkocher Edelstahl\nVoraussichtliche Lieferung: 3.–5. Oktober.\nIhr Allerlei-Team"),
  c("x04", "notification", "Kalender", "calendar-noreply@kalender.example", "Erinnerung: Zahnarzt morgen 9:00", "Dies ist eine Erinnerung an Ihren Termin „Zahnarzt“ morgen um 9:00 Uhr.", { alsoOk: ["appointment"] }),
  c("x05", "notification", "Code-Hosting", "notifications@codehost.example", "[stinkyma] Build erfolgreich", "Der Build #212 auf dem Branch main war erfolgreich. Dauer: 4 min 12 s."),
  c("x06", "notification", "Mietwagen Flott", "service@flott-mietwagen.example", "Ihre Buchung ist bestätigt", "Buchungsnummer FL-77812\nAbholung: 12.10.2026, 9:00 Uhr, Flughafen Musterstadt\nRückgabe: 15.10.2026, 18:00 Uhr", { alsoOk: ["appointment"] }),
  c("x07", "notification", "Passwort-Service", "noreply@stadtwerke-portal.example", "Ihr Passwort wurde geändert", "Das Passwort für Ihr Kundenkonto wurde soeben geändert. Wenn Sie das nicht waren, wenden Sie sich bitte an unseren Kundenservice."),
  c("x08", "notification", "Forum Heimwerker", "noreply@heimwerkerforum.example", "Neue Antwort auf Ihren Beitrag", "Benutzer „Schrauber77“ hat auf Ihren Beitrag „Dübel für Gipskarton?“ geantwortet. Zum Beitrag"),
  c("x09", "notification", "Bahn-Reiseportal", "buchung@reiseportal-bahn.example", "Ihr Ticket: Musterstadt → Hamburg", "Ihre Reise am 22.10.2026, Abfahrt 7:14 Uhr, Gleis 5. Ihr Ticket finden Sie im Anhang.", { attachments: ["Ticket.pdf"], alsoOk: ["appointment"] }),
  c("x10", "notification", "Streamingdienst Flimmer", "info@flimmer.example", "Ihr Abo wurde verlängert", "Ihr Abo wurde um einen Monat verlängert. Ihr Zugang bleibt unverändert bestehen.", { alsoOk: ["invoice"] }),
  c("x11", "notification", "Smart Home Zentrale", "alarm@smarthome-zentrale.example", "Wassermelder Keller: Alarm beendet", "Der Wassermelder „Keller“ meldet wieder trocken. Alarm beendet um 03:42 Uhr."),
  c("x12", "notification", "Behördenportal", "noreply@buergerportal.example", "Neue Nachricht im Postfach", "In Ihrem Postfach im Bürgerportal liegt eine neue Nachricht. Bitte melden Sie sich an, um sie zu lesen."),

  // ——— invoice ———
  c("i01", "invoice", "Stadtwerke Musterstadt", "rechnung@stadtwerke.example", "Ihre Jahresabrechnung Strom 2026", "Sehr geehrte Frau Beispiel,\nanbei Ihre Jahresabrechnung. Der Nachzahlungsbetrag von 84,20 € wird am 15.10.2026 von Ihrem Konto abgebucht.\nIhre Stadtwerke", { attachments: ["Jahresabrechnung_2026.pdf"] }),
  c("i02", "invoice", "Telefon & Netz AG", "rechnung@telnetz.example", "Ihre Rechnung für September", "Guten Tag,\nIhre Rechnung für September beträgt 39,99 €. Der Betrag wird per Lastschrift eingezogen.\nKundennummer 5512-889", { attachments: ["Rechnung_09-2026.pdf"] }),
  c("i03", "invoice", "Zahnarztpraxis Dr. Sommer", "praxis@dr-sommer.example", "Privatrechnung Behandlung 12.09.", "Sehr geehrte Frau Beispiel,\nanbei die Rechnung über 236,50 € für die professionelle Zahnreinigung. Bitte überweisen Sie den Betrag bis 10.10.2026.\nPraxis Dr. Sommer", { attachments: ["Rechnung_PZR.pdf"] }),
  c("i04", "invoice", "Handwerk Müller GmbH", "buero@handwerk-mueller.example", "Rechnung 2026-0412 Badsanierung", "Sehr geehrte Damen und Herren,\nfür die ausgeführten Arbeiten erlauben wir uns, 3.480,00 € in Rechnung zu stellen. Zahlbar innerhalb von 14 Tagen ohne Abzug.\nHandwerk Müller", { attachments: ["Rechnung_2026-0412.pdf"] }),
  c("i05", "invoice", "Onlineshop Allerlei", "rechnung@allerlei-shop.example", "Ihre Rechnung zur Bestellung 300-551", "Anbei erhalten Sie die Rechnung zu Ihrer Bestellung 300-551 über 49,90 €. Der Betrag wurde per Kreditkarte beglichen.", { attachments: ["Rechnung_300-551.pdf"], alsoOk: ["notification"] }),
  c("i06", "invoice", "Hausverwaltung Lindner", "verwaltung@lindner-hv.example", "Nebenkostenabrechnung 2025", "Sehr geehrte Frau Beispiel,\nanbei die Nebenkostenabrechnung für 2025. Es ergibt sich ein Guthaben von 112,40 €, das wir mit der nächsten Miete verrechnen.\nHausverwaltung Lindner", { attachments: ["NK-Abrechnung_2025.pdf"] }),
  c("i07", "invoice", "Versicherung Sicher & Gut", "beitrag@sicherundgut.example", "Beitragsrechnung Kfz-Versicherung 2027", "Ihr Jahresbeitrag für die Kfz-Versicherung beträgt 418,00 €. Fälligkeit: 01.01.2027.", { attachments: ["Beitragsrechnung.pdf"] }),
  c("i08", "invoice", "Musikschule Klangfarbe", "verwaltung@klangfarbe.example", "Zahlungserinnerung Unterrichtsgebühr", "Liebe Frau Beispiel,\nleider konnten wir die Unterrichtsgebühr für September (65,00 €) noch nicht feststellen. Bitte überweisen Sie den Betrag in den nächsten Tagen.\nIhre Musikschule"),
  c("i09", "invoice", "Webhosting Nordlicht", "billing@nordlicht-hosting.example", "Rechnung NL-2026-8841", "Rechnungsbetrag: 5,95 € (Webhosting Basic, Oktober). Zahlung erfolgt per PayPal.", { attachments: ["NL-2026-8841.pdf"] }),
  c("i10", "invoice", "Tierarztpraxis Pfote", "praxis@pfote.example", "Rechnung Impfung Bello", "Hallo Frau Beispiel,\nanbei die Rechnung für die Impfung von Bello: 78,30 €. Gerne per Überweisung bis Monatsende.\nIhr Praxisteam", { attachments: ["Rechnung_Bello.pdf"] }),
  c("i11", "invoice", "Fahrradladen Speiche", "laden@speiche.example", "Ihr Beleg", "Vielen Dank für Ihren Einkauf! Anbei Ihr Beleg über 129,00 € (Inspektion + neue Bremsbeläge).", { attachments: ["Beleg_8812.pdf"] }),
  c("i12", "invoice", "Finanzamt Musterstadt", "poststelle@finanzamt.example", "Festsetzung Einkommensteuer 2025 – Nachzahlung", "Für das Jahr 2025 ergibt sich eine Nachzahlung von 612,00 €, fällig am 04.11.2026. Den Bescheid finden Sie in Ihrem Bürgerportal-Postfach.", { alsoOk: ["notification"] }),

  // ——— appointment ———
  c("a01", "appointment", "Praxis Dr. Sommer", "termine@dr-sommer.example", "Terminbestätigung", "Sehr geehrte Frau Beispiel,\nhiermit bestätigen wir Ihren Termin am Dienstag, 14.10.2026, um 8:30 Uhr. Bitte bringen Sie Ihre Versichertenkarte mit."),
  c("a02", "appointment", "Sabine Krüger", "s.krueger@firma.example", "Einladung: Abstimmung Messe – Do 10:00", "Hallo Anna,\nich lade dich zur Abstimmung der Messeplanung ein: Donnerstag, 10:00–11:00 Uhr, Raum 3.12 oder per Video.\nSabine", { alsoOk: ["work"] }),
  c("a03", "appointment", "Kita Sonnenschein", "leitung@kita-sonnenschein.example", "Elternabend am 21.10.", "Liebe Eltern,\nwir laden herzlich zum Elternabend am 21.10. um 19:30 Uhr in die Bärengruppe ein. Themen: Laternenfest und Schließtage.\nIhr Kita-Team"),
  c("a04", "appointment", "Autohaus Stern", "werkstatt@autohaus-stern.example", "Ihr Werkstatttermin", "Guten Tag,\nIhr Termin für den Reifenwechsel ist am Samstag, 18.10., um 9:15 Uhr. Bitte planen Sie ca. 45 Minuten ein."),
  c("a05", "appointment", "Hausverwaltung Lindner", "verwaltung@lindner-hv.example", "Ablesung der Heizkostenverteiler", "Sehr geehrte Mieter,\ndie Ablesung findet am 7.11. zwischen 8 und 12 Uhr statt. Bitte sorgen Sie dafür, dass die Wohnung zugänglich ist.", { alsoOk: ["notification"] }),
  c("a06", "appointment", "Frank Lehmann", "f.lehmann@firma.example", "Terminanfrage: Kundenbesuch Hansen", "Hi Anna,\npasst dir für den Besuch bei Hansen der 23.10. vormittags? Alternativ ginge der 24. ab 13 Uhr.\nFrank", { alsoOk: ["work"] }),
  c("a07", "appointment", "Bürgeramt Musterstadt", "termin@buergeramt.example", "Ihr Termin: Personalausweis", "Ihr Termin im Bürgeramt: Mittwoch, 29.10.2026, 11:40 Uhr, Schalter 4. Bitte bringen Sie ein biometrisches Passfoto mit.", { alsoOk: ["notification"] }),
  c("a08", "appointment", "Friseur Schnittpunkt", "termine@schnittpunkt.example", "Terminabsage", "Liebe Frau Beispiel,\nleider müssen wir Ihren Termin am Freitag um 16 Uhr wegen Krankheit absagen. Bitte vereinbaren Sie einen neuen Termin.\nIhr Schnittpunkt-Team"),
  c("a09", "appointment", "Tennisclub Grün-Weiß", "sport@tc-gruenweiss.example", "Einladung zur Mitgliederversammlung", "Liebe Mitglieder,\ndie Mitgliederversammlung findet am 15.11. um 18 Uhr im Clubhaus statt. Tagesordnung im Anhang.\nDer Vorstand", { attachments: ["Tagesordnung.pdf"], alsoOk: ["newsletter"] }),
  c("a10", "appointment", "Dr. Michael Braun", "m.braun@ingenieurbuero-braun.example", "Ortstermin Hallendach", "Sehr geehrte Frau Beispiel,\nkönnen wir den Ortstermin am Montag, 20.10., um 14 Uhr vor Ort durchführen? Bitte kurze Bestätigung.\nMichael Braun", { alsoOk: ["work"] }),

  // ——— spam_suspect ———
  c("s01", "spam_suspect", "Sparkasse Kundenservice", "sicherheit@sparkasse-kundenservice.example", "Ihr Konto wurde vorübergehend gesperrt", "Sehr geehrter Kunde,\naufgrund ungewöhnlicher Aktivitäten wurde Ihr Konto gesperrt. Verifizieren Sie sich innerhalb von 24 Stunden über den folgenden Link, sonst wird Ihr Konto dauerhaft geschlossen."),
  c("s02", "spam_suspect", "Paket-Info", "info@paket-zustellung-de.example", "Ihr Paket konnte nicht zugestellt werden", "Ihr Paket konnte nicht zugestellt werden. Zahlen Sie die Zollgebühr von 1,99 € über diesen Link, damit wir es erneut zustellen können."),
  c("s03", "spam_suspect", "Gewinnspiel-Zentrale", "gewinn@gluecksziehung.example", "Herzlichen Glückwunsch! Sie haben gewonnen", "Sie wurden als Gewinner eines iPhone ausgewählt! Bestätigen Sie jetzt Ihre Daten und zahlen Sie nur die Versandkosten."),
  c("s04", "spam_suspect", "PayFlow Sicherheit", "service@payflow-secure-login.example", "Dringend: Ungewöhnliche Zahlung", "Wir haben eine Zahlung über 849,00 € an einen unbekannten Händler festgestellt. Wenn Sie diese nicht autorisiert haben, melden Sie sich sofort hier an, um sie zu stornieren."),
  c("s05", "spam_suspect", "Inkasso Schneider & Partner", "forderung@inkasso-sofort.example", "Letzte Mahnung vor Pfändung", "Sie haben trotz mehrfacher Aufforderung nicht bezahlt. Überweisen Sie 389,40 € sofort, sonst leiten wir die Pfändung ein. Rechnung im Anhang.", { attachments: ["Rechnung.zip"] }),
  c("s06", "spam_suspect", "Microsoft Konto-Team", "account-security@microsoft-verify.example", "Ihr Postfach ist voll", "Ihr Postfach hat die Speichergrenze erreicht. Eingehende Nachrichten werden blockiert. Klicken Sie hier, um kostenlos 50 GB zu erhalten."),
  c("s07", "spam_suspect", "Dr. Rose Williams", "rose.williams@freemail.example", "Vertrauliches Anliegen", "Liebe Freundin,\nich bin Anwältin und betreue das Erbe eines verstorbenen Kunden ohne Angehörige. Ich biete Ihnen 40 % von 4,5 Millionen Dollar, wenn Sie mir helfen."),
  c("s08", "spam_suspect", "Krypto Profit", "team@krypto-profit.example", "Anna, so verdienen Sie 3.000 € pro Tag", "Mit unserem Handelsroboter verdienen Menschen wie Sie täglich tausende Euro. Nur noch 3 Plätze frei – jetzt registrieren!"),
  c("s09", "spam_suspect", "Steuerverwaltung", "erstattung@steuer-rueckzahlung.example", "Steuererstattung: 412,50 € für Sie", "Sie haben Anspruch auf eine Steuererstattung von 412,50 €. Geben Sie Ihre Kreditkartendaten ein, um die Rückzahlung zu erhalten."),
  c("s10", "spam_suspect", "Chef", "geschaeftsfuehrung.firma@freemail.example", "Kurze Bitte – vertraulich", "Anna, ich sitze in einem Meeting und kann nicht telefonieren. Ich brauche dringend 5 Gutscheinkarten à 100 € für einen Kunden. Kannst du die kaufen und mir die Codes schicken? Bitte niemandem sagen."),
];

/**
 * Kontrollsatz: geschrieben, bevor die Prompts nach dem ersten Messlauf angepasst wurden, und nie zum Feintuning
 * benutzt. Zeigt, ob Verbesserungen nur auf den Haupt-Testsatz passen (Überanpassung).
 */
export const evalHoldoutMails: EvalMail[] = [
  c("hp1", "personal", "Bernd Ostermann", "bernd.o@mailbox.example", "Fahrgemeinschaft Klassentreffen", "Hallo Anna,\nfährst du auch zum Klassentreffen nach Kassel? Ich hätte noch zwei Plätze im Auto frei.\nBernd"),
  c("hp2", "personal", "Tante Rita", "rita.beispiel@familie.example", "Weihnachten bei uns?", "Liebe Anna,\nwir würden uns freuen, wenn ihr dieses Jahr Weihnachten zu uns kommt. Platz ist genug!\nRita"),
  c("hp3", "personal", "Mia Lorenz", "mia.lorenz@web.example", "Hast du meinen Schal?", "Hi, ich glaube, ich habe gestern meinen grünen Schal bei dir liegen lassen. Kannst du mal schauen?\nMia"),
  c("hp4", "personal", "Felix Graf", "felix.graf@posteo.example", "Glückwunsch zum neuen Job!", "Hey Anna,\nhabe gerade gehört, dass du die Stelle bekommen hast – mega! Darauf stoßen wir an.\nFelix"),
  c("hw1", "work", "Ingrid Paulsen", "i.paulsen@firma.example", "Kennzahlen Oktober", "Hallo Anna,\nkannst du mir bis Mittwoch die Kennzahlen für Oktober schicken? Der Vorstand will sie früher sehen.\nIngrid"),
  c("hw2", "work", "Karl Neubert", "k.neubert@lieferant-sued.example", "Preisanpassung ab Januar", "Sehr geehrte Frau Beispiel,\naufgrund gestiegener Rohstoffkosten passen wir unsere Preise zum 1. Januar um 4 % an. Die neue Preisliste liegt bei.\nKarl Neubert", { attachments: ["Preisliste_2027.pdf"] }),
  c("hw3", "work", "Laura Brandt", "l.brandt@firma.example", "Feedback zum Konzept", "Anna, ich habe dein Konzept gelesen. Abschnitt 3 ist stark, beim Budget fehlen mir aber noch die Reisekosten.\nLaura"),
  c("hw4", "work", "Projektbüro", "projekte@kunde-hansen.example", "Abnahme Phase 2", "Sehr geehrte Frau Beispiel,\nwir bestätigen die Abnahme der Phase 2 ohne Mängel. Die Schlussrechnung kann gestellt werden.\nMit freundlichen Grüßen\nProjektbüro Hansen"),
  c("hn1", "newsletter", "Zooladen Fellnase", "news@fellnase.example", "Herbst-Special für Hund und Katze", "Kuschelige Hundebetten und Katzenbäume jetzt 25 % günstiger. Gültig bis 31.10.\nAbmelden"),
  c("hn2", "newsletter", "Museum der Stadt", "info@stadtmuseum.example", "Neue Ausstellung: 100 Jahre Straßenbahn", "Ab dem 8. November zeigen wir historische Fotos und Fahrzeuge. Führungen jeden Sonntag.\nNewsletter abbestellen"),
  c("hn3", "newsletter", "Spielwaren Kunterbunt", "angebote@kunterbunt.example", "Jetzt schon an Weihnachten denken", "Die beliebtesten Spielzeuge 2026 – jetzt bestellen und entspannt in die Feiertage. Gratis Geschenkverpackung.\nAbmelden | Impressum"),
  c("hn4", "newsletter", "Gemeinde Musterdorf", "rundbrief@musterdorf.example", "Gemeindebrief November", "Themen: Laubabfuhr, neue Öffnungszeiten der Bücherei und der Seniorennachmittag im Bürgerhaus.\nVom Rundbrief abmelden"),
  c("hx1", "notification", "Paketstation", "noreply@paketstation.example", "Ihr Paket liegt zur Abholung bereit", "Ihr Paket liegt in der Packstation 112, Bahnhofstraße. Abholcode: in der App. Abholung bis 10.10.", { alsoOk: ["appointment"] }),
  c("hx2", "notification", "Bank Musterstadt", "noreply@bank-musterstadt.example", "Neues Dokument im Postfach", "In Ihrem Online-Banking-Postfach liegt ein neues Dokument (Kontoauszug September). Sie finden es nach der Anmeldung in der App.", { alsoOk: ["invoice"] }),
  c("hx3", "notification", "Fotodienst Bildwerk", "service@bildwerk.example", "Ihre Fotos sind fertig", "Ihre Bestellung (24 Abzüge) ist fertig und kann in der Filiale Marktplatz abgeholt werden."),
  c("hx4", "notification", "Router Heimnetz", "router@heimnetz.example", "Firmware-Update installiert", "Auf Ihrem Router wurde die Firmware 8.1 installiert. Es ist nichts weiter zu tun."),
  c("hi1", "invoice", "Gasversorger Nord", "abrechnung@gas-nord.example", "Abschlagsplan 2027", "Ihr monatlicher Abschlag beträgt ab Januar 72,00 €. Die Abbuchung erfolgt jeweils zum 1. des Monats.", { attachments: ["Abschlagsplan.pdf"] }),
  c("hi2", "invoice", "Physiopraxis Bewegung", "abrechnung@physio-bewegung.example", "Rechnung Krankengymnastik", "Sehr geehrte Frau Beispiel,\nanbei die Rechnung über 96,40 € (Zuzahlung). Bitte überweisen Sie innerhalb von 14 Tagen.", { attachments: ["Rechnung_KG.pdf"] }),
  c("hi3", "invoice", "Buchhandlung Seitenweise", "laden@seitenweise.example", "Ihre Rechnung", "Anbei die Rechnung über 23,80 € für Ihre Bestellung (2 Bücher). Bezahlt per EC-Karte.", { attachments: ["Rechnung_4471.pdf"] }),
  c("hi4", "invoice", "Schornsteinfeger Meister Ruß", "buero@meister-russ.example", "Rechnung Feuerstättenschau", "Für die Feuerstättenschau am 12.09. berechnen wir 58,10 €. Zahlbar bis 15.10.2026.", { attachments: ["Rechnung_FS.pdf"] }),
  c("ha1", "appointment", "Augenarzt Dr. Weiß", "praxis@augenarzt-weiss.example", "Erinnerung an Ihren Termin", "Wir erinnern Sie an Ihren Termin am Freitag, 17.10., um 10:20 Uhr. Bitte kommen Sie ohne Kontaktlinsen.", { alsoOk: ["notification"] }),
  c("ha2", "appointment", "Ingrid Paulsen", "i.paulsen@firma.example", "Jahresgespräch", "Hallo Anna,\nlass uns dein Jahresgespräch am 4.11. um 15 Uhr in meinem Büro machen. Passt das?\nIngrid", { alsoOk: ["work"] }),
  c("ha3", "appointment", "Grundschule am Park", "sekretariat@grundschule-park.example", "Einladung zum Elternsprechtag", "Der Elternsprechtag findet am 13.11. von 14 bis 18 Uhr statt. Bitte tragen Sie sich in die Terminliste ein."),
  c("ha4", "appointment", "Umzugsfirma Flink", "dispo@flink-umzug.example", "Besichtigungstermin", "Guten Tag,\nunser Mitarbeiter kommt am Dienstag, 21.10., zwischen 9 und 10 Uhr zur Besichtigung.\nIhr Flink-Team"),
  c("hs1", "spam_suspect", "Volksbank Sicherheit", "noreply@volksbank-sicherheitscenter.example", "Aktualisierung Ihrer Daten erforderlich", "Aufgrund neuer gesetzlicher Vorgaben müssen Sie Ihre Daten bis morgen aktualisieren. Melden Sie sich jetzt über den Link an, sonst wird Ihr Online-Banking gesperrt."),
  c("hs2", "spam_suspect", "Amazon Prime", "prime@amazon-abo-service.example", "Ihre Mitgliedschaft wurde pausiert", "Ihre Zahlungsmethode ist abgelaufen. Aktualisieren Sie innerhalb von 48 Stunden Ihre Kreditkarte, um Ihre Vorteile nicht zu verlieren."),
  c("hs3", "spam_suspect", "Lotto-Service", "info@lotto-sofortgewinn.example", "Ihr Gewinn: 25.000 €", "Ihre E-Mail-Adresse wurde bei unserer Sonderziehung gezogen! Zur Auszahlung benötigen wir eine Bearbeitungsgebühr von 89 €."),
  c("hs4", "spam_suspect", "DHL Express", "track@dhl-paket-info.example", "Zustellung fehlgeschlagen", "Wir konnten Ihre Sendung nicht zustellen. Bestätigen Sie Ihre Adresse und zahlen Sie 2,49 € Nachporto über den folgenden Link."),
];

const anna = "anna@beispiel.example";
const annaFrom = { name: "Anna Beispiel", address: anna };

export const evalThreads: EvalThread[] = [
  {
    id: "t01",
    ownAddress: anna,
    mails: [
      { from: { name: "Dr. Michael Braun", address: "m.braun@ingenieurbuero-braun.example" }, date: "2026-09-20T09:00:00Z", subject: "Angebot Hallendach", body: "Sehr geehrte Frau Beispiel,\nanbei unser Angebot für die Statik des Hallendachs über 7.850 € netto. Das Angebot gilt bis 31.10.2026.\nMit freundlichen Grüßen\nMichael Braun" },
      { from: annaFrom, date: "2026-09-22T08:00:00Z", subject: "Re: Angebot Hallendach", body: "Sehr geehrter Herr Braun,\ndanke für das Angebot. Ist die Prüfstatik im Preis enthalten?\nViele Grüße\nAnna Beispiel" },
      { from: { name: "Dr. Michael Braun", address: "m.braun@ingenieurbuero-braun.example" }, date: "2026-09-23T10:00:00Z", subject: "Re: Angebot Hallendach", body: "Sehr geehrte Frau Beispiel,\nnein, die Prüfstatik kostet zusätzlich 1.200 €. Bitte geben Sie mir bis Freitag Bescheid, ob wir beauftragt werden.\nMichael Braun" },
    ],
    facts: ["7.850", "1.200", "Prüfstatik"],
    waitingOn: "me",
  },
  {
    id: "t02",
    ownAddress: anna,
    mails: [
      { from: annaFrom, date: "2026-09-25T18:00:00Z", subject: "Grillen?", body: "Hi Tom,\nwollen wir am Samstag grillen? Ich bringe Salat mit.\nAnna" },
      { from: { name: "Tom Wagner", address: "tom.wagner@mailbox.example" }, date: "2026-09-25T19:00:00Z", subject: "Re: Grillen?", body: "Super Idee! Samstag 18 Uhr bei uns. Lena kommt auch. Bring gern noch Getränke mit.\nTom" },
      { from: annaFrom, date: "2026-09-25T19:30:00Z", subject: "Re: Grillen?", body: "Perfekt, bis Samstag!\nAnna" },
    ],
    facts: ["Samstag", "18"],
    waitingOn: "nobody",
  },
  {
    id: "t03",
    ownAddress: anna,
    mails: [
      { from: { name: "Hausverwaltung Lindner", address: "verwaltung@lindner-hv.example" }, date: "2026-09-10T08:00:00Z", subject: "Wasserschaden Keller", body: "Sehr geehrte Frau Beispiel,\nim Keller wurde ein Wasserschaden festgestellt. Ein Gutachter kommt am 02.10.2026 um 10 Uhr. Bitte räumen Sie Ihr Kellerabteil bis dahin frei.\nHausverwaltung Lindner" },
      { from: annaFrom, date: "2026-09-11T08:00:00Z", subject: "Re: Wasserschaden Keller", body: "Guten Tag,\nich räume das Abteil am Wochenende leer. Werden die Kosten für beschädigte Kartons übernommen?\nAnna Beispiel" },
    ],
    facts: ["02.10.2026", "Gutachter", "Kellerabteil"],
    waitingOn: "others",
  },
  {
    id: "t04",
    ownAddress: anna,
    mails: [
      { from: { name: "Sabine Krüger", address: "s.krueger@firma.example" }, date: "2026-09-28T09:00:00Z", subject: "Präsentation Q3", body: "Hallo Anna,\nkannst du bis Donnerstag die Folien zu den Q3-Zahlen prüfen? Besonders der Umsatz in Region Süd (1,4 Mio. €) kommt mir zu hoch vor.\nSabine" },
      { from: { name: "Frank Lehmann", address: "f.lehmann@firma.example" }, date: "2026-09-28T11:00:00Z", subject: "Re: Präsentation Q3", body: "Der Wert für Süd stimmt, da ist der Großauftrag von Hansen drin.\nFrank" },
      { from: { name: "Sabine Krüger", address: "s.krueger@firma.example" }, date: "2026-09-28T12:00:00Z", subject: "Re: Präsentation Q3", body: "Danke Frank. Anna, dann bitte nur noch Folie 7 und 9 anschauen.\nSabine" },
    ],
    facts: ["Donnerstag", "Folie 7", "Hansen"],
    waitingOn: "me",
  },
  {
    id: "t05",
    ownAddress: anna,
    mails: [
      { from: { name: "Onlineshop Allerlei", address: "service@allerlei-shop.example" }, date: "2026-09-15T08:00:00Z", subject: "Ihre Reklamation 300-551", body: "Sehr geehrte Frau Beispiel,\nwir haben Ihre Reklamation zum Wasserkocher erhalten. Bitte senden Sie das Gerät mit dem beigefügten Retourenschein zurück.\nIhr Allerlei-Team" },
      { from: annaFrom, date: "2026-09-16T08:00:00Z", subject: "Re: Ihre Reklamation 300-551", body: "Ist heute verschickt worden.\nAnna Beispiel" },
      { from: { name: "Onlineshop Allerlei", address: "service@allerlei-shop.example" }, date: "2026-09-19T08:00:00Z", subject: "Re: Ihre Reklamation 300-551", body: "Sehr geehrte Frau Beispiel,\ndie Rücksendung ist eingegangen. Wir erstatten Ihnen 49,90 € innerhalb von 5 Werktagen auf Ihre Kreditkarte.\nIhr Allerlei-Team" },
    ],
    facts: ["49,90", "Wasserkocher"],
    waitingOn: "nobody",
  },
  {
    id: "t06",
    ownAddress: anna,
    mails: [
      { from: { name: "Kita Sonnenschein", address: "leitung@kita-sonnenschein.example" }, date: "2026-09-29T08:00:00Z", subject: "Laternenfest – Helfer gesucht", body: "Liebe Eltern,\nfür das Laternenfest am 11.11. suchen wir Helfer für Kuchenstand und Aufbau. Bitte tragen Sie sich bis 20.10. ein und teilen Sie uns mit, was Sie übernehmen.\nIhr Kita-Team" },
    ],
    facts: ["11.11.", "20.10."],
    waitingOn: "me",
  },
  {
    id: "t07",
    ownAddress: anna,
    mails: [
      { from: { name: "Jens Hartmann", address: "j.hartmann@kunde-nord.example" }, date: "2026-09-24T07:00:00Z", subject: "Reklamation Auftrag 4471", body: "Guten Tag,\ndie gelieferten Schrauben haben das falsche Gewinde (M6 statt M8). Bitte um schnellstmöglichen Austausch – wir brauchen 2.000 Stück bis 6.10.\nJens Hartmann" },
      { from: annaFrom, date: "2026-09-24T09:00:00Z", subject: "Re: Reklamation Auftrag 4471", body: "Sehr geehrter Herr Hartmann,\nes tut mir leid. Der Ersatz geht morgen raus, die falsche Ware holen wir bei Gelegenheit ab.\nAnna Beispiel" },
      { from: { name: "Jens Hartmann", address: "j.hartmann@kunde-nord.example" }, date: "2026-09-26T07:00:00Z", subject: "Re: Reklamation Auftrag 4471", body: "Ersatz ist angekommen, passt alles. Danke für die schnelle Hilfe!\nJens Hartmann" },
    ],
    facts: ["M8", "2.000"],
    forbidden: ["M10"],
    waitingOn: "nobody",
  },
  {
    id: "t08",
    ownAddress: anna,
    mails: [
      { from: { name: "Jonas Kraus", address: "jonas.kraus@posteo.example" }, date: "2026-09-20T10:00:00Z", subject: "Umzug", body: "Hey Anna,\nkannst du mir am 28.09. beim Umzug helfen? Start ist um 9 Uhr in der Lindenstraße 4.\nJonas" },
      { from: annaFrom, date: "2026-09-20T12:00:00Z", subject: "Re: Umzug", body: "Klar, ich komme! Soll ich meinen Akkuschrauber mitbringen?\nAnna" },
    ],
    facts: ["28.09.", "9 Uhr", "Akkuschrauber"],
    waitingOn: "others",
  },
  {
    id: "t09",
    ownAddress: anna,
    mails: [
      { from: { name: "Zahnarztpraxis Dr. Sommer", address: "praxis@dr-sommer.example" }, date: "2026-09-12T08:00:00Z", subject: "Kostenvoranschlag Krone", body: "Sehr geehrte Frau Beispiel,\nder Kostenvoranschlag für die Krone beträgt 1.140,00 €, Ihr Eigenanteil voraussichtlich 520,00 €. Bitte reichen Sie den Plan bei Ihrer Krankenkasse ein und melden Sie sich zur Terminvereinbarung.\nPraxis Dr. Sommer" },
    ],
    facts: ["1.140", "520", "Krankenkasse"],
    waitingOn: "me",
  },
  {
    id: "t10",
    ownAddress: anna,
    mails: [
      { from: annaFrom, date: "2026-09-18T08:00:00Z", subject: "Frage zur Nebenkostenabrechnung", body: "Sehr geehrte Damen und Herren,\nin der Abrechnung sind 240 € für Gartenpflege aufgeführt, wir haben aber keinen Garten. Können Sie das prüfen?\nAnna Beispiel" },
      { from: { name: "Hausverwaltung Lindner", address: "verwaltung@lindner-hv.example" }, date: "2026-09-25T08:00:00Z", subject: "Re: Frage zur Nebenkostenabrechnung", body: "Sehr geehrte Frau Beispiel,\nSie haben recht, die Position wurde irrtümlich berechnet. Wir korrigieren die Abrechnung, Ihr Guthaben erhöht sich auf 352,40 €.\nHausverwaltung Lindner" },
    ],
    facts: ["240", "352,40", "Gartenpflege"],
    waitingOn: "nobody",
  },
];

/** Erwartete Aktionen (W6.1) – jede Erwartung muss von einer erkannten Aktion erfüllt werden (Datum/Uhrzeit/Betrag). */
export interface EvalActionCase {
  mailId: string;
  /** leer = in dieser Mail darf nichts erkannt werden (Werbung, reine Info) */
  expected: { date?: string; time?: string; amount?: string }[];
}

// Maildatum im Messlauf: Mittwoch, 30.09.2026
export const evalActionCases: EvalActionCase[] = [
  { mailId: "i01", expected: [{ date: "2026-10-15", amount: "84,20" }] },
  { mailId: "i02", expected: [{ amount: "39,99" }] },
  { mailId: "i03", expected: [{ date: "2026-10-10", amount: "236,50" }] },
  { mailId: "i04", expected: [{ amount: "3.480,00" }] },
  { mailId: "i07", expected: [{ date: "2027-01-01", amount: "418,00" }] },
  { mailId: "i08", expected: [{ amount: "65,00" }] },
  { mailId: "i10", expected: [{ amount: "78,30" }] },
  { mailId: "i12", expected: [{ date: "2026-11-04", amount: "612,00" }] },
  { mailId: "a01", expected: [{ date: "2026-10-14", time: "08:30" }] },
  { mailId: "a02", expected: [{ date: "2026-10-01", time: "10:00" }] },
  { mailId: "a03", expected: [{ date: "2026-10-21", time: "19:30" }] },
  { mailId: "a04", expected: [{ date: "2026-10-18", time: "09:15" }] },
  { mailId: "a05", expected: [{ date: "2026-11-07" }] },
  { mailId: "a07", expected: [{ date: "2026-10-29", time: "11:40" }] },
  { mailId: "a09", expected: [{ date: "2026-11-15", time: "18:00" }] },
  { mailId: "a10", expected: [{ date: "2026-10-20", time: "14:00" }] },
  { mailId: "w05", expected: [{ date: "2026-10-31" }] },
  { mailId: "x06", expected: [{ date: "2026-10-12", time: "09:00" }] },
  { mailId: "x09", expected: [{ date: "2026-10-22", time: "07:14" }] },
  { mailId: "n01", expected: [] },
  { mailId: "n03", expected: [] },
  { mailId: "n07", expected: [] },
  { mailId: "x05", expected: [] },
  { mailId: "x08", expected: [] },
  { mailId: "p03", expected: [] },
  { mailId: "p12", expected: [] },
  // Kontrollsatz
  { mailId: "hi2", expected: [{ amount: "96,40" }] },
  { mailId: "hi4", expected: [{ date: "2026-10-15", amount: "58,10" }] },
  { mailId: "ha1", expected: [{ date: "2026-10-17", time: "10:20" }] },
  { mailId: "ha2", expected: [{ date: "2026-11-04", time: "15:00" }] },
  { mailId: "ha3", expected: [{ date: "2026-11-13", time: "14:00" }] },
  { mailId: "ha4", expected: [{ date: "2026-10-21", time: "09:00" }] },
  { mailId: "hn3", expected: [] },
  { mailId: "hn4", expected: [] },
  { mailId: "hx4", expected: [] },
];

// --- Regeln in normaler Sprache (W6.4) ---

/** Eigene Ordner, die es in den Testfällen gibt. */
export const evalRuleFolders = ["Newsletter", "Verein", "Steuer 2026", "Kinder", "Reisen"];

export interface EvalRuleCase {
  id: string;
  text: string;
  /** Erwartete Felder; nicht genannte Felder müssen leer/aus sein. */
  expected: Partial<RuleDefinition>;
}

export const evalRuleCases: EvalRuleCase[] = [
  { id: "r01", text: "Alles von newsletter@zeitung.example ins Archiv", expected: { from: ["newsletter@zeitung.example"], move: "archive" } },
  { id: "r02", text: "Mails von shop.example automatisch als gelesen markieren", expected: { from: ["shop.example"], markRead: true } },
  { id: "r03", text: "Newsletter in den Ordner Newsletter verschieben", expected: { category: "newsletter", folder: "Newsletter" } },
  { id: "r04", text: "Mails vom Sportverein in Verein", expected: { from: ["Sportverein"], folder: "Verein" } },
  { id: "r05", text: "Wenn der Betreff „Lohnsteuer“ enthält, nach Steuer 2026 verschieben", expected: { subject: ["Lohnsteuer"], folder: "Steuer 2026" } },
  { id: "r06", text: "Rechnungen mit Anhang markieren", expected: { category: "invoice", hasAttachment: true, flag: true } },
  { id: "r07", text: "Werbung von angebote@moebel.example löschen", expected: { from: ["angebote@moebel.example"], category: "newsletter", move: "trash" } },
  { id: "r08", text: "Alles von der Grundschule Am Park in den Ordner Kinder", expected: { from: ["Grundschule Am Park"], folder: "Kinder" } },
  { id: "r09", text: "Benachrichtigungen als gelesen markieren und archivieren", expected: { category: "notification", markRead: true, move: "archive" } },
  { id: "r10", text: "Mails von Amazon archivieren", expected: { from: ["Amazon"], move: "archive" } },
  { id: "r11", text: "Mails mit \"Buchungsbestätigung\" im Betreff in Reisen ablegen", expected: { subject: ["Buchungsbestätigung"], folder: "Reisen" } },
  { id: "r12", text: "Alles von gewinnspiel-24.example in den Spam", expected: { from: ["gewinnspiel-24.example"], move: "spam" } },
  { id: "r13", text: "Mails von meiner Chefin mit einem Fähnchen versehen", expected: { from: ["Chefin"], flag: true } },
  { id: "r14", text: "Termine von praxis-sommer.example als wichtig kennzeichnen", expected: { from: ["praxis-sommer.example"], category: "appointment", flag: true } },
  { id: "r15", text: "Mails von noreply@paket.example als gelesen markieren", expected: { from: ["noreply@paket.example"], markRead: true } },
  { id: "r16", text: "Verschiebe Mails von der Elternvertretung nach Kinder", expected: { from: ["Elternvertretung"], folder: "Kinder" } },
  { id: "r17", text: "Newsletter von verlag.example bitte direkt löschen", expected: { from: ["verlag.example"], category: "newsletter", move: "trash" } },
  { id: "r18", text: "Alles, was der Tennisclub schickt, kommt in Verein", expected: { from: ["Tennisclub"], folder: "Verein" } },
  { id: "r19", text: "Betrugsmails sofort in den Spam-Ordner", expected: { category: "spam_suspect", move: "spam" } },
  { id: "r20", text: "Mails, deren Betreff Gutschein enthält, archivieren", expected: { subject: ["Gutschein"], move: "archive" } },
  { id: "r21", text: "Rechnungen von stadtwerke.example in Steuer 2026", expected: { from: ["stadtwerke.example"], category: "invoice", folder: "Steuer 2026" } },
  { id: "r22", text: "Ich will Mails von Oma Hilde nie verpassen – immer markieren", expected: { from: ["Oma Hilde"], flag: true } },
  { id: "r23", text: "Automatische Mails vom Kundenkonto-System auf gelesen setzen", expected: { from: ["Kundenkonto-System"], category: "notification", markRead: true } },
  { id: "r24", text: "Mails von reisebuero.example mit Anhang nach Reisen", expected: { from: ["reisebuero.example"], hasAttachment: true, folder: "Reisen" } },
];

/** Kontrollsatz für Regeln: nie zum Verbessern der Regeln oder Prompts benutzt. */
export const evalRuleHoldout: EvalRuleCase[] = [
  { id: "rh01", text: "Post von info@fitnessstudio.example bitte gleich archivieren", expected: { from: ["info@fitnessstudio.example"], move: "archive" } },
  { id: "rh02", text: "Mails vom Vermieter markieren", expected: { from: ["Vermieter"], flag: true } },
  { id: "rh03", text: "Alles mit „Reiseunterlagen“ im Betreff nach Reisen", expected: { subject: ["Reiseunterlagen"], folder: "Reisen" } },
  { id: "rh04", text: "Newsletter als gelesen markieren", expected: { category: "newsletter", markRead: true } },
  { id: "rh05", text: "Mails von kita-sonnenschein.example in den Ordner Kinder schieben", expected: { from: ["kita-sonnenschein.example"], folder: "Kinder" } },
  { id: "rh06", text: "Lösche alles von rabatte@outlet.example", expected: { from: ["rabatte@outlet.example"], move: "trash" } },
  { id: "rh07", text: "Rechnungen vom Finanzamt in Steuer 2026 ablegen", expected: { from: ["Finanzamt"], category: "invoice", folder: "Steuer 2026" } },
  { id: "rh08", text: "Mails mit Anhang von buchhaltung.example wichtig markieren", expected: { from: ["buchhaltung.example"], hasAttachment: true, flag: true } },
  { id: "rh09", text: "Was der Chor verschickt, gehört in Verein", expected: { from: ["Chor"], folder: "Verein" } },
  { id: "rh10", text: "Benachrichtigungen von bank.example nicht markieren, nur archivieren", expected: { from: ["bank.example"], category: "notification", move: "archive" } },
  { id: "rh11", text: "Spam-Verdacht direkt in den Junk-Ordner", expected: { category: "spam_suspect", move: "spam" } },
  { id: "rh12", text: "Betreff enthält Abo – dann als gelesen markieren und ins Archiv", expected: { subject: ["Abo"], markRead: true, move: "archive" } },
];
