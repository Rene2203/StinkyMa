import type { EvalMail } from "./evalSet.js";

// Testsatz „eigene Kategorien“ (geschrieben am 02.10.2026 vor der Messung). Alle Mails und Absender erfunden.
// Drei Beispiel-Kategorien, wie ein Nutzer sie anlegen würde, mit Fallen (Fußballspiel ≠ Gaming, Kinderarzt ≠ Schule,
// Sportgeschäft-Werbung ≠ Verein) und Mails, die zu keiner Kategorie gehören.

export const evalUserCategoryDefs = [
  { id: "gaming", name: "Gaming", description: "Videospiele, Spiele-Shops und Plattformen wie Steam oder Nexus Mods, Mods, Gaming-Hardware" },
  { id: "verein", name: "Verein", description: "Sportverein TSV Musterstadt: Training, Spiele der Mannschaft, Mitgliederversammlung, Vereinsfeste" },
  { id: "schule", name: "Schule", description: "Schule und Kita der Kinder: Elternbriefe, Lehrer, Ausflüge, Elternabend" },
] as const;

export type EvalUserCategoryId = (typeof evalUserCategoryDefs)[number]["id"];

export interface EvalUserCategoryCase {
  mail: Omit<EvalMail, "expected">;
  /** Erwartete Kategorie oder null (keine passt) */
  expected: EvalUserCategoryId | null;
}

const m = (id: string, name: string, address: string, subject: string, body: string, expected: EvalUserCategoryId | null): EvalUserCategoryCase => ({
  mail: { id, from: { name, address }, subject, body },
  expected,
});

export const evalUserCategoryCases: EvalUserCategoryCase[] = [
  // Gaming
  m("uc01", "Steam", "noreply@steampowered.example", "Ein Artikel auf Ihrer Wunschliste ist im Angebot!", "Hallo Anna, Starfall Odyssey ist jetzt 40 % günstiger. Das Angebot endet am 06.10.", "gaming"),
  m("uc02", "Nexus Mods", "noreply@nexusmods.example", "Your Premium membership receipt", "Thanks for supporting Nexus Mods. Amount paid: €9.98. Your membership renews monthly.", "gaming"),
  m("uc03", "Spielwelt Shop", "bestellung@spielwelt-shop.example", "Deine Bestellung ist unterwegs", "Deine Bestellung #44120 (Controller Pro, Schwarz) wurde heute verschickt.", "gaming"),
  m("uc04", "Epic Arena", "news@epicarena.example", "Season 4 startet morgen", "Neue Karten, neue Helden und ein Battle Pass voller Belohnungen – ab morgen 10 Uhr.", "gaming"),
  m("uc05", "Jonas", "jonas@mailbox.example", "Heute Abend zocken?", "Hey, Lust heute Abend ab 21 Uhr ein paar Runden Starfall im Koop? Ich mach die Lobby auf.", "gaming"),
  m("uc06", "PixelForge", "support@pixelforge.example", "Ihr Support-Ticket #8812", "Wir haben Ihr Problem mit den Speicherständen geprüft. Bitte installieren Sie Patch 1.2.3 und starten Sie das Spiel neu.", "gaming"),
  m("uc07", "Steam", "noreply@steampowered.example", "Steam-Guard-Code für Ihr Konto", "Hier ist der Code, den Sie für die Anmeldung bei Steam benötigen: 7K2QF", "gaming"),
  m("uc08", "GPU-Store", "info@gpu-store.example", "Ihre Rechnung zur Grafikkarte", "Vielen Dank für Ihren Einkauf: RX 9070 Gaming OC, 649,00 €. Die Rechnung finden Sie im Anhang.", "gaming"),
  // Verein
  m("uc09", "TSV Musterstadt", "news@tsv-musterstadt.example", "Vereinsnachrichten Oktober", "Neue Trainingszeiten in der Halle, Rückblick aufs Sommerfest und Einladung zur Mitgliederversammlung.", "verein"),
  m("uc10", "Trainer Markus", "markus.trainer@tsv-musterstadt.example", "Training fällt am Donnerstag aus", "Hallo zusammen, wegen der Hallensanierung fällt das Training am Donnerstag aus. Samstag spielen wir wie geplant.", "verein"),
  m("uc11", "TSV Musterstadt Kasse", "kasse@tsv-musterstadt.example", "Mitgliedsbeitrag 2027", "Der Jahresbeitrag von 96,00 € wird am 15.01.2027 per Lastschrift eingezogen.", "verein"),
  m("uc12", "Sabine (Mannschaft)", "sabine@mailbox.example", "Aufstellung Samstag", "Hi, für das Spiel gegen den SV Nordheim am Samstag brauchen wir noch zwei Leute. Wer kann?", "verein"),
  m("uc13", "TSV Musterstadt", "vorstand@tsv-musterstadt.example", "Einladung Mitgliederversammlung", "Die ordentliche Mitgliederversammlung findet am 20.11. um 19 Uhr im Vereinsheim statt. Tagesordnung anbei.", "verein"),
  m("uc14", "Festausschuss TSV", "fest@tsv-musterstadt.example", "Helfer für das Herbstfest gesucht", "Für den Kuchenstand und den Aufbau am 17.10. suchen wir noch Helferinnen und Helfer.", "verein"),
  // Schule
  m("uc15", "Grundschule am Park", "sekretariat@gs-ampark.example", "Elternbrief: Wandertag", "Liebe Eltern, am 09.10. findet der Wandertag der Klasse 3b statt. Bitte geben Sie Ihrem Kind Regenkleidung mit.", "schule"),
  m("uc16", "Frau Becker (Klassenlehrerin)", "becker@gs-ampark.example", "Elternabend Klasse 3b", "Der Elternabend findet am Dienstag um 19:30 Uhr im Klassenraum statt.", "schule"),
  m("uc17", "Kita Sonnenblume", "info@kita-sonnenblume.example", "Schließtag am Freitag", "Wegen einer Fortbildung bleibt die Kita am Freitag geschlossen.", "schule"),
  m("uc18", "Schulförderverein", "foerderverein@gs-ampark.example", "Spendenaufruf für die Schulbibliothek", "Wir möchten neue Bücher für die Schulbibliothek anschaffen und freuen uns über jede Spende.", "schule"),
  m("uc19", "Elternbeirat 3b", "elternbeirat3b@mailbox.example", "Klassenkasse", "Bitte überweist bis Ende Oktober 15 € für die Klassenkasse (Ausflug ins Museum).", "schule"),
  m("uc20", "Schul-Messenger", "noreply@schulmessenger.example", "Neue Nachricht: Krankmeldung bestätigt", "Die Krankmeldung für Mia (Klasse 3b) am 01.10. wurde vom Sekretariat bestätigt.", "schule"),
  // Keine Kategorie (mit Fallen)
  m("uc21", "Sporthaus Weber", "angebote@sporthaus-weber.example", "Herbst-Sale: Laufschuhe -30 %", "Nur dieses Wochenende: alle Laufschuhe und Trainingsjacken 30 % günstiger.", null),
  m("uc22", "Kinderarztpraxis Dr. Stein", "termine@praxis-stein.example", "Terminerinnerung U9", "Wir erinnern an den Vorsorgetermin von Mia am 14.10. um 9:15 Uhr.", null),
  m("uc23", "Stadtwerke Musterstadt", "rechnung@stadtwerke-musterstadt.example", "Ihre Abschlagsrechnung Oktober", "Der Abschlag von 86,00 € wird am 15.10. abgebucht.", null),
  m("uc24", "Lotto Musterland", "service@lotto-musterland.example", "Ihre Spielquittung", "Ihr Tipp für die Ziehung am Samstag ist eingegangen. Viel Glück!", null),
  m("uc25", "Thomas Krüger", "t.krueger@beispiel-agentur.example", "Angebot Website-Relaunch", "Hallo Anna, anbei das überarbeitete Angebot. Können wir Montag kurz telefonieren?", null),
  m("uc26", "Sportschau-Ticketshop", "tickets@bundesliga-tickets.example", "Ihre Tickets für Samstag", "Ihre zwei Tickets für das Heimspiel am Samstag, 15:30 Uhr, Block C.", null),
  m("uc27", "Streamflix", "no-reply@streamflix.example", "Neu diese Woche", "Drei neue Serien und ein Dokumentarfilm über die Geschichte der Videospiele.", null),
  m("uc28", "Bank Musterstadt", "service@bank-musterstadt.example", "Ihr Kontoauszug ist da", "Ihr Kontoauszug für September steht im Online-Banking bereit.", null),
  m("uc29", "Oma Helga", "helga@mailbox.example", "Sonntag Kaffee?", "Kommt ihr am Sonntag zum Kaffee? Ich backe Apfelkuchen.", null),
  m("uc30", "Paketdienst", "noreply@paketdienst.example", "Ihr Paket kommt heute", "Ihre Sendung 0034 5521 wird heute zwischen 14 und 16 Uhr zugestellt.", null),
];

// Kontrollsatz (geschrieben am 02.10.2026 nach der ersten Messung, VOR Prompt v2 – zum Prüfen, ob v2 allgemein hilft):
// andere Kategorien, andere Fallen.
export const evalUserCategoryHoldoutDefs = [
  { id: "auto", name: "Auto", description: "Mein Auto: Werkstatt, TÜV, Kfz-Versicherung, Tankkarte" },
  { id: "reisen", name: "Reisen", description: "Urlaub und Reisen: Flüge, Hotels, Bahntickets, Mietwagen" },
  { id: "garten", name: "Garten", description: "Schrebergarten und Gartenverein Grünland, Pflanzen, Gartenmarkt-Bestellungen" },
] as const;

export interface EvalUserCategoryHoldoutCase {
  mail: Omit<EvalMail, "expected">;
  expected: (typeof evalUserCategoryHoldoutDefs)[number]["id"] | null;
}

const h = (id: string, name: string, address: string, subject: string, body: string, expected: EvalUserCategoryHoldoutCase["expected"]): EvalUserCategoryHoldoutCase => ({
  mail: { id, from: { name, address }, subject, body },
  expected,
});

export const evalUserCategoryHoldout: EvalUserCategoryHoldoutCase[] = [
  h("uh01", "Autohaus Brandt", "service@autohaus-brandt.example", "Ihr Werkstatttermin", "Ihr Fahrzeug M-AB 123 ist am 08.10. um 8:00 Uhr zur Inspektion eingeplant.", "auto"),
  h("uh02", "Prüfstelle Nord", "termine@pruefstelle-nord.example", "HU fällig im November", "Die Hauptuntersuchung Ihres Fahrzeugs ist im November fällig. Jetzt Termin buchen.", "auto"),
  h("uh03", "KfzSicher Versicherung", "kunden@kfzsicher.example", "Ihr neuer Beitrag ab Januar", "Ihr Kfz-Versicherungsbeitrag beträgt ab 01.01.2027 412,80 € jährlich.", "auto"),
  h("uh04", "Tankkarte Plus", "abrechnung@tankkarte-plus.example", "Monatsabrechnung September", "Ihre Tankkarte: 4 Tankvorgänge, gesamt 238,40 €.", "auto"),
  h("uh05", "SkyJet", "booking@skyjet.example", "Buchungsbestätigung Flug nach Lissabon", "Flug SJ 482 am 12.11., Abflug 6:45 Uhr, Gepäck 23 kg inklusive.", "reisen"),
  h("uh06", "Hotel Miramar", "reservierung@hotel-miramar.example", "Ihre Reservierung", "Wir freuen uns auf Ihren Aufenthalt vom 12. bis 18.11. im Doppelzimmer mit Meerblick.", "reisen"),
  h("uh07", "Bahn-Tickets", "tickets@bahn-tickets.example", "Ihr Ticket für Freitag", "Sparpreis München – Hamburg, Fr 16:04 Uhr, Wagen 7, Platz 45.", "reisen"),
  h("uh08", "RentaCar", "info@rentacar.example", "Mietwagen in Lissabon abholbereit", "Ihr Mietwagen steht ab 12.11. um 10 Uhr am Flughafen bereit.", "reisen"),
  h("uh09", "Gartenverein Grünland", "vorstand@gv-gruenland.example", "Arbeitseinsatz am Samstag", "Am Samstag ab 9 Uhr schneiden wir die Hecken an den Gemeinschaftswegen. Bitte Gartenschere mitbringen.", "garten"),
  h("uh10", "Gartenmarkt Blüte", "bestellung@gartenmarkt-bluete.example", "Ihre Bestellung: Blumenzwiebeln", "50 Tulpenzwiebeln und 1 Sack Pflanzerde werden morgen geliefert.", "garten"),
  h("uh11", "Gartenverein Grünland", "kasse@gv-gruenland.example", "Pacht und Wassergeld 2026", "Bitte überweisen Sie Pacht und Wassergeld (gesamt 284,00 €) bis 30.11.", "garten"),
  h("uh12", "Nachbarin Petra", "petra@mailbox.example", "Tomatensamen", "Ich hab noch Samen von den gelben Tomaten übrig – willst du welche für deine Parzelle?", "garten"),
  // Keine Kategorie
  h("uh13", "Möbelhaus Schulz", "p.schulz@moebelhaus-schulz.example", "Ihre Küche wird geliefert", "Die Lieferung Ihrer Küche erfolgt am 21.10. zwischen 8 und 12 Uhr.", null),
  h("uh14", "Fahrradladen Speiche", "info@speiche.example", "Ihr Fahrrad ist fertig", "Die Inspektion Ihres E-Bikes ist abgeschlossen. Abholung ab morgen möglich.", null),
  h("uh15", "Volkshochschule", "anmeldung@vhs-musterstadt.example", "Anmeldung Portugiesisch A1", "Ihre Anmeldung zum Kurs Portugiesisch A1 (dienstags, 18 Uhr) ist bestätigt.", null),
  h("uh16", "Stadtwerke Musterstadt", "rechnung@stadtwerke-musterstadt.example", "Wasserabrechnung", "Ihre Jahresabrechnung Wasser liegt im Kundenportal bereit.", null),
  h("uh17", "Kollege Ben", "ben@beispiel-agentur.example", "Präsentation Montag", "Kannst du mir bis Freitag die Folien zum Kundenprojekt schicken?", null),
  h("uh18", "Zahnarztpraxis Lächeln", "termine@praxis-laecheln.example", "Erinnerung Kontrolltermin", "Ihr Kontrolltermin ist am 22.10. um 15 Uhr.", null),
  h("uh19", "Baumarkt Hammer", "angebote@baumarkt-hammer.example", "Wochenangebote", "Bohrmaschinen, Farben und Fliesen – diese Woche bis zu 25 % günstiger.", null),
  h("uh20", "Tante Ilse", "ilse@mailbox.example", "Geburtstag", "Liebe Anna, ich wünsche dir alles Liebe zum Geburtstag! Wann kommst du mal wieder vorbei?", null),
];
