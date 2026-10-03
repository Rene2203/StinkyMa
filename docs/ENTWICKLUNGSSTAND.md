# Entwicklungsstand

Laufendes Protokoll des Zwischenstands. Wird nach jedem größeren Arbeitsschritt aktualisiert –
nicht erst am Ende einer Phase. Abgeschlossene Phasen stehen zusätzlich in `CHANGELOG.md`.

**Zuletzt aktualisiert:** 03.10.2026
**Aktueller Fokus:** Windows-App (`web/`), danach Server mit Browser – Roadmap: `docs/ROADMAP-WINDOWS.md`
**Aktuelle Phase:** W5 – KI-Basis. W5.1–W5.4 gebaut, Windows-CI grün; Messlauf fertig → **Standardmodell Gemma 4 E2B**. **W6 – Assistent:** W6.1 (Zu tun: Termine/Fristen/Zahlungen), W6.2 (Phishing-Check), W6.3 (Türsteher), W6.4 (Regeln in eigenen Worten), W6.5 (Antwortvorschläge) und W6.6 (Tagesüberblick) fertig, lokal geprüft und vom Nutzer unter Windows mit echtem Gmail-Konto getestet – **W6 abgeschlossen**. Danach (Wunsch des Nutzers): Zeitraum „alle Mails“, **Aufräumen**, **Newsletter abbestellen** (Abmelde-Seite im verschiebbaren Fenster in der App) und Umbenennung in **StinkyMail** – gebaut, lokal geprüft. Als Nächstes: Feinabstimmung der Modelle

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

## iPad/Mac (zurückgestellt)
Grund: Ohne Mac und ohne bezahlten Apple-Developer-Account (99 €/Jahr) kann der Nutzer die App nicht auf
Geräten testen; außerdem sollen die Ressourcen auf Windows und Server gebündelt werden. Stand: Phase 1 fertig.
Swift wird nicht mehr mitgezogen, die Apple-CI läuft nur von Hand. Was später nachzuholen ist:
`docs/SWIFT-NACHHOLEN.md`. Das iPad erreicht StinkyMa bis dahin über die Server-Version im Browser.

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

- App-Name: **StinkyMail** (Entscheidung des Nutzers, 01.10.2026); Bundle-ID `de.stinkyma.*` bleibt (Windows: gleiche appId, damit der Installer die alte Version ersetzt)
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
- **iPad/Mac-CI Lauf #13 (W2.1) rot, aber nicht wegen der Migration:** Swift-Paket-Job grün (Migration v3
  läuft, 43 Tests auch lokal grün). Rot war der iPad-UI-Test in Schritt 4 (Gmail-Posteingang, 4 Mails): der
  Simulator brauchte ~80 s, um den Seitenleisten-Eintrag zu finden, danach reichte das 10-s-Limit nicht.
  Korrektur: Zeitlimits in `NavigationUITests` auf 30 s, Fehlermeldung nennt die gefundene Anzahl.
  **Ungeprüft:** ob der UI-Test damit stabil grün ist (nur auf macOS-CI prüfbar).
- **Entscheidung Nutzer: iPad/Mac zurückgestellt.** Kein paralleles Swift-Schema mehr (maßgeblich: `schema.ts`),
  Apple-CI nur noch von Hand, Nachhol-Liste in `docs/SWIFT-NACHHOLEN.md`. Der UI-Test-Fix aus Lauf #13 bleibt
  eingecheckt, aber ungeprüft.
- **Nutzer-Test W2.1:** Speicherproblem gemeldet – laut Screenshot Windows-Dienste (CDPUserSvc, Explorer) und
  PowerToys, StinkyMa nicht darunter. Kein Handlungsbedarf in der App; Nutzer prüft StinkyMa separat.
- **W2.2:** (1) „Ungelesen“: geöffnete Mail verschwand durch Neuladen nach `mail:changed` → bleibt jetzt bis zum
  Auswahlwechsel stehen (Store-Test und E2E-Schritt, beide schlagen ohne Fix nachweislich fehl). (2) Knopf
  „Externe Inhalte laden“ pro Mail, nicht gespeichert; CSP `img-src` um `https: http:` erweitert – Schutz liegt
  damit allein beim Säubern, das jetzt auch `<style>`-Blöcke und `@import` abdeckt (Tests). Lokal: 104 Tests
  + 3 E2E grün. **Ungeprüft:** Windows-CI; echtes Laden externer Bilder (im Test gibt es kein Internet – geprüft
  wird nur, dass die Adresse im Mail-Frame steht).
- **W2.2 – Ausnahmeliste (Wunsch des Nutzers):** Statt eines Knopfs pro Absender in der Mail gibt es jetzt
  **Optionen** (Zahnrad unten links) mit einer Liste von Adressen/Domains, deren externe Inhalte sofort laden.
  Migration v4 (nur TS, Swift auf der Nachhol-Liste). Aus einer blockierten Mail führt ein Link in die
  Optionen, Domain vorausgefüllt. Tests: Normalisierung/Abgleich (u. a. `evilshop.example` greift nicht bei
  `shop.example`), Vertragstest beider Repositorys, Store, E2E (hinzufügen, ungültige Eingabe, entfernen).
  Lokal: 121 Tests + 3 E2E grün. **Ungeprüft:** Windows-CI; echte Bilder aus dem Internet.
- **W3 Teil 1 – Schreiben und Senden:** Composer (Neu/Antworten/Allen antworten/Weiterleiten, Tasten N/R/A/F,
  Strg+Enter), SMTP über nodemailer 10 (Version 7 hatte bekannte Sicherheitslücken), dauerhafter Postausgang
  (Migration v5, nur TS), Ablage in „Gesendet“ per IMAP-APPEND (nicht bei Gmail/Outlook), „beantwortet“-Markierung.
  Geprüft gegen GreenMail: Zustellung, Bcc unsichtbar, In-Reply-To, „Gesendet“, \Answered, SMTP nicht erreichbar
  → bleibt im Postausgang und lässt sich zurückholen; E2E: Antworten per Tastatur bis zur Zustellung, Hinweis bei
  fehlendem Empfänger, Verwerfen fragt nach. Gefunden und behoben: Preload-Brücke kannte „send“ nicht (jetzt per
  Test abgesichert). Lokal: 149 Tests + 3 E2E grün.
  **Ungeprüft:** echtes Senden über iCloud (smtp.mail.me.com:587, STARTTLS, app-spezifisches Passwort) – insbesondere
  ob iCloud die Mail zusätzlich selbst in „Gesendet“ ablegt (dann stünde sie doppelt dort); Windows-CI.
  Bewusst noch nicht: Entwürfe (Verwerfen fragt deshalb nach), Anhänge, Adressvorschläge, HTML-Mails schreiben.
- **Windows-CI #25 rot, #26 grün (gleicher Code):** Alle IMAP-Tests scheiterten beim Aufbau mit „Command failed“,
  3 s nach dem Start von GreenMail. Ursache: Port offen, Server nimmt aber noch keine Befehle an. Korrektur: Tests
  warten, bis ein echter IMAP-Befehl durchgeht. Code der App war nicht betroffen.
- **Formatierung im Mail-Fenster (Wunsch des Nutzers):** TipTap-Editor mit Leiste (Schriftart, pt-Größe, B/I/U/S,
  Farbe, Listen, Zitat, Ausrichtung, Link, Formatierung entfernen). Antworten zitieren als HTML-Blockquote.
  Versand multipart/alternative; Nur-Text-Fassung aus dem HTML (Listen mit „•“, Links mit Adresse, Zitat mit „>“).
  E2E prüft beim Empfänger: <strong>, Liste, Schriftart Georgia, Zitat, Nur-Text. Mail-Fenster wird nachgeladen
  (Startpaket 0,85 MB statt 1,7 MB). Lokal: 154 Tests + 3 E2E grün.
  **Ungeprüft:** Darstellung beim Empfänger in echten Programmen (Outlook, Apple Mail, Gmail); Windows-CI.
- **W3 Teil 2, Baustein 1 – Anhänge:** Öffnen/Speichern empfangener Anhänge (Inhalt bei Bedarf per IMAP geholt,
  `attachmentContent`), riskante Endungen nur speichern, IPC-Kanal „files“ (Preload-Liste per Test geprüft).
  Anhängen im Composer (Knopf, Drag & Drop), Grenzen 18/40 MB. Tests: Dateinamen/Endungen, MIME mit Umlaut-Namen
  (Rundreise durch den Parser), GreenMail: Anhang holen + mit Anhang senden, E2E: Speichern und Öffnen (Dialoge
  im Test ersetzt), .exe ohne Öffnen, Anhang im Composer kommt beim Empfänger an. Lokal 159 Tests + 3 E2E grün.
  **Ungeprüft:** echte Windows-Dialoge und Standardprogramme (im Test ersetzt), Drag & Drop (im Test nicht simuliert).
- **W3 Teil 2, Baustein 2 – Entwürfe:** Tabelle `draft` (v6), lokale Zeile im Ordner „Entwürfe“, Server-Abgleich in
  `#flushDrafts` (APPEND mit \\Draft, alte UID löschen, lokale Zeile auf neue UID umhängen; Revision verhindert,
  dass während des Hochladens Geschriebenes verloren geht). Composer: Autospeichern, Esc/× behält, Verwerfen löscht.
  Gefunden per E2E: Preload kannte die neuen Methoden nicht (Wächter-Test schlug an), Editor schluckte Esc.
  Tests: Vertragstests beider Speicher, GreenMail (ersetzt statt verdoppelt, kein Duplikat nach Abgleich, gelöscht
  nach Senden, iPhone-Entwurf weiterschreiben), E2E (Speichern, Wiederfinden, Server, Verwerfen). Lokal 166 + 3 E2E grün.
  **Ungeprüft:** Verhalten mit iCloud (UIDPLUS wird vorausgesetzt; ohne UIDPLUS könnte eine alte Server-Fassung
  liegen bleiben); Entwürfe mit großen Anhängen (werden bei jeder Server-Fassung komplett hochgeladen).
- **W3 Teil 2, Baustein 3 – Adressvorschläge:** `suggestAddresses` (SQLite: eine Abfrage mit json_each über
  „Gesendet“ + Absender; gleiche Rangfolge `rankContacts` in beiden Speichern), Komponente `AddressInput`
  (Combobox, Tastatur). Nebenbei behoben: Enter in einem Feld hat die Mail sofort gesendet. Tests: Rangfolge,
  Vertragstests (inkl. Sonderzeichen %), Token-Logik, E2E (Jonas nach Antwort oben, Enter übernimmt, Esc).
  Lokal alle Tests + 3 E2E grün. **Ungeprüft:** Tempo bei sehr großen Postfächern (> 50 000 Mails) auf schwacher Hardware.
- **W3 Teil 2, Baustein 4 – Signatur:** Spalte `account.signatureHtml` (v7), `setSignature`, Einfügen in
  `prepareCompose` (neu/Antwort/Weiterleiten), Bereich in den Optionen (Editor wird nachgeladen). Tests: Einfügen und
  Leerzeilen, leere Signatur = keine, Vertragstest, E2E (Signatur mit Fett speichern → steht in neuer Mail).
  **Bekannte Lücke:** Wechselt man im Mail-Fenster das Absender-Konto, bleibt die Signatur des zuerst gewählten Kontos.
- **W3 Teil 2, Baustein 5 – Weiterleiten:** `forwardedHtml`/`forwardedText`/`forwardAttachments` in OutgoingMail,
  `emailHtml` hängt das Original an, MailService holt Original-Anhänge beim Senden (`attachmentContent`), Oberfläche
  bereinigt das Original mit DOMPurify (externe Bilder bleiben für den Empfänger). Tests: Vorbelegung, Versand-HTML,
  GreenMail (Layout + PDF kommen an), E2E (HTML-Rechnung ohne Skript, „Unterlagen“ mit PDF, .exe abgewählt).
  **W3 Teil 2 damit komplett.** Lokal 178 Tests + 3 E2E grün. **Ungeprüft:** alles mit echtem iCloud-Konto;
  Weiterleiten ohne Internet (Original-Anhänge nicht ladbar → Hinweis im Mail-Fenster, Mail bleibt offen).
- **Windows-CI Lauf #40 (W3 Teil 2 komplett) grün** – Installer „StinkyMa-Windows-Installer“ dort. Test mit iCloud
  durch den Nutzer steht aus.
- **01.10.2026 – Gmail (zweitwichtigstes Konto des Nutzers):** Läuft schon mit App-Passwort (Anbieter-Erkennung,
  „Gesendet“ wird von Gmail selbst befüllt). Neu: virtuelle Ordner (\\Flagged, \\Important) werden übersprungen,
  \\All = Archiv, Archiv-Kopien in „Markiert“ nur einmal (beide Speicher, Vertragstest). **Ungeprüft:** echtes
  Gmail-Konto. **Offen:** OAuth-Anmeldung (siehe Abwägung im Chat; braucht ein Google-Cloud-Projekt des Nutzers).
  Bekannt: „Alle Nachrichten“ wird für die letzten 30 Tage zusätzlich geladen (Posteingangsmails doppelt übertragen).
- **Windows-CI Lauf #44 (Gmail-Anpassungen) grün** – aktueller Installer. Antwort des Nutzers zu App-Passwort vs. OAuth steht aus.
- **01.10.2026 – Entscheidung Nutzer:** Gmail vorerst per App-Passwort, weiter mit W4 (OAuth später).
- **W4 Baustein 1 – Volltextsuche:** `search` in beiden Speichern (FTS5 bzw. Textvergleich mit gleicher Logik),
  `parseSearchQuery`/`ftsExpression` (jede Eingabe als Phrase – keine FTS-Syntax-Injektion), Archiv-Duplikate
  (Gmail) ausgeblendet. Oberfläche: Suche aus der Datenbank (200 ms nach der letzten Eingabe), „Alle Ordner“/„Nur hier“,
  Ordnerhinweis, Auswahl bleibt beim Neuladen. Tests: Parser, Vertragstests (Wortanfang, Akzente, von:, Bereich,
  Sonderzeichen, Sortierung), Store, E2E (Wort aus dem Mailtext einer archivierten Mail). Lokal alle grün.
  **Ungeprüft:** Tempo mit sehr großen Postfächern auf schwacher Hardware.
- **W4 Baustein 2 – Neue Mails sofort:** Wächter in `MailService.startWatching` (eigene Verbindung, `idle()` in
  Schleife – das automatische IDLE von imapflow ist bei uns aus), `syncAccountNow(…, { roles: ["inbox"] })`,
  `onNewMail` für neue ungelesene Posteingangsmails. Beim Testen gefunden: „Wächter bereit“ wurde zu früh gemeldet
  (Mails in der Lücke gingen verloren) → bereit erst bei aktivem IDLE + Nachholen nach jedem Verbinden.
  Tests: GreenMail (Meldung kommt, gelesene neue Mails melden nichts, Konto entfernen stoppt die Wache, erster
  Abgleich meldet nichts), Store (Mail aus Benachrichtigung öffnen), E2E (neue Mail erscheint ohne Abruf).
  **Ungeprüft:** die Windows-Benachrichtigung selbst (im Linux-Test nicht darstellbar), IDLE bei iCloud/Gmail über
  Stunden, Verhalten nach Standby/WLAN-Wechsel.
- **W4 Baustein 3 – Infobereich und Autostart:** Tray mit Ungelesen-Punkt, Schließen = verstecken (sofern
  eingestellt), Autostart mit `--hidden`, Benachrichtigungs-Modi, Einstellungsdatei (`SettingsFile`), IPC-Kanal
  „settings“ (Preload-Liste per Test geprüft), Optionen-Bereich „App“. Tests: Einlesen/Standardwerte, Datei samt
  kaputter Datei, E2E (Modus gespeichert, Schließen versteckt, Beenden/Neustart weiterhin sauber).
  **Ungeprüft:** Tray-Symbol und Autostart unter echtem Windows (im Linux-Test ohne Infobereich), Verhalten bei
  Windows-Abmeldung.
- **W4 Baustein 4 – Anhang-Vorschau und -Suche:** `extractAttachmentText` (unpdf, Grenzen), Textauslese im Abgleich,
  `attachmentFTS` (v8) und Suche per UNION (Absender-Filter gilt über die Mail), `AttachmentFiles.read` +
  `previewKind`, Vorschau-Dialog (lazy). Tests: Textauslese inkl. kaputtem PDF, SQLite-Suche im Anhang (ersetzen,
  löschen), GreenMail (PDF beim Abgleich gelesen und gefunden), E2E (kaputtes PDF → Hinweis + extern öffnen;
  echtes PDF → Seite gerendert, Suche findet Anhang-Text). **W4 damit komplett.** Lokal alle Tests + 3 E2E grün.
  **Bekannt:** bereits abgerufene Mails haben noch keinen Anhang-Text (kein erneuter Download); gescannte PDFs ohne
  Textebene bleiben unauffindbar (Texterkennung/OCR später). **Ungeprüft:** Tempo der PDF-Auslese auf dem N97.
- **Windows-CI Lauf #53 (W4 komplett) grün** – aktueller Installer (alle W4-Läufe #47, #49, #51, #53 grün).
  Test durch den Nutzer und Entscheidung zu W5 stehen aus.
- **Entscheidung Nutzer (W5):** Gemma 4 (E2B/E4B, kann auch Bilder und Ton) **und** Qwen 3.5 (2B/4B) werden beide
  eingebaut; ein Messlauf auf einem deutschen Testsatz entscheidet. Regel: Ist Gemma 4 E2B beim deutschen Text nicht
  deutlich schlechter, wird es Standard (wegen Multimodalität). Größere Modelle bleiben optional.
- **W5.1 – KI-Kern (ohne Modell):** `packages/core/src/ai/`: `AIProvider`, `AIRouter` mit Freigabe-Prüfung je Konto
  und Aufgabe (On-Device immer erlaubt; Server/Cloud nur mit Freigabe; ein Konto ohne Freigabe blockiert die ganze
  Anfrage; nie Ausweichen auf einen anderen Anbieter), `PrivacyGuard` (vorerst ohne Funktion) und Übertragungsprotokoll
  nur für Server/Cloud. Eingaben bereinigen (Zitate, Signatur, Newsletter-Fußzeilen, Kürzen; bei langen Konversationen
  Vorrang für die neuesten Mails). Versionierte deutsche Prompts mit JSON-Schema für Kategorie und Zusammenfassung;
  Antwort prüfen, genau ein zweiter Versuch, dann Regeln (Kategorie) bzw. ehrlicher Fehler (Zusammenfassung).
  Modellkatalog mit Download-Adressen, Größen und SHA-256 (Gemma 4 E2B/E4B, Qwen 3.5 2B/4B, je mit Bild-Baustein).
  Tests: 22 neue Unit-Tests (Router-Pflichttests, Auswertung, Regeln, Vorbereitung, Aufgaben mit Test-Anbieter).
  **Ungeprüft:** alles mit echtem Modell – kommt mit W5.2/W5.3.
- **W5.2–W5.4 – Lokale KI in der App (lokal geprüft):**
  - `@stinkyma/core/llm`: `ModelStore` (Download fortsetzbar per HTTP-Range, SHA-256-Prüfung, Abbruch, Löschen),
    `LlamaCppProvider` (node-llama-cpp 3.22.1, JSON-Grammatik aus dem Schema, „Nachdenken“ aus, Anfragen nacheinander,
    Modell nach 5 min Ruhe aus dem Speicher), `AIService` (Einstellungen, Zusammenfassen mit Speicherung, Einordnen im
    Hintergrund – nur Posteingang, letzte 14 Tage, eine Mail nach der anderen, hält bei Modellfehler an).
  - Migration `v9-ai-results` (Herkunft der Kategorie, Tabelle `threadSummary`).
  - App: IPC-Kanal „ai“ (Preload-Liste per Test geprüft), Optionen → KI (Modelle mit Größe/RAM-Hinweis, Laden/Fortsetzen/
    Abbrechen/Verwenden/Löschen), Knopf „Zusammenfassen“ mit Karte (wer ist dran, offene Punkte, „Auf diesem Gerät berechnet
    · Modell“, veraltet-Hinweis). Installer ohne CUDA-Pakete (CPU + Vulkan).
  - Testsatz: 80 erfundene Mails + 10 Konversationen, dazu Kontrollsatz (28 Mails, nie zum Feintuning). Messskript
    `packages/core/scripts/eval-models.ts`.
  - Tests: Download-Manager gegen lokalen HTTP-Server, KI-Dienst, Store, llama.cpp mit echtem Modell (lokal Qwen 3.5 2B)
    und winzigem Testmodell (1 MB, auch in der Windows-CI), E2E in Electron (Optionen → KI, Zusammenfassung end-to-end).
  - **Erstes Messergebnis (Prompt v1, 4 CPU-Kerne, ohne GPU):** Gemma 4 E2B – Kategorie 88,8 %, Fakten in Zusammenfassungen
    100 %, „wer ist dran“ 70 %, ~3,8 s je Mail, ~14 s je Zusammenfassung. Schwäche: Phishing (3/10). Prompt v2 dafür
    vorbereitet, Messung aller vier Modelle läuft.
  - **Ungeprüft:** Download echter Modelle in der App, Vulkan/GPU unter Windows, Verhalten der installierten App
    (gepackt, asar) mit llama.cpp, Tempo auf dem N97.
- **Windows-CI Lauf #58 grün:** llama.cpp läuft unter echtem Windows (Testmodell), KI-E2E in der Windows-App, Installer 145 MB
  (vorher ~120 MB; CPU- und Vulkan-Laufzeit). Hinweis `npm audit`: 2 mittlere Funde nur im Testwerkzeug Vitest (nicht in der
  App) – Behebung braucht Vitest 5 (größerer Versionssprung), später.
- **Messlauf v1, alle vier Modelle** (Details `docs/KI-MESSUNG.md`): Gemma 4 E2B 88,8 % / Fakten 100 % / 3,5 s; Gemma 4 E4B
  97,5 % / 92 % / 6,2 s; Qwen 3.5 2B 85 % / 81 % / 5,9 s; Qwen 3.5 4B 96,3 % / 92 % / 14,3 s. Prompt v2 + Kontrollsatz laufen.
- **Messlauf v2 + Kontrollsatz fertig → Entscheidung: Gemma 4 E2B ist Standard** (in der App als „Empfohlen“ markiert).
  Prompt v2: Kategorie 98,8 % (Testsatz) / 92,9 % (Kontrollsatz, nie zum Feintuning), Phishing 9/10 bzw. 3/4, ~3,7 s je Mail.
  Gemma 4 E4B fehlerfrei, aber ~doppelt so langsam (Option für starke Rechner). Qwen 3.5 2B langsamer und ungenauer.
  **Offen:** „wer ist dran“ 60 % bei Gemma, Fakten 92 % (Ziel 95 %) → Prompt v3 für Zusammenfassungen. Messung auf N97/GPU fehlt.
- **01.10.2026 – Entscheidung Nutzer:** zuerst W5.5 (Bilder), dann OAuth; Server (S1) später.
- **W5.5 – Bilder und Scans mit KI lesen (lokal geprüft):** node-llama-cpp kann keine Bilder – deshalb für Bilder das
  Programm `llama-server` aus llama.cpp (feste Version b11320, SHA-256 geprüft, erst bei Bedarf geladen: Windows 33 MB
  inkl. Vulkan, entpackt mit dem tar des Systems). Läuft nur auf 127.0.0.1 mit zufälligem Schlüssel (über die Umgebung,
  nicht die Befehlszeile), Fehlertexte des Servers werden nicht weitergereicht. Gemessen: Start mit `--fit off` 14 s statt
  4,5 min. Text- und Bildmodell liegen nie gleichzeitig im Speicher (der KI-Dienst wechselt; per Test geprüft).
  - Optionen → KI: „Bilder und Scans verstehen“ (lädt Bild-Baustein ~1 GB + Laufzeit). Anhang-Vorschau: „Mit KI lesen“
    für Bilder (PNG/JPEG/WebP/GIF/BMP) und PDFs (die App schickt die ersten 3 gerenderten Seiten). Ergebnis-Karte mit Art,
    Titel, Beschreibung, gelesenem Text und Herkunft; gespeichert in `attachmentAnalysis`, Text im Suchindex
    (echter PDF-Text hat Vorrang).
  - Ergebnis mit Gemma 4 E2B auf 4 CPU-Kernen: erfundenes Rechnungsfoto fehlerfrei gelesen (Nummer, Datum, Beträge, IBAN),
    41–47 s; gescannter Brief (PDF ohne Textebene) fehlerfrei, 53 s. Danach über die Suche auffindbar.
  - Tests: 15 neue Unit-Tests (Anfrage-Aufbau, Client ohne Weitergabe von Server-Fehlertexten, Laufzeit-Download/Entpacken/
    Prüfsumme, Speicherung, Formatprüfung, Wechsel Text↔Bild), echte Laufzeit mit Testmodell (auch in der Windows-CI),
    E2E mit echtem Gemma gegen GreenMail (Foto, Scan, Suche, gespeichertes Ergebnis – nur lokal, Modelle 4 GB).
  - **Ungeprüft:** Windows mit Vulkan/GPU, HEIC-Fotos vom iPhone (nicht unterstützt – Hinweis erscheint), automatisches
    Lesen im Hintergrund (bewusst nur auf Klick: ~45 s je Bild auf schwacher Hardware). **Noch offen:** Sprachnachrichten
    (Gemma 4 kann Audio, llama.cpp meldet es als experimentell).
- **Windows-CI Lauf #63 (W5.5) grün:** die Bild-Laufzeit wird unter echtem Windows geladen (ZIP, Prüfsumme), mit dem
  Windows-tar entpackt und `llama-server.exe` antwortet (Testmodell).
- **OAuth für Gmail und Outlook (lokal geprüft):** `core/src/oauth.ts` (plattformneutral: PKCE mit Web Crypto, Anmeldeseite,
  Code-Tausch, Erneuerung, Adresse aus dem ID-Token), `core/node/oauthLoopback.ts` (Rückleitung nur auf 127.0.0.1/::1,
  `state`-Prüfung, Zeitlimit, Abbruch). `MailService`: Konten mit `authType: "oauth2"`, IMAP/SMTP per XOAUTH2, Token wird
  rechtzeitig und je Konto nur einmal erneuert (auch bei gleichzeitigen Verbindungen), widerrufen → Warnung am Konto +
  „Erneut anmelden“ (nur mit derselben Adresse). Gespeichert wird nur das Token (DPAPI), kein Passwort.
  App: „Mit Google/Microsoft anmelden“ im Konto-Dialog (nur für eingerichtete Anbieter), Optionen → „Anmeldung per Browser“
  für die eigene App-Registrierung (Client-ID), Anleitung `docs/OAUTH-EINRICHTEN.md`.
  Tests: 11 Unit-Tests gegen nachgestellten Anbieter (PKCE, state, Abbruch, Zeitlimit, Rotation, widerrufen ohne
  Anbieter-Details), 5 Integrationstests gegen GreenMail (XOAUTH2-Abgleich, Senden, einmalige Erneuerung, widerrufen +
  Neu-Anmeldung), E2E in der App („Mit Google anmelden“ → Mails da, nur Token verschlüsselt gespeichert).
  **Ungeprüft:** echte Google-/Microsoft-Anmeldung (braucht die Registrierung des Nutzers), Google-„Testen“-Modus (Tokens
  7 Tage), Firmenkonten mit Admin-Sperre.
- **Fehler gefunden und behoben (beim E2E-Lauf unter Last):** Lief beim Öffnen einer Mail gerade ein Abgleich, konnte er
  die eben gesetzte Markierung „gelesen“ mit dem alten Serverstand überschreiben – die Mail sah kurz wieder ungelesen aus,
  bis die Warteschlange beim Server war. Jetzt gewinnt eine noch nicht übertragene lokale Änderung. Regressionstest gegen
  GreenMail (scheitert ohne die Korrektur nachweislich).
- **01.10.2026 – Entscheidung Nutzer:** W6 (Assistent) bauen, danach Feinabstimmung der Modelle. Türsteher-Standard nach
  meinem Vorschlag: aus, beim Hinzufügen eines Kontos einmal fragen (noch nicht vom Nutzer bestätigt).
- **Container-Neustart** während eines Messlaufs: Dateien blieben erhalten, Messlauf lief weiter. GreenMail startete danach
  unter Last nicht (Startzeit 2 s zu knapp) → Startskript mit `-Dgreenmail.startup.timeout=30000`.
- **W6.1 – Zu tun (Aktionen) (lokal geprüft):** `core/ai/actions.ts`: KI-Aufgabe mit Pflicht-Zitat (was nicht in der Mail
  steht, fällt weg; Beträge nur, wenn sie wörtlich vorkommen; Termine nur mit Datum), Regeln ohne KI (Datum, Uhrzeit,
  Spanne, Betrag, Schlüsselwörter, Werbung ausgenommen). Migration `v10-message-actions`, `ActionStore`, Erinnerungen
  (Windows-Benachrichtigung, jede genau einmal), Kalendereintrag als .ics (öffnet Outlook/Kalender).
  App: Karte „Zu tun“ über der Mail – sofort mit Regeln, das Modell verfeinert im Hintergrund und die Karte aktualisiert
  sich; Erinnern (1 Std. vorher / Vortag / am Tag / morgen früh), In den Kalender, Erledigt, Ausblenden. Nicht untersucht:
  Gesendet, Entwürfe, Papierkorb, Spam, Newsletter, Verdächtiges.
  **Messung** (35 Mails aus Test- und Kontrollsatz, 43 erwartete Angaben): Regeln allein 93,0 % ohne Fehlalarm; Gemma 4 E2B
  97,7 % (Ziel ≥ 95 %), aber 4 überflüssige To-dos, ~7,8 s je Mail auf 4 CPU-Kernen. Ehrlich: Die Regeln wurden an diesem Satz
  verbessert – Kontrollmails sind beigemischt, trotzdem eher optimistisch.
  **Gefunden und behoben:** Beim Verschieben (Archivieren) einer Mail gingen Anhang-Text (Suche in Scans!), Leseergebnis und
  neue Aktionen verloren, weil die Zeile neu angelegt wird – jetzt ziehen sie mit (Test).
- **W6.2 – Phishing-Check (lokal geprüft):** `core/phishing.ts` ohne KI: Marke im Namen + nachgeahmte Domain/Freemail,
  „Chef“ von Freemail, Link-Text ≠ Link-Ziel, IP-Links, Kurzlinks, Druck, Datenabfrage, Zahlung per Link, „zu gut um wahr zu
  sein“, Gutscheinkarten, riskante Anhänge; KI-Einordnung „verdächtig“ zählt mit. Warnleiste mit verständlichen Gründen und
  Rat, Schild-Symbol in der Liste. **Messung:** Regeln allein 10/14 Betrugsmails, mit Gemma-Einordnung 13/14 – in Test- und
  Kontrollsatz **0 Fehlalarme** bei 94 echten Mails.
  **Ungeprüft:** echte Phishing-Mails (HTML, Weiterleitungen); Absender-Vertrauen („kenne ich“) noch nicht eingebaut.
- **W6.3 – Türsteher (lokal geprüft):** pro Konto in Optionen bzw. beim Hinzufügen eines Kontos (Standard aus). Migration
  `v11-screener`. Mails von Absendern ohne Entscheidung erscheinen nicht im Posteingang, sondern unter „Neue Absender“
  (Seitenleiste, nur wenn ein Konto den Türsteher an hat). Beim Einschalten gelten bisherige Absender, Empfänger gesendeter
  Mails und die eigene Adresse als erlaubt; wem man schreibt, der wird automatisch erlaubt. Blockieren verschiebt die Mails in
  den Spam-Ordner (auf dem Server, über die Warteschlange); hat das Konto keinen, bleiben sie lokal ausgeblendet.
  Geprüft: Vertragstests beider Repositories, SQLite, Store-Test, E2E gegen GreenMail (zwei neue Absender, Erlauben,
  Blockieren → `Junk` auf dem Server enthält die Mail). Entscheidungen gelten kontenübergreifend je Adresse.
  **Ungeprüft:** echte Konten mit vielen Absendern (Dauer des Schnappschusses), Entscheidung wieder zurücknehmen (noch keine
  Oberfläche dafür).
- **Messung Aktionen mit Gemma 4 E4B:** 93,0 % bei doppelter Zeit (15,4 s) – nicht besser als E2B. Beide setzen bei
  „31. Oktober“ das Jahr 2027 → Punkt für die Feinabstimmung. Details in `docs/KI-MESSUNG.md`.
- **Wackeliger E2E-Test behoben:** „Grillen?“ und die HTML-Mail hatten dieselbe Uhrzeit; je nach Reihenfolge öffnete das
  Archivieren per E die einzige ungelesene Mail, und „Ungelesen“ war leer. Jetzt feste Reihenfolge; 3 volle Läufe grün.
- **W6.4 – Regeln in eigenen Worten (lokal geprüft):** Optionen → Regeln. Der Nutzer schreibt z. B. „Mails von
  jonas@example.test in den Ordner Verein“; StinkyMa zeigt die erkannte Regel als Formular (Absender, Betreff, Art, Anhang →
  Archiv/Papierkorb/Spam/eigener Ordner, gelesen, markieren), die passenden Mails im Posteingang und speichert erst auf Klick.
  Regeln gelten für **neu ankommende** Mails (auf Wunsch auch für die angezeigten vorhandenen). Hängt eine Regel an der
  KI-Einordnung („Newsletter …“), wartet die Mail bis zu 10 Minuten darauf. Was eine Regel wegräumt oder gelesen setzt, löst
  keine Benachrichtigung aus. Migration `v12-mail-rules`. Sicherungen: Absender/Betreff müssen im Text stehen (nichts
  Erfundenes), Ordner müssen existieren, ohne Bedingung oder Aktion kein Speichern.
  **Messung** (`eval-models.ts --rules`, 24 Testsätze + 12 Kontrollsätze): Regeln allein 24/24 und 10/12. **Gemma 4 E2B allein
  ist schlechter** (18/24, 6/12) – es erfindet gern eine „Art“ dazu („Lohnsteuer im Betreff“ → Rechnung). Deshalb: zuerst
  Regeln, Modell nur, wenn die nichts Brauchbares ergeben → 24/24 und 11/12, Modell nur in 1 von 36 Fällen nötig (~8 s).
  Ehrlich: Die Regeln wurden am Testsatz entwickelt; der Kontrollsatz wurde vorher geschrieben und nicht zum Verbessern genutzt.
  Bekannte Schwäche: Verneinung („nicht markieren, nur archivieren“ → markiert trotzdem) – im Formular sichtbar und korrigierbar.
  Geprüft: Unit-Tests (Regeln, RuleService mit SQLite, Store), E2E gegen GreenMail (Regel anlegen → neue Mail landet im
  Ordner „Verein“ auf dem Server). Verschachtelte Ordner („INBOX/Verein“) werden auch über den letzten
  Namensteil gefunden (Unit-Test). **Ungeprüft:** echte Konten mit vielen Ordnern; Gemma E4B/Qwen siehe `docs/KI-MESSUNG.md`.
- **W6.5 – Antwortvorschläge (lokal geprüft):** Knopf in der Mail (nur mit Modell): drei feste Plätze (zusagen/danken,
  absagen/später, nachfragen), Anrede du/Sie und „Hallo Tom,“ per Regeln, Gruß aus der Signatur. Verworfen wird, was
  Platzhalter, falsche Anrede oder erfundene Zahlen enthält. Klick öffnet „Antworten“ mit dem Text – nie automatisch senden.
  **Messung** Gemma 4 E2B: 12/12 Mails mit ≥ 2 Vorschlägen, du/Sie 12/12, 7 s (Prompt v1: nur 2/12). Details und alle
  Vorschläge zum Lesen: `docs/KI-MESSUNG.md`. Geprüft: Unit-Tests (Anrede, Gruß, Filter), Store-Test, E2E mit Testmodell.
  **Ungeprüft:** in der Windows-App mit echtem Modell; Mails mit langem Verlauf.
- **Windows-CI Lauf #71 rot, #72 (gleicher Stand) grün:** GreenMail nahm beim Start auf dem Windows-Runner kurz keine
  Anmeldungen an; der OAuth-Integrationstest wartete gar nicht auf ihn. Jetzt: gemeinsames `waitForGreenMail` (60 s) für
  beide Integrationstests und GreenMail in der CI mit `-Dgreenmail.startup.timeout=30000`. Lokal 24/24 grün.
- **Windows-CI #77: echter Fehler gefunden.** Das winzige CI-Modell lieferte einen Antwortvorschlag; Klick darauf öffnete
  den Editor nicht. Nachgestellt (KI-Schnittstelle im Test durch eine Attrappe ersetzt): selten „Cannot read properties of
  null (reading 'commands')“ – der Editor war beim schnellen Neuaufbau schon abgebaut, als er den Cursor setzen wollte; der
  Fehler riss den ganzen Composer mit. Jetzt Prüfung `isDestroyed`. Lokal selten (1 von ~20), auf dem langsameren
  Windows-Runner zweimal in Folge. Kann auch beim normalen „Antworten“ aufgetreten sein.
  **Windows-CI #80/#81 danach grün** (ob das Testmodell dabei einen Vorschlag lieferte, ist Zufall). Nächster Schritt:
  Nutzer testet den Installer aus der CI selbst (Türsteher, Regeln, Antwortvorschläge, Tagesüberblick).
  **Lokal nicht testbar:** echte Modelle in der E2E-App unter Linux – node-llama-cpp prüft seine Binärdateien in einem
  Kindprozess, der Playwrights Debugger-Schalter erbt und hängen bleibt. Unter Windows (CI) läuft es.
- **Nutzertest 01.10.2026: „Die KI hört nach einiger Zeit auf, Mails einzuordnen.“** Zwei Schwachstellen gefunden:
  (1) Ein einziger Fehler beim Einordnen hielt die ganze Einordnung an – und beim nächsten Anstoß scheiterte sie wieder an
  derselben (neuesten) Mail. (2) Hängt eine Modell-Anfrage, warten alle folgenden für immer (das Modell arbeitet eine Anfrage
  nach der anderen ab), und die Einordnung gilt weiter als „läuft“. Behoben: Höchstdauer je Anfrage (Text 3 Min., Bilder
  6 Min.), danach Abbruch und Neustart des Modells; scheitert das Modell an einer Mail, bekommt sie die einfache
  Regel-Einordnung und es geht weiter – erst nach 3 Fehlern in Folge Stopp mit Meldung. Tests mit hängendem und teilweise
  scheiterndem Modell. **Ungeprüft:** ob genau das beim Nutzer passiert ist (Fehlermeldung unter Optionen → KI erfragt).
- **KI-Anzeige in der Seitenleiste (Wunsch des Nutzers):** unten links immer sichtbar, solange die KI arbeitet: was sie
  gerade tut (einordnen, zusammenfassen, Vorschläge schreiben …), Fortschrittsbalken bei der Einordnung („12 von 40“), eine
  mitlaufende Uhr und wie viele Aufgaben warten; ab 1 Minute „bitte Geduld“. Hält die Einordnung wegen eines Fehlers an:
  Hinweis mit Fehlertext und „Weiter einordnen“. Klick öffnet die KI-Optionen. Dazu: Der untere Teil der Seitenleiste
  (Abrufstatus, Konto hinzufügen) bleibt jetzt auch bei vielen Ordnern sichtbar – vorher scrollte er weg. Statusmeldungen
  werden nummeriert, damit eine ältere „arbeitet …“-Meldung nie eine neuere überschreibt. Geprüft: Unit-Tests (Fortschritt,
  Aufgabe, Weiter einordnen), Sichtprüfung per Screenshot mit nachgestelltem Status.
- **Einordnung korrigieren = KI beibringen (Wunsch des Nutzers, lokal geprüft):** Die Einordnung über der Mail ist
  anklickbar. Gewählte Einordnung gilt sofort; standardmäßig „für diesen Absender merken“ (Migration `v13-sender-category`):
  andere, von der KI eingeordnete Mails des Absenders werden gleich mit geändert, neue Mails bekommen sie ohne Modell
  (Herkunft „learned“). Von Hand Gesetztes überschreibt nichts. Optionen → KI → „Gelernte Absender“ mit Vergessen.
  Bewusst ohne Nachtrainieren des Modells: Für ein ~3B-Modell ist „Absender → Einordnung“ zuverlässiger und kostet keine
  Rechenzeit. Die Korrekturen sind zugleich Material für die Feinabstimmung (wo irrt das Modell?).
  Geprüft: Unit-Tests (Lernen, Mitändern, neue Mail ohne Modell, Vergessen), Store-Test, E2E mit Beispieldaten.
- **Windows-CI #85 rot (#86 gleicher Stand grün):** Die neuen Hintergrund-Statusmeldungen liefen nach dem Aufräumen eines
  Tests noch weiter; die Modelldatei fehlte, der Fehler blieb unbehandelt. Hätte in der App beim Löschen eines Modells genauso
  passieren können. Jetzt: Statusmeldungen im Hintergrund fangen Fehler ab, die Dateiprüfung meldet „nicht da“ statt zu
  scheitern, und die Einordnung ist gegen unerwartete Fehler abgesichert (hält an und meldet).
- **Nutzertest: „Einordnung bricht noch immer ab“, Anzeige nicht gefunden.** Die Anzeige erschien nur, solange die KI
  arbeitete. Sehr wahrscheinliche Ursache des „Abbruchs“: Eingeordnet wurden nur Posteingangs-Mails der letzten 14 Tage –
  danach ist sie fertig, ältere bleiben ohne Einordnung. Jetzt: Anzeige unten links immer sichtbar, solange die KI an ist
  („KI bereit · alles eingeordnet“ bzw. „N Mails älter als 14 Tage sind nicht eingeordnet · Auch ältere“, „N Mails warten ·
  Jetzt einordnen“, falls trotz Arbeit nichts läuft). Neue Einstellung „Auch ältere Mails einordnen“. **Ungeprüft**, ob das
  den Abbruch beim Nutzer vollständig erklärt – nachfragen, was die Anzeige jetzt zeigt.
- **Zeitraum für die Einordnung (Wunsch des Nutzers):** Optionen → KI → „Außer neuen Mails auch einordnen“: nichts weiter /
  letzte 30 bzw. 90 Tage / letztes Jahr / alle / eigener Zeitraum mit Von- und Bis-Datum (Kalenderfelder). Neue Mails
  (letzte 14 Tage) werden immer eingeordnet. Darunter: wie viele Mails noch offen sind und grobe Dauer (~5 s je Mail), und
  wie viele außerhalb liegen. Die frühere Einstellung „auch ältere“ wird zu „alle“. Geprüft: Unit-Tests (Zeitgrenzen,
  Enddatum einschließlich, tolerantes Lesen), Sichtprüfung per Screenshot.
- **W6.6 – Tagesüberblick (lokal geprüft):** Sonnen-Knopf unten links öffnet ihn; optional täglich als Windows-
  Benachrichtigung zur gewählten Uhrzeit (Optionen → App, Standard aus; nur Anzahlen, keine Betreffzeilen; einmal am Tag).
  Inhalt **ohne Modell**: offene Fristen/Termine/Zahlungen der nächsten 7 Tage und Überfälliges (nur Posteingang, Archiv,
  eigene Ordner), „wartet auf dich“ aus gespeicherten Zusammenfassungen (nur wenn sie zum letzten Stand passen), ungelesene
  wichtige Mails der letzten 2 Tage; Newsletter/Benachrichtigungen/Verdächtiges/Markiertes nur gezählt; Türsteher-Mails
  bleiben draußen. Vorher werden ungeöffnete neue Mails schnell mit den Regeln nach Aktionen durchsucht – sonst fehlten
  Fristen aus Mails, die noch niemand geöffnet hat. Geprüft: Unit-Tests mit SQLite (Abschlagsrechnung wird ungeöffnet
  gefunden, später überfällig, Erledigtes/Papierkorb fehlt), Store-Test, E2E mit Beispieldaten (Klick öffnet die Mail).
  **Grenzen:** Die Regeln erkennen Wochentage („am Dienstag um 9:30“) noch nicht – solche Termine erscheinen erst, wenn die
  Mail geöffnet und vom Modell gelesen wurde. Die Benachrichtigung selbst (Uhrzeit-Auslösung unter Windows) ist ungeprüft.

- **Nutzer-Test (01.10.2026, Windows-Installer):** Gmail-Konto mit **App-Passwort** (IMAP/SMTP) eingerichtet – funktioniert.
  Zusammenfassungen laut Nutzer „sehr gut“, die übrigen Funktionen (W5/W6) ebenfalls ohne Beanstandung. Damit erstmals
  mit einem **echten Konto** geprüft (Gmail per App-Passwort). Weiter ungeprüft: OAuth Google/Microsoft mit echten
  Konten, Uhrzeit-Benachrichtigung des Tagesüberblicks. Nächster Schritt: Feinabstimmung der Modelle.
- **Zeitraum und Aufräumen (Wunsch des Nutzers, 01.10.2026):** Anlass: Gmail meldet ~8000 ungelesene, StinkyMa zeigte ~200
  (nur die letzten 30 Tage waren geladen). Jetzt je Konto 30 Tage / 3 Monate / 1 Jahr / alle (Migration v14), „Ältere Mails
  anzeigen“ in der Liste, Ladefortschritt in der Seitenleiste; nachgeladene alte Mails lösen keine Benachrichtigung/Regel
  aus; Verschieben vieler Mails als ein MOVE. **Aufräumen**-Dialog: Gruppen nach Absender/Domain (registrierte Domain),
  Schutz per Regeln (Betreff breit, Text nur eindeutige Formulierungen) plus KI-Einordnung; Spam-Verdacht der KI hebt den
  Text-Schutz auf (Phishing mit „Passwort“). Löschen nur in den Papierkorb, nach Bestätigung, optional mit Regel für
  künftige Mails; „KI prüfen lassen“ ordnet die Gruppe vorrangig ein. Geprüft: GreenMail (Zeitraum länger/kürzer/alle,
  keine Benachrichtigung für alte Mails, ein MOVE für drei Mails mit neuen UIDs), Schutz-Regeln, Gruppierung mit SQLite
  (Papierkorb/Spam/Gmail-Doppel ausgenommen), KI-Vorrang, Store, E2E mit der echten App (Gruppe wählen, Geschütztes
  abgewählt, Löschen nach Bestätigung, Regel angelegt). Lokal: 387 Tests + 9 E2E grün. **Ungeprüft:** echtes großes
  Gmail-Konto (Dauer, Speicher, Gmail-Tageslimit beim ersten vollständigen Abruf, Verhalten von „Alle Nachrichten“ beim
  Löschen), Trefferquote der Schutz-Regeln an echten Mails, Windows-CI.
- **Newsletter abbestellen (01.10.2026):** Abmelde-Angabe der Mail (List-Unsubscribe; Ein-Klick nach RFC 8058) wird beim
  Abruf gespeichert (Migration v15), bei älteren Mails werden nur diese zwei Kopfzeilen bei Bedarf vom Server geholt.
  Leiste „Abbestellen“ in der Mail und im Aufräumen-Dialog; Weg: Ein-Klick beim Anbieter → Abmelde-Mail über das eigene
  Konto (Empfänger wird nicht als Kontakt gemerkt) → Abmelde-Seite. Nur https, einfache Adresse, keine Kopfzeilen-Tricks;
  bei Spam-Verdacht rät die App ab. Danach Link „Vorhandene Mails aufräumen“. **Abmelde-Seite (Wunsch des Nutzers):** in
  einem verschiebbaren Fenster innerhalb der App mit abgedunkeltem Hintergrund – die Seite läuft abgeschottet
  (`WebContentsView` mit Sandbox, eigene Sitzung nur im Arbeitsspeicher und beim Schließen geleert, nur https, keine
  Popups/Downloads/Berechtigungen). Geprüft: Parser (Unsicheres wird verworfen), Dienst (Ein-Klick/Status/offline, Mail,
  Seite, Beispielkonten ohne Netz), GreenMail (Angabe beim Abruf gelesen, vom Server nachgeholt, Abmelde-Mail kommt an),
  E2E (Ein-Klick in der echten App; Abmelde-Fenster erscheint, wandert beim Ziehen mit, verschwindet beim Schließen).
  **Ungeprüft:** echte Anbieter (ob sie Ein-Klick korrekt annehmen), Darstellung echter Abmelde-Seiten im Fenster (im
  Container kein Internet), Windows-CI.
- **Umbenennung in StinkyMail (Wunsch des Nutzers, 01.10.2026):** Fenster, Infobereich, Benachrichtigungen, Texte,
  Installer (`StinkyMail-Setup-….exe`, Verknüpfung „StinkyMail“), X-Mailer, Kalender-PRODID. Gleich geblieben: appId
  `de.stinkyma.app` (Installer ersetzt die alte Version, Autostart-Eintrag bleibt derselbe) und der **Datenordner** – gibt
  es schon `%APPDATA%\StinkyMa\mail.sqlite`, nutzt StinkyMail diesen weiter (Konten, Passwörter, Mails bleiben), sonst
  `%APPDATA%\StinkyMail`. Interne Namen (`@stinkyma/*`, `STINKYMA_*`, Repo, Swift-Projekt) unverändert. Lokal: 396 Tests +
  11 E2E grün. **Ungeprüft:** Update-Installation über eine vorhandene StinkyMa-Installation unter Windows.

- **Nutzer-Test (01.10.2026, Windows):** Rückmeldung zu Zeitraum, Aufräumen, Abbestellen, Abmelde-Fenster und Umbenennung:
  „funktioniert super“. Welche Punkte im Einzelnen geprüft wurden (Update über alte Installation, „alle Mails“ bei Gmail,
  Trefferquote der Schutz-Regeln), ist nicht genauer gemeldet. Nächster Schritt: W7 (Verträge & Abos, Belegordner,
  Versprechen-Tracker) bzw. Feinabstimmung der Modelle.
- **Feinabstimmung Gemma E2B/E4B (Wunsch des Nutzers, 01./02.10.2026) – fertig, Details in `docs/KI-MESSUNG.md`:**
  - Zusammenfassung **Prompt v4**: Das Modell beurteilt nur die letzte Mail, „wer ist dran“ folgt im Code. Test- +
    Kontrollsatz: E2B 15/20 → 18/20, E4B 14/20 → 18/20; Fakten 96–100 %. Gespeicherte Zusammenfassungen werden wegen der
    neuen Prompt-Version beim nächsten Öffnen neu erstellt.
  - Aktionen: Jahr ohne Jahreszahl per Code, Wochentage/„morgen“/„übermorgen“ in den Regeln, Gegenprobe der Modell-Daten
    mit dem Satz aus der Mail. 60 Angaben: Regeln 95 %, E2B 100 % (3 unnötige), E4B 98,3 % (3 unnötige).
  - Unverändert nach Messung: Antwortvorschläge (beide 12/12), Regeln in eigenen Worten (Regeln zuerst), Einordnung.
  - **Ehrlich:** Die Kontrollsätze sind nicht mehr ganz unberührt (v3-Fehler flossen in v4 ein; ein Kontrollfall der
    Aktionen deckte einen Fehler auf). Gemessen nur auf 4 CPU-Kernen im Container; mit echten Mails ungeprüft.
- **W7.1 Verträge & Abos (02.10.2026) – gebaut, lokal geprüft:** Erkennung per Regeln (sofort, alle Mails) und lokalem Modell
  (Hintergrund, nur Kandidaten; „kein Abo“ entfernt reine Regel-Funde; Spam-Verdacht und „Persönlich“ werden übersprungen).
  Speicher je Konto + Absender-Domain (Migration v16), neuere Mails aktualisieren, Korrekturen des Nutzers bleiben.
  Ansicht „Abos & Verträge“ mit Kosten, Kündigungstag, Erinnerung (nie in der Vergangenheit), Korrigieren, Status.
  Messung siehe `docs/KI-MESSUNG.md`: Regeln stark auf eigenen Sätzen, auf unordentlichen Mails (Kontrollsatz 2) 44 % (nach
  Korrekturen 51 %), mit E2B 80,5 % → nach Korrekturen 90,2 %, E4B 87,8 % (vor Korrekturen).
  Tests: Rechnen/Erkennen/Speicher/Suchlauf (Unit), E2E mit der echten App.
  **Ungeprüft:** echte Postfächer (Trefferquote, Dauer des KI-Durchgangs bei vielen Kandidaten), Windows-CI.
- **W7.1 nachgebessert nach erstem Test des Nutzers (02.10.2026) – gebaut, lokal geprüft:** Rückmeldung: Werbung als Abo,
  Abos nur als Rechnung erkannt, Abos im PDF fehlen, Nexus Mods doppelt (Rechnungen aus August und September), kein
  manueller Suchlauf. Umgesetzt: ein Eintrag je Abo mit allen Mails (Migration v17 `subscriptionMail`), Zuordnung nach
  Anbietername/Aliasen über Konten und Domains (Zahlungsdienste nur nach Name), Altduplikate werden beim Suchlauf
  zusammengeführt, von Hand zusammenführen, „Das ist ein Abo“ an der Mail (Knopf + Rechtsklick), PDF-Text in Regeln und
  KI, Rechnungen gehen immer an die KI, „Durchsuchen“/„Alles neu prüfen“, Hinweis ohne KI, Werbefilter (Newsletter nicht
  per Regel, KI-Fund bei Werbung ohne eigene Beziehung verworfen), „19 % MwSt.“ nicht mehr als Werbung, englische Beträge
  in den Regeln. Tests: 5 neue Unit-Tests, neuer E2E (Rechtsklick → Abo, Alles neu prüfen, Zusammenführen, Mail öffnen).
  Messung unverändert (Regeln Kontrollsatz 2: 51,2 %, E2B 90,2 %). **Ungeprüft:** echte Mails des Nutzers (Nexus Mods, PDF-Rechnungen),
  Dauer von „Alles neu prüfen“ mit KI bei vielen Rechnungen, Windows-CI. Bekannte Grenze: „beginnt mit“-Vergleich der
  Namen kann ähnlich benannte Anbieter zusammenlegen (z. B. „Google“ und „Google One“) – Trennen gibt es noch nicht.
- **Kategorien-Filter und eigene Kategorien (02.10.2026) – gebaut, lokal geprüft:** Wunsch des Nutzers (vor W7.2).
  Seitenleiste „Kategorien“ unter „Übersicht“: Filter über alle Konten für eigene und (mit KI) feste Kategorien.
  Eigene Kategorie = zweites Etikett, feste Einordnung bleibt (Schutz beim Aufräumen, Abos, Tagesüberblick unverändert).
  Zuordnung: von Hand → gemerkter Absender → Absenderliste der Kategorie → lokales Modell (eigener kurzer Prompt, der
  gemessene Einordnungs-Prompt bleibt unverändert; neueste 300 Mails + neue, neu prüfen bei geänderten Kategorien).
  Migration v18. Tests: 6 Unit-Tests (Kern), 1 Store-Test, 1 E2E (anlegen mit Absender, Filter, an der Mail ändern
  und merken, bearbeiten/löschen). Messung siehe `docs/KI-MESSUNG.md` („Eigene Kategorien“): E2B mit Rückfrage bei Treffern (v3) 30/30 und 20/20, keine
  Fehlzuordnung, ~8 s je Mail; E4B mit v2 29/30 und 20/20, ~4 s. Ohne Rückfrage ordnete E2B die Hälfte der Mails ohne
  passende Kategorie trotzdem zu.
  **Ungeprüft:** echte Postfächer, Dauer des KI-Durchgangs auf schwacher Hardware bei 300 Mails, Windows-CI.
  Vom Nutzer getestet (02.10.2026): „nicht alles richtig, aber einiges – damit kann ich leben“.
- **W7.2 Belegordner (02.10.2026) – gebaut, lokal geprüft:** Erkennung per Regeln (sofort; Beträge in deutscher und
  englischer Schreibweise, Netto/MwSt. nur wenn dastehend, Rechnungsdatum hinter Stichworten und nie in der Zukunft,
  Frist inkl. „innerhalb von N Tagen“, Rechnungsnummer, Kategorie per Stichwort) und lokalem Modell (Hintergrund, nur
  Kandidaten; Beträge/Daten müssen im Text stehen, sonst „bitte prüfen“). Migration v19, Belege überleben die Mail.
  Ansicht „Belege“: Jahr, Summen je Kategorie als Filter, korrigieren mit gemerkter Kategorie je Händler, eigene
  Kategorien, ausblenden, Erinnerung vor Frist, „Als Beleg übernehmen“, Export ZIP (PDFs ohne AGB + CSV für Excel).
  Testhaken `STINKYMA_TEST_SAVE_DIR` (Export ohne Dialog, nur für E2E). Tests: 8 Unit-Tests (Beträge, Regeln,
  Modell-Prüfung, CSV, ZIP, Speicher/Dienst, Export), E2E (erkannt, korrigiert, Rechtsklick, Export geprüft).
  Messung: siehe Eintrag W7.3 unten (Nachmessung nach Korrekturen) und `docs/KI-MESSUNG.md`.
  **Ungeprüft:** echte Postfächer, ZIP mit echten PDFs vom Server (im E2E nur Beispielkonten ohne Dateiinhalt),
  Öffnen des ZIP unter Windows, Windows-CI.
- **W7.3 Versprechen-Tracker (02.10.2026) – gebaut, lokal geprüft:** „Meine Zusagen“ (gesendete Mails) und „Ich warte auf“
  (eingegangene). Regeln: Zusage in erster Person bzw. vom Absender, ohne Fragen/Bitten/Erledigtes/Zitate/Werbung/
  automatische Absender; Frist per Code aus dem Ausdruck (Wochentage, Ende der Woche, nächste Woche, Monatsende, in N Tagen,
  heute, Englisch), Anlass („wegen Samstag“) ist keine Frist; ohne Frist 3 Tage. Modell: Zitat muss in der Mail stehen.
  Folge-Mail im Verlauf → „erledigt?“. Eigene Zusagen: Erinnerung 1 Tag vorher. „Nachhaken“ öffnet Antwort-Entwurf
  (Text ohne KI, freundlich mit Zitat). Migration v20. Tests: 5 Unit-Tests, E2E (Zusage aus gesendeter Mail, erledigt,
  Reiter). Messung: Regeln Testsatz 17/17 (Frist 17/17), Kontrollsatz 9/9 – geschönt (aus einer Hand); unordentlicher
  Kontrollsatz 2: **0/11** – Regeln versagen bei Umgangssprache. Mit KI (Modell- und Regel-Funde zusammen): E2B 17/17,
  9/9, 5/11; E4B 17/17, 9/9, 8/11; keine Fehlalarme, Fristen fast alle richtig (Details `docs/KI-MESSUNG.md`).
  **Ungeprüft:** echte Postfächer, wie oft Fehlalarme in echten gesendeten Mails auftauchen, Windows-CI.
  Hinweis zur Messung Belege: E2B füllte „Händler“ mit der Dokumentart („Rechnung“) und MwSt. mit dem Satz („19 %“) –
  allgemein behoben (Händler muss im Absender/Text stehen und darf keine Dokumentart sein; Prozent ist kein Betrag;
  Netto/MwSt. nur, wenn im Text; Stichwort-Kategorie vor Modell; „KI sagt kein Beleg“ bei klarem Gesamtbetrag → bleibt
  mit „bitte prüfen“). Nachmessung: E2B 100 % / 100 % / 84,6 % (Kontrollsatz 2), E4B 100 % / 100 % / 92,3 %, Regeln 53,8 %
  auf Kontrollsatz 2. Details `docs/KI-MESSUNG.md`.
  Als Nächstes: W8 (siehe Roadmap) – oder Nachbesserungen nach dem Test des Nutzers.

### 03.10.2026 – W8 Personalisierung (in Arbeit)
- **Kontext 16K für alle** (Wunsch des Nutzers, ausdrücklich ohne Prüfung): `modelContextTokens = 16 384`, größere
  Eingabe-Budgets (Verlauf 24 000, Mail 4 000, Anhang 6 000 Zeichen), KV-Cache Q8_0 mit Rückfall auf F16, llama-server
  `-c 16384 --cache-type-k q8_0`. **Ungeprüft:** Speicher/Tempo bei langen Eingaben auf schwacher Hardware.
- **Komprimierung – gebaut, Unit-getestet:** laufende Zusammenfassung (nur neue Mails + vorherige Zusammenfassung),
  Map-Reduce für lange Verläufe/Dokumente (neueste Mails wörtlich, ältere verdichtet, sonst gekürzt). **Ungeprüft:**
  Qualität der verdichteten Zusammenfassungen (keine Messung).
- **W8.1 Frag dein Postfach – gebaut, lokal geprüft:** Volltext (FTS5) + Bedeutung (EmbeddingGemma 300M, optionaler
  Download mit Prüfsumme) mit Rangfusion, Antwort mit Quellen. Migration v21. Messung: Bedeutung+Wörter 13/13 richtig,
  Wörter allein 10/13; **die eine Falle (ähnliches Thema) beantwortet E2B fälschlich** – auch mit Prompt v2. Unit- und
  E2E-Test (ohne Zusatzmodell). **Ungeprüft:** echte Postfächer, Dauer des Vorbereitens bei 10 000+ Mails, Windows-CI.
- **W8.2 Absender-Steckbrief – gebaut, lokal geprüft:** Seitenteil neben der Mail, Daten aus vorhandenen Tabellen,
  Schnellfrage an „Frag dein Postfach“. Unit- und E2E-Test.
- **W8.3 Priorisierung – gebaut, lokal geprüft:** Verhaltens-Protokoll (öffnen = einzelne Mail gelesen, antworten,
  markieren, archivieren, löschen – ungelesen gelöscht zählt negativ), Absender steht im Ereignis (überlebt Verschieben),
  Wichtigkeit per Code (Absender und Einordnung je zur Hälfte, Festlegung des Nutzers gewinnt), Schwelle 0,55. Bereich
  „Wichtig“ mit Zähler, Stern in der Liste. Neu gerechnet beim Start, nach neuen Mails und nach der Einordnung
  (gebündelt) und sofort für den Absender nach jeder Aktion. **Ungeprüft:** ob die Gewichte im Alltag passen
  (keine Messung, Schwelle geschätzt), Tempo bei großen Postfächern.
- **W8.4 Stilprofil + Transparenz-Seite – gebaut, lokal geprüft:** Anrede, Gruß, Länge, Emoji/Ausrufezeichen aus
  gesendeten Mails (ohne Zitat); je Person du/Sie und letzte Anredezeile. Antwortvorschläge: Form und Anrede je Person,
  Längen-Hinweis im Prompt (ohne Stilprofil bleibt der gemessene Prompt wörtlich gleich). Transparenz-Seite in den
  Optionen mit „immer/nie wichtig“ und „Alles vergessen“. 4 Unit-Tests, E2E. **Ungeprüft:** ob die Antwortvorschläge mit
  Längen-Hinweis besser werden (nicht nachgemessen).
- **W8.5 Autovervollständigung – gebaut, lokal geprüft:** grauer Vorschlag im Editor (ProseMirror-Dekoration) nach
  300 ms Tipppause am Absatzende, Tab/→ übernimmt, Esc/Weitertippen verwirft, laufende Anfrage wird abgebrochen.
  Prompt mit Beispielen, Code-Prüfung (Zahlen, Zeitwörter, Adressen, Platzhalter, doppeltes Wort, neuer Satz).
  Abschaltbar; schaltet sich bei über 6 s (Median) selbst ab. Messung E2B: Kontrollsatz 9/12 brauchbar (10/12 nach einer
  allgemeinen Korrektur), ~2,3 s je Vorschlag auf 4 Kernen. Unit-Tests (Prüfung, Dienst, Oberflächen-Zustand), E2E mit
  dem winzigen CI-Modell (Ablauf: Vorschlag erscheint, Tab übernimmt, Weitertippen verwirft).
- **Vorrang für Klicks:** Die Modell-Warteschlange stellt Vordergrund-Aufgaben vor Hintergrundarbeit (Unit-Test).
- **Gefunden, nicht gelöst – Electron + Gemma im Linux-Container:** Die App stürzt hier beim Laden von Gemma 4 E2B
  (und später bei Qwen 3.5 2B) im Electron-Hauptprozess ab (SIGTRAP/SIGILL, interner Abbruch in einem libuv-Thread).
  Nachgestellt mit einem 15-Zeilen-Electron-Programm ganz ohne App-Code, auch mit 4K-Kontext, ohne Q8_0-Zwischenspeicher,
  ohne mmap und ohne Grafikkarte – liegt also **nicht** an W8 oder 16K. Im normalen Node (Messskripte) läuft dasselbe
  Modell. Electron (44.5.1) und node-llama-cpp (3.22.1) sind seit W1/W5 unverändert, und der Nutzer hat die KI unter
  Windows benutzt – vermutlich eine Eigenheit dieses Containers. **Ungeprüft:** ob es unter Windows mit 16K weiter läuft
  → bitte beim nächsten Test unter Windows auf Abstürze beim ersten Zusammenfassen achten. Deshalb ist die
  Autovervollständigung mit einem echten Modell **in der App ungetestet** (nur Ablauf mit Testmodell + Messung im Node).
- Stand Tests: 458 Unit-Tests grün (inkl. GreenMail), E2E 19 grün / 2 übersprungen (Modell-abhängig); KI-E2E mit dem
  winzigen Testmodell grün.
- Als Nächstes: Test des Nutzers unter Windows (W8 komplett), danach Roadmap (Server mit Browser) oder Nachbesserungen.

### 03.10.2026 – W9: Anhänge verstehen und Terminfinder (Phase 7/8 der Spezifikation, Wunsch des Nutzers)
- **Vom Nutzer bestätigt:** Gmail- und iCloud-Konto laufen seit Wochen einwandfrei unter Windows (damit sind „echtes
  iCloud-Konto“ und die Konten-Grundfunktionen geprüft).
- **W9.1 Relevanzprüfung – gebaut, lokal geprüft:** Prüfsumme, Seitenzahl, Sperre und Risiko-Kennzeichen beim Abgleich;
  Vorfilter per Code; Regeln sofort, KI im Hintergrund (neueste 300 Mails); Status-Knopf am Anhang mit Begründung,
  „Trotzdem lesen“/„Ist unwichtig“ mit Regel je Absender; Phishing-Check nutzt die Risiko-Kennzeichen. Migration v22.
  Messung: nie ein zentraler Anhang übersehen (Regeln, E2B, E4B); E2B Kontrollsatz 10/13. Tests: Unit + E2E.
- **W9.2 Tiefenanalyse + „Frag den Anhang“ – gebaut, lokal geprüft:** Text aus PDF, Text und neu Word/PowerPoint/Excel;
  Zusammenfassung zentraler Anhänge im Hintergrund (Map-Reduce bei langen Dokumenten); Frage mit Seite und geprüftem
  Zitat. Messung E2B: 7/7 richtig mit Seite. **Ungeprüft:** in der App mit echtem Modell (siehe Electron-Absturz in diesem
  Container), Scans/Bilder (laufen über „Mit KI lesen“), sehr lange Dokumente.
- **W9.3 Passwortgeschützte PDFs – gebaut, lokal geprüft:** mit echtem AES-128-verschlüsselten Test-PDF (pypdf):
  Sperre erkannt, Passwort aus einer zweiten Mail gefunden, für den Absender gemerkt (im Test: Speicher im Arbeitsspeicher;
  in der App DPAPI), beim nächsten PDF ohne Suche entsperrt; danach durchsuchbar. **Nicht umgesetzt:** verschlüsselte
  ZIPs und Office-Dateien (Spezifikation: spätere Phase), Liste „häufige Passwörter“, Anzeige gesperrter PDFs im Betrachter
  der App (Text, Suche und KI gehen; zum Ansehen weiter das Standardprogramm).
- **W9.4 Terminfinder – gebaut, lokal geprüft:** ICS-Abo (Entscheidung des Nutzers) mit Zeitzonen, Wiederholungen
  (täglich/wöchentlich mit Tagen/monatlich/jährlich, COUNT/UNTIL/EXDATE, verschobene Einzeltermine), ganztägig, abgesagt,
  „frei“; freie Zeiten mit Arbeitszeiten/Puffer/Dauer, genannte Wochentage bevorzugt; Antwort öffnet den Editor; Zusage
  → Kalenderdatei. Migration v23. Tests: Unit (Parser, Zeitfenster, Dienst mit Test-Abruf) + E2E (ohne Kalender).
  **Ungeprüft:** echte Google-/iCloud-ICS-Links (Format, Größe, Abrufzeit), monatliche Regeln mit BYDAY/BYMONTHDAY
  (werden nicht ausgewertet, nur einfache Monatswiederholung), Zeitzonen-Sonderfälle.
- Stand Tests: 475 Unit-Tests grün (inkl. GreenMail), E2E 21 grün / 2 übersprungen (Modell-abhängig).
- Als Nächstes: Test des Nutzers unter Windows (W8 + W9), danach Server mit Browser (S1).

### 03.10.2026 – Windows-CI wieder grün (Korrektur)
- **Fehler:** Seit der 16K-Änderung (Lauf #116–#120) schlug in der Windows-CI genau ein Test fehl: die Bild-Laufzeit
  `llama-server` startete nicht. Ursache: Sie bekam fest `--cache-type-k q8_0` mit; das winzige CI-Testmodell kann das nicht
  (Kopfgröße 8 nicht durch 32 teilbar) und `llama-server` beendet sich dann sofort. Beim Hauptmodell gab es einen Rückfall,
  bei `llama-server` hatte ich ihn vergessen – und lokal läuft dieser Test nur mit eigener Freigabe, darum fiel es mir nicht auf.
- **Behoben:** Beendet sich `llama-server` beim Start, startet er einmal ohne den kleinen Zwischenspeicher neu und merkt
  sich das. Lokal nachgestellt (gleicher Test mit Testmodell und echter Laufzeit): ohne Korrektur Fehler, mit Korrektur grün.
- **Lehre:** Vor jedem Push auch die Laufzeit-Tests (`STINKYMA_TEST_LLAMA_RUNTIME=1`) laufen lassen und den CI-Lauf prüfen.
- **Zweiter Fehler (sichtbar erst, nachdem die Unit-Tests wieder grün waren):** Zwei App-Tests konnten „Neue E-Mail“ nicht
  anklicken – die Werkzeugleiste der Mail-Ansicht lief im kleineren Windows-Fenster nach links über die Mail-Liste (seit
  W8.2: zusätzlicher Knopf „Person“ und `position: relative` für den Steckbrief). Das trifft auch echte Nutzer mit
  schmalem Fenster. Behoben: Leiste bricht um, Mail-Ansicht ragt nicht mehr über ihre Spalte. Lokal mit 1024×768
  nachgestellt (vorher Fehler, nachher alle 21 E2E grün, KI-E2E mit Testmodell grün).
- **Lehre:** E2E zusätzlich mit kleinem Bildschirm (`xvfb-run -s "-screen 0 1024x768x24"`) laufen lassen.
- **Dritter Punkt (Lauf #122):** Der Test des Hauptmodells hing unter Windows einmal 180 s – nach dem Neuladen des Modells,
  jeweils nach einem gescheiterten Q8_0-Versuch (das Testmodell kann Q8_0 nicht). Unter Linux 12× wiederholt nicht
  nachstellbar. Trotzdem behoben statt als Zufall abgetan: Q8_0 wird nur noch versucht, wenn das Modell es laut
  GGUF-Metadaten kann (Kopfgröße durch 32 teilbar: Testmodell nein, Gemma 4 E2B und Qwen 3.5 2B ja – geprüft), und ein
  Fehlschlag wird je Modell gemerkt. Damit fällt der fehlschlagende Weg weg. **Ungeprüft:** ob das Hängen unter Windows
  damit sicher verschwunden ist – das zeigt erst die CI.
