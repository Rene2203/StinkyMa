# Die App auf dem iPad ausprobieren (ohne Mac, ohne bezahlten Account)

Swift Playgrounds (kostenlos im App Store) kann SwiftUI-Apps direkt auf dem iPad bauen und starten.
Die CI erzeugt dafür bei jedem Push ein fertiges App-Playground.

## Einmalig
1. **Swift Playgrounds** aus dem App Store installieren.

## Bei jeder neuen Version
1. Auf dem iPad in Safari das Repository auf GitHub öffnen und anmelden.
2. **Actions** → den neuesten grünen Lauf von „CI“ auf dem Branch öffnen.
3. Ganz unten unter **Artifacts** auf **StinkyMa-Playground** tippen → die ZIP-Datei wird geladen.
4. In der **Dateien**-App die ZIP-Datei antippen → sie wird entpackt, es entsteht `StinkyMa.swiftpm`.
5. `StinkyMa.swiftpm` antippen → öffnet sich in Swift Playgrounds.
6. Beim ersten Öffnen lädt Playgrounds die Datenbank-Bibliothek (GRDB) aus dem Internet – kurz warten.
7. Oben auf **▶︎ (Ausführen)** tippen. Für die volle Ansicht: App-Vorschau auf Vollbild ziehen.

## Was im Playground geht – und was nicht
- ✅ Oberfläche, Navigation, Mock-Mails, später auch echte Konten (IMAP) – bis etwa Phase 4.
- ⚠️ Die Keychain im Playground funktioniert, ist aber an Swift Playgrounds gebunden, nicht an die spätere App.
- ❌ Widgets, Hintergrund-Sync, App Intents, große lokale Modelle: brauchen später eine „echte“ App
  (Apple Developer Program oder ein Mac).

Das Playground wird aus dem Projekt erzeugt (`scripts/make-playground.sh`); Änderungen daran
bitte nicht im Playground machen, sondern im Repository.
