# Changelog

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
