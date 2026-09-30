# Entwicklungsstand

Laufendes Protokoll des Zwischenstands. Wird nach jedem größeren Arbeitsschritt aktualisiert –
nicht erst am Ende einer Phase. Abgeschlossene Phasen stehen zusätzlich in `CHANGELOG.md`.

**Zuletzt aktualisiert:** 30.09.2026
**Aktueller Fokus:** Windows-App (`web/`), danach Server mit Browser – Roadmap: `docs/ROADMAP-WINDOWS.md`
**Aktuelle Phase:** W2.1 – Korrekturen nach dem ersten Praxistest (Windows-CI Lauf #17 grün; erneuter Test beim Nutzer steht aus)

## Überblick

| Phase | Status |
|---|---|
| **W1 – Fundament Windows** | 🟢 fertig: 65 Unit-Tests + 2 E2E-Tests grün unter Linux **und Windows**; Installer wird gebaut |
| W2 – Ein Konto lesen (IMAP, iCloud) | 🟢 fertig: Konto-Dialog, IMAP-Abgleich, Server-Aktionen, sichere HTML-Anzeige; Windows-CI Lauf #14 grün (95 Tests inkl. IMAP-Integration, 3 E2E inkl. Konto-Einrichtung mit DPAPI). Offen: echtes iCloud-Konto |
| W3–W5, S1 (Server & Browser) | ⚪ offen |
| iPad/Mac Phase 1 | ⏸️ fertig und im Simulator abgenommen, **ruht** (siehe unten) |

## Windows – was geprüft funktioniert (lokal, Linux-Container)
- Kernpaket: Schema/Migrationen, FTS5, beide Repository-Implementierungen (gemeinsame Vertragstests),
  Mock-Daten, verschlüsselter Passwortspeicher (mit Test-Verschlüsselung).
- Oberflächen-Zustand (BrowserStore): Laden, Auswahl, Gelesen-Markieren, Archivieren mit Folgeauswahl,
  Tastatur-Navigation, Suche, Fehlerbehandlung.
- E2E mit der echten Electron-App: Posteingang, Mail öffnen (Zähler sinkt), „Markiert“, Gmail-Posteingang,
  ↓ + E (archivieren), Rechtsklick-Menü inkl. Escape, Suche, Daten bleiben nach Neustart erhalten.
- Gepackte App (electron-builder, Linux-Variante) startet und zeigt die Mails – `better-sqlite3` (Node-API)
  funktioniert ohne Neubau in Node und Electron.
- Screenshots: `docs/screenshots/windows-*.png`

- **Windows-CI (Lauf #1, windows-latest): auf Anhieb grün** – Typprüfung, Tests, E2E mit der echten App,
  NSIS-Installer (~120 MB). Screenshots mit echter Windows-Darstellung (Segoe UI) in `docs/screenshots/windows-*.png`.

## Windows – noch ungeprüft
- **Installation beim Nutzer** (SmartScreen, Startmenü, Deinstallation), hoher DPI-Wert, dunkler Modus,
  Windows-DPAPI (`safeStorage`) auf einem echten Benutzerkonto.
- `EncryptedFileSecretStore` mit echter DPAPI (wird erst ab W2 genutzt).

## Nächste Schritte
1. Nutzer: Installer aus Windows-CI **Lauf #14** testen und ein echtes Konto (z. B. iCloud mit app-spezifischem Passwort) einrichten.
2. Phase W3: Senden (SMTP), Composer, Entwürfe, OAuth für Gmail/Outlook, Offline-Warteschlange.
3. Hardware: Haupt-PC (Windows) mit RTX 4070 Ti Super 16 GB – dort testet der Nutzer. **Maßstab für die KI
   bleibt ein 3B-Modell auf schwacher Hardware** (Leitplanken in `docs/ROADMAP-WINDOWS.md`).

## iPad/Mac (ruht)
Grund: Ohne Mac und ohne bezahlten Apple-Developer-Account (99 €/Jahr) kann der Nutzer die App nicht auf
Geräten testen. Stand: Phase 1 fertig, CI grün, UI-Test im iPad-Simulator besteht. Die Apple-CI läuft nur
noch bei Änderungen am Swift-Code. Details im Verlauf unten.

## Testen ohne Mac

Der Nutzer hat keinen Mac. Deshalb startet die CI die iPad-App im Simulator, klickt sich per
UI-Test durch (Posteingang → Mail öffnen → „Markiert“ → Entwürfe) und lädt Screenshots als
Artefakt `ipad-screenshots` hoch (Skript: `scripts/ci-ipad-screenshots.sh`).
Zum Selbst-Ausprobieren erzeugt die CI außerdem ein **App-Playground für Swift Playgrounds auf dem
iPad** (Artefakt `StinkyMa-Playground`, Anleitung: `docs/IPAD-TESTEN.md`). TestFlight scheidet
vorerst aus: Der Nutzer hat nur einen kostenlosen Developer-Account.
Konsequenz für die Planung: Features, die eine signierte App brauchen (Widgets, Hintergrund-Sync,
App Intents, großes RAM-Limit für lokale Modelle), lassen sich derzeit nicht auf dem Gerät testen.

## Nächste Schritte

1. Abnahme Phase 1 auf iPad und Mac (App startet, Mock-Posteingang, Navigation).
2. Phase 2 beginnen: IMAP-Client (`MailSync` mit `swift-nio-imap`), iCloud-Login mit
   app-spezifischem Passwort, MIME-Parser, HTML-Anzeige, Datenbank als Datei.

## Offene Entscheidungen (aus Spezifikation, Abschnitt 12)

- Heimserver: Rollen der drei Rechner, Betriebssystem/Docker auf dem N97 (für Phase S1)

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
  und Konversation ergänzt.
- Erster UI-Testlauf im iPad-Simulator (iOS 26.5): **App startet, Mock-Posteingang erscheint,
  Mail öffnen zeigt die Konversation** ✅. Fehlgeschlagen beim Tippen auf „Markiert“ in der
  Seitenleiste: Die Test-Kennung hing am Symbol statt an der Zeile. Behoben; außerdem exportiert
  das Skript Screenshots jetzt auch bei fehlgeschlagenem Test.
- Zweiter Lauf (#9): Posteingang ✅, Konversation ✅, Seitenleiste „Markiert“ ✅. Fehlgeschlagen erst
  beim Entwurfsordner des dritten Kontos: liegt im Querformat unterhalb des sichtbaren Bereichs.
  Test nutzt jetzt den Gmail-Posteingang. Außerdem: Artefakt-Upload scheiterte an Dateinamen mit
  Anführungszeichen (Debug-Anhänge) → nur eigene Screenshots + Bildschirmaufnahme behalten.
  Playground-Schritt läuft jetzt vor dem UI-Test, damit das Paket auch bei rotem UI-Test entsteht.
- Dritter Lauf (#11): Playground-Paket ließ sich nicht auflösen – Platzhalter-Icon `.mail` gibt es
  in AppleProductTypes nicht → `.leaf`. UI-Test läuft jetzt auch, wenn der Playground-Schritt
  scheitert.
- Vierter Lauf (#13) **komplett grün**: Pakettests, macOS-App, Playground-Paket, iPad-UI-Test.
  Abnahme Phase 1 im Simulator erfüllt: App startet, Mock-Posteingang, Navigation (Mail öffnen,
  „Markiert“, Gmail-Posteingang), Ungelesen-Zähler sinkt beim Öffnen (8 → 7).
  Screenshots: `docs/screenshots/phase1-*.png`.
- Beobachtungen für später (UI-Feinschliff): Bei ungelesenen iCloud-Mails stehen zwei blaue Punkte
  nebeneinander (Ungelesen + Kontofarbe) – verwechselbar. Die blaue Auswahl der Liste scheint durch
  die schwebende Seitenleiste (iPadOS-26-Stil) hindurch.
- Swift-Playgrounds-Export (`scripts/make-playground.sh`): kopiert alle Module in ein App-Target.
  Unter Linux geprüft, dass die Kernmodule als ein Modul kompilieren; Playground-Build in der CI
  (Xcode) und Öffnen auf dem iPad **noch ungeprüft**.
- **Richtungswechsel:** Nutzer kann iOS derzeit nicht testen → Fokus „zuerst voll auf Windows“, danach
  Server mit Browser. Architektur: TypeScript-Workspaces unter `web/` (Kern, React-Oberfläche, Electron-App),
  derselbe Kern und dieselbe Oberfläche später im Server. Begründung TypeScript statt Swift unter Windows:
  ausgereifte Mail-Bibliotheken (imapflow, mailparser, nodemailer), Electron/Installer-Werkzeuge,
  eine Sprache für Windows-App und Server.
- Phase W1 umgesetzt (siehe Überblick). Gefundener und behobener Fehler beim E2E-Test: Escape schloss das
  Rechtsklick-Menü nicht, weil das App-weite Tastenkürzel ein Neu-Rendern auslöste, das den Listener des
  Menüs während desselben Ereignisses entfernte. Menü behandelt Tasten jetzt selbst (inkl. ↑/↓).
- Erster Windows-CI-Lauf auf Anhieb grün, Installer-Artefakt verfügbar. Hardware des Nutzers erfasst
  (N97 12 GB, PC mit RTX 2070 Super/32 GB, i5-14600K/32 GB) und Rollen vorgeschlagen.
- Schrift: Nutzer wünscht Avenir. Umgesetzt als bevorzugte Systemschrift (Avenir Next / Avenir, Fallback Segoe UI).
  Die Schriftdateien werden bewusst **nicht** ins Repository oder den Installer aufgenommen (kommerzielle
  Lizenz; Weitergabe/Einbettung nur mit entsprechender Lizenz). Auf dem Rechner des Nutzers ungeprüft.
- Nutzer bestätigt: Windows zuerst. Haupt-PC: Ryzen 9 5900X, RTX 4070 Ti Super (16 GB VRAM), 32 GB –
  geeignet für lokale 7–14B-Modelle (Phase W5). Die drei anderen Rechner sind Server (später, S1).
- **Leitplanken vom Nutzer bekräftigt:** ursprüngliches Ziel (iPad, Windows, Server) bleibt; KI-Kernfunktionen
  müssen mit einem 3B-Modell auf Low-End-Hardware funktionieren; der Haupt-PC ist nicht der Maßstab.
  Festgehalten in `docs/ROADMAP-WINDOWS.md` und `CLAUDE.md`.
- **W2, Teil 1 (Kern):** Datenmodell um Anmeldename, Verbindungssicherheit und Sync-Status erweitert –
  Migration `v2-account-connection` in TypeScript **und** Swift (iPad-Parität, 43 Swift-Tests grün).
  Neues Modul `@stinkyma/core/mail`: Anbieter-Erkennung (iCloud, Gmail, Yahoo, GMX, WEB.DE, T-Online, Posteo,
  mailbox.org; Outlook braucht OAuth → W3), Ordnerrollen (SPECIAL-USE, sonst Namen inkl. deutsch),
  deterministische Konversations-IDs aus References/In-Reply-To, MIME-Parsing (mailparser; Vorschau ohne
  Zitate/Signatur; HTML→Text), IMAP-Abgleich (imapflow): 30 Tage, neue Mails, Flags, gelöschte Mails,
  UIDVALIDITY-Wechsel. `MailService`: Lesen aus SQLite; bei echten Konten wirken Gelesen/Markieren/Archivieren/
  Papierkorb zuerst auf dem Server; Beispielkonten bleiben lokal; Konto hinzufügen testet die Verbindung,
  speichert das Passwort verschlüsselt und entfernt auf Wunsch die Beispielkonten; verständliche deutsche
  Fehlermeldungen ohne Zugangsdaten.
- Tests: 83 Unit-Tests + 6 Integrationstests gegen einen lokalen **GreenMail**-Testserver (nie gegen echte
  Konten). Ohne Testserver werden die Integrationstests übersprungen.
- **W2, Teil 2 (App):** Windows-App nutzt jetzt `MailService` (Datenbank `mail.sqlite`, Beispielkonten bis zum
  ersten echten Konto), IPC-Kanal „accounts“, Änderungs-Meldungen an die Oberfläche, Abgleich alle 5 Minuten.
  Oberfläche: Dialog „Konto hinzufügen“, Abruf-Status und Knopf (F5), Fehler-Symbol pro Konto, Konto entfernen,
  HTML-Mails im Sandbox-Frame mit DOMPurify und Tracker-Blockade. E2E-Test „Konto einrichten“ gegen GreenMail
  grün (inkl. Server-Archivierung und „gelesen“ auf dem Server). Beobachtet: Ohne Schlüsselbund (Linux-Container)
  verweigert die App das Speichern des Passworts – gewollt; Windows hat immer DPAPI.
  Windows-CI startet jetzt ebenfalls GreenMail und testet den kompletten Ablauf.
- **Windows-CI für W2 (Lauf #10): teilweise grün.** Auf echtem Windows funktionieren Konto-Einrichtung mit
  DPAPI, Abgleich gegen GreenMail, HTML-Anzeige mit Tracker-Blockade und „gelesen“ auf dem Server
  (Screenshots). Danach schlug der E2E-Test fehl, und das Schließen der App hing – dadurch war die eigentliche
  Fehlermeldung verdeckt. Test jetzt in benannte Schritte gegliedert, robustes Schließen, vollständiger
  Testbericht (Trace) wird bei Fehlern hochgeladen. Die iPad/Mac-CI mit der Swift-Migration v2 ist grün.
- **Windows-CI Lauf #12 ausgewertet (Testbericht):** Alle Funktionsschritte des Konto-Tests liefen auf Windows
  durch (Einrichtung mit DPAPI, Abgleich, HTML, gelesen, Archivieren per E, Abruf-Knopf). Fehlgeschlagen ist nur
  das Aufräumen: Windows sperrte den temporären Testordner (EBUSY), weil Electron-Prozesse nach dem Test noch
  liefen. Ursache in der App behoben: Beim Beenden trennt der `MailService` offene IMAP-Verbindungen sofort
  (`dispose()`), keine neuen mehr. Aufräumen im Test ist jetzt „bestmöglich“.
- **Windows-CI Lauf #14: komplett grün.** 95 Tests inkl. 6 IMAP-Integrationstests gegen GreenMail, 3 E2E-Tests
  inkl. Konto-Einrichtung mit echter Windows-DPAPI, Archivieren auf dem Server und Abruf-Knopf; Installer gebaut.
  Keine verwaisten Electron-Prozesse mehr – das sofortige Beenden wirkt.
- **Erster Praxistest des Nutzers (echtes iCloud-Konto):** Verbinden klappt, Mails werden angezeigt und lassen
  sich öffnen. Probleme: Zähler nicht aktuell, App träge, Archivieren/Löschen erst nach Wegklicken sichtbar,
  Scrollen geht nicht.
- **W2.1 – Ursachen und Korrekturen:** (1) CSS: Grid-Spalten ohne `min-height: 0` → kein Scrollen. (2) Jede
  Aktion öffnete eine neue IMAP-Verbindung und wartete auf den Server – und hinter einem laufenden Abruf.
  Jetzt: sofort lokal + dauerhafte Warteschlange (`pendingAction`, Migration v3 in TS **und** Swift),
  wiederverwendete Verbindung. (3) Seitenleiste lud jeden Zähler einzeln → ein Aufruf `overview`; Zähler
  sinken sofort. (4) Abruf meldet nach jedem Ordner, Posteingang zuerst, gibt dem Main-Prozess Luft.
  Lokal: 101 Tests + 3 E2E grün (Scroll-Test fällt ohne Fix nachweislich durch). Swift: 43 Tests grün.
  **Ungeprüft:** Verhalten mit echtem iCloud-Konto und großen Postfächern; Windows-CI steht aus.
- **Entscheidung Nutzer:** Die Zahlen in der Seitenleiste zeigen weiterhin die **ungelesenen** Mails (nicht die Gesamtzahl).
- **Windows-CI Lauf #17 (W2.1) grün:** alle Tests inkl. Warteschlange, Scrollen und sofortigem Archivieren auf
  Windows; neuer Installer verfügbar. iPad/Mac-CI (Swift-Migration v3) läuft noch.
