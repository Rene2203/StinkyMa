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

## Hardware des Nutzers (Stand 30.09.2026)

| Rechner | Ausstattung | Vorgeschlagene Rolle |
|---|---|---|
| **Intel N97** | 12 GB DDR5 (geteilt mit der Grafik) | **Dauerläufer-Server** (sparsam): Mail-Sync rund um die Uhr, Datenbank, Web-Oberfläche, später Push (Phase 13). KI nur für kleine Aufgaben (1–3B-Modelle auf der CPU, langsam, eher nachts). |
| **PC mit RTX 2070 Super** | 8 GB VRAM, 32 GB DDR4, 1 TB M.2 | **KI-Server** mit Ollama/llama.cpp: 7–8B-Modelle (4-Bit) passen komplett in die Grafikkarte und laufen flott; 13B nur teilweise auf der GPU (spürbar langsamer). Wenn er aus ist, stellt die App KI-Aufgaben zurück (5.3) – nie Fallback in die Cloud. |
| **Intel i5-14600K** | 32 GB, 2 TB M.2 | Stark genug für Windows-App plus lokale Modelle auf der CPU (7B mit einigen Wörtern pro Sekunde). Rolle hängt davon ab, ob das der Alltags-PC ist. |

Alle drei zusammen decken die Spezifikation gut ab: „Eigener Server“ (5.3) und Server-Version (11.3) laufen im Heimnetz.

## Offene Fragen an den Nutzer
- Welcher Rechner ist der Windows-Alltags-PC? Welche laufen dauerhaft?
- Betriebssystem auf dem N97 (Linux/Windows)? Docker vorhanden?
- App-Name (Arbeitsname „StinkyMa“)
