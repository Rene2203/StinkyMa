// Testsatz „Versprechen-Tracker“ (W7.3, geschrieben am 02.10.2026 vor der Erkennung). Alle Mails erfunden.
// Maildatum: Mittwoch, 30.09.2026. Die Nutzerin ist Anna Beispiel <anna@beispiel.example>.
// „mine“: Zusage in einer von Anna GESENDETEN Mail. „theirs“: Zusage eines anderen an Anna (eingehende Mail).
// Frist: echtes Datum, wie der Code es aus dem Ausdruck rechnet. Ohne Frist („kümmere mich drum“): null – die App
// setzt dann eine Standardfrist (3 Tage), das wird hier nicht gewertet.
// Regeln für Ausdrücke: „bis Freitag“ = 02.10.; „Ende der Woche“ = Freitag dieser Woche; „nächste Woche“ = Freitag der
// nächsten Woche (09.10.); „Anfang nächster Woche“ = Montag (05.10.); „Ende des Monats“ = letzter Tag des Monats
// (hier 30.09., also heute); „heute“/„heute Abend“/„nachher“ = 30.09.

export const ownAddress = "anna@beispiel.example";

export interface EvalPromiseExpected {
  direction: "mine" | "theirs";
  /** Wortteil der Zusage, z. B. „Präsentation“ */
  about: string;
  dueDate: string | null;
}

export interface EvalPromiseCase {
  id: string;
  /** gesendet = von Anna */
  sent: boolean;
  /** Gegenüber (Empfänger bei gesendeten, Absender bei eingehenden Mails) */
  other: { name: string; address: string };
  subject: string;
  body: string;
  /** leer = keine Zusage (Falle) */
  expected: EvalPromiseExpected[];
}

const p = (id: string, sent: boolean, name: string, address: string, subject: string, body: string, expected: EvalPromiseExpected[]): EvalPromiseCase => ({
  id, sent, other: { name, address }, subject, body, expected,
});

export const evalPromiseCases: EvalPromiseCase[] = [
  // Eigene Zusagen (gesendet)
  p("pm01", true, "Thomas Krüger", "t.krueger@beispiel-agentur.example", "Re: Angebot Website-Relaunch",
    "Hallo Thomas,\n\ndanke für die Infos. Ich schicke dir die überarbeitete Präsentation bis Freitag.\n\nViele Grüße\nAnna",
    [{ direction: "mine", about: "Präsentation", dueDate: "2026-10-02" }]),
  p("pm02", true, "Lena Wagner", "lena@mailbox.example", "Re: Fotos vom Urlaub",
    "Hi Lena, klar, die Fotos lade ich dir heute Abend hoch! LG Anna", [{ direction: "mine", about: "Fotos", dueDate: "2026-09-30" }]),
  p("pm03", true, "Ben Schulte", "ben@beispiel-agentur.example", "Re: Budgetfreigabe",
    "Hallo Ben,\nich kläre das mit der Buchhaltung und melde mich nächste Woche bei dir.\nAnna", [{ direction: "mine", about: "Buchhaltung", dueDate: "2026-10-09" }]),
  p("pm04", true, "Frau Becker", "becker@gs-ampark.example", "Re: Einverständniserklärung Wandertag",
    "Sehr geehrte Frau Becker,\ndie unterschriebene Einverständniserklärung gebe ich Mia morgen mit.\nMit freundlichen Grüßen\nAnna Beispiel", [{ direction: "mine", about: "Einverständniserklärung", dueDate: "2026-10-01" }]),
  p("pm05", true, "Hausverwaltung Ruhig", "info@hv-ruhig.example", "Re: Zählerstand",
    "Guten Tag,\nden Zählerstand schicke ich Ihnen bis spätestens 10.10. zu.\nFreundliche Grüße\nAnna Beispiel", [{ direction: "mine", about: "Zählerstand", dueDate: "2026-10-10" }]),
  p("pm06", true, "Jonas", "jonas@mailbox.example", "Re: Grillen?",
    "Hey Jonas, ich frag Lisa wegen Samstag und geb dir Bescheid. Bis dann!", [{ direction: "mine", about: "Bescheid", dueDate: null }]),
  p("pm07", true, "Ben Schulte", "ben@beispiel-agentur.example", "Protokoll",
    "Hi Ben, ich kümmere mich ums Protokoll und schicke es dir Ende der Woche.\nAnna", [{ direction: "mine", about: "Protokoll", dueDate: "2026-10-02" }]),
  p("pm08", true, "Kundin Möller", "moeller@kunde.example", "Re: Rückfrage Rechnung",
    "Sehr geehrte Frau Möller,\nich prüfe die Rechnung und melde mich in 3 Tagen bei Ihnen.\nMit freundlichen Grüßen\nAnna Beispiel", [{ direction: "mine", about: "Rechnung", dueDate: "2026-10-03" }]),
  p("pm09", true, "Thomas Krüger", "t.krueger@beispiel-agentur.example", "Re: Vertrag",
    "Hallo Thomas,\nden Vertrag unterschreibe ich und schicke ihn dir bis Ende des Monats zurück. Außerdem rufe ich dich Anfang nächster Woche wegen der Termine an.\nAnna",
    [{ direction: "mine", about: "Vertrag", dueDate: "2026-09-30" }, { direction: "mine", about: "rufe", dueDate: "2026-10-05" }]),
  p("pm10", true, "Oma Helga", "helga@mailbox.example", "Re: Sonntag Kaffee?",
    "Liebe Oma, ja, wir kommen gern! Ich bringe den Kuchen mit. Bis Sonntag, Anna", [{ direction: "mine", about: "Kuchen", dueDate: "2026-10-04" }]),
  // Fallen (gesendet): keine eigene Zusage
  p("pm11", true, "Thomas Krüger", "t.krueger@beispiel-agentur.example", "Präsentation",
    "Hallo Thomas,\nanbei wie versprochen die Präsentation.\nViele Grüße\nAnna", []),
  p("pm12", true, "Ben Schulte", "ben@beispiel-agentur.example", "Frage",
    "Hi Ben, kannst du mir bis Freitag die Zahlen schicken? Danke! Anna", []),
  p("pm13", true, "Lena Wagner", "lena@mailbox.example", "Re: Kino?",
    "Hi Lena, gern! Hast du Samstag Zeit?\n\nAm 29.09.2026 schrieb Lena:\n> Ich schicke dir morgen das Kinoprogramm.", []),
  p("pm14", true, "Jonas", "jonas@mailbox.example", "Danke",
    "Danke für gestern, war ein schöner Abend!", []),
  // Zusagen anderer (eingehend)
  p("pm15", false, "Thomas Krüger", "t.krueger@beispiel-agentur.example", "Angebot",
    "Hallo Anna,\ndas überarbeitete Angebot bekommst du bis Montag von mir.\nViele Grüße\nThomas", [{ direction: "theirs", about: "Angebot", dueDate: "2026-10-05" }]),
  p("pm16", false, "Autohaus Brandt", "service@autohaus-brandt.example", "Ihr Kostenvoranschlag",
    "Sehr geehrte Frau Beispiel,\nwir prüfen den Schaden und senden Ihnen den Kostenvoranschlag bis zum 07.10.2026 zu.\nMit freundlichen Grüßen\nIhr Autohaus Brandt",
    [{ direction: "theirs", about: "Kostenvoranschlag", dueDate: "2026-10-07" }]),
  p("pm17", false, "Ben Schulte", "ben@beispiel-agentur.example", "Re: Zahlen",
    "Hi Anna, die Zahlen schicke ich dir morgen früh. Ben", [{ direction: "theirs", about: "Zahlen", dueDate: "2026-10-01" }]),
  p("pm18", false, "Hausverwaltung Ruhig", "info@hv-ruhig.example", "Ihre Meldung: Heizung",
    "Guten Tag Frau Beispiel,\nwir haben Ihre Meldung erhalten. Ein Techniker meldet sich in den nächsten Tagen bei Ihnen zur Terminabsprache.\nFreundliche Grüße",
    [{ direction: "theirs", about: "Techniker", dueDate: null }]),
  p("pm19", false, "Lena Wagner", "lena@mailbox.example", "Buch",
    "Hey Anna, ich bring dir das Buch nächste Woche vorbei! Lena", [{ direction: "theirs", about: "Buch", dueDate: "2026-10-09" }]),
  p("pm20", false, "Kundin Möller", "moeller@kunde.example", "Unterlagen",
    "Liebe Frau Beispiel,\ndie fehlenden Unterlagen reiche ich bis Ende der Woche nach.\nBeste Grüße\nPetra Möller", [{ direction: "theirs", about: "Unterlagen", dueDate: "2026-10-02" }]),
  // Fallen (eingehend)
  p("pm21", false, "Paketdienst", "noreply@paketdienst.example", "Ihr Paket kommt morgen",
    "Ihre Sendung wird morgen zwischen 10 und 14 Uhr zugestellt.", []),
  p("pm22", false, "Ben Schulte", "ben@beispiel-agentur.example", "Bitte",
    "Hi Anna, kannst du mir bis Freitag das Protokoll schicken? Danke, Ben", []),
  p("pm23", false, "Wohnwelt Online", "news@wohnwelt-online.example", "Wir melden uns!",
    "Wir melden uns nächste Woche mit neuen Angeboten – bleiben Sie gespannt!", []),
  p("pm24", false, "Thomas Krüger", "t.krueger@beispiel-agentur.example", "Präsentation erhalten",
    "Hallo Anna, danke, die Präsentation ist angekommen. Gruß Thomas", []),
];

// Kontrollsatz (geschrieben am 02.10.2026 nach dem Testsatz, vor der Erkennung): andere Formulierungen, Englisch.
export const evalPromiseHoldout: EvalPromiseCase[] = [
  p("ph01", true, "Sara Klein", "sara@beispiel-agentur.example", "Re: Belege Dienstreise",
    "Hi Sara, die Belege reiche ich dir bis Donnerstag ein. Anna", [{ direction: "mine", about: "Belege", dueDate: "2026-10-01" }]),
  p("ph02", true, "Mark Evans", "mark@partner.example", "Re: Proposal",
    "Hi Mark,\nthanks! I'll send you the revised proposal by Friday.\nBest, Anna", [{ direction: "mine", about: "proposal", dueDate: "2026-10-02" }]),
  p("ph03", true, "Vermieter Kurz", "kurz@vermietung.example", "Re: Schlüssel",
    "Hallo Herr Kurz,\nden Zweitschlüssel werfe ich Ihnen heute noch in den Briefkasten.\nGrüße\nAnna Beispiel", [{ direction: "mine", about: "Schlüssel", dueDate: "2026-09-30" }]),
  p("ph04", true, "Team", "team@beispiel-agentur.example", "Re: Planung Q4",
    "Hallo zusammen, ich erstelle bis 15.10. einen Entwurf für die Planung und teile ihn dann mit euch.", [{ direction: "mine", about: "Entwurf", dueDate: "2026-10-15" }]),
  p("ph05", true, "Lena Wagner", "lena@mailbox.example", "Re: Geld",
    "Hey, ich überweise dir die 12,50 € gleich nachher. LG", [{ direction: "mine", about: "überweise", dueDate: "2026-09-30" }]),
  p("ph06", true, "Ben Schulte", "ben@beispiel-agentur.example", "Re: Termin",
    "Hi Ben, ich habe den Termin gestern schon abgesagt. Anna", []),
  p("ph07", false, "Mark Evans", "mark@partner.example", "Contract",
    "Hi Anna,\nI will get back to you with the signed contract by next Tuesday.\nCheers, Mark", [{ direction: "theirs", about: "contract", dueDate: "2026-10-06" }]),
  p("ph08", false, "Steuerberater Kunz", "kanzlei@kunz-steuer.example", "Ihre Steuererklärung",
    "Sehr geehrte Frau Beispiel,\nIhre Steuererklärung reichen wir bis zum 31.10.2026 beim Finanzamt ein und senden Ihnen anschließend eine Kopie.\nMit freundlichen Grüßen",
    [{ direction: "theirs", about: "Steuererklärung", dueDate: "2026-10-31" }]),
  p("ph09", false, "Jonas", "jonas@mailbox.example", "Re: Grillen?",
    "Super, ich besorg das Fleisch und sag dir morgen, wann wir starten.", [{ direction: "theirs", about: "morgen", dueDate: "2026-10-01" }]),
  p("ph10", false, "Gärtnerei Grün", "kontakt@gaertnerei-gruen.example", "Rückruf",
    "Guten Tag, wir rufen Sie zeitnah zurück, um einen Termin für den Heckenschnitt zu vereinbaren.", [{ direction: "theirs", about: "rufen", dueDate: null }]),
  p("ph11", false, "Streamflix", "no-reply@streamflix.example", "Neue Folgen",
    "Am Freitag erscheinen neue Folgen deiner Lieblingsserie!", []),
  p("ph12", false, "Sara Klein", "sara@beispiel-agentur.example", "Frage",
    "Hi Anna, hast du die Belege schon fertig? Ich bräuchte sie bis Donnerstag. Sara", []),
];

// Kontrollsatz 2 (geschrieben am 02.10.2026 NACH dem Feinschliff der Regeln, ohne danach etwas anzupassen):
// Umgangssprache, lange Sätze, mehrere Zusagen, Zusagen in Nebensätzen, Konjunktiv, Weiterleitungen.
export const evalPromiseHoldout2: EvalPromiseCase[] = [
  p("px01", true, "Thomas Krüger", "t.krueger@beispiel-agentur.example", "Re: Kickoff",
    "Hi Thomas,\npasst! Agenda kommt von mir bis morgen Mittag, Raum buch ich auch gleich.\nAnna",
    [{ direction: "mine", about: "Agenda", dueDate: "2026-10-01" }, { direction: "mine", about: "Raum", dueDate: "2026-09-30" }]),
  p("px02", true, "Lena Wagner", "lena@mailbox.example", "Re: Umzug",
    "Na klar helf ich dir am Samstag beim Umzug, bring auch Kartons mit 💪", [{ direction: "mine", about: "Umzug", dueDate: "2026-10-03" }]),
  p("px03", true, "Kundin Möller", "moeller@kunde.example", "Re: Angebot",
    "Sehr geehrte Frau Möller,\nvielen Dank für Ihre Rückmeldung. Gerne passe ich das Angebot entsprechend an; Sie erhalten es spätestens am 06.10. von mir.\nMit freundlichen Grüßen\nAnna Beispiel",
    [{ direction: "mine", about: "Angebot", dueDate: "2026-10-06" }]),
  p("px04", true, "Ben Schulte", "ben@beispiel-agentur.example", "Re: Bug im Formular",
    "Schau ich mir an, sobald ich aus dem Meeting raus bin.", [{ direction: "mine", about: "Schau", dueDate: null }]),
  p("px05", true, "Jonas", "jonas@mailbox.example", "Re: Grillen?",
    "Würde ich gern machen, wenn ich Zeit hätte – leider klappt's diesmal nicht.", []),
  p("px06", true, "Team", "team@beispiel-agentur.example", "Fwd: Rechnung Druckerei",
    "Zur Info.\n\n---------- Weitergeleitete Nachricht ---------\nVon: Druckerei Blatt\nWir liefern die Flyer bis Freitag.", []),
  p("px07", false, "Mark Evans", "mark@partner.example", "Re: Numbers",
    "Anna – will do. Numbers coming your way first thing tomorrow, plus I'll loop in Sarah on the legal bits next week.",
    [{ direction: "theirs", about: "Numbers", dueDate: "2026-10-01" }, { direction: "theirs", about: "Sarah", dueDate: "2026-10-09" }]),
  p("px08", false, "Elektro Funke", "rechnungen@elektro-funke.example", "Re: Termin",
    "Hallo Frau Beispiel, unser Monteur kommt dann am Dienstag zwischen 8 und 10 Uhr vorbei. Gruß, Funke",
    [{ direction: "theirs", about: "Monteur", dueDate: "2026-10-06" }]),
  p("px09", false, "Sara Klein", "sara@beispiel-agentur.example", "Re: Präsentation",
    "Hab grad keine Zeit, aber ich guck heute Abend drüber und geb dir Feedback.", [{ direction: "theirs", about: "Feedback", dueDate: "2026-09-30" }]),
  p("px10", false, "Hausverwaltung Ruhig", "info@hv-ruhig.example", "Wasserschaden",
    "Guten Tag, wir haben die Versicherung informiert. Diese wird sich mit Ihnen in Verbindung setzen.", [{ direction: "theirs", about: "Versicherung", dueDate: null }]),
  p("px11", false, "Thomas Krüger", "t.krueger@beispiel-agentur.example", "Re: Vertrag",
    "Hallo Anna, ich hatte dir doch letzte Woche geschrieben, dass ich das bis Freitag schicke – kam leider was dazwischen, sorry! Neuer Plan: Montag.",
    [{ direction: "theirs", about: "Montag", dueDate: "2026-10-05" }]),
  p("px12", false, "Ben Schulte", "ben@beispiel-agentur.example", "Kurze Frage",
    "Weißt du, ob Thomas das Angebot bis Freitag schickt?", []),
];
