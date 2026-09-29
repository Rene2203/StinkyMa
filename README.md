# StinkyMa – KI-Mail-App für iPadOS und macOS

Native Mail-App im Stil von Spark und Outlook: mehrere Konten in einem gemeinsamen Posteingang,
dazu eine **KI, die auf dem Gerät läuft** und Mails sortiert, zusammenfasst und an Fristen erinnert.
„StinkyMa“ ist ein Arbeitsname; der endgültige App-Name ist noch offen.

Die vollständige Spezifikation liegt in [`docs/SPEZIFIKATION.md`](docs/SPEZIFIKATION.md),
der laufende Zwischenstand in [`docs/ENTWICKLUNGSSTAND.md`](docs/ENTWICKLUNGSSTAND.md),
abgeschlossene Phasen in [`CHANGELOG.md`](CHANGELOG.md).

## Stand

**Phase 1 – Fundament** ist umgesetzt: Drei-Spalten-Layout mit erfundenen Beispielmails,
iPad- und Mac-App, Datenbankschema mit Migrationen, Keychain-Zugriff. Echte Konten folgen in Phase 2.

## Aufbau

```
App/                     SwiftUI-Oberfläche (gemeinsam für iPadOS und macOS)
  Sources/               Views, App-Einstieg
  Resources/             Assets, Localizable.xcstrings (Deutsch, Englisch)
Packages/StinkyMaKit/    Swift Package mit den Kernmodulen
  MailCore               Modelle (Konto, Ordner, Mail, Thread, Anhang), Protokolle
  MailStore              SQLite via GRDB: Schema, Migrationen, FTS5, Repository, Mock-Daten
  PlatformServices       Apple-spezifisches hinter Protokollen (Keychain)
  AppFeature             Zustand der Oberfläche (@Observable), ohne SwiftUI – testbar
project.yml              Beschreibung des Xcode-Projekts (XcodeGen)
StinkyMa.xcodeproj       daraus erzeugt, eingecheckt zum direkten Öffnen
```

`MailCore`, `MailStore` und `AppFeature` importieren weder SwiftUI noch UIKit und bauen
auch unter Linux (Vorbereitung für Web/Windows, Spezifikation Abschnitt 11).

## Loslegen

Voraussetzungen: Xcode 26, iPadOS 26 bzw. macOS 26.

1. `StinkyMa.xcodeproj` in Xcode öffnen.
2. Unter *Signing & Capabilities* das eigene Team wählen.
3. Schema **StinkyMa-iOS** (iPad oder iPad-Simulator) oder **StinkyMa-macOS** starten.

Nach Änderungen an `project.yml` das Projekt neu erzeugen:

```sh
brew install xcodegen
xcodegen generate
```

## Tests

```sh
swift test --package-path Packages/StinkyMaKit
```

Läuft auf macOS und Linux (dort wird `libsqlite3-dev` benötigt). Die GitHub-Actions-Pipeline
testet die Pakete unter Linux und macOS und baut beide Apps.
