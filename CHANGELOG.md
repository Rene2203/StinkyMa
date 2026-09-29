# Changelog

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
- Die SwiftUI-Oberfläche wurde in einer Linux-Umgebung geschrieben; kompiliert wird sie erst
  in der macOS-CI bzw. in Xcode. Die Kernmodule sind lokal gebaut und getestet.
- Die App nutzt in Phase 1 eine Datenbank im Arbeitsspeicher mit Mock-Daten; das Speichern auf
  Datei (inkl. Dateischutz) kommt mit echten Konten in Phase 2.
- App-Icon ist noch leer; App-Name und Bundle-ID sind Platzhalter (offene Entscheidung).
- Die Suche filtert in Phase 1 nur die geladene Liste; die FTS5-Suche ist vorbereitet und wird
  in Phase 4 angebunden.
- J/K-Navigation, Befehlspalette und weitere Tastaturkürzel folgen in Phase 11.
