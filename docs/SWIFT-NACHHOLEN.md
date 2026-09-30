# Swift-Seite: später nachholen

Die iPad-/Mac-App (Swift, `App/` und `Packages/StinkyMaKit`) ist seit 30.09.2026 zurückgestellt
(Entscheidung des Nutzers: Ressourcen auf Windows und Server bündeln). Das Ziel iPad/Mac bleibt bestehen.

**Stand beim Zurückstellen:** Phase 1 der Swift-App (Mock-Posteingang, Navigation, Datenbank). Schema bis
Migration `v3-pending-actions` in Swift und TypeScript gleich; 43 Swift-Tests grün. Der iPad-UI-Test lief zuletzt
rot wegen eines Zeitlimits auf dem CI-Simulator (Lauf #13); die Korrektur (Zeitlimits 30 s) ist eingecheckt,
aber ungeprüft.

**Wieder aufnehmen:** Apple-CI von Hand starten (Actions → „CI iPad & Mac“ → „Run workflow“), dann die Liste
unten abarbeiten.

## Offene Punkte

| Seit | Was | Wo in TypeScript |
|------|-----|------------------|
| – | (noch nichts – neue Migrationen ab v4 und Funktionen hier eintragen) | |

Funktional fehlt der Swift-App alles ab Windows-Phase W2 (echte IMAP-Konten, Abruf, Warteschlange, HTML-Ansicht).
Die Logik dazu liegt plattformneutral in `web/packages/core` und dient als Vorlage.
