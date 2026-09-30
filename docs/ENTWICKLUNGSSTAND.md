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
Für eigenes Ausprobieren auf dem iPad kommen Swift Playgrounds oder TestFlight infrage (siehe Verlauf).

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
  und Konversation ergänzt. **Status: erster Lauf steht aus.**
