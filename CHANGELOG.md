# Changelog

## Aufräumen und mehr Mails (nach W6)

### Neu
- **Mails laden: 30 Tage, 3 Monate, 1 Jahr oder alle** – je Konto in den Optionen. Länger: wird sofort im Hintergrund
  nachgeladen, mit Fortschritt („Lädt Mails … 1.200 von 8.000“) unten links; nachgeladene ältere Mails lösen keine
  Benachrichtigungen und keine Regeln aus. Kürzer: ältere Mails verschwinden nur aus StinkyMa, auf dem Server bleiben sie.
  Migration `v14-account-sync-days`.
- **„Ältere Mails anzeigen“** am Ende der Liste statt fester 500 Mails.
- **Aufräumen** (Besen-Knopf unten links): Absender oder Domains mit den meisten Mails, mit Anzahl ungelesen und
  geschützt. Alles einer Gruppe kann in den Papierkorb – **außer** Mails, die man behalten sollte: Rechnungen, Bestellungen,
  Verträge, Tickets, Zugangsdaten/Passwörter, Sicherheitscodes, Dokumente (Steuer, Lohn, Lizenz), markierte und
  beantwortete Mails, offene Fristen, von der KI als persönlich/Arbeit/Rechnung/Termin Eingeordnetes. Geschützte Mails
  sind nicht vorausgewählt, lassen sich aber anhaken. Löschen nur nach Bestätigung, nur in den Papierkorb; auf Wunsch
  Regel „künftige Mails auch in den Papierkorb“. „KI prüfen lassen“ ordnet noch nicht eingeordnete Mails der Gruppe
  vorrangig ein (im Hintergrund, mit geschätzter Dauer).
- Verschieben vieler Mails zwischen denselben Ordnern geht als **ein** Server-Befehl (statt einer pro Mail).
- **Newsletter abbestellen** mit einem Klick (in der Mail und beim Aufräumen): Ein-Klick-Abmeldung beim Anbieter, sonst
  Abmelde-Mail, sonst Abmelde-Seite – die öffnet in einem **verschiebbaren Fenster in der App** (Hintergrund abgedunkelt,
  Seite abgeschottet: kein Zugriff auf die App, nichts gespeichert, keine Downloads). Bei Spam-Verdacht rät die App ab.
  Danach: „Vorhandene Mails aufräumen“. Migration `v15-unsubscribe`.
- **Neuer Name: StinkyMail.** Daten, Konten und Einstellungen bleiben beim Update erhalten.

### Feinabstimmung Gemma 4 E2B / E4B
- Zusammenfassung „wer ist dran“ deutlich zuverlässiger (beide Modelle 90 % statt 60–90 %), Beträge und Daten vollständiger.
- Termine und Fristen: „am Dienstag um 9:30“, „bis Freitag“, „morgen“, „übermorgen“ werden erkannt – auch ohne KI; Daten ohne
  Jahreszahl bekommen das richtige Jahr; Öffnungszeiten und Werbung erzeugen keine Termine mehr.

## W6 – Assistent

### Neu
- **Zu tun:** Termine, Fristen, Zahlungen und Bitten werden über der Mail angezeigt – sofort (Regeln), auf Wunsch mit KI
  verfeinert. Erinnerung per Windows-Benachrichtigung, Kalendereintrag (.ics), erledigt/ausblenden. Migration `v10-message-actions`.
- **Phishing-Check:** Warnleiste mit nachvollziehbaren Gründen (gefälschter Absender, irreführende Links, Druck, Datenabfrage,
  Gutscheinkarten …) und Kennzeichen in der Liste.
- **Türsteher für neue Absender** (pro Konto, Standard aus; beim Hinzufügen eines Kontos wählbar): Mails von Unbekannten
  landen zuerst unter „Neue Absender“. Erlauben → Posteingang (auch künftig), Blockieren → Spam-Ordner auf dem Server.
  Beim Einschalten gelten alle bisherigen Absender und Empfänger eigener Mails als bekannt. Migration `v11-screener`.
- **Regeln in eigenen Worten** (Optionen → Regeln): z. B. „Newsletter von zeitung.example ins Archiv“. StinkyMa zeigt die
  erkannte Regel zum Prüfen und Ändern (Absender, Betreff, Art, Anhang → verschieben/eigener Ordner, gelesen, markieren)
  und welche Mails im Posteingang jetzt schon passen; auf Wunsch auch auf diese anwenden. Gilt danach für neu ankommende
  Mails – lokal sofort, auf dem Server über die Warteschlange; Weggeräumtes löst keine Benachrichtigung aus. Gelesen wird
  zuerst mit einfachen Regeln, das lokale Modell hilft nur, wenn die nichts Brauchbares ergeben. Migration `v12-mail-rules`.
- **Antwortvorschläge** (Knopf in der Mail, nur mit lokalem Modell): 2–3 kurze Varianten (z. B. zusagen, absagen,
  nachfragen) in der Anrede der Mail (du/Sie). Klick übernimmt Anrede und Text in „Antworten“ – über Signatur und Zitat;
  gesendet wird nur vom Nutzer. Vorschläge mit Platzhaltern, falscher Anrede oder erfundenen Zahlen werden verworfen.
- **Einordnung korrigieren:** Klick auf die Einordnung über der Mail; auf Wunsch für den Absender gemerkt – künftige Mails
  kommen ohne KI richtig, andere Mails des Absenders werden mit korrigiert. Migration `v13-sender-category`.
- **KI-Anzeige** unten in der Seitenleiste: was die KI gerade tut, Fortschrittsbalken der Einordnung, laufende Uhr,
  bei Stillstand „Weiter einordnen“; im Leerlauf, ob alles eingeordnet ist. Einordnen auch älterer Mails: letzte 30/90 Tage, letztes Jahr, alle oder eigener Zeitraum
  (Von/Bis), mit Anzahl und geschätzter Dauer.
- **Tagesüberblick** (Sonnen-Knopf unten links; auf Wunsch täglich als Benachrichtigung zur gewählten Uhrzeit, nur mit
  Anzahlen): Fälliges der nächsten 7 Tage und Überfälliges, „wartet auf dich“, neue wichtige ungelesene Mails; Newsletter,
  Benachrichtigungen und Verdächtiges nur gezählt. Ohne KI-Modell, sofort – ungeöffnete neue Mails werden dafür schnell mit
  den Regeln nach Fristen und Zahlungen durchsucht.

### Behoben
- KI-Einordnung blieb nach einem Fehler oder einer hängenden Modell-Anfrage dauerhaft stehen; jetzt Zeitlimit mit Neustart
  des Modells, und eine einzelne Problem-Mail hält die übrigen nicht mehr auf.
- Antwort-Editor öffnete sich gelegentlich nicht (Editor beim schnellen Neuaufbau schon abgebaut).
- Archivierte/verschobene Mails verloren den gelesenen Anhang-Text (Suche in Scans) und KI-Leseergebnisse.
- E2E-Test „Ungelesen“ war wackelig (zwei Mails mit gleicher Uhrzeit, zufällige Reihenfolge).

## W5 – KI-Basis (in Arbeit)

### Behoben
- Eine eben geöffnete Mail konnte während eines laufenden Abgleichs kurz wieder als ungelesen erscheinen.

### Neu
- **KI-Kern** (`@stinkyma/core`, plattformneutral): Anbieter-Schnittstelle, zentrale Freigabe-Prüfung (Mails verlassen
  das Gerät nur mit Freigabe je Konto und Aufgabe, nie stilles Ausweichen), Übertragungsprotokoll, Eingabe-Bereinigung,
  versionierte deutsche Prompts mit JSON-Schema, Prüfung der Antworten mit einem zweiten Versuch und Regel-Rückfall.
- **Modellkatalog:** Gemma 4 E2B/E4B und Qwen 3.5 2B/4B (Q4, GGUF) mit Prüfsummen – Auswahl per Messlauf.
- **Lokale KI in der Windows-App:** Optionen → KI (Modell laden mit Fortschritt, fortsetzbar, Prüfsumme; verwenden; löschen),
  „Zusammenfassen“ mit Herkunftsangabe, automatische Einordnung neuer Mails im Hintergrund. Alles auf dem eigenen Rechner
  (llama.cpp, CPU oder Grafikkarte über Vulkan). Migration `v9-ai-results`.
- **Anmeldung per Browser (OAuth) für Gmail und Outlook:** „Mit Google/Microsoft anmelden“ statt App-Passwort; IMAP/SMTP
  per XOAUTH2, automatische Token-Erneuerung, „Erneut anmelden“ bei abgelaufener Anmeldung. Benötigt eine eigene
  App-Registrierung (Anleitung `docs/OAUTH-EINRICHTEN.md`, Eintrag unter Optionen).
- **Bilder und Scans mit KI lesen:** in der Anhang-Vorschau „Mit KI lesen“ für Fotos, Bildschirmfotos und gescannte PDFs –
  Art, Kurzbeschreibung und vollständiger Text, danach durchsuchbar. Läuft auf dem eigenen Rechner (llama.cpp-Programm,
  erst bei Bedarf geladen, Prüfsumme). Text- und Bildmodell nie gleichzeitig im Speicher.
- **Standardmodell Gemma 4 E2B** (Messlauf, `docs/KI-MESSUNG.md`), Prompt v2 mit besserer Phishing-Erkennung.
- **Testsatz und Messlauf:** deutscher Testsatz (80 Mails, 10 Konversationen, Kontrollsatz mit 28 Mails), Messskript.

## W4 – Suche, sofortige Zustellung, Infobereich, Anhänge ansehen

### Neu
- **Volltextsuche** über den SQLite-Index (FTS5): Betreff, Absender und kompletter Mailtext, ohne Akzente,
  Wortanfang genügt, neueste zuerst. Syntax: Wörter, "feste Wortgruppe", `von:`/`from:` für den Absender.
  Standard: alle Ordner (ohne Papierkorb/Spam), umschaltbar auf „Nur hier“; Treffer aus anderen Ordnern zeigen
  den Ordnernamen. Eingaben werden nie als Index-Syntax gelesen (Sonderzeichen sicher). Esc leert die Suche.
- **Neue Mails sofort:** je Konto eine Wächter-Verbindung auf den Posteingang (IMAP IDLE, alle 4 min erneuert,
  Wiederverbindung mit wachsender Pause bis 5 min). Meldet der Server etwas, wird nur der Posteingang abgeglichen;
  nach jedem (Wieder-)Verbinden einmal nachholen, was in der Lücke kam. Voller Abgleich aller Ordner nur noch alle
  15 statt 5 Minuten.
- **Windows-Benachrichtigung** für neue ungelesene Mails im Posteingang (Absender und Betreff, nie der Inhalt; nicht
  beim ersten Abgleich eines Kontos, nicht wenn das Fenster vorne ist). Klick öffnet die Mail.
- **Infobereich:** Schließen versteckt das Fenster, StinkyMa läuft weiter (einmaliger Hinweis). Symbol zeigt
  ungelesene Mails (roter Punkt, Anzahl im Tooltip); Menü: Öffnen, Jetzt abrufen, Beenden.
- **Optionen → App:** „Beim Schließen im Infobereich weiterlaufen“ (Standard an), „Mit Windows starten“ (unauffällig
  im Infobereich, Standard aus), Benachrichtigungen „Absender und Betreff“ / „Nur ‚Neue Mail‘“ / „Aus“.
  Gespeichert in `settings.json` im Benutzerordner (tolerant gegen kaputte Dateien).
- Platzhalter-Symbol (Briefumschlag auf Blau) für Fenster, Installer und Infobereich – App-Name/Logo stehen noch aus.
- **Anhang-Vorschau in der App:** PDF (PDF.js über `unpdf`, ohne Skripte, bis 50 Seiten), Bilder (PNG/JPEG/GIF/WebP/BMP –
  kein SVG) und Text; bis 30 MB. Knöpfe: im Standardprogramm öffnen, speichern. Andere Formate öffnen wie bisher extern.
  Der PDF-Baustein wird erst beim ersten Öffnen geladen.
- **Anhänge durchsuchbar:** Text aus PDF- und Textanhängen wird beim Abgleich gelesen (kein zusätzlicher Download;
  Grenzen 15 MB / 30 Seiten / 10 s) und in einem eigenen Suchindex abgelegt (Migration `v8-attachment-search`).
  Die Suche findet Mails auch über den Text ihrer Anhänge. Gilt für ab jetzt abgerufene Mails.

## W3 – Gmail-Vorbereitung

- Gmail (mit App-Passwort): virtuelle Ordner „Markiert“ und „Wichtig“ werden nicht abgeglichen (nur Kopien,
  sonst doppelte Downloads); „Alle Nachrichten“ (SPECIAL-USE `\\All`) ist der Archiv-Ordner. Mails, die zusätzlich
  im Archiv liegen, erscheinen in „Markiert“ und im Zähler nur einmal.

## W3 (Teil 2) – Schreiben alltagstauglich

### Neu
- **Anhänge empfangen:** Klick öffnet mit dem Standardprogramm, das Download-Symbol speichert („Speichern unter“).
  Der Inhalt wird erst dann vom Server geholt (nichts vorab auf der Platte). Programme, Skripte, Makro-Dokumente
  und Abbilder (.exe, .ps1, .lnk, .xlsm, .iso …) werden nie geöffnet – nur speichern. Geöffnete Anhänge liegen in
  einem Temp-Ordner, der beim nächsten Start geleert wird; Dateinamen werden bereinigt (keine Pfade, keine
  reservierten Windows-Namen).
- **Anhänge senden:** Büroklammer im Mail-Fenster oder Dateien hineinziehen; Hinweis ab 18 MB, Grenze 40 MB.
- **Entwürfe:** Das Mail-Fenster speichert 1,5 s nach der letzten Änderung automatisch („Entwurf gespeichert“).
  Schließen (× oder Esc) behält den Entwurf, „Verwerfen“ löscht ihn nach Rückfrage. Entwürfe erscheinen sofort im
  Ordner „Entwürfe“; Doppelklick oder „Entwurf bearbeiten“ öffnet sie wieder. Auf dem Server (IMAP, \\Draft) liegt
  immer nur die aktuelle Fassung – hochgeladen nach 8 s Schreibpause bzw. beim Abruf. Entwürfe von anderen Geräten
  lassen sich weiterschreiben. Senden löscht den Entwurf. Migration `v6-drafts`.
- **Adressvorschläge** in An/Cc/Bcc: passend zu Name oder Adresse; wem man geschrieben hat, steht oben (5-fach),
  dann Absender empfangener Mails, bei Gleichstand der zuletzt genutzte. ↑/↓, Enter/Tab übernimmt, Esc schließt nur
  die Liste. Eigene Adressen werden nicht vorgeschlagen. Enter in einem Feld sendet nicht mehr (nur Knopf/Strg+Enter).
- **Signatur pro Konto** in den Optionen (mit demselben Editor, formatierbar). Steht unter neuen Mails, Antworten
  und Weiterleitungen – bei Antworten über dem Zitat. Migration `v7-account-signature`.
- **Weiterleiten mit Original-Layout:** Bei HTML-Mails bleibt das Original außerhalb des Editors und wird unverändert
  (bereinigt: ohne Skripte/Formulare) unter den eigenen Text gehängt; Vorschau im Mail-Fenster. Anhänge der
  Originalmail gehen mit (einzeln abwählbar) und werden erst beim Senden vom Server geholt.

## W3 (Teil 1) – Mails schreiben und senden

### Neu
- **Composer:** Neue E-Mail, Antworten, Allen antworten, Weiterleiten – Knöpfe in der Mail, „Neue E-Mail“ über der
  Liste, Tasten N, R, A, F (und Strg+N), Senden mit Strg+Enter. Antworten zitieren die Mail („> “), setzen
  In-Reply-To/References und lassen bei „Allen antworten“ die eigenen Adressen weg. Empfängerzeile versteht
  „Name <adresse>“, Kommas in Anführungszeichen und Semikolons; ungültige Adressen werden benannt.
- **Senden per SMTP** (nodemailer 10) über einen **dauerhaften Postausgang** (Migration `v5-outbox`): Die Mail ist
  sofort gesichert, geht im Hintergrund raus und wird danach in „Gesendet“ abgelegt (außer Gmail/Outlook, die das
  selbst tun). Nach dem Senden wird die Originalmail als „beantwortet“ markiert. Bcc steht nur im Umschlag.
- **Offline/Fehler:** Server nicht erreichbar → Mail bleibt im Postausgang, neuer Versuch beim nächsten Abruf;
  vom Server abgelehnt → Hinweis „Nicht gesendet“ in der Seitenleiste mit „Bearbeiten“ (zurück in den Composer).
  Einmal angenommene Mails werden nie doppelt gesendet. Nichts wird ohne Klick auf „Senden“ verschickt.
- Test: Die Methodenliste der Preload-Brücke wird gegen die Schnittstellen geprüft (hatte „send“ vergessen).

- **Formatierung (Wunsch des Nutzers):** Leiste im Mail-Fenster mit Schriftart (11 gängige Schriften, die auch
  beim Empfänger vorhanden sind), Schriftgröße in pt, Fett/Kursiv/Unterstrichen/Durchgestrichen (Strg+B/I/U),
  Textfarbe, Aufzählung, Nummerierung, Zitat, Ausrichtung, Link, „Formatierung entfernen“. Editor: TipTap 3.
  Versand als multipart/alternative (HTML mit Inline-Stilen + daraus erzeugter Nur-Text-Fassung).
  Das Mail-Fenster wird erst beim ersten Öffnen geladen (Startpaket bleibt ~0,85 MB).
- Tests warten auf die Bereitschaft von GreenMail (Windows-CI #25 scheiterte direkt nach dem Start; #26 mit
  identischem Code war grün).

### Noch nicht (Teil 2)
- Entwürfe, Anhänge, Adressvorschläge, Bilder im Text; OAuth für Gmail/Outlook.
- Weiterleiten übernimmt die Originalmail bisher als Text (nicht mit ihrer HTML-Gestaltung).

## W2.2 – Zweiter Praxistest (Windows)

### Behoben
- **„Ungelesen“:** Eine angeklickte Mail verschwand sofort aus der Liste und ließ sich nicht lesen. Ursache: Das
  Gelesen-Setzen löste im Hauptprozess `mail:changed` aus, die Liste wurde neu geladen und die Mail gehörte nicht
  mehr dazu. Jetzt bleibt die geöffnete Mail in „Ungelesen“/„Markiert“ stehen, bis man eine andere wählt.
- **Tracking-Schutz:** Externe Bilder in `<style>`-Blöcken und `@import` werden jetzt ebenfalls vom Säubern entfernt
  (bisher fing sie nur die Sicherheitsrichtlinie der App ab).

### Neu
- **„Externe Inhalte laden“** pro Mail (Spezifikation 7.2: externe Bilder nur auf Wunsch). Gilt nur für die
  geöffnete Mail und wird nicht gespeichert; Skripte bleiben auch dann gesperrt.
- **Optionen** (Zahnrad unten in der Seitenleiste) mit **Ausnahmeliste für externe Inhalte**: Adressen
  (`news@shop.example`) oder Domains (`shop.example`, gilt auch für Subdomains). Mails dieser Absender laden
  Bilder sofort; ein Hinweis in der Mail nennt die greifende Ausnahme. Aus einer blockierten Mail führt
  „Für Absender immer laden …“ direkt in die Optionen, mit der Absender-Domain vorausgefüllt.
  Gespeichert in der Datenbank (Migration `v4-remote-content-exceptions`, nur TypeScript – Swift steht in
  `docs/SWIFT-NACHHOLEN.md`).

## W2.1 – Korrekturen nach dem ersten Praxistest (Windows)

Rückmeldung des Nutzers mit echtem iCloud-Konto: Zahlen in der Seitenleiste nicht aktuell, App träge,
Archivieren/Löschen erst nach Wegklicken sichtbar, Scrollen geht nicht.

### Behoben
- **Scrollen:** Spalten durften nicht kleiner als ihr Inhalt werden (fehlendes `min-height: 0` im Grid) –
  Listen wurden abgeschnitten statt gescrollt. E2E-Test prüft jetzt das Scrollen (schlägt ohne Fix nachweislich fehl).
- **Aktionen sofort:** Gelesen, Markieren, Archivieren, Papierkorb wirken sofort in Liste und Zählern.
  Übertragung zum Server im Hintergrund über eine **dauerhafte Warteschlange** (Tabelle `pendingAction`,
  Migration `v3-pending-actions` in TypeScript und Swift) – überlebt Neustart und fehlendes Internet
  (vorgezogen aus W3). Vor jedem Abruf wird die Warteschlange zuerst übertragen.
- **Verbindung wiederverwenden:** eine IMAP-Verbindung pro Konto bleibt bis zu 2 Minuten offen, statt für
  jede Aktion neu anzumelden (bei iCloud 1–2 s pro Aktion gespart).
- **Zähler:** Seitenleiste mit einem einzigen Aufruf (`overview`) statt einer Anfrage pro Ordner; beim Öffnen
  einer Mail sinkt der Zähler sofort.
- **Abruf blockiert nicht:** Posteingang zuerst, Oberfläche wird nach jedem Ordner aktualisiert, der
  Main-Prozess bekommt zwischen Mails Luft.

### Tests
101 Unit-/Integrationstests (neu: Warteschlange offline und nach Neustart, `overview`, sofortige Zähler und
Listen im Oberflächen-Modell), 3 E2E-Tests (neu: Scrollen, 42 Mails, Archivieren innerhalb 1 s sichtbar).

## Phase W2 – Ein Konto lesen (Windows)

### Fertig
- **Konto einrichten:** Dialog mit Anbieter-Erkennung (iCloud, Gmail, Yahoo, GMX, WEB.DE, T-Online, Posteo,
  mailbox.org; sonst Vorschlag imap./smtp.<domain>), Hinweis und Link zum app-spezifischen Passwort,
  aufklappbare Servereinstellungen, Verbindungstest vor dem Speichern, verständliche Fehlermeldungen,
  Beispielkonten werden auf Wunsch entfernt. Konto entfernen über die Seitenleiste.
- **Passwörter** verschlüsselt mit Windows-DPAPI (Electron `safeStorage`); ohne verfügbare Verschlüsselung
  wird nichts gespeichert. Nie im Log, nie im Klartext auf der Platte.
- **Abgleich (IMAP, imapflow):** Ordner mit Rollen (SPECIAL-USE bzw. Namen), Mails der letzten 30 Tage,
  Flags, auf dem Server gelöschte Mails, UIDVALIDITY-Wechsel. Beim Start, alle 5 Minuten, per F5/Knopf.
  Status und Fehler pro Konto in der Seitenleiste.
- **MIME** (mailparser): Text, HTML, Anhänge (Metadaten), Umlaute/Kodierungen; Vorschau ohne Zitate und Signatur.
- **Konversationen** aus References/In-Reply-To (deterministisch, auch bei ungeordnetem Abruf).
- **Aktionen auf dem Server:** Gelesen/ungelesen, Markieren, Archivieren, Papierkorb (IMAP STORE/MOVE);
  Beispielkonten bleiben lokal.
- **HTML-Mails sicher:** DOMPurify (keine Skripte, Formulare, Frames, Ereignis-Handler), externe Bilder und
  Hintergründe blockiert (mit Hinweis „Schutz vor Tracking“), Anzeige in einem Sandbox-Frame ohne Skripte,
  Links öffnen im Standardbrowser.
- **Datenmodell:** Migration `v2-account-connection` (Anmeldename, Verschlüsselung, Sync-Status) in
  TypeScript **und** Swift.
- **Tests:** 89 Unit-Tests, 6 IMAP-Integrationstests und 1 E2E-Test „Konto einrichten“ gegen einen lokalen
  GreenMail-Testserver (auch in der Windows-CI), 2 weitere E2E-Tests.

### Offen
- Senden, Entwürfe, OAuth (Gmail/Outlook), Offline-Warteschlange → W3.
- Sofortige Zustellung (IDLE), Volltextsuche in der Oberfläche, Anhänge öffnen → W4.
- Externe Bilder auf Wunsch laden, Link-Prüfer → später (7.6).
- Mit einem echten iCloud-Konto noch **ungetestet** (nur gegen den Testserver).

## Phase W1 – Fundament Windows

### Fertig
- **Richtungswechsel:** Fokus zuerst Windows, dann Server mit Browser-Zugriff; iPad/Mac ruht
  (ohne Mac/bezahlten Apple-Account nicht auf Geräten testbar). Roadmap: `docs/ROADMAP-WINDOWS.md`.
- **Struktur `web/`** (npm-Workspaces, TypeScript strikt): `packages/core`, `packages/ui`, `apps/desktop`.
- **Kern:** Modelle wie in der Swift-App; SQLite-Schema mit denselben Tabellen und Migrationen
  (`PRAGMA user_version`), FTS5-Volltextindex ohne Umlaut-Empfindlichkeit; `SqliteMailRepository` und
  `InMemoryMailRepository` mit gemeinsamer Vertrags-Testreihe; gleiche Mock-Daten; verschlüsselter
  Passwortspeicher (`EncryptedFileSecretStore`, in der App mit Windows-DPAPI über Electron `safeStorage`).
- **Oberfläche (React):** Drei-Spalten-Layout wie auf dem iPad; Seitenleiste mit Zählern, Mail-Liste mit
  Kontofarbe (als Balken – nicht mit dem Ungelesen-Punkt verwechselbar), Kategorie-Chips, Schnellaktionen
  beim Überfahren, Rechtsklick-Menü (mit Tastatur bedienbar), lokale Suche; Konversationsansicht mit Anhängen;
  Tastaturkürzel (↑/↓, J/K, E, Entf, S, U, Esc); Deutsch/Englisch nach Systemsprache; hell/dunkel nach Windows.
- **Windows-App (Electron 44):** Datenbank im Main-Prozess, abgesicherte IPC-Brücke (nur freigegebene
  Methoden, Sandbox, Context Isolation, CSP, keine fremde Navigation), Einzelinstanz, deutsches Menü.
  Demo-Datenbank in `%APPDATA%\StinkyMa\demo.sqlite`, Änderungen bleiben nach Neustart erhalten.
- **Tests:** 65 Unit-Tests (Vitest) + 2 E2E-Tests (Playwright startet die echte App, prüft Navigation,
  Tastatur, Kontextmenü, Suche, Neustart) mit Screenshots.
- **CI Windows:** Typprüfung, Tests, E2E und NSIS-Installer als Download-Artefakt. Die Apple-CI läuft nur noch
  bei Änderungen am Swift-Code.

### Offen / Hinweise
- Installer ist nicht signiert → SmartScreen-Warnung beim ersten Start.
- App-Icon ist das Standard-Electron-Icon; App-Name und Bundle-ID sind Platzhalter.
- Suche filtert nur die geladene Liste; die FTS5-Suche wird in W4 angebunden.
- HTML-Mails werden noch nicht angezeigt (nur Text) – kommt mit echten Konten in W2.

## Phase 1 – Fundament

### Fertig
- **Projektstruktur:** Swift Package `StinkyMaKit` mit den Modulen `MailCore`, `MailStore`,
  `PlatformServices` und `AppFeature`; Xcode-Projekt per XcodeGen (`project.yml`) mit je einem
  Target für iPadOS und macOS (native SwiftUI, kein „Designed for iPad“). Swift 6, strikte Concurrency.
- **Oberfläche:** Drei-Spalten-Layout mit `NavigationSplitView`
  - Seitenleiste: „Alle Posteingänge“, „Ungelesen“, „Markiert“ und die Ordner jedes Kontos,
    Kontofarbe, Zähler für Ungelesenes.
  - Mail-Liste: Absender, Betreff, Vorschau, Datum, Kategorie-Chip, Kontofarbe im gemeinsamen
    Posteingang, Symbole für ungelesen/markiert/Anhang, Wischgesten und Kontextmenü
    (gelesen/ungelesen, markieren, archivieren, Papierkorb), lokale Filtersuche.
  - Konversation: alle Mails des Threads über Ordner hinweg (auch gesendete Antworten),
    aufklappbar, Anhang-Chips; Toolbar mit Kurzbefehlen (`E` archivieren, `⌘⌫` Papierkorb,
    `⇧⌘L` markieren).
  - Mac: Einstellungen-Fenster (Platzhalter). Jedes Fenster hat eine eigene Auswahl (Stage Manager).
- **Mock-Daten:** drei erfundene Konten (iCloud, Gmail, eigene Domain) mit ca. 20 deutschen
  Beispielmails inkl. Threads, Anhängen und Kategorien. Alle Adressen enden auf `.example`.
- **Datenbank (GRDB):** Schema für Konten, Ordner, Threads, Mails, Anhänge, Anhang-Analysen und
  -Texte, Embeddings, Verhaltens-Events, Absender- und Stilprofile, Erinnerungen und KI-Modelle
  (Abschnitt 8) als Migration `v1-core`; FTS5-Volltextindex über Betreff, Absender und Text,
  per Trigger synchron, ohne Umlaut-Empfindlichkeit (`v1-fts`).
- **Repository:** `MailRepository`-Protokoll (MailCore) mit GRDB-Implementierung: Bereiche
  (gemeinsamer Posteingang, ungelesen, markiert, Ordner), Threads, Anhänge, Zähler, Flags setzen,
  Verschieben in Archiv/Papierkorb des jeweiligen Kontos.
- **Keychain:** `SecretStore`-Protokoll mit `KeychainSecretStore` (nur dieses Gerät, verfügbar
  nach dem ersten Entsperren – für Hintergrund-Sync) und `InMemorySecretStore` für Tests.
- **Lokalisierung:** String Catalog mit Deutsch als Ausgangssprache und Englisch.
- **Tests:** 43 Tests (Swift Testing) für Modelle, Migrationen, Volltextindex, Repository,
  Mock-Daten, Keychain-Ersatz und das Oberflächen-Modell; laufen unter Linux und macOS.
- **CI:** GitHub Actions testet die Pakete unter Linux und macOS und baut beide Apps.

### Offen / Hinweise
- Die SwiftUI-Oberfläche kompiliert in der macOS-CI (Xcode 26), wurde aber noch nicht im
  Simulator oder auf einem Gerät gestartet.
- Die App nutzt in Phase 1 eine Datenbank im Arbeitsspeicher mit Mock-Daten; das Speichern auf
  Datei (inkl. Dateischutz) kommt mit echten Konten in Phase 2.
- App-Icon ist noch leer; App-Name und Bundle-ID sind Platzhalter (offene Entscheidung).
- Die Suche filtert in Phase 1 nur die geladene Liste; die FTS5-Suche ist vorbereitet und wird
  in Phase 4 angebunden.
- J/K-Navigation, Befehlspalette und weitere Tastaturkürzel folgen in Phase 11.
