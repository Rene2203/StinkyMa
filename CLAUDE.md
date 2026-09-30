# Hinweise für Claude Code

- Spezifikation: `docs/SPEZIFIKATION.md`. Phasenweise arbeiten (Abschnitt 9); jede Phase endet mit
  lauffähigem, getestetem Code und einem Eintrag in `CHANGELOG.md`.
- **Zwischenstand dokumentieren (Wunsch des Nutzers, wichtig):** `docs/ENTWICKLUNGSSTAND.md` nach jedem
  größeren Arbeitsschritt aktualisieren – spätestens vor jedem Push. Darin: aktuelle Phase, was geprüft
  funktioniert, was ungeprüft ist, nächste Schritte, Verlauf mit Datum. Ehrlich bleiben: Ungetestetes
  als ungetestet markieren.
- Qualitätsregeln (Abschnitt 10): Swift 6 mit strikter Concurrency, keine Force-Unwraps außer in
  Tests, keine Secrets oder Mail-Inhalte in Logs, UI-Texte deutsch in `App/Resources/Localizable.xcstrings`
  (Englisch als zweite Sprache).
- `MailCore`, `MailSync`, `MailStore`, `AIKit` und `AppFeature` dürfen weder SwiftUI noch UIKit
  importieren. Apple-Spezifisches gehört hinter Protokolle nach `PlatformServices`.
- Datenbank: bestehende Migrationen in `MailSchema.swift` nie ändern, neue anhängen.
- Testdaten sind erfunden; Adressen enden auf `.example`.

## Leitplanken (vom Nutzer, verbindlich)

- **Ursprüngliches Ziel bleibt:** iPad/Mac, Windows und Server mit Browser. Windows ist nur die erste Plattform.
  Nichts bauen, was die anderen Plattformen verbaut; Datenmodell und Schnittstellen parallel halten.
- **KI-Maßstab ist ein ~3B-Modell auf schwacher Hardware** (Low-End-PC, N97-Server, iPad). Größere Modelle
  sind optional, nie Voraussetzung. Der starke Haupt-PC des Nutzers (RTX 4070 Ti Super) ist nicht der Standard.

## Aktueller Fokus: Windows (web/)

Seit 30.09.2026: zuerst Windows-App, dann Server mit Browser (`docs/ROADMAP-WINDOWS.md`). Die Swift-App ruht.
- `web/packages/core`: plattformneutral (kein Electron/DOM). SQLite-Teil nur über `@stinkyma/core/sqlite`,
  Node-spezifisches über `@stinkyma/core/node` – damit die Oberfläche kein natives Modul einbündelt.
- `web/packages/ui`: spricht nur mit `MailRepository`. UI-Texte in `packages/ui/src/i18n.ts` (de + en).
- Schema-Änderungen immer in **beiden** Welten gleich halten (`MailSchema.swift` ↔ `web/packages/core/src/sqlite/schema.ts`).

```sh
cd web
npm install
npm test                                  # Vitest: Kern + Oberfläche
npm run typecheck
npm run build                             # Electron-App bauen
cd apps/desktop && xvfb-run -a npx playwright test   # E2E unter Linux (Windows: npx playwright test)
```

## Befehle (iPad/Mac)

```sh
swift build --package-path Packages/StinkyMaKit
swift test  --package-path Packages/StinkyMaKit
xcodegen generate          # nach Änderungen an project.yml, Projekt mit einchecken
```

Unter Linux gibt es kein SwiftUI: die App-Sources (`App/`) werden nur auf macOS gebaut (CI-Job
„Apps (iPadOS & macOS)“).
