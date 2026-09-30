# Entwicklungsstand

Laufendes Protokoll des Zwischenstands. Wird nach jedem größeren Arbeitsschritt aktualisiert –
nicht erst am Ende einer Phase. Abgeschlossene Phasen stehen zusätzlich in `CHANGELOG.md`.

**Zuletzt aktualisiert:** 30.09.2026
**Aktuelle Phase:** 1 – Fundament (umgesetzt, baut in CI; Abnahme auf Gerät steht aus)

## Überblick

| Phase | Status |
|---|---|
| 1 – Fundament | 🟢 Code fertig, CI grün (Linux + macOS, beide Apps bauen); Start auf Gerät noch ungeprüft |
| 2 – Ein Konto lesen | ⚪ offen |
| 3–15 | ⚪ offen |

## Was funktioniert (geprüft)

- Kernmodule `MailCore`, `MailStore`, `PlatformServices`, `AppFeature` bauen unter Linux
  (Swift 6.1, strikte Concurrency, ohne Warnungen).
- 43 Tests grün: Modelle, Migrationen, FTS5-Index, Repository (gemeinsamer Posteingang,
  Ungelesen, Markiert, Threads, Flags, Archiv/Papierkorb), Mock-Daten, Keychain-Ersatz,
  Oberflächen-Modell (Auswahl, Als-gelesen-Markieren, Auswahl nach Archivieren).
- Xcode-Projekt lässt sich aus `project.yml` erzeugen (XcodeGen).
- CI-Lauf #2 (29.09.2026) grün: Pakettests unter Linux und macOS (inkl. Keychain-Test),
  macOS-App und iPadOS-App (Simulator) bauen mit Xcode 26 ohne Fehler.

## Was noch nicht geprüft ist

- **Aussehen und Bedienung:** Die App kompiliert, wurde aber noch nie gestartet (weder Simulator
  noch Gerät). Layout, Wischgesten, Tastaturkürzel und VoiceOver sind ungeprüft.
- Keychain-Test in CI: Läuft ohne Signatur; falls der Keychain dort `errSecMissingEntitlement`
  meldet, wird der Test stillschweigend übersprungen – echter Nachweis erst in der signierten App.

## Testen ohne Mac

Der Nutzer hat keinen Mac. Deshalb startet die CI die iPad-App im Simulator, klickt sich per
UI-Test durch (Posteingang → Mail öffnen → „Markiert“ → Entwürfe) und lädt Screenshots als
Artefakt `ipad-screenshots` hoch (Skript: `scripts/ci-ipad-screenshots.sh`).
Zum Selbst-Ausprobieren erzeugt die CI außerdem ein **App-Playground für Swift Playgrounds auf dem
iPad** (Artefakt `StinkyMa-Playground`, Anleitung: `docs/IPAD-TESTEN.md`). TestFlight scheidet
vorerst aus: Der Nutzer hat nur einen kostenlosen Developer-Account.
Konsequenz für die Planung: Features, die eine signierte App brauchen (Widgets, Hintergrund-Sync,
App Intents, großes RAM-Limit für lokale Modelle), lassen sich derzeit nicht auf dem Gerät testen.

## Nächste Schritte

1. Abnahme Phase 1 auf iPad und Mac (App startet, Mock-Posteingang, Navigation).
2. Phase 2 beginnen: IMAP-Client (`MailSync` mit `swift-nio-imap`), iCloud-Login mit
   app-spezifischem Passwort, MIME-Parser, HTML-Anzeige, Datenbank als Datei.

## Offene Entscheidungen (aus Spezifikation, Abschnitt 12)

- App-Name (Arbeitsname „StinkyMa“), Bundle-ID `de.stinkyma.*` ist Platzhalter
- Private Nutzung oder App-Store-Release
- Kuratierte Modellliste, Heimserver-Funktionen, Web/Windows, Beleg-Export, Türsteher-Standard

## Verlauf

### 29.09.2026
- Phase 1 umgesetzt: Paketstruktur, GRDB-Schema mit Migrationen, Keychain-Wrapper,
  Mock-Daten, Drei-Spalten-Layout für iPadOS und macOS, String Catalog (de/en), CI.
- Spezifikation nach `docs/SPEZIFIKATION.md` übernommen.
- Erster CI-Build: beide Apps kompilieren auf Anhieb. Veralteten Info.plist-Schlüssel
  `UIRequiresFullScreen` entfernt (iOS-26-Warnung).

### 30.09.2026
- UI-Test für die Abnahme von Phase 1 (`App/UITests`) und CI-Schritt, der die iPad-App im
  Simulator startet und Screenshots erzeugt. Accessibility-Kennungen für Liste, Seitenleiste
  und Konversation ergänzt.
- Erster UI-Testlauf im iPad-Simulator (iOS 26.5): **App startet, Mock-Posteingang erscheint,
  Mail öffnen zeigt die Konversation** ✅. Fehlgeschlagen beim Tippen auf „Markiert“ in der
  Seitenleiste: Die Test-Kennung hing am Symbol statt an der Zeile. Behoben; außerdem exportiert
  das Skript Screenshots jetzt auch bei fehlgeschlagenem Test.
- Zweiter Lauf (#9): Posteingang ✅, Konversation ✅, Seitenleiste „Markiert“ ✅. Fehlgeschlagen erst
  beim Entwurfsordner des dritten Kontos: liegt im Querformat unterhalb des sichtbaren Bereichs.
  Test nutzt jetzt den Gmail-Posteingang. Außerdem: Artefakt-Upload scheiterte an Dateinamen mit
  Anführungszeichen (Debug-Anhänge) → nur eigene Screenshots + Bildschirmaufnahme behalten.
  Playground-Schritt läuft jetzt vor dem UI-Test, damit das Paket auch bei rotem UI-Test entsteht.
  **Dritter Lauf steht aus.**
- Swift-Playgrounds-Export (`scripts/make-playground.sh`): kopiert alle Module in ein App-Target.
  Unter Linux geprüft, dass die Kernmodule als ein Modul kompilieren; Playground-Build in der CI
  (Xcode) und Öffnen auf dem iPad **noch ungeprüft**.
