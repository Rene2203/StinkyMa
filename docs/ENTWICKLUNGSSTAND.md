# Entwicklungsstand

Laufendes Protokoll des Zwischenstands. Wird nach jedem größeren Arbeitsschritt aktualisiert –
nicht erst am Ende einer Phase. Abgeschlossene Phasen stehen zusätzlich in `CHANGELOG.md`.

**Zuletzt aktualisiert:** 29.09.2026
**Aktuelle Phase:** 1 – Fundament (umgesetzt, Kompilier-Prüfung der Apps läuft)

## Überblick

| Phase | Status |
|---|---|
| 1 – Fundament | 🟡 Code fertig, Kernmodule getestet; SwiftUI-Apps warten auf ersten CI-Build |
| 2 – Ein Konto lesen | ⚪ offen |
| 3–15 | ⚪ offen |

## Was funktioniert (geprüft)

- Kernmodule `MailCore`, `MailStore`, `PlatformServices`, `AppFeature` bauen unter Linux
  (Swift 6.1, strikte Concurrency, ohne Warnungen).
- 43 Tests grün: Modelle, Migrationen, FTS5-Index, Repository (gemeinsamer Posteingang,
  Ungelesen, Markiert, Threads, Flags, Archiv/Papierkorb), Mock-Daten, Keychain-Ersatz,
  Oberflächen-Modell (Auswahl, Als-gelesen-Markieren, Auswahl nach Archivieren).
- Xcode-Projekt lässt sich aus `project.yml` erzeugen (XcodeGen).

## Was noch nicht geprüft ist

- **SwiftUI-Oberfläche (`App/Sources`)** wurde ohne Xcode geschrieben und noch nie kompiliert.
  Erster Build läuft im CI-Job „Apps (iPadOS & macOS)“.
- `KeychainSecretStore` läuft nur auf Apple-Plattformen; der Test dafür läuft erst in der macOS-CI.
- Aussehen und Bedienung auf echtem iPad/Mac: noch niemand hat die App gestartet.

## Nächste Schritte

1. CI-Ergebnis auswerten, Kompilierfehler der Apps beheben.
2. Abnahme Phase 1 auf iPad und Mac (App startet, Mock-Posteingang, Navigation).
3. Phase 2 beginnen: IMAP-Client (`MailSync` mit `swift-nio-imap`), iCloud-Login mit
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
