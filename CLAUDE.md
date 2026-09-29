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

## Befehle

```sh
swift build --package-path Packages/StinkyMaKit
swift test  --package-path Packages/StinkyMaKit
xcodegen generate          # nach Änderungen an project.yml, Projekt mit einchecken
```

Unter Linux gibt es kein SwiftUI: die App-Sources (`App/`) werden nur auf macOS gebaut (CI-Job
„Apps (iPadOS & macOS)“).
