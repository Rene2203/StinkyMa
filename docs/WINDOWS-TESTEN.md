# StinkyMa unter Windows installieren und ausprobieren

Die CI baut bei jeder Änderung unter `web/` einen fertigen Windows-Installer.

1. Auf GitHub **Actions** → Workflow **„CI Windows“** → den neuesten grünen Lauf öffnen.
2. Unten unter **Artifacts** auf **StinkyMa-Windows-Installer** klicken → ZIP herunterladen und entpacken.
3. `StinkyMa-Setup-….exe` starten.
4. Windows SmartScreen meldet „Der Computer wurde durch Windows geschützt“, weil der Installer
   nicht signiert ist (eine Code-Signatur kostet Geld). → **Weitere Informationen** → **Trotzdem ausführen**.
5. Installieren (ohne Administratorrechte, für den aktuellen Benutzer). StinkyMa erscheint im Startmenü.

## Erstes echtes Konto einrichten (ab Phase W2)

1. Links unten auf **Konto hinzufügen**.
2. E-Mail-Adresse eingeben. Bekannte Anbieter (iCloud, Gmail, Yahoo, GMX, WEB.DE, T-Online, Posteo,
   mailbox.org) werden erkannt, die Servereinstellungen füllen sich selbst.
3. **iCloud:** Hier brauchst du ein **app-spezifisches Passwort**, nicht dein Apple-Passwort. Erstellen unter
   account.apple.com → *Anmelden und Sicherheit* → *App-spezifische Passwörter*. Der Link „So erstellst du eins“
   im Dialog führt zur Anleitung. Gleiches gilt für Gmail und Yahoo (bei aktivierter Zwei-Faktor-Anmeldung).
4. **Verbinden** – die App testet die Verbindung, speichert das Passwort verschlüsselt (Windows-DPAPI) und
   ruft die Mails der letzten 30 Tage ab. Die Beispielkonten verschwinden dabei (abwählbar).

Outlook/Hotmail geht noch nicht (Microsoft verlangt eine Anmeldung über OAuth – kommt in Phase W3).
**Senden** kommt ebenfalls in W3. Gelesen, Markieren, Archivieren und Papierkorb wirken direkt auf deinem
Mailserver. Mails werden beim Start, alle 5 Minuten und mit **F5** bzw. dem Pfeil-Knopf abgerufen.

## Was du siehst
- Beim ersten Start drei erfundene Beispielkonten, bis du ein echtes Konto einrichtest.
- Änderungen (gelesen, markiert, archiviert) werden gespeichert und sind nach einem Neustart noch da.
- Tastatur: ↑/↓ oder J/K wechseln die Mail · E archivieren · Entf Papierkorb · S markieren · U gelesen/ungelesen · Esc schließt.
- Rechtsklick auf eine Mail öffnet das Kontextmenü; beim Überfahren mit der Maus erscheinen Schnellaktionen.
- Schrift: **Avenir**, sofern sie unter Windows installiert ist (Rechtsklick auf die Schriftdatei → *Für alle Benutzer installieren*); sonst Segoe UI. Die Schrift wird aus Lizenzgründen nicht mitgeliefert.
- Die Oberfläche folgt der Windows-Sprache (Deutsch, sonst Englisch) und dem hellen/dunklen Modus.

Die Daten liegen unter `%APPDATA%\StinkyMa\` (`mail.sqlite` für Mails, `secrets.json` für verschlüsselte Passwörter).
Zum kompletten Zurücksetzen: App schließen, beide Dateien löschen.

## Selbst bauen (optional, für Entwickler)
Voraussetzung: Node.js 22.
```
cd web
npm install
npm run dev        # App im Entwicklungsmodus starten
npm test           # Tests
npm run dist:win   # Installer bauen (unter Windows)
```
