# Entwicklungsstand

Laufendes Protokoll des Zwischenstands. Wird nach jedem größeren Arbeitsschritt aktualisiert –
nicht erst am Ende einer Phase. Abgeschlossene Phasen stehen zusätzlich in `CHANGELOG.md`.

**Zuletzt aktualisiert:** 30.09.2026
**Aktueller Fokus:** Windows-App (`web/`), danach Server mit Browser – Roadmap: `docs/ROADMAP-WINDOWS.md`
**Aktuelle Phase:** W1 – Fundament Windows (fertig, auf Windows in der CI geprüft; Installation beim Nutzer steht aus)

## Überblick

| Phase | Status |
|---|---|
| **W1 – Fundament Windows** | 🟢 fertig: 65 Unit-Tests + 2 E2E-Tests grün unter Linux **und Windows**; Installer wird gebaut |
| W2 – Ein Konto lesen (IMAP, iCloud) | ⚪ offen |
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
1. Installer vom Nutzer testen lassen (`docs/WINDOWS-TESTEN.md`).
2. Phase W2: IMAP-Anbindung (imapflow), Konto-Einrichtung iCloud, MIME, sichere HTML-Anzeige.
3. Hardware ist bekannt (N97, PC mit RTX 2070 Super, i5-14600K – Rollenvorschlag in `docs/ROADMAP-WINDOWS.md`).
   Offen: Alltags-PC, Betriebssystem/Docker auf dem N97.

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
