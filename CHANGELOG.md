# Changelog

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
