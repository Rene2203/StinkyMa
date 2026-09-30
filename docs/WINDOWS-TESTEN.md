# StinkyMa unter Windows installieren und ausprobieren

Die CI baut bei jeder Änderung unter `web/` einen fertigen Windows-Installer.

1. Auf GitHub **Actions** → Workflow **„CI Windows“** → den neuesten grünen Lauf öffnen.
2. Unten unter **Artifacts** auf **StinkyMa-Windows-Installer** klicken → ZIP herunterladen und entpacken.
3. `StinkyMa-Setup-….exe` starten.
4. Windows SmartScreen meldet „Der Computer wurde durch Windows geschützt“, weil der Installer
   nicht signiert ist (eine Code-Signatur kostet Geld). → **Weitere Informationen** → **Trotzdem ausführen**.
5. Installieren (ohne Administratorrechte, für den aktuellen Benutzer). StinkyMa erscheint im Startmenü.

## Was du in Phase W1 siehst
- Drei erfundene Konten mit Beispielmails (noch keine echten Konten – die kommen in Phase W2).
- Änderungen (gelesen, markiert, archiviert) werden gespeichert und sind nach einem Neustart noch da.
- Tastatur: ↑/↓ oder J/K wechseln die Mail · E archivieren · Entf Papierkorb · S markieren · U gelesen/ungelesen · Esc schließt.
- Rechtsklick auf eine Mail öffnet das Kontextmenü; beim Überfahren mit der Maus erscheinen Schnellaktionen.
- Die Oberfläche folgt der Windows-Sprache (Deutsch, sonst Englisch) und dem hellen/dunklen Modus.

Die Daten liegen unter `%APPDATA%\StinkyMa\demo.sqlite`. Zum Zurücksetzen der Beispieldaten: App schließen, Datei löschen.

## Selbst bauen (optional, für Entwickler)
Voraussetzung: Node.js 22.
```
cd web
npm install
npm run dev        # App im Entwicklungsmodus starten
npm test           # Tests
npm run dist:win   # Installer bauen (unter Windows)
```
