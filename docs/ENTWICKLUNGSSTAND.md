# Entwicklungsstand

Laufendes Protokoll des Zwischenstands. Wird nach jedem größeren Arbeitsschritt aktualisiert –
nicht erst am Ende einer Phase. Abgeschlossene Phasen stehen zusätzlich in `CHANGELOG.md`.

**Zuletzt aktualisiert:** 30.09.2026
**Aktueller Fokus:** Windows-App (`web/`), danach Server mit Browser – Roadmap: `docs/ROADMAP-WINDOWS.md`
**Aktuelle Phase:** W3 Teil 2 fertig (lokal geprüft) – Test durch den Nutzer mit iCloud steht aus; danach OAuth-Frage (Gmail/Outlook) bzw. W4

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
