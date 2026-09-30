# Roadmap Windows & Server

## Leitplanken (vom Nutzer bestätigt, 30.09.2026)

1. **Das ursprüngliche Ziel bleibt:** iPadOS/macOS, Windows **und** Server mit Browser. Windows kommt nur
   zuerst, weil es sich sofort testen lässt. Alles wird so gebaut, dass die anderen Plattformen folgen können
   (gleiches Datenmodell, gleiche Schnittstellen, Prompts/Kategorien als plattformneutrale Dateien).
2. **Maßstab ist schwache Hardware:** Alle KI-Kernfunktionen müssen mit einem **~3B-Modell** gut funktionieren
   (Spezifikation 5.7) – auf einem Low-End-PC, dem N97-Server und später dem iPad. Größere Modelle (7B, 13B)
   sind eine Option für bessere Qualität, **nie Voraussetzung**. Der leistungsstarke Haupt-PC des Nutzers
   ist ausdrücklich **nicht** der Standard, gegen den entwickelt oder getestet wird.
3. Daraus folgt: Prompts kurz, Eingaben bereinigt, strukturierte Ausgaben, „Code rechnet, KI versteht“ (5.7);
   Test-Set und Benchmark messen immer zuerst mit einem 3B-Modell.

**Entscheidung vom 30.09.2026:** Die iPad-/Mac-Version ruht vorerst, weil sie ohne Mac bzw. ohne bezahlten
Apple-Developer-Account nicht auf echten Geräten testbar ist. Zuerst entsteht die **Windows-App**, danach
die **Server-Version mit Browser-Zugriff** (Spezifikation, Abschnitt 11). Die Swift-Module bleiben erhalten
und werden später wieder aufgenommen. **Nachtrag 30.09.2026:** Die Swift-Seite ist ganz zurückgestellt – kein
paralleles Nachziehen des Schemas mehr, Apple-CI nur von Hand. Offene Punkte sammelt `docs/SWIFT-NACHHOLEN.md`.

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
| **W2 – Ein Konto lesen** | IMAP (imapflow), Konto-Einrichtung mit iCloud (app-spezifisches Passwort), Ordner & Mails laden, MIME parsen, HTML sicher anzeigen (ohne Skripte, externe Bilder blockiert) | ✅ umgesetzt (mit echtem Konto noch ungetestet) |
| **W3 – Mehrere Konten & Senden** | Auto-Discovery, OAuth Gmail/Outlook (Loopback-Redirect + PKCE), SMTP, Composer, Entwürfe, Offline-Warteschlange | 🚧 Composer, SMTP, Postausgang, Formatierung, Entwürfe, Anhänge, Adressvorschläge, Signatur, Weiterleiten umgesetzt; offen: OAuth Gmail/Outlook |
| **W4 – Suche & Sync** | FTS5-Suche in der Oberfläche, IDLE, Sync im Hintergrund (Infobereich/Tray), Autostart, Anhang-Reader (PDF.js), Textextraktion | offen |
| **W5 – KI-Basis** | `AIProvider`/`AIRouter` mit Datenschutz-Prüfung in TypeScript, lokales **3B-Modell als Standard** (llama.cpp, läuft auch nur auf der CPU), optional Ollama/größere Modelle; Test-Set, gemessen mit 3B; Zusammenfassung, Kategorisierung | offen |
| **S1 – Server & Browser** | `apps/server`: HTTP-API + gleiche Oberfläche im Browser, Login, Docker Compose, Zugriff nur im Heimnetz/VPN | offen |
| danach | Spezifikation Phasen 6–15 (eigene Modelle, Assistent, Alleinstellungsmerkmale …) für Windows & Server | offen |

## Hardware des Nutzers (Stand 30.09.2026)

| Rechner | Ausstattung | Rolle |
|---|---|---|
| **Haupt-PC (Windows)** | Ryzen 9 5900X, **RTX 4070 Ti Super (16 GB VRAM)**, 32 GB DDR4 | Hier testet der Nutzer die Windows-App. Kann optional größere Modelle (7–14B) nutzen – **aber nicht Maßstab** (siehe Leitplanke 2). |
| Server: PC mit RTX 2070 Super | 8 GB VRAM, 32 GB DDR4, 1 TB M.2 | später: KI-Server im Heimnetz (5.3) |
| Server: Intel N97 | 12 GB DDR5 (geteilt) | später: sparsamer Dauerläufer für Mail-Sync & Browser-Version (S1) |
| Server: Intel i5-14600K | 32 GB, 2 TB M.2 | später: Reserve / Server-Version / Dienste |

Reihenfolge laut Nutzer: **Windows zuerst**, Server danach.

## Offene Fragen an den Nutzer
- (für S1, später) Welche Server laufen dauerhaft, Betriebssystem, Docker?
- App-Name (Arbeitsname „StinkyMa“)
