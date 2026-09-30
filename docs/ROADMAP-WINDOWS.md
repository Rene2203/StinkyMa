# Roadmap Windows & Server

**Entscheidung vom 30.09.2026:** Die iPad-/Mac-Version ruht vorerst, weil sie ohne Mac bzw. ohne bezahlten
Apple-Developer-Account nicht auf echten Geräten testbar ist. Zuerst entsteht die **Windows-App**, danach
die **Server-Version mit Browser-Zugriff** (Spezifikation, Abschnitt 11). Die Swift-Module bleiben erhalten
und werden später wieder aufgenommen.

## Architektur

```
web/
  packages/core     TypeScript-Kern: Modelle, SQLite (better-sqlite3, FTS5), Repository, Mock-Daten,
                    sicherer Speicher. Läuft in Electron UND später im Server-Prozess.
  packages/ui       React-Oberfläche (Drei-Spalten-Layout). Spricht nur mit der MailRepository-Schnittstelle.
  apps/desktop      Windows-App (Electron): Datenbank im Main-Prozess, Oberfläche im Renderer,
                    Verbindung über eine abgesicherte IPC-Brücke. Installer per electron-builder (NSIS).
  apps/server       (später) Node-Server: dieselbe Schnittstelle als HTTP-API, dieselbe Oberfläche im Browser,
                    Auslieferung als Docker-Compose-Paket für den Heimserver.
```

- **Gleiches Datenmodell wie auf dem iPad:** Tabellen, Flags und Mock-Daten sind identisch mit `MailSchema.swift`
  bzw. `MockData.swift`. Eine Datenbank-Datei ist damit grundsätzlich zwischen den Plattformen austauschbar.
- **Datenschutz-Versprechen (5.0) auf Windows:** „On-Device“ heißt hier: lokales Modell über llama.cpp
  (z. B. `node-llama-cpp`) oder eine vorhandene Ollama-/LM-Studio-Installation auf demselben Rechner.
  Apples Foundation Models gibt es unter Windows nicht.
- **Passwörter & Tokens:** Electron `safeStorage` → Windows-DPAPI (an das Windows-Benutzerkonto gebunden).
  Auf dem Server später: Schlüssel aus Nutzer-Passwort bzw. Secret-Datei (11.3).
- **Mail-Bibliotheken (ab W2):** `imapflow` (IMAP inkl. IDLE, CONDSTORE/QRESYNC), `mailparser` (MIME),
  `nodemailer` (SMTP) – ausgereift und MIT-lizenziert. Vor Einsatz Lizenz und Pflegezustand erneut prüfen.

## Phasen

Die Phasen folgen der Spezifikation (Abschnitt 9), angepasst an Windows. ★ = Vorrang innerhalb der Phase.

| Phase | Inhalt | Status |
|---|---|---|
| **W1 – Fundament** | Electron-App, Drei-Spalten-Oberfläche mit Mock-Daten, SQLite-Schema + Migrationen, sicherer Speicher (DPAPI), Tests, Windows-CI mit Installer | ✅ umgesetzt |
| **W2 – Ein Konto lesen** | IMAP (imapflow), Konto-Einrichtung mit iCloud (app-spezifisches Passwort), Ordner & Mails laden, MIME parsen, HTML sicher anzeigen (ohne Skripte, externe Bilder blockiert) | offen |
| **W3 – Mehrere Konten & Senden** | Auto-Discovery, OAuth Gmail/Outlook (Loopback-Redirect + PKCE), SMTP, Composer, Entwürfe, Offline-Warteschlange | offen |
| **W4 – Suche & Sync** | FTS5-Suche in der Oberfläche, IDLE, Sync im Hintergrund (Infobereich/Tray), Autostart, Anhang-Reader (PDF.js), Textextraktion | offen |
| **W5 – KI-Basis** | `AIProvider`/`AIRouter` mit Datenschutz-Prüfung in TypeScript, lokales Modell (llama.cpp/Ollama), Zusammenfassung, Kategorisierung | offen |
| **S1 – Server & Browser** | `apps/server`: HTTP-API + gleiche Oberfläche im Browser, Login, Docker Compose, Zugriff nur im Heimnetz/VPN | offen |
| danach | Spezifikation Phasen 6–15 (eigene Modelle, Assistent, Alleinstellungsmerkmale …) für Windows & Server | offen |

## Offene Fragen an den Nutzer
- Heimserver: Welche Hardware/Betriebssystem, ist Docker vorhanden? (für S1)
- App-Name (Arbeitsname „StinkyMa“)
