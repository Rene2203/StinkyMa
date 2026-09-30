# StinkyMa – KI-Mail-App für iPadOS und macOS

Native Mail-App im Stil von Spark und Outlook: mehrere Konten in einem gemeinsamen Posteingang,
dazu eine **KI, die auf dem Gerät läuft** und Mails sortiert, zusammenfasst und an Fristen erinnert.
„StinkyMa“ ist ein Arbeitsname; der endgültige App-Name ist noch offen.

Die vollständige Spezifikation liegt in [`docs/SPEZIFIKATION.md`](docs/SPEZIFIKATION.md),
der laufende Zwischenstand in [`docs/ENTWICKLUNGSSTAND.md`](docs/ENTWICKLUNGSSTAND.md),
abgeschlossene Phasen in [`CHANGELOG.md`](CHANGELOG.md).

## Stand

**Aktueller Fokus: Windows**, danach Server mit Browser-Zugriff (siehe [`docs/ROADMAP-WINDOWS.md`](docs/ROADMAP-WINDOWS.md)).

- **Windows-App – Phase W1 (Fundament)** ist umgesetzt: Drei-Spalten-Oberfläche mit Beispielmails, SQLite,
  verschlüsselter Passwortspeicher, Installer aus der CI. Installation: [`docs/WINDOWS-TESTEN.md`](docs/WINDOWS-TESTEN.md).
- **iPad/Mac – Phase 1** ist umgesetzt und im Simulator abgenommen, ruht aber vorerst.

## Aufbau

```
web/                     Windows-App & später Server (TypeScript)
  packages/core          Modelle, SQLite-Speicher, Repository, Mock-Daten
  packages/ui            React-Oberfläche
  apps/desktop           Electron-App für Windows
```

iPad/Mac (Swift, ruht vorerst):

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

### Ohne Mac: Swift Playgrounds auf dem iPad

Siehe [`docs/IPAD-TESTEN.md`](docs/IPAD-TESTEN.md). Die CI erzeugt dafür bei jedem Push ein
App-Playground zum Herunterladen.

## Tests

```sh
swift test --package-path Packages/StinkyMaKit
```

Läuft auf macOS und Linux (dort wird `libsqlite3-dev` benötigt). Die GitHub-Actions-Pipeline
testet die Pakete unter Linux und macOS und baut beide Apps.
