import type { EvalMail } from "./evalSet.js";

// Testsatz „Verträge & Abos“ (W7.1, geschrieben am 02.10.2026 vor der Erkennung). Alle Mails erfunden, vom Mittwoch,
// 30.09.2026 (siehe evalMailToMessage). Erwartet wird nur, was in der Mail steht bzw. sich daraus rechnen lässt.
// „lastCancelDay“: letzter Tag, an dem die Kündigung beim Anbieter sein muss – ±1 Tag gilt als richtig (Formulierungen
// wie „14 Tage vor Verlängerung“ lassen beide Lesarten zu). Keine Rechtsberatung.

export interface EvalSubscriptionExpected {
  kind: "subscription" | "trial" | "contract" | "membership" | "insurance";
  /** Wortteil des Anbieternamens, z. B. „Streamflix“ */
  provider: string;
  amount?: string;
  interval?: "weekly" | "monthly" | "quarterly" | "yearly";
  trialEnd?: string;
  lastCancelDay?: string;
  /** Kündigung bestätigt / Abo endet */
  cancelled?: boolean;
}

export interface EvalSubscriptionCase {
  mail: EvalMail;
  /** null = keine Abo-/Vertragsmail (Falle) */
  expected: EvalSubscriptionExpected | null;
}

const m = (id: string, name: string, address: string, subject: string, body: string): EvalMail => ({ id, from: { name, address }, subject, body, expected: "notification" });

export const evalSubscriptionCases: EvalSubscriptionCase[] = [
  {
    mail: m("su01", "Streamflix", "no-reply@streamflix.example", "Dein Probemonat hat begonnen", "Hallo Anna,\nwillkommen bei Streamflix! Dein kostenloser Probemonat läuft bis 14.10.2026. Danach kostet dein Abo 12,99 € pro Monat. Du kannst jederzeit in deinem Konto kündigen.\nDein Streamflix-Team"),
    expected: { kind: "trial", provider: "Streamflix", amount: "12,99", interval: "monthly", trialEnd: "2026-10-14", lastCancelDay: "2026-10-14" },
  },
  {
    mail: m("su02", "FunkNetz Mobil", "vertrag@funknetz.example", "Ihre Vertragsbestätigung", "Sehr geehrte Frau Beispiel,\nvielen Dank für Ihren Auftrag. Tarif: FunkNetz Allnet M. Vertragsbeginn: 01.10.2026. Mindestlaufzeit: 24 Monate. Monatlicher Grundpreis: 29,99 €. Kündigungsfrist: 1 Monat zum Ende der Mindestlaufzeit.\nIhr FunkNetz-Team"),
    expected: { kind: "contract", provider: "FunkNetz", amount: "29,99", interval: "monthly", lastCancelDay: "2028-08-30" },
  },
  {
    mail: m("su03", "FitWerk Studio", "mitglieder@fitwerk.example", "Willkommen im FitWerk", "Hallo Anna,\nschön, dass du dabei bist! Deine Mitgliedschaft beginnt am 1.10.2026 und läuft 12 Monate. Der Mitgliedsbeitrag von 34,90 € wird monatlich abgebucht. Eine Kündigung ist bis 4 Wochen vor Ablauf möglich, sonst verlängert sich die Mitgliedschaft um 12 Monate.\nDein FitWerk-Team"),
    expected: { kind: "membership", provider: "FitWerk", amount: "34,90", interval: "monthly", lastCancelDay: "2027-09-02" },
  },
  {
    mail: m("su04", "WolkenSpeicher", "billing@wolkenspeicher.example", "Ihr Abo verlängert sich bald", "Guten Tag,\nIhr Jahresabo WolkenSpeicher 2 TB verlängert sich am 20.10.2026 automatisch um ein weiteres Jahr. Der Betrag von 59,99 € wird dann von Ihrer Kreditkarte abgebucht. Wenn Sie nicht verlängern möchten, kündigen Sie vorher in den Kontoeinstellungen.\nIhr WolkenSpeicher-Team"),
    expected: { kind: "subscription", provider: "WolkenSpeicher", amount: "59,99", interval: "yearly", lastCancelDay: "2026-10-19" },
  },
  {
    mail: m("su05", "Tageblatt Digital", "abo@tageblatt.example", "Preisanpassung Ihres Digitalabos", "Sehr geehrte Leserin,\nab dem 1.11.2026 kostet Ihr Digitalabo 14,99 € statt bisher 12,99 € im Monat. Sie können Ihr Abo jederzeit zum Monatsende kündigen.\nIhr Tageblatt"),
    expected: { kind: "subscription", provider: "Tageblatt", amount: "14,99", interval: "monthly" },
  },
  {
    mail: m("su06", "PhotoPro Software", "accounts@photopro.example", "Rechnung PhotoPro Jahresabo", "Hallo Anna Beispiel,\nvielen Dank für Ihre Zahlung von 119,88 € für PhotoPro (Jahresabo). Die nächste Verlängerung erfolgt am 03.01.2027. Eine Kündigung ist bis 14 Tage vor der Verlängerung möglich.\nIhr PhotoPro-Team"),
    expected: { kind: "subscription", provider: "PhotoPro", amount: "119,88", interval: "yearly", lastCancelDay: "2026-12-20" },
  },
  {
    mail: m("su07", "Tonwelle", "hallo@tonwelle.example", "Willkommen bei Tonwelle Premium", "Hi Anna,\nschön, dass du Tonwelle Premium nutzt! Dein Abo kostet 10,99 € monatlich, die erste Abbuchung erfolgt heute. Du kannst jederzeit monatlich kündigen.\nDein Tonwelle-Team"),
    expected: { kind: "subscription", provider: "Tonwelle", amount: "10,99", interval: "monthly" },
  },
  {
    mail: m("su08", "Stadtwerke Musterstadt", "vertrieb@stadtwerke-musterstadt.example", "Vertragsbestätigung Strom", "Sehr geehrte Frau Beispiel,\nwir bestätigen Ihren Stromliefervertrag „Musterstrom Öko“. Lieferbeginn: 01.11.2026. Monatlicher Abschlag: 86,00 €. Erstlaufzeit: 12 Monate. Kündigungsfrist: 6 Wochen zum Ende der Erstlaufzeit.\nIhre Stadtwerke Musterstadt"),
    expected: { kind: "contract", provider: "Stadtwerke", amount: "86,00", interval: "monthly", lastCancelDay: "2027-09-19" },
  },
  {
    mail: m("su09", "Sicher & Gut Versicherung", "service@sicherundgut.example", "Ihre Privathaftpflicht – Beitragsrechnung", "Sehr geehrte Frau Beispiel,\nder Jahresbeitrag Ihrer Privathaftpflichtversicherung beträgt 68,40 €. Der Vertrag läuft bis 31.12.2026 und verlängert sich jeweils um ein Jahr, wenn er nicht 3 Monate vor Ablauf gekündigt wird.\nIhre Sicher & Gut"),
    expected: { kind: "insurance", provider: "Sicher", amount: "68,40", interval: "yearly", lastCancelDay: "2026-09-30" },
  },
  {
    mail: m("su10", "Kochbox", "service@kochbox.example", "Bestätigung Ihrer Kündigung", "Hallo Anna,\nwir bestätigen die Kündigung deines Kochbox-Abos. Dein Abo endet am 31.10.2026, danach erfolgen keine Lieferungen und Abbuchungen mehr.\nDein Kochbox-Team"),
    expected: { kind: "subscription", provider: "Kochbox", cancelled: true },
  },
  {
    mail: m("su11", "Lernfix", "team@lernfix.example", "Deine Testphase endet bald", "Hallo Anna,\ndeine kostenlose Testphase endet in 3 Tagen. Danach läuft dein Abo automatisch für 7,99 € im Monat weiter. Wenn du nicht weitermachen möchtest, kündige vorher in der App.\nDein Lernfix-Team"),
    expected: { kind: "trial", provider: "Lernfix", amount: "7,99", interval: "monthly", trialEnd: "2026-10-03", lastCancelDay: "2026-10-03" },
  },
  {
    mail: m("su12", "Gartenfreund Verlag", "leserservice@gartenfreund.example", "Ihr Jahresabo Gartenfreund", "Sehr geehrte Frau Beispiel,\nIhr Abonnement der Zeitschrift Gartenfreund (12 Ausgaben für 54,00 € jährlich) läuft bis zum 31.12.2026. Es verlängert sich um ein Jahr, wenn Sie nicht bis 6 Wochen vor Ablauf kündigen.\nIhr Leserservice"),
    expected: { kind: "subscription", provider: "Gartenfreund", amount: "54,00", interval: "yearly", lastCancelDay: "2026-11-19" },
  },
  {
    mail: m("su13", "Radlerverein Musterstadt e.V.", "kasse@radlerverein.example", "Mitgliedsbeitrag 2027", "Liebe Mitglieder,\nder Jahresbeitrag für 2027 beträgt unverändert 48,00 € und wird am 15.01.2027 eingezogen. Austritte sind bis 30.11. zum Jahresende möglich.\nEure Kassenwartin"),
    expected: { kind: "membership", provider: "Radlerverein", amount: "48,00", interval: "yearly", lastCancelDay: "2026-11-30" },
  },
  {
    mail: m("su14", "ShieldVPN", "billing@shieldvpn.example", "Your subscription renews soon", "Hi Anna,\nyour ShieldVPN subscription renews on October 12, 2026 for 59,88 € per year. To cancel, visit your account page before the renewal date.\nShieldVPN Team"),
    expected: { kind: "subscription", provider: "ShieldVPN", amount: "59,88", interval: "yearly", lastCancelDay: "2026-10-11" },
  },
  {
    mail: m("su15", "Streamflix", "no-reply@streamflix.example", "Dein Abo wurde geändert", "Hallo Anna,\ndein Abo wurde auf „Standard mit Werbung“ umgestellt. Ab dem nächsten Abrechnungszeitraum zahlst du 4,99 € pro Monat.\nDein Streamflix-Team"),
    expected: { kind: "subscription", provider: "Streamflix", amount: "4,99", interval: "monthly" },
  },
  {
    mail: m("su16", "KFZ-Direkt Versicherung", "kunden@kfz-direkt.example", "Ihre neue Kfz-Versicherung", "Sehr geehrte Frau Beispiel,\nwillkommen bei KFZ-Direkt. Ihre Kfz-Versicherung beginnt am 01.10.2026. Der Beitrag beträgt 38,50 € im Monat. Das Versicherungsjahr endet am 31.12.2026; die Kündigungsfrist beträgt einen Monat zum Ende des Versicherungsjahres.\nIhre KFZ-Direkt"),
    expected: { kind: "insurance", provider: "KFZ-Direkt", amount: "38,50", interval: "monthly", lastCancelDay: "2026-11-30" },
  },
  // ——— Fallen: klingt nach Abo, ist keins ———
  { mail: m("sn01", "Tageblatt", "angebote@tageblatt.example", "Jetzt abonnieren: 3 Monate gratis lesen", "Lesen Sie das Tageblatt 3 Monate kostenlos! Danach nur 12,99 € im Monat, jederzeit kündbar. Jetzt Abo abschließen und Prämie sichern."), expected: null },
  { mail: m("sn02", "Onlineshop Allerlei", "rechnung@allerlei-shop.example", "Ihre Rechnung zur Bestellung 300-552", "Anbei erhalten Sie die Rechnung zu Ihrer Bestellung (Teekanne) über 24,90 €. Der Betrag wurde von Ihrer Kreditkarte abgebucht."), expected: null },
  { mail: m("sn03", "Kochen mit Lisa", "lisa@kochblog.example", "Danke fürs Abonnieren!", "Hallo ihr Lieben,\nihr habt meinen kostenlosen Newsletter abonniert. Ab jetzt gibt es jeden Sonntag neue Rezepte.\nLisa"), expected: null },
  { mail: m("sn04", "Streamflix Kundenservice", "support@streamflix-konto-hilfe.example", "Ihr Abo wurde pausiert", "Ihre Zahlung ist fehlgeschlagen. Aktualisieren Sie innerhalb von 24 Stunden Ihre Zahlungsdaten über den folgenden Link, sonst wird Ihr Konto gelöscht."), expected: null },
  { mail: m("sn05", "Tom Wagner", "tom.wagner@mailbox.example", "Fitness", "Hi Anna,\nmein Fitnessstudio-Vertrag nervt total, ich komme da erst 2027 raus. Gehst du noch zum Schwimmen?\nTom"), expected: null },
  { mail: m("sn06", "Bahn-Reiseportal", "buchung@reiseportal-bahn.example", "Ihre Buchung", "Ihre Fahrkarte Musterstadt → Berlin am 14.10.2026 für 39,90 € ist gebucht. Gute Reise!"), expected: null },
];

/** Kontrollsatz (vor der Erkennung geschrieben, nie zum Verbessern benutzt). */
export const evalSubscriptionHoldout: EvalSubscriptionCase[] = [
  {
    mail: m("sh01", "Hörwelt", "service@hoerwelt.example", "Dein Gratis-Monat läuft", "Hallo Anna,\ndein Gratis-Monat bei Hörwelt endet am 22.10.2026. Danach kostet dein Abo 9,95 € monatlich. Kündigen kannst du jederzeit vorher.\nHörwelt"),
    expected: { kind: "trial", provider: "Hörwelt", amount: "9,95", interval: "monthly", trialEnd: "2026-10-22", lastCancelDay: "2026-10-22" },
  },
  {
    mail: m("sh02", "NetzPlus", "kundenservice@netzplus.example", "Informationen zu Ihrem DSL-Vertrag", "Sehr geehrte Frau Beispiel,\nIhr DSL-Vertrag (39,99 € pro Monat) läuft noch bis zum 30.04.2027. Die Kündigungsfrist beträgt einen Monat zum Laufzeitende.\nIhr NetzPlus-Team"),
    expected: { kind: "contract", provider: "NetzPlus", amount: "39,99", interval: "monthly", lastCancelDay: "2027-03-30" },
  },
  {
    mail: m("sh03", "Auto-Club Süd", "mitglieder@autoclub-sued.example", "Ihre Mitgliedschaft", "Sehr geehrte Frau Beispiel,\nIhre Mitgliedschaft (94,00 € pro Jahr) verlängert sich am 01.03.2027 automatisch. Eine Kündigung muss uns spätestens 3 Monate vorher erreichen.\nIhr Auto-Club Süd"),
    expected: { kind: "membership", provider: "Auto-Club", amount: "94,00", interval: "yearly", lastCancelDay: "2026-12-01" },
  },
  {
    mail: m("sh04", "PlayCloud", "noreply@playcloud.example", "Kündigung bestätigt", "Hallo Anna,\ndein PlayCloud-Abo ist gekündigt und endet am 15.10.2026. Bis dahin kannst du weiter spielen.\nPlayCloud"),
    expected: { kind: "subscription", provider: "PlayCloud", cancelled: true },
  },
  {
    mail: m("sh05", "Handyschutz24", "vertrag@handyschutz24.example", "Ihr Handyschutz ist aktiv", "Sehr geehrte Frau Beispiel,\nIhre Handyversicherung ist aktiv. Beitrag: 6,99 € monatlich, monatlich kündbar.\nIhr Handyschutz24-Team"),
    expected: { kind: "insurance", provider: "Handyschutz24", amount: "6,99", interval: "monthly" },
  },
  {
    mail: m("sh06", "TaskBoard", "billing@taskboard.example", "Your Pro trial ends soon", "Hi Anna,\nyour TaskBoard Pro trial ends on October 9, 2026. After that you'll be charged 15,00 € per month unless you cancel.\nTaskBoard"),
    expected: { kind: "trial", provider: "TaskBoard", amount: "15,00", interval: "monthly", trialEnd: "2026-10-09", lastCancelDay: "2026-10-09" },
  },
  { mail: m("sh07", "Wochenkurier", "angebote@wochenkurier.example", "Nur bis Sonntag: 50 % auf das Jahresabo", "Sichern Sie sich jetzt das Jahresabo zum halben Preis – nur 49,00 € statt 98,00 €. Angebot gültig bis Sonntag."), expected: null },
  { mail: m("sh08", "Paketblitz", "noreply@paketblitz.example", "Ihr Paket kommt morgen", "Ihre Sendung PB 7781 2291 wird morgen zwischen 10 und 14 Uhr zugestellt."), expected: null },
  { mail: m("sh09", "Mia Hofmann", "mia.hofmann@mailbox.example", "Musik", "Hi Anna,\nich habe mein Tonwelle-Abo gekündigt, lohnt sich für mich nicht. Hörst du noch Podcasts?\nMia"), expected: null },
  {
    mail: m("sh10", "Bücherei Musterstadt", "ausleihe@buecherei-musterstadt.example", "Verlängerung Ihres Leseausweises", "Guten Tag,\nIhr Leseausweis läuft am 31.10.2026 ab. Die Jahresgebühr für die Verlängerung beträgt 20,00 €.\nIhre Stadtbücherei"),
    expected: { kind: "membership", provider: "Bücherei", amount: "20,00", interval: "yearly" },
  },
];

/**
 * Kontrollsatz 2 – absichtlich unordentlich (geschrieben am 02.10.2026, NACHDEM die Regeln am Testsatz 100 % erreichten,
 * und danach nie zum Verbessern benutzt): Englisch, „€8.99“, „tomorrow“, Rechnungen statt Bestätigungen, Fallen.
 */
export const evalSubscriptionHoldout2: EvalSubscriptionCase[] = [
  {
    mail: m("sx01", "MeinFitnessPortal", "rechnung@meinfitnessportal.example", "Ihre Rechnung Nr. 4471-22", "Guten Tag,\nMonatsbeitrag Oktober (Abo Premium): 19,99 EUR. Der Betrag wird am 05.10. per Lastschrift eingezogen."),
    expected: { kind: "subscription", provider: "MeinFitnessPortal", amount: "19,99", interval: "monthly" },
  },
  {
    mail: m("sx02", "Readly Plus", "hello@readlyplus.example", "Thanks for subscribing!", "Hi Anna,\nthanks for subscribing to Readly Plus. You will be billed €8.99 monthly until you cancel.\nThe Readly Team"),
    expected: { kind: "subscription", provider: "Readly", amount: "8.99", interval: "monthly" },
  },
  {
    mail: m("sx03", "Nordsee Gebäudeversicherung", "vertrag@nordsee-versicherung.example", "Verlängerung Ihres Vertrags Nr. 554", "Sehr geehrte Frau Beispiel,\nIhr Vertrag Nr. 554 wurde verlängert. Neue Laufzeit bis 31.12.2027. Kündigungsfrist: 3 Monate. Jahresbeitrag: 312,00 €."),
    expected: { kind: "insurance", provider: "Nordsee", amount: "312,00", interval: "yearly", lastCancelDay: "2027-09-30" },
  },
  {
    mail: m("sx04", "CloudNotes", "billing@cloudnotes.example", "Your free trial ends tomorrow", "Hi Anna,\nyour free trial of CloudNotes ends tomorrow. After that, your card will be charged 4,99 € / month. Cancel anytime in settings."),
    expected: { kind: "trial", provider: "CloudNotes", amount: "4,99", interval: "monthly", trialEnd: "2026-10-01", lastCancelDay: "2026-10-01" },
  },
  {
    mail: m("sx05", "FunkNetz Mobil", "rechnung@funknetz.example", "Ihre Mobilfunkrechnung September", "Sehr geehrte Frau Beispiel,\nIhre Rechnung für September: Grundgebühr 24,99 €, Verbindungen 0,00 €, Gesamt 24,99 €. Der Betrag wird abgebucht."),
    expected: { kind: "contract", provider: "FunkNetz", amount: "24,99", interval: "monthly" },
  },
  {
    mail: m("sx06", "Tageblatt", "abo@tageblatt.example", "Ihr Probeabo endet bald", "Sehr geehrte Frau Beispiel,\nIhr Probeabo der Zeitung endet am Freitag. Danach erhalten Sie die Zeitung für 39,90 € im Monat, wenn Sie nicht kündigen."),
    expected: { kind: "trial", provider: "Tageblatt", amount: "39,90", interval: "monthly", trialEnd: "2026-10-02", lastCancelDay: "2026-10-02" },
  },
  { mail: m("sx07", "Kalenderwelt", "shop@kalenderwelt.example", "Ihre Bestellung", "Vielen Dank für Ihre Bestellung: Jahreskalender 2027 „Berge“ – 19,95 €. Die Lieferung erfolgt in 3 Werktagen."), expected: null },
  { mail: m("sx08", "Wechselprofi", "news@wechselprofi.example", "Stromvertrag zu teuer?", "Mit unserem Tarif-Wechsel-Service sparen Sie bis zu 300 € im Jahr beim Stromvertrag. Vergleichen lohnt sich!"), expected: null },
  { mail: m("sx09", "Lena Wagner", "lena.wagner@mailbox.example", "Netflix", "Hi Anna,\nkannst du mir noch die 9,99 € für das geteilte Streaming-Abo vom letzten Monat überweisen? Danke!\nLena"), expected: null },
  {
    mail: m("sx10", "Stadtwerke Musterstadt", "vertrieb@stadtwerke-musterstadt.example", "Kündigungsbestätigung", "Sehr geehrte Frau Beispiel,\nwir bestätigen den Eingang Ihrer Kündigung. Ihr Gasliefervertrag endet zum 31.12.2026."),
    expected: { kind: "contract", provider: "Stadtwerke", cancelled: true },
  },
  {
    mail: m("sx11", "Fotoclub Linse e.V.", "kasse@fotoclub-linse.example", "Rechnung Jahresmitgliedschaft 2027", "Hallo Anna,\nanbei die Rechnung für deine Jahresmitgliedschaft 2027: 60,00 €, fällig zum 01.01.2027."),
    expected: { kind: "membership", provider: "Fotoclub", amount: "60,00", interval: "yearly" },
  },
  {
    mail: m("sx12", "PlanIt", "billing@planit.example", "Your Pro plan has been renewed", "Hi Anna,\nyour Pro plan has been renewed for another year. Amount charged: 99,00 €. Next renewal: September 30, 2027."),
    expected: { kind: "subscription", provider: "PlanIt", amount: "99,00", interval: "yearly", lastCancelDay: "2027-09-29" },
  },
];
