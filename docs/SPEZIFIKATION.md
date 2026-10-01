# Projekt-Spezifikation: KI-Mail-App für iPadOS (und macOS)

> Dieses Dokument ist die Arbeitsgrundlage für Claude Code. Es beschreibt Vision, Architektur, Features und eine Umsetzungs-Roadmap. Bei Unklarheiten gilt: erst nachfragen, dann bauen. Arbeite phasenweise (siehe Roadmap) und schließe jede Phase mit lauffähigem, getestetem Code ab.

---

## 1. Vision

Eine native Mail-App für iPadOS im Stil von **Spark** und **Outlook**, die mehrere Mail-Konten in einem gemeinsamen Posteingang vereint. Das Alleinstellungsmerkmal ist eine **lokal laufende KI**, die Mails liest, sortiert, zusammenfasst, Erinnerungen setzt und mit der Zeit das Verhalten des Nutzers lernt. Optional kann statt/zusätzlich zur lokalen KI eine Cloud-API (Claude, OpenAI, Mistral u. a.) eingebunden werden.

Dazu kommen KI-Funktionen, die kaum eine andere Mail-App bietet (Abschnitt 7.1): ein Versprechen-Tracker für eigene und fremde Zusagen, ein Überblick über Verträge und Abos mit Kündigungsfristen, ein Belegordner für die Steuer und Mail-Regeln, die man einfach in Worten beschreibt.

**Leitprinzipien**
- **Das Versprechen: On-Device-KI.** Keine von der KI gelesene Mail verlässt das Gerät, es sei denn, der Nutzer entscheidet sich ausdrücklich für einen externen KI-Anbieter oder seinen eigenen Server. Diese Regel ist nicht verhandelbar und gilt für jede Plattform (siehe 5.0).
- **Freie Modellwahl:** Apples eingebautes Modell ist der Standard. Der Nutzer entscheidet aber selbst, welches LLM er nutzt: eigenes lokales Modell, eigener Heimserver oder Cloud-API.
- **iPad-nativ:** Drei-Spalten-Layout, Stage Manager, Split View, Tastaturkürzel, Apple Pencil, Drag & Drop.
- **KI als Assistent, nicht als Autopilot:** Die KI schlägt vor, der Nutzer entscheidet. Keine Mail wird ohne Bestätigung gesendet oder gelöscht.
- **Plattform-offen bauen:** Zuerst iPadOS, später optional Web und Windows (siehe Abschnitt 11). Kernlogik, Prompts und Datenformate von Anfang an so gestalten, dass sie wiederverwendbar sind.

---

## 2. Technologie-Stack

| Bereich | Wahl | Begründung |
|---|---|---|
| Sprache | Swift 6 (strict concurrency) | Modern, sicher |
| UI | SwiftUI (`NavigationSplitView`) | Drei-Spalten-Layout nativ |
| Mindestversion | iPadOS 26 | Foundation Models Framework verfügbar |
| IMAP | `swift-nio-imap` (Apple) | Aktiv gepflegt, async-fähig |
| SMTP | eigener schlanker Client auf SwiftNIO oder bewährtes Swift-Package | Senden |
| MIME-Parsing | eigenes Modul oder etabliertes Package | Multipart, Encodings, Anhänge |
| Datenbank | SQLite via **GRDB** inkl. **FTS5** | Volltextsuche, Performance |
| Vektorsuche | `sqlite-vec` Extension (oder einfache Cosine-Suche in Swift als Fallback) | RAG / semantische Suche |
| Secrets | Keychain | Passwörter, OAuth-Tokens, API-Keys |
| OAuth | `ASWebAuthenticationSession` + PKCE; MSAL für Microsoft optional | Gmail, Outlook |
| Lokale KI | Apple **Foundation Models**, **llama.cpp** (GGUF), **MLX Swift** | Siehe Abschnitt 5 |
| Kalender/Erinnerungen | EventKit | Termine & Reminder |
| Anhänge | PDFKit, Quick Look, Vision (Texterkennung), ZIP-Bibliothek mit Passwort-Support (z. B. minizip-ng), AVKit, SpeechAnalyzer | Reader & Textextraktion (7.8) |
| Hintergrund | `BGTaskScheduler` | Sync, Indexierung, Lernen |
| Systemintegration | App Intents, WidgetKit | Kurzbefehle, Siri, Widgets |

---

## 3. Architektur

```
┌─────────────────────────── UI (SwiftUI) ───────────────────────────┐
│  Sidebar (Konten/Ordner) │ Mail-Liste │ Mail-Detail / Composer     │
└───────────────┬────────────────────────────────────────┬──────────┘
                │                                        │
        ┌───────▼────────┐                      ┌────────▼────────┐
        │  MailService   │                      │   AIService     │
        │ (Accounts,Sync)│◄────── Events ──────►│ (Provider-Proto)│
        └───────┬────────┘                      └────────┬────────┘
                │                                        │
   ┌────────────▼────────────┐            ┌──────────────▼──────────────┐
   │ Provider-Adapter        │            │ AI-Provider                 │
   │ IMAPAdapter, GmailAPI,  │            │ AppleFoundation, LlamaCpp,  │
   │ GraphAPI (optional)     │            │ MLX, Anthropic, OpenAI, ... │
   └────────────┬────────────┘            └──────────────┬──────────────┘
                │                                        │
        ┌───────▼────────────────────────────────────────▼───────┐
        │  Storage (GRDB): Mails, Threads, FTS5, Embeddings,      │
        │  Verhaltens-Events, Nutzerprofil, Einstellungen         │
        └─────────────────────────────────────────────────────────┘
```

**Modulstruktur (Swift Packages im Workspace)**
- `MailCore` – Modelle (Account, Mailbox, Message, Thread, Attachment), MIME-Parser
- `MailSync` – IMAP/SMTP-Clients, Provider-Adapter, Sync-Engine
- `MailStore` – GRDB-Schema, Migrationen, FTS, Vektor-Index
- `AIKit` – `AIProvider`-Protokoll, alle Provider, Prompt-Templates, Task-Pipeline
- `Personalization` – Verhaltens-Tracking, Priorisierungsmodell, Stilprofil
- `Insights` – Extraktoren für Zusagen, Abos, Belege, Reisen, Pakete (schema.org-Parser, Regex, KI-Fallback), Statistik
- `Rules` – Regel-Schema, Regel-Engine (deterministisch), Übersetzung Sprache → Regel
- `App` – SwiftUI-Oberfläche, App Intents, Widgets

Alle Services als `actor` bzw. mit sauberer Concurrency. Abhängigkeiten per Protokoll injizieren, damit alles testbar ist (Mock-IMAP-Server, Mock-AI-Provider).

---

## 4. Mail-Konten

### 4.1 Unterstützte Anbieter

| Anbieter | Protokoll | Auth | Server |
|---|---|---|---|
| iCloud (@icloud.com, @me.com, @mac.com) | IMAP/SMTP | **App-spezifisches Passwort** (kein OAuth verfügbar) | `imap.mail.me.com:993` (SSL), `smtp.mail.me.com:587` (STARTTLS) |
| Gmail / Google Workspace | IMAP/SMTP oder Gmail API | OAuth2 (XOAUTH2), Scope `https://mail.google.com/` | `imap.gmail.com:993`, `smtp.gmail.com:587` |
| Outlook / Hotmail / Microsoft 365 | IMAP/SMTP (optional Graph API) | OAuth2, Scopes `IMAP.AccessAsUser.All`, `SMTP.Send`, `offline_access` | `outlook.office365.com:993`, `smtp.office365.com:587` |
| Yahoo | IMAP/SMTP | App-Passwort oder OAuth2 | `imap.mail.yahoo.com:993` |
| GMX, web.de, T-Online, Posteo, mailbox.org u. a. | IMAP/SMTP | Passwort | Auto-Discovery |
| Eigene Domain | IMAP/SMTP | Passwort | Manuelle Eingabe |

### 4.2 Einrichtungs-Flow
1. Nutzer gibt E-Mail-Adresse ein.
2. **Auto-Discovery:** Domain → bekannte Anbieter-Tabelle → Mozilla-ISPDB (`autoconfig.thunderbird.net`) → DNS SRV (`_imaps._tcp`) → manuelle Eingabe.
3. Bei iCloud: kurze, bebilderte Anleitung zum Erstellen eines app-spezifischen Passworts (Link zu account.apple.com).
4. Bei Gmail/Outlook: OAuth-Flow via `ASWebAuthenticationSession` mit PKCE, Refresh-Token in Keychain.
5. Verbindungstest, danach initialer Sync (neueste 30 Tage zuerst, Rest im Hintergrund).

**Hinweis Gmail:** Für private Nutzung reicht ein Google-Cloud-Projekt im Testmodus (max. 100 Testnutzer). Ein öffentlicher Release erfordert Googles Verifizierung inkl. Security Assessment für restricted Scopes.

### 4.3 Sync-Engine
- IMAP `CONDSTORE`/`QRESYNC` wo verfügbar für effiziente Delta-Syncs, sonst UID-basiert.
- `IDLE` solange die App im Vordergrund ist.
- Hintergrund: `BGAppRefreshTask` (vom System gesteuert, nicht garantiert). **Echtzeit-Push im Hintergrund ist ohne eigenen Server nicht möglich** – als optionale spätere Phase einplanen (Server hält IMAP-IDLE, schickt APNs-Push).
- Offline-fähig: Aktionen (Archivieren, Flaggen, Senden) in einer Queue, Abgleich bei Verbindung.
- Gmail-Labels auf Ordner-Konzept abbilden (`X-GM-LABELS`, `X-GM-THRID` für Threads).

### 4.4 Kernfunktionen Mail
- Gemeinsamer Posteingang aller Konten + Einzelansicht pro Konto, Farbe pro Konto
- Konversations-/Thread-Ansicht
- Wischgesten (konfigurierbar): Archivieren, Löschen, Snooze, Als gelesen
- Mehrfachauswahl, Drag & Drop in Ordner
- Composer mit Rich Text, Anhängen, Signatur pro Konto, Absender-Auswahl
- Entwürfe, Senden rückgängig (Verzögerung 5–30 s)
- Volltextsuche lokal (FTS5) + Server-Suche als Fallback
- HTML-Mails sicher rendern (`WKWebView`, JavaScript aus, externe Bilder standardmäßig blockiert)

---

## 5. KI-System

### 5.0 Datenschutz-Versprechen & Modellwahl

**Grundregel:** Die KI arbeitet auf dem Gerät. Mail-Inhalte gehen nur dann an einen anderen Rechner, wenn der Nutzer das bewusst eingerichtet hat. Die App unterscheidet deshalb drei Klassen von KI-Anbietern:

| Klasse | Beispiele | Verlässt die Mail das Gerät? | Standard |
|---|---|---|---|
| **On-Device** | Apple Foundation Models (~3B), eigene GGUF-/MLX-Modelle (3B / 7B / 13B) | Nein | **Ja** (Apple-Modell) |
| **Eigener Server** | Heimserver mit Ollama, LM Studio, llama.cpp-Server, vLLM (OpenAI-kompatibler Endpoint) | Ja, aber nur zum eigenen Server des Nutzers | Aus, Opt-in |
| **Cloud-API** | Anthropic, OpenAI, Mistral, Google Gemini | Ja, zum Anbieter | Aus, Opt-in |

**Pflichten für die Umsetzung**
- Ohne Zutun des Nutzers wird **ausschließlich On-Device** verwendet. Kein stiller Fallback auf Server oder Cloud, auch nicht, wenn das lokale Modell fehlt, zu langsam ist oder abstürzt. Stattdessen: Hinweis an den Nutzer.
- Beim Aktivieren von „Eigener Server“ oder „Cloud-API“ erscheint ein klarer Dialog, was übertragen wird und wohin.
- Freigabe **pro Konto und pro Aufgabe** (z. B. Zusammenfassungen dürfen in die Cloud, Stilprofil-Lernen nie).
- Sichtbare Kennzeichnung in der UI: kleines Symbol bei jedem KI-Ergebnis, das zeigt, wo es berechnet wurde (Gerät / eigener Server / Cloud).
- Verhaltens-Log, Stilprofil und Embeddings werden **immer lokal** berechnet und gespeichert, unabhängig vom gewählten LLM.
- Das Datenschutz-Dashboard (7.6) protokolliert jede Übertragung außerhalb des Geräts: wann, welcher Anbieter, welche Aufgabe, wie viele Zeichen.
- Eigener Server: nur verschlüsselte Verbindungen (HTTPS) oder Heimnetz / VPN (z. B. Tailscale, WireGuard); Warnung bei unverschlüsseltem HTTP außerhalb des lokalen Netzes.

**Freie Modellwahl**
- Standard beim ersten Start: Apple Foundation Models, sofern verfügbar. Sonst Angebot, ein kleines 3B-Modell herunterzuladen.
- Der Nutzer kann **pro Aufgabe** ein anderes Modell wählen (z. B. Kategorisierung mit Apple-Modell, Antwortentwürfe mit 8B-Modell oder Heimserver).
- Jedes GGUF- bzw. MLX-kompatible Modell ist erlaubt, nicht nur die kuratierte Liste.
- Pro Modell einstellbar: Prompt-Format / Chat-Template, Kontextlänge, Temperatur, Systemprompt.
- Benchmark-Knopf: „Teste dieses Modell mit 5 meiner Mails“ zeigt Geschwindigkeit und Qualität im Vergleich, lokal ausgeführt.

### 5.1 Provider-Abstraktion

```swift
protocol AIProvider: Sendable {
    var id: String { get }
    var displayName: String { get }
    var privacyClass: PrivacyClass { get }   // .onDevice, .ownServer, .cloud
    var contextWindow: Int { get }
    func generate(_ request: AIRequest) async throws -> AIResponse
    func stream(_ request: AIRequest) -> AsyncThrowingStream<String, Error>
    func embed(_ texts: [String]) async throws -> [[Float]]   // optional
}
```

Alle KI-Features sprechen nur mit `AIProvider`. Nutzer wählt pro Aufgabe (Zusammenfassung, Sortierung, Entwürfe) den Provider.

Ein zentraler `AIRouter` prüft vor jedem Aufruf, ob die `privacyClass` des Providers für dieses Konto und diese Aufgabe freigegeben ist. Ist sie das nicht, wird der Aufruf blockiert, nicht umgeleitet. Für diese Prüfung sind Unit-Tests Pflicht.

Der `AIRouter` bekommt schon in Phase 5 einen Zwischenschritt für ausgehende und eingehende Texte (`PrivacyGuard`-Protokoll, anfangs ohne Funktion). So lässt sich die Schutzschicht aus 5.6 später einbauen, ohne die Architektur umzubauen.

### 5.2 Lokale Modelle

| Stufe | Umsetzung | RAM (4-Bit) | Zielgeräte |
|---|---|---|---|
| **Standard** | Apple Foundation Models (`import FoundationModels`, `LanguageModelSession`, `@Generable` für strukturierte Ausgaben) | systemseitig | Apple-Intelligence-fähige iPads |
| **3B** | GGUF via llama.cpp oder MLX Swift | ~2 GB | alle M-iPads |
| **7–8B** | GGUF/MLX | ~4,5 GB | iPads mit ≥ 8 GB RAM |
| **13B** | GGUF/MLX | ~8 GB | nur iPad Pro 16 GB, experimentell |

- **Modell-Manager:** Modelle aus Hugging Face herunterladen (URL eingeben oder kuratierte Liste), Fortschritt, Prüfsumme, Speicherplatzanzeige, Löschen.
- **Import eigener Modelle:** GGUF-Datei über die Dateien-App importieren.
- **Geräte-Check:** verfügbaren RAM ermitteln (`os_proc_available_memory()`), zu große Modelle ausgrauen und warnen.
- Entitlement `com.apple.developer.kernel.increased-memory-limit` setzen.
- Modell nur laden, wenn benötigt; bei Memory-Warnung entladen.
- Rechenintensive Jobs (Batch-Zusammenfassungen, Indexierung) bevorzugt beim Laden (`BGProcessingTask` mit `requiresExternalPower = true`).

### 5.3 Eigener Server (Heimserver)
- Anbindung über **OpenAI-kompatiblen Endpoint** (Ollama, LM Studio, llama.cpp-Server, vLLM) mit URL und optionalem API-Key.
- Modellliste automatisch vom Server abfragen (`/v1/models`), Auswahl in der App.
- Verbindungstest und Anzeige von Antwortzeit.
- Erlaubt große Modelle (13B, 30B+), die auf dem iPad nicht laufen.
- Wenn der Server nicht erreichbar ist (z. B. unterwegs ohne VPN): Aufgabe in eine Warteschlange stellen oder den Nutzer fragen, ob sie einmalig lokal laufen soll. Nie automatisch in die Cloud.

### 5.4 Cloud-APIs
- Anbieter: Anthropic (Claude), OpenAI, Mistral, Google Gemini.
- API-Keys in Keychain.
- Datenschutz-Schalter pro Konto: „Cloud-KI darf Mails dieses Kontos verarbeiten“.
- Vor dem Senden: Schutzschicht mit Pseudonymisierung (siehe 5.6).
- Kostenanzeige: Token-Zähler pro Monat.

### 5.5 KI-Aufgaben

| Aufgabe | Beschreibung | Ausgabe |
|---|---|---|
| **Kategorisierung** | Jede neue Mail: Persönlich, Arbeit, Newsletter, Benachrichtigung, Rechnung, Termin, Spam-Verdacht | strukturiert (enum + Konfidenz) |
| **Priorisierung** | Wichtig / Normal / Später, kombiniert mit Verhaltensmodell (6.2) | Score 0–1 |
| **Thread-Zusammenfassung** | 2–4 Sätze + offene Punkte + wer wartet auf wen | strukturiert |
| **Aktionen extrahieren** | Termine, Fristen, To-dos, Zahlungsbeträge | Vorschläge für Kalender/Erinnerungen |
| **Erinnerungen** | „Antwort fällig bis Freitag“, „Rechnung fällig am 15.“ | EventKit-Reminder nach Bestätigung |
| **Antwortentwürfe** | 2–3 Varianten (kurz zusagen / ablehnen / nachfragen) im Stil des Nutzers | Text |
| **Phishing-Check** | Absender-Domain vs. Anzeigename, verdächtige Links, Dringlichkeitsdruck | Warnbanner mit Begründung |
| **Tages-Digest** | Morgens: was ist wichtig, was wartet, was ist fällig | Übersichtsseite + Widget |
| **Anhang-Relevanz** | Ist der Anhang für den Zusammenhang wichtig? (7.8.3) | strukturiert (Relevanz, Dokumenttyp, Aktion, Begründung) |
| **Anhang-Analyse** | Nur relevante Anhänge: Volltext, Felder je Dokumenttyp, Kurzfassung | strukturiert + Text |
| **Passwort finden** | Passwort-Kandidaten für gesperrte Anhänge im Thread erkennen (7.8.2) | Liste von Kandidaten, nur lokal |

Alle Prompts als versionierte Templates in `AIKit/Prompts/`. Strukturierte Ausgaben immer als JSON mit Schema-Validierung (bzw. `@Generable` bei Foundation Models); bei ungültiger Ausgabe einmal neu versuchen, sonst Fallback auf Regeln.

**Kontextgrenzen:** Lange Threads kürzen (Zitate/Signaturen entfernen, älteste Mails zuerst zusammenfassen, dann Map-Reduce).

### 5.6 Schutzschicht für externe KI (späte Phase)

**Grundsatz:** Ein Sprachmodell muss den Text lesen können, um damit zu arbeiten. Klassische Verschlüsselung, bei der der Anbieter nur Datensalat sieht und trotzdem sinnvoll antwortet, funktioniert mit LLMs praktisch nicht. Homomorphe Verschlüsselung (Rechnen auf verschlüsselten Daten) ist für Sprachmodelle heute um Größenordnungen zu langsam und wird nicht umgesetzt. Stattdessen zwei realistische Bausteine:

**A) Pseudonymisierung mit lokalem Übersetzungslayer (Hauptbaustein)**
1. **Erkennen (lokal):** Personenbezogene und sensible Daten werden auf dem Gerät gefunden: Namen, E-Mail-Adressen, Telefonnummern, Adressen, IBAN/Kontonummern, Firmen, Vertrags-/Kundennummern, Beträge (optional), Links. Umsetzung: Regeln/Regex für feste Formate + `NLTagger` (Named Entity Recognition) + optional das lokale LLM für schwierige Fälle.
2. **Ersetzen (lokal):** Jeder Treffer wird durch einen stabilen Platzhalter ersetzt, z. B. „Max Müller“ → `[PERSON_1]`, „DE89 3704…“ → `[IBAN_1]`. Gleiche Werte bekommen im selben Thread immer denselben Platzhalter, damit die KI Zusammenhänge versteht.
3. **Senden:** Nur der pseudonymisierte Text geht an die API. Der Systemprompt erklärt der KI, dass Platzhalter unverändert zu übernehmen sind.
4. **Zurückübersetzen (lokal):** Die Antwort wird auf dem Gerät wieder mit den echten Werten gefüllt. Die Zuordnungstabelle verlässt **nie** das Gerät und wird nach der Aufgabe gelöscht (oder verschlüsselt pro Thread zwischengespeichert).
5. **Prüfen:** Fehlen Platzhalter in der Antwort oder wurden sie verändert, wird das erkannt und markiert, statt falsche Daten einzusetzen.

Einstellungen und UI:
- Schutzstufen: **Aus / Standard** (Kontaktdaten, Bank, Adressen) / **Streng** (zusätzlich Namen, Firmen, Beträge, Orte).
- Vorschau-Knopf „Was wird gesendet?“ zeigt den exakten pseudonymisierten Text vor dem Absenden.
- Pro Aufgabe unterschiedlich: z. B. Zusammenfassungen streng, Übersetzungen Standard.
- Das Datenschutz-Dashboard protokolliert, wie viele Werte ersetzt wurden.

Ehrliche Grenzen (in der App erklären):
- Der Inhalt der Mail bleibt lesbar; aus dem Zusammenhang kann man oft trotzdem Rückschlüsse ziehen.
- Die Erkennung ist nie zu 100 % vollständig.
- Manche Aufgaben werden schlechter, wenn Namen fehlen (z. B. Anrede in Antwortentwürfen). Diese setzt der Übersetzungslayer lokal wieder ein.

**B) Anbieter mit vertraulicher Verarbeitung (Confidential Computing)**
- Einige Anbieter verarbeiten Anfragen in abgeschotteten, geprüften Hardware-Umgebungen (Trusted Execution Environments), in die auch der Betreiber nicht hineinsehen kann. Apples Private Cloud Compute ist das bekannteste Beispiel.
- In der App: Anbieter können als „vertrauliche Verarbeitung“ markiert werden, wenn sie eine überprüfbare Bestätigung (Attestation) liefern. Wo die App diese Bestätigung technisch prüfen kann, tut sie das vor dem Senden.
- Zusätzlich anzeigen, ob beim Anbieter „Zero Data Retention“ (keine Speicherung, kein Training) vereinbart ist.
- Vor der Umsetzung aktuellen Stand recherchieren: welche Anbieter so etwas zu diesem Zeitpunkt per API anbieten.

**Kombination:** A und B lassen sich kombinieren. Am stärksten ist: Pseudonymisierung + vertraulicher Anbieter + Zero Data Retention. Noch sicherer bleibt der eigene Heimserver (5.3), bei dem die Schutzschicht optional ebenfalls aktivierbar ist.

**Architektur:** Die Schutzschicht sitzt im `AIRouter` als eigener Schritt (`PrivacyGuard`) zwischen Aufgabe und Provider und gilt automatisch für alle Provider der Klassen „Eigener Server“ und „Cloud“. Umfangreiche Tests: Round-Trip (ersetzen → zurückübersetzen ergibt Original), keine echten Werte im ausgehenden Request, Umgang mit veränderten Platzhaltern.

### 5.7 Was schafft welches Modell? (Arbeitsteilung Code ↔ KI)

Ziel: **Alle Kernfunktionen müssen mit dem ~3B-Modell (Apple oder eigenes) gut funktionieren.** Größere Modelle oder der Heimserver machen einzelne Features besser, sind aber nie Voraussetzung.

**Grundprinzip „Code rechnet, KI versteht“**
- Die KI erkennt, ordnet ein und füllt feste Felder aus (Klassifikation, Extraktion, kurze Zusammenfassungen, kurze Formulierungen). Darin sind kleine Modelle stark.
- Der Code übernimmt alles, wobei kleine Modelle Fehler machen: Datumsrechnung, Beträge gegenprüfen, freie Kalender-Zeiten, Regeln ausführen, Statistik, schema.org-Daten auslesen, Regex für Sendungsnummern und IBANs.
- Strukturierte Ausgaben immer über ein festes Schema (`@Generable` bzw. JSON-Schema), nie freier Text, der danach geparst werden muss.
- **Kurze Eingaben:** Mails vorher bereinigen (Zitate, Signaturen, HTML-Ballast, Newsletter-Footer entfernen). Das ist wichtig, weil das Kontextfenster klein ist: Apples On-Device-Modell hat nach Stand iPadOS 26 nur **4.096 Tokens für Ein- und Ausgabe zusammen** (vor Umsetzung prüfen).
- **Große Mengen** (Digest, Newsletter-Zeitung, Steckbrief) werden in Häppchen verarbeitet (Map-Reduce), bevorzugt nachts am Ladekabel.
- Jedes KI-Ergebnis trägt eine Konfidenz. Unsichere Ergebnisse erscheinen als „Vorschlag“ und brauchen eine Bestätigung.

**Einschätzung pro Feature**

| Feature | ~3B (Apple / eigenes) | Empfehlung |
|---|---|---|
| Kategorisierung, Priorisierung, Türsteher-Einschätzung | ✅ gut | 3B reicht |
| Fristen, Zusagen, Abos, Belege, Pakete, Reisen extrahieren | ✅ gut, Code prüft Daten und Beträge | 3B reicht |
| Regeln in normaler Sprache | ✅ gut dank festem Schema und Vorschau | 3B reicht |
| Terminfinder | ✅ Kalender-Logik macht der Code | 3B reicht |
| Ton-Check, Phishing-Check (mit Regeln) | ✅ gut | 3B reicht |
| Thread-Zusammenfassung | ✅ kurz gut; lange Threads per Map-Reduce | 3B reicht |
| Tages-Digest, Newsletter-Zeitung, Absender-Steckbrief | 🟡 machbar im Hintergrund, Qualität ordentlich | 7B / Heimserver spürbar besser |
| Antwortentwürfe im eigenen Stil | 🟡 kurze Antworten gut, lange oder heikle Mails mittelmäßig | 7B+ / Heimserver |
| „Frag dein Postfach“ | 🟡 einfache Fragen gut (Suche leistet die Hauptarbeit), Fragen über viele Mails schwierig | 7B+ / Heimserver für komplexe Fragen |
| Autovervollständigung | 🟡 hängt an der Geschwindigkeit; auf M-Chips realistisch | 3B, notfalls abschalten |
| Anhang-Relevanzprüfung, Passwort in der Mail finden | ✅ gut, kurze Eingaben, Vorfilter per Code | 3B reicht |
| Lange Anhänge zusammenfassen / „Frag den Anhang“ | 🟡 machbar in Abschnitten, bei 50+ Seiten langsam | 7B / Heimserver besser |
| Übersetzung | – | Apples Translation-Framework statt LLM |

**Qualität messen statt raten**
- Claude Code legt in Phase 5 ein Test-Set an: ca. 50–100 realistische, **erfundene** deutsche Beispiel-Mails (Rechnungen, Abo-Bestätigungen, Terminanfragen, Zusagen, Newsletter, Phishing) mit den erwarteten Ergebnissen als JSON.
- Ein Test-Runner misst pro Modell Trefferquote und Geschwindigkeit. Zielwerte für 3B: Extraktion von Datum/Betrag ≥ 95 % (nach Code-Prüfung), Kategorisierung ≥ 90 %.
- Derselbe Runner steckt hinter dem Benchmark-Knopf in der App (5.0), dort mit den eigenen Mails des Nutzers, rein lokal.

---

## 6. Personalisierung („Die KI lernt dazu“)

Echtes Fine-Tuning ist auf dem iPad teuer. Daher ein dreistufiger Ansatz, der ohne Training des LLMs auskommt – Fine-Tuning nur als optionales Experiment.

### 6.1 Gedächtnis (RAG)
- Jede Mail wird bereinigt, in Abschnitte zerlegt und eingebettet (Embeddings über `NLContextualEmbedding` aus dem NaturalLanguage-Framework oder ein kleines lokales Embedding-Modell).
- Speicherung in SQLite mit Vektor-Index.
- Bei jeder KI-Aufgabe werden relevante frühere Mails als Kontext mitgegeben (z. B. bisheriger Austausch mit diesem Absender).
- Ermöglicht **„Frag dein Postfach“**: „Wann hat der Vermieter die Nebenkosten geschickt?“ → Antwort mit Links auf die Quell-Mails.

### 6.2 Verhaltensmodell
Lokales Event-Log (nie in die Cloud):
- geöffnet / ungelesen gelöscht / archiviert
- Zeit bis Antwort, Zeit bis Öffnen
- manuelle Umsortierungen und Korrekturen an KI-Kategorien
- Snooze, Flaggen

Daraus wird ein kleines Priorisierungsmodell trainiert (Features: Absender, Domain, Kategorie, bisherige Interaktionsrate, Uhrzeit, Thread-Beteiligung). Umsetzung: einfache logistische Regression in Swift oder ein updatebares Core-ML-Modell. Nachtraining regelmäßig im Hintergrund. **Korrekturen des Nutzers haben das höchste Gewicht.**

### 6.3 Stilprofil
- Aus gesendeten Mails werden automatisch typische Anreden, Grußformeln, Länge und Tonfall pro Empfängergruppe (formell / locker) erkannt.
- Die besten Beispiele werden als Few-Shot-Beispiele in Antwort-Prompts eingefügt.
- Nutzer kann das Profil einsehen und bearbeiten („Ich duze Kollegen, sieze Kunden“).

### 6.4 Optional: LoRA-Fine-Tuning (experimentell, Phase 13)
- Nur mit MLX Swift, nur am Ladekabel, nur mit ausdrücklicher Zustimmung.
- Trainingsdaten: Paare aus erhaltener Mail → eigener Antwort.
- Adapter separat speichern, jederzeit zurücksetzbar.

### 6.5 Transparenz
- Einstellungsseite „Was die KI über mich weiß“: gelernte Regeln, wichtige Absender, Stilprofil.
- Alles einzeln lösch- und zurücksetzbar.
- Export des Profils als JSON.

---

## 7. Features

### 7.1 Alleinstellungsmerkmale: KI-Features, die kaum eine andere Mail-App bietet

Diese Features machen die App besonders und haben Vorrang vor reinen Komfort-Funktionen. Alle laufen standardmäßig auf dem Gerät (5.0). Durchgängiges Muster: **KI erkennt → Code prüft und rechnet → Nutzer bestätigt** (siehe 5.7). Jedes erkannte Element verlinkt auf die Quell-Mail, und jede Korrektur des Nutzers fließt ins Lernen ein (6.2).

**★ Versprechen-Tracker**
- Analysiert die *gesendeten* Mails auf Zusagen: „Ich schicke dir das bis Freitag“, „Melde mich nächste Woche“, „Kümmere mich drum“.
- KI extrahiert Zusage, Empfänger und Frist-Ausdruck. Code löst relative Fristen („bis Freitag“, „Ende des Monats“) anhand des Sendedatums in ein echtes Datum auf. Ohne Frist: Standard-Erinnerung nach 3 Tagen (einstellbar).
- Erinnerung einen Tag vor Fälligkeit. Wird im selben Thread eine passende Folge-Mail gesendet, schlägt die App „erledigt“ vor.
- Gegenstück **„Andere schulden mir“**: Zusagen anderer in eingehenden Mails („Sie erhalten das Angebot bis Montag“). Kommt nichts, erscheint ein Nachhak-Vorschlag inkl. KI-Entwurf (verknüpft mit dem Follow-up-Wächter).
- Zwei Übersichten: „Meine Zusagen“ und „Ich warte auf“.

**★ Verträge & Abos**
- Erkennt Bestätigungen für Abos, Verträge, Mitgliedschaften, Versicherungen und Probe-Abos (Streaming, Mobilfunk, Strom, Fitness, Software …).
- Extrahiert: Anbieter, Betrag, Intervall, Beginn, Mindestlaufzeit, Kündigungsfrist, nächste Verlängerung, Ende der Probezeit, Link zur Kündigung.
- Code berechnet den letzten Kündigungstag. Erinnerung rechtzeitig vorher („Probe-Abo endet in 3 Tagen – kündigen?“).
- Übersicht mit monatlichen und jährlichen Gesamtkosten.
- Alle Werte manuell korrigierbar. Hinweis in der App: Angaben stammen aus den Mails, keine Rechtsberatung.

**★ Belegordner (Steuer & Haushalt)**
- Sammelt Rechnungen, Quittungen und Bestellbestätigungen aus Mail-Text und PDF-/Bild-Anhängen (siehe 7.8).
- Extrahiert: Händler, Datum, Brutto, Netto/MwSt. (falls vorhanden), Rechnungsnummer, Zahlungsfrist.
- Beträge und Daten prüft der Code im Originaltext gegen (Regex, `NSDataDetector`). Bei Abweichung wird der Beleg als „bitte prüfen“ markiert.
- Kategorien (z. B. Arbeitsmittel, Handwerker, Spenden, Versicherungen, Haushalt) sind frei anpassbar. Die KI schlägt vor und lernt aus Korrekturen.
- Export pro Jahr oder Zeitraum: ZIP mit allen Beleg-PDFs + CSV-Übersicht (optional XLSX). Zahlungsfristen werden zu Erinnerungen.

**★ Regeln in normaler Sprache**
- Eingabe z. B.: „Alle Rechnungen von der Telekom nach Finanzen verschieben und 3 Tage vor Fälligkeit erinnern.“
- Die KI übersetzt das in eine strukturierte Regel (Bedingungen + Aktionen, festes Schema per `@Generable` bzw. JSON-Schema).
- Der Nutzer sieht die Regel als lesbare Karte („Wenn Absender-Domain = telekom.de UND Kategorie = Rechnung → …“), kann sie bearbeiten, an vorhandenen Mails testen („würde 14 Mails treffen“) und speichert sie erst dann.
- Ausgeführt wird die Regel danach **ohne KI**: deterministisch, schnell, nachvollziehbar. KI-Bedingungen wie „Kategorie = Rechnung“ nutzen das vorhandene Klassifikationsergebnis.

**Terminfinder**
- Erkennt Terminanfragen („Wann passt es dir nächste Woche?“).
- Code ermittelt freie Zeitfenster aus EventKit (Arbeitszeiten, Puffer und Dauer einstellbar, Zeitzonen beachten). Die KI formuliert die Antwort mit 2–3 Vorschlägen.
- Sagt die Gegenseite zu, wird der Termin mit einem Tipp in den Kalender übernommen.

**Absender-Steckbrief**
- Seitenleiste pro Kontakt: letzte Gespräche, offene Punkte, gegenseitige Zusagen (aus dem Versprechen-Tracker), wiederkehrende Themen, Antwortverhalten („antwortet meist am selben Tag“).
- Schnellfragen: „Was habe ich ihm zugesagt?“, „Worüber haben wir zuletzt gesprochen?“
- Die Zusammenfassung wird im Hintergrund inkrementell aktualisiert (nur neue Mails verarbeiten).

**Digest zum Anhören**
- Der Tages-Digest als gesprochenes Morgen-Briefing über `AVSpeechSynthesizer` (on-device, hochwertige deutsche Stimmen).
- Steuerung: Pause, Weiter, Überspringen, „Diese Mail öffnen“. Läuft im Hintergrund mit Steuerung auf dem Sperrbildschirm.
- Per Siri/Kurzbefehl startbar („Lies mir meine Mails vor“).

**Reise-Zeitleiste**
- Flug-, Bahn-, Hotel-, Mietwagen- und Veranstaltungsbuchungen werden erkannt und zu Reisen gruppiert (zeitliche Nähe, Zielort).
- Pro Reise eine Zeitleiste: Buchungsnummern, Check-in-Zeiten, Adressen (Karte via MapKit), zugehörige Anhänge. Kalendereinträge auf Wunsch.
- Viele Anbieter betten strukturierte schema.org-Daten (JSON-LD, z. B. `FlightReservation`, `LodgingReservation`, `TrainReservation`, `EventReservation`) ins HTML ein. **Diese zuerst auslesen**, die KI nur als Fallback.

**Paket-Übersicht**
- Sendungsnummern (DHL, Hermes, DPD, GLS, UPS, Amazon u. a.) aus Versandmails erkennen: zuerst schema.org `ParcelDelivery`, dann Regex pro Paketdienst, KI als Fallback.
- Liste aller offenen Sendungen mit Link zur Sendungsverfolgung des Paketdienstes.
- Live-Status direkt in der App nur als Opt-in, weil dafür die Sendungsnummer an den Paketdienst geht.
- Nach Zustellbestätigung automatisch als erledigt markiert.

**Newsletter-Zeitung**
- Einmal pro Woche (Tag/Uhrzeit wählbar) werden alle Newsletter zu einem Magazin im Lesemodus: pro Newsletter die Kernaussagen in 2–3 Sätzen, Link zum Original, nach Themen gruppiert.
- Berechnung nachts am Ladekabel (`BGProcessingTask`).
- Danach alle enthaltenen Newsletter mit einem Tipp archivieren.

**Autovervollständigung beim Tippen**
- Das lokale Modell schlägt die Satzfortsetzung als grauen Text vor. Tab bzw. → übernimmt, Weitertippen verwirft.
- Nur nach kurzer Tipppause (~300 ms), maximal ca. 10–15 Wörter. Laufende Anfragen werden bei jedem Tastendruck abgebrochen.
- Kontext: aktueller Entwurf, zitierte Mail, Stilprofil (6.3).
- Abschaltbar. Auf zu langsamen Geräten automatisch aus.

**Anhänge verstehen** (Details in 7.8)
- Eigener Reader für die gängigen Formate, inkl. Entsperren passwortgeschützter Dateien, mit „Passwort in der Mail finden“.
- Die KI prüft zuerst, ob ein Anhang für den Zusammenhang wichtig ist, und liest nur relevante Anhänge vollständig.
- Grundlage für Belegordner, Verträge & Abos, Reise-Zeitleiste und „Frag dein Postfach“.

**Postfach-Statistik & Mail-Diät**
- Wer schreibt am meisten, was wird nie gelesen, welche Newsletter werden ungeöffnet gelöscht, eigene Antwortzeiten, Mail-Aufkommen pro Tag/Woche.
- Konkrete Vorschläge: „Diese 8 Newsletter öffnest du nie – alle abbestellen?“
- Reine Statistik aus dem lokalen Verhaltens-Log, keine KI nötig.

### 7.2 Von anderen Apps inspiriert

**★ Türsteher für neue Absender** (Idee wie Spark „Gatekeeper“ / HEY „Screener“)
- Wer zum ersten Mal schreibt, landet in „Neue Absender“ statt im Posteingang. Ein Tipp: zulassen, blockieren, als Newsletter einsortieren oder in „Papierkram“.
- KI-Einschätzung dazu: „wahrscheinlich Newsletter“, „wahrscheinlich Spam“, „Antwort auf deine Anfrage“.
- Automatisch zugelassen: Kontakte aus dem Adressbuch und Absender, denen man selbst schon geschrieben hat.
- Pro Konto ein-/ausschaltbar. Entscheidungen werden im `SenderProfile` gespeichert.

**Geteilter Posteingang** (Idee wie Superhuman „Split Inbox“)
- Frei definierbare Tabs (z. B. „Wichtig“, „Kunden“, „Familie“, „Rest“), gefüllt über Regeln (7.1) oder KI-Kategorien.
- Zähler pro Tab, Reihenfolge per Drag & Drop.

**Gebündelte Benachrichtigungen**
- Sofort nur bei Wichtigem: hohe Priorität, VIP-Absender, Antworten in eigenen Threads.
- Der Rest kommt gesammelt zu festen Zeiten (z. B. 9, 13, 17 Uhr) als eine Benachrichtigung mit KI-Kurzfassung.
- Hinweis: Ohne Push-Server hängt die Zuverlässigkeit vom Hintergrund-Refresh ab (4.3).

**Tracker-Report**
- Pro Mail sichtbar, welche Tracking-Pixel und Tracking-Links blockiert wurden und von welchem Dienst.
- Statistik: welche Absender tracken.
- Tracking-Parameter (z. B. `utm_*`) werden beim Öffnen von Links entfernt.

**Eigene Betreffzeilen, Threads zusammenführen, private Notizen**
- Betreff lokal umbenennen (Original bleibt abrufbar).
- Threads zusammenführen oder trennen.
- Private Notizen an Mails/Threads, durchsuchbar.
- Alles nur lokal gespeichert (optional per Sync, 11.4), nie auf dem Mailserver.

### 7.3 Produktivität
- Snooze („heute Abend“, „morgen früh“, „wenn ich zu Hause bin“)
- Später senden (auf Wunsch zur Morgenzeit in der Zeitzone des Empfängers)
- Follow-up-Wächter: „Keine Antwort seit 3 Tagen – nachhaken?“ inkl. KI-Entwurf
- Newsletter-Zentrale: alle Newsletter gesammelt, Ein-Tipp-Abmelden (`List-Unsubscribe`-Header, RFC 8058 One-Click)
- Anhang-Hub: alle Anhänge kontoübergreifend, filterbar nach Typ
- Vorlagen / Textbausteine
- Smarte Ordner (gespeicherte Suchen)

### 7.4 iPad & Mac
- Apple Pencil: handschriftliche Antwort (Scribble), PDF-Anhänge annotieren und zurücksenden (PencilKit / PDFKit)
- Stage Manager & mehrere Fenster (Composer im eigenen Fenster)
- Umfangreiche Tastaturkürzel (`⌘N`, `⌘R`, `E` archivieren, `J/K` navigieren, `⌘K` Befehlspalette)
- Drag & Drop von Anhängen in andere Apps
- **★ Mac-App:** Das macOS-Target wird von Phase 1 an mitgebaut und muss immer kompilieren (native SwiftUI für macOS, nicht nur „Designed for iPad“). Mac-typisch: Menüleiste, mehrere Fenster, Einstellungen-Fenster. Auf Macs mit viel RAM sind auch größere lokale Modelle (13B+) realistisch.
- **Handoff** (`NSUserActivity`): geöffnete Mail oder Entwurf nahtlos zwischen iPad und Mac weiterführen.

### 7.5 Apple-Frameworks & Systemintegration
- App Intents: „Fasse meine ungelesenen Mails zusammen“, „Zeig Mails von X“, „Lies mir meine Mails vor“
- Widgets (interaktiv): Tages-Digest, Anzahl wichtiger Mails, nächste Fristen, offene Zusagen; Aktionen wie Archivieren direkt im Widget
- Steuerelemente für Kontrollzentrum und Sperrbildschirm (Controls über WidgetKit): „Neue Mail“, „Digest vorlesen“
- Fokus-Filter: im Arbeitsfokus nur Arbeitskonten
- Kalender- und Erinnerungen-Integration über EventKit
- Teilen-Erweiterung: Inhalte aus anderen Apps direkt als Mail
- **Übersetzung** über Apples Translation-Framework, komplett offline (Sprachpakete lokal)
- **Diktat** über SpeechAnalyzer, on-device
- **Dokumentenscanner** (VisionKit): Papier abfotografieren, als sauberes PDF anhängen
- **Spotlight** (Core Spotlight): Mails in der Systemsuche finden, Index bleibt lokal
- **Wallet** (PassKit): `.pkpass`-Anhänge (Tickets, Bordkarten) mit einem Tipp hinzufügen
- **Passkeys** (AuthenticationServices) für den Login am Heimserver
- Vor Umsetzung jeweils prüfen, welche neuen Frameworks die aktuelle iPadOS-Version mitbringt.

### 7.6 Sicherheit & Datenschutz
- Tracking-Pixel-Blocker, externe Bilder nur auf Wunsch (+ Tracker-Report, 7.2)
- Phishing-Warnung (siehe 5.5)
- App-Sperre mit Face ID / Touch ID
- Datenschutz-Dashboard: welche Daten wohin gingen (lokal / eigener Server / Cloud)
- **Echte Mail-Verschlüsselung:** OpenPGP und S/MIME – signieren, verschlüsseln, Signaturen prüfen, Schlüsselverwaltung. Private Schlüssel in der Keychain. Geeignete Bibliotheken inkl. Lizenz vor Umsetzung prüfen.
- **Link-Prüfer:** Zeigt die echte Zieldomain, wenn Linktext und Ziel abweichen. Warnung bei Doppelgänger-Domains (z. B. Punycode, `paypa1.com`). Kurzlinks werden nur auf Wunsch aufgelöst (dafür ist eine Anfrage an den Kurzlink-Dienst nötig).
- **Wegwerf-Adressen:** Aliase für Anmeldungen, ohne Fremddienst über die eigene Domain (Catch-all) oder Plus-Adressen (`name+shop@…`, wo vom Anbieter unterstützt). Optional per Opt-in Anbindung von Alias-Diensten wie addy.io oder SimpleLogin. Apples „E-Mail-Adresse verbergen“ bietet nach aktuellem Stand keine Schnittstelle für Dritt-Apps – vor Umsetzung erneut prüfen. Die App merkt sich, welcher Alias bei welchem Dienst genutzt wurde, und zeigt so, wer Adressen weitergibt.

### 7.7 Komfort
- Übersetzung eingehender und ausgehender Mails (7.5)
- Ton-Check vor dem Senden („klingt das zu harsch?“)
- Diktat → KI formuliert daraus eine saubere Mail
- Dark Mode, anpassbare Dichte der Mail-Liste

### 7.8 Anhang-Reader & KI-Anhangsanalyse

Anhänge werden direkt in der App geöffnet, ohne in andere Apps wechseln zu müssen. Die KI kann Anhänge lesen, **entscheidet aber zuerst, ob ein Anhang für den Zusammenhang überhaupt wichtig ist**. So spart die App Akku und Rechenzeit, und das kleine Kontextfenster der lokalen Modelle (5.7) wird nicht mit AGB, Logos und Datenschutzhinweisen verstopft.

#### 7.8.1 Unterstützte Formate

| Format | Anzeige in der App | Text für KI & Suche | Passwortschutz |
|---|---|---|---|
| **PDF** | Eigener Reader (PDFKit): Miniaturen, Suche, Markieren, Apple Pencil, Unterschreiben | PDF-Text; gescannte Seiten per Vision-Texterkennung | ✅ `PDFDocument.unlock(withPassword:)` |
| **Bilder** (JPEG, PNG, HEIC, GIF, TIFF, WebP) | Eigener Bildbetrachter mit Zoom, Galerie bei mehreren Bildern | Vision-Texterkennung (Fotos von Dokumenten, Screenshots) | – |
| **Word, Excel, PowerPoint** (DOCX, XLSX, PPTX) | Quick Look | Eigener Extraktor (ZIP + XML): Fließtext, Tabellen, Folientexte | 🟡 spätere Phase (Office-Verschlüsselung, MS-OFFCRYPTO) |
| **Alte Office-Formate** (DOC, XLS, PPT) | Quick Look | eingeschränkt bzw. nicht | – |
| **Pages, Numbers, Keynote** | Quick Look | nur eingebettete Vorschau, falls vorhanden | – |
| **Text** (TXT, CSV, Markdown, JSON, XML, Code) | Eigener Textbetrachter; CSV als sortierbare Tabelle | direkt | – |
| **RTF** | `NSAttributedString` | direkt | – |
| **HTML** | `WKWebView` ohne JavaScript, externe Inhalte blockiert | Text aus HTML | – |
| **ZIP** | Inhaltsliste, Dateien einzeln öffnen | je nach enthaltenem Typ | 🟡 ZipCrypto/AES über eine geeignete Bibliothek (z. B. minizip-ng) |
| **EML** (weitergeleitete Mail als Anhang) | Eigener Mail-Viewer (gleicher MIME-Parser) | direkt | – |
| **MSG** (Outlook-Mail) | spätere Phase | spätere Phase | – |
| **ICS** (Einladung) | Termin-Karte: „Zum Kalender“, Zusagen/Absagen | direkt | – |
| **VCF** (Kontakt) | Kontakt-Karte: „Zu Kontakten hinzufügen“ | direkt | – |
| **PKPASS** | Wallet (7.5) | – | – |
| **Audio** (M4A, MP3, WAV) | Player | Transkription on-device (SpeechAnalyzer) – z. B. Sprachnachrichten | – |
| **Video** (MP4, MOV) | AVKit-Player | optional Transkription der Tonspur | – |

Unbekannte Formate: Dateiinfo anzeigen, „In anderer App öffnen“ bzw. „In Dateien sichern“.

**Reader-Funktionen**
- Auf dem iPad Mail und Anhang nebeneinander (geteilte Ansicht), Anhang auch im eigenen Fenster (Stage Manager).
- Vorschau-Chips mit Miniatur direkt in der Mail-Liste und im Thread.
- **„Frag den Anhang“:** Chat mit einem einzelnen Dokument („Was ist die Kündigungsfrist in diesem Vertrag?“), Antworten mit Seitenangabe.
- Zusammenfassung auf Knopfdruck, in Dateien sichern, teilen, drucken.
- PDF annotieren, unterschreiben und direkt als Antwort-Anhang zurückschicken (7.4).

#### 7.8.2 Passwortgeschützte Anhänge

1. **Erkennen:** Verschlüsselung wird beim Sync festgestellt (PDF gesperrt, ZIP mit Verschlüsselungs-Flag, Office-Datei mit Verschlüsselungs-Container). Der Anhang bekommt das Symbol „gesperrt“.
2. **Passwort-Vorschläge (alles lokal):**
   - für diesen Absender gemerktes Passwort (Keychain),
   - **Passwort in der Mail finden:** Häufig steht es im Mailtext oder kommt in einer separaten Mail („Das Passwort erhalten Sie in einer gesonderten Nachricht“). Regex für typische Muster („Passwort:“, „Kennwort“, „PIN“, „password“) im Thread und in Mails desselben Absenders ±3 Tage, KI prüft die Kandidaten,
   - vom Nutzer hinterlegte „häufige Passwörter“ (z. B. Kundennummer oder Geburtsdatum-Format, das Banken und Versicherungen oft nutzen), in der Keychain gespeichert.
   Kandidaten werden automatisch lokal ausprobiert (begrenzte Anzahl), der Nutzer sieht, welches gepasst hat.
3. **Manuelle Eingabe** mit Option „Für diesen Absender merken“.
4. **Nach dem Entsperren:** Der Nutzer entscheidet einmalig (merkbar pro Absender), ob der entschlüsselte Inhalt in Suche und KI-Analyse einfließen darf. Standard: nur On-Device. Entschlüsselte Inhalte gehen **nie** an Server oder Cloud, außer der Nutzer gibt genau diese Datei ausdrücklich frei.
5. Entschlüsselte Kopien werden nicht dauerhaft gespeichert; bei Bedarf wird mit dem Keychain-Passwort neu entschlüsselt. Extrahierter Text liegt in der Datenbank mit Dateischutz `complete`.

Passwörter werden nie geloggt, nie an die KI-Cloud geschickt und nie in Klartext in der Datenbank abgelegt.

#### 7.8.3 KI-Relevanzprüfung: Erst entscheiden, dann lesen

Anhänge werden in drei Stufen verarbeitet. Nur was die Stufen 0 und 1 übersteht, wird vollständig gelesen.

**Stufe 0 – Vorfilter (Code, ohne KI, sofort beim Sync)**
- Inline-Bilder aus Signaturen und Layouts aussortieren: per `Content-ID` im HTML referenziert, klein (z. B. < 20 KB), typische Namen (`image001.png`, `logo`, `banner`, Social-Media-Icons).
- **Standard-Anhänge** erkennen: Dateien, die derselbe Absender immer wieder schickt (gleicher SHA-256-Hash oder gleicher Name wie `AGB.pdf`, `Datenschutzhinweise.pdf`, `Widerrufsbelehrung.pdf`). Diese einmal analysieren, danach wiederverwenden.
- Duplikate über den Hash erkennen: Wurde dieselbe Datei schon analysiert, wird das Ergebnis übernommen.
- ICS, VCF und PKPASS werden direkt strukturiert verarbeitet, ohne KI.

**Stufe 1 – Relevanz-Check (KI, günstig)**
- Eingabe: Betreff, bereinigter Mailtext (gekürzt), Liste der Anhänge (Name, Typ, Größe, Seitenzahl) und je Anhang nur ein **kurzer Ausschnitt** (z. B. die ersten ~500 Zeichen bzw. die erste Seite).
- Ausgabe (festes Schema) pro Anhang:
  - `relevance`: `zentral` (der Anhang ist der eigentliche Inhalt, z. B. „Anbei die Rechnung“), `unterstützend` (hilfreich, aber nicht nötig) oder `unwichtig` (AGB, Werbung, Standardtexte),
  - `documentType`: Rechnung, Vertrag, Angebot, Kündigung, Buchung, Ticket, Kontoauszug, Lebenslauf, Präsentation, Foto, Sonstiges,
  - `action`: `vollständig lesen`, `nur Metadaten`, `ignorieren`,
  - `reason`: ein kurzer Satz, warum.
- Bei gesperrten Anhängen entscheidet die KI nur anhand von Mailtext und Metadaten und schlägt ggf. das Entsperren vor.

**Stufe 2 – Tiefenanalyse (nur für relevante Anhänge)**
- Vollständige Textextraktion, bei langen Dokumenten in Abschnitten (Map-Reduce, 5.7).
- Typabhängige Extraktion in feste Felder: Rechnung → Belegordner, Vertrag → Verträge & Abos, Buchung/Ticket → Reise-Zeitleiste, Einladung → Kalender.
- Kurzzusammenfassung, Aufnahme in Suche und Embeddings (RAG, 6.1).
- Zeitpunkt: `zentral` bei wichtigen Mails sofort, sonst im Hintergrund bzw. am Ladekabel. `unterstützend` nur am Ladekabel oder auf Anfrage.

**Nutzer behält die Kontrolle**
- Jeder Anhang zeigt ein kleines Status-Symbol: „von KI gelesen“, „als unwichtig übersprungen“ (Tippen zeigt die Begründung), „gesperrt“, „wird analysiert“.
- „Trotzdem lesen“ startet die Tiefenanalyse sofort. „Anhänge dieser Art von diesem Absender immer ignorieren“ bzw. „immer lesen“ wird als Regel gespeichert.
- Jede Korrektur fließt ins Verhaltensmodell (6.2) ein, damit die Relevanzprüfung mit der Zeit besser wird.
- Fragt der Nutzer konkret nach einem Anhang („Frag den Anhang“, „Frag dein Postfach“), wird er unabhängig von der Relevanzprüfung gelesen.
- Cloud- bzw. Heimserver-Freigabe für Anhänge ist eine eigene Aufgabe in den Datenschutz-Einstellungen (5.0), getrennt von der Freigabe für Mailtexte.

#### 7.8.4 Sicherheit bei Anhängen
- Dokumente werden nur angezeigt, nie ausgeführt: keine Makros, kein JavaScript in PDFs oder HTML-Anhängen. Links in Dokumenten laufen über den Link-Prüfer (7.6).
- Schutz vor „ZIP-Bomben“: Grenzen für entpackte Gesamtgröße (z. B. 500 MB), Anzahl Dateien und Verschachtelungstiefe (max. 2).
- **Warnungen**, die auch in den Phishing-Check (5.5) einfließen:
  - ausführbare oder Skript-Dateien (`.exe`, `.scr`, `.js`, `.vbs`, `.bat`, `.cmd`, `.msi`, `.apk`, `.lnk`, `.iso`, `.img`),
  - Office-Dateien mit Makros (`.docm`, `.xlsm`, `.pptm`),
  - doppelte Endungen (`Rechnung.pdf.exe`),
  - passwortgeschützte Archive von unbekannten Absendern (klassisches Muster, um Virenscanner zu umgehen),
  - HTML-Anhänge mit Login-Formularen.
- Solche Anhänge werden nicht automatisch entsperrt und nicht automatisch analysiert.

---

## 8. Datenmodell (Kern)

```
Account(id, email, displayName, provider, imapHost, smtpHost, authType, color, aiCloudAllowed)
Mailbox(id, accountId, name, role[inbox|sent|drafts|trash|archive|spam|custom], uidValidity, highestModSeq)
Message(id, accountId, mailboxId, uid, messageId, threadId, from, to, cc, subject, date,
        snippet, bodyText, bodyHTML, flags, hasAttachments, category, priorityScore, snoozedUntil)
Attachment(id, messageId, filename, mimeType, size, localPath, sha256, isInline, contentId, pageCount,
           isEncrypted, relevance[central|supporting|irrelevant], relevanceReason, documentType,
           analysisStatus[pending|skipped|analyzed|locked|failed], riskFlags)
AttachmentAnalysis(attachmentId, summary, extractedJSON, modelId, privacyClass, analyzedAt)
# Passwörter nie in der DB, nur in der Keychain (pro Absender bzw. „häufige Passwörter“)
Thread(id, subject, participants, lastDate, summary, summaryUpdatedAt)
Embedding(messageId, chunkIndex, vector)
BehaviorEvent(id, messageId, type, timestamp, metadata)
SenderProfile(address, domain, interactionRate, avgReplyTime, userPriority)
StyleProfile(recipientGroup, greeting, closing, formality, examples)
Reminder(id, messageId, dueDate, text, eventKitId)
AIModel(id, name, providerType, filePath, sizeBytes, quantization, paramCount)

# Erweiterungen für Abschnitt 7
SenderProfile += screenerStatus[pending|allowed|blocked|newsletter|paperwork], briefSummary, briefUpdatedAt
Thread        += customSubject, mergedIntoThreadId
Message       += trackersBlocked
AttachmentText(attachmentId, text, source[pdf|ocr], confidence)
Commitment(id, messageId, direction[mine|theirs], counterpart, text, dueDate, status[open|done|dismissed], reminderId)
Subscription(id, provider, amount, currency, interval, startDate, minTermEnd, noticePeriod,
             nextRenewal, trialEnd, cancelURL, sourceMessageIds)
Receipt(id, messageId, attachmentId, vendor, date, gross, net, vat, currency, invoiceNumber,
        dueDate, category, verified)
MailRule(id, naturalLanguage, conditionsJSON, actionsJSON, enabled, createdAt, lastMatchedAt)
Trip(id, title, destination, startDate, endDate)
TripItem(id, tripId, messageId, type[flight|train|hotel|car|event], start, end, confirmationCode, address, dataJSON)
Parcel(id, messageId, carrier, trackingNumber, status, expectedDate, completedAt)
ThreadNote(id, threadId, text, createdAt)
Alias(id, address, service, createdAt)
```

Migrationen mit GRDB `DatabaseMigrator`. Mail-Bodies ab einer Größe als Dateien, nicht in der DB.

---

## 9. Roadmap

★ = Alleinstellungsmerkmal bzw. Lieblings-Feature, hat innerhalb seiner Phase Vorrang.

### Phase 1 – Fundament
- Xcode-Projekt, Package-Struktur, SwiftUI-Drei-Spalten-Layout mit Mock-Daten
- ★ macOS-Target von Anfang an anlegen und mitkompilieren
- GRDB-Schema + Migrationen
- Keychain-Wrapper
- **Abnahme:** App startet auf iPad und Mac, zeigt Mock-Posteingang, Navigation funktioniert

### Phase 2 – Ein Konto lesen
- IMAP-Client, Login mit iCloud (app-spezifisches Passwort)
- Ordner laden, Mails laden, MIME parsen, HTML sicher anzeigen
- **Abnahme:** echte iCloud-Mails werden angezeigt

### Phase 3 – Mehrere Konten & Senden
- Auto-Discovery, OAuth für Gmail und Outlook
- SMTP senden, Composer, Entwürfe
- Gemeinsamer Posteingang, Aktionen (archivieren, löschen, flaggen) mit Offline-Queue
- **Abnahme:** iCloud + Gmail parallel nutzbar, Senden funktioniert

### Phase 4 – Suche & Sync
- FTS5-Suche, Delta-Sync, IDLE, Hintergrund-Refresh
- Anhang-Reader Grundversion (7.8.1): PDF inkl. Passwort-Entsperren, Bilder, Text/CSV, Quick Look für Office & iWork, ICS/VCF-Karten
- Textextraktion aus PDF, Bildern (Vision) und DOCX/XLSX/PPTX für die Suche
- Anhang-Sicherheitswarnungen (7.8.4)
- **Abnahme:** Suche < 200 ms bei 50.000 Mails; Text aus PDF-Anhängen ist auffindbar; passwortgeschützte PDFs lassen sich entsperren

### Phase 5 – KI-Basis
- `AIProvider`-Protokoll mit `privacyClass`, `AIRouter` mit Freigabe-Prüfung, Apple Foundation Models als Standard, ein Cloud-Provider (Anthropic) als Opt-in
- Thread-Zusammenfassung, Kategorisierung
- Test-Set mit Beispiel-Mails für die Qualitätsmessung anlegen (siehe 5.7)
- **Abnahme:** Zusammenfassung per Knopfdruck, Kategorien in der Liste

### Phase 6 – Eigene Modelle
- Modell-Manager, llama.cpp-Integration, GGUF-Import, Geräte-Check
- Heimserver-Anbindung (OpenAI-kompatibler Endpoint), weitere Cloud-Provider, Modellwahl pro Aufgabe, Herkunfts-Symbol an KI-Ergebnissen
- **Abnahme:** 3B-Modell lokal nutzbar, Wechsel zwischen Providern

### Phase 7 – Assistent
- Aktionen extrahieren, Erinnerungen via EventKit, Antwortentwürfe, Phishing-Check, Tages-Digest
- ★ Türsteher für neue Absender
- ★ Regeln in normaler Sprache
- ★ KI-Relevanzprüfung und Tiefenanalyse für Anhänge (7.8.3), „Frag den Anhang“, „Passwort in der Mail finden“
- **Abnahme:** Neue Absender landen im Türsteher; AGB/Logos werden übersprungen, die Rechnung in „Anbei die Rechnung“ wird als zentral erkannt und gelesen; eine in Worten beschriebene Regel wird korrekt als Karte angezeigt, getestet und ausgeführt

### Phase 8 – Alleinstellungsmerkmale I
- ★ Versprechen-Tracker (inkl. „Ich warte auf“)
- ★ Verträge & Abos
- ★ Belegordner mit Export
- Terminfinder
- **Abnahme:** Auf dem Test-Set werden Zusagen, Abos und Belege mit Datum/Betrag korrekt erkannt (Zielwerte in 5.7); Erinnerungen landen in der Erinnerungen-App

### Phase 9 – Personalisierung
- Embeddings + RAG, „Frag dein Postfach“
- Verhaltens-Log + Priorisierungsmodell
- Stilprofil, Transparenz-Seite
- Absender-Steckbrief
- Autovervollständigung beim Tippen

### Phase 10 – Alleinstellungsmerkmale II
- Reise-Zeitleiste, Paket-Übersicht (schema.org zuerst)
- Newsletter-Zeitung, Digest zum Anhören
- Postfach-Statistik & Mail-Diät

### Phase 11 – Komfort & Integration
- Snooze, später senden, Follow-up-Wächter, Newsletter-Zentrale, Anhang-Hub
- Geteilter Posteingang, gebündelte Benachrichtigungen, Tracker-Report, eigene Betreffzeilen / Threads zusammenführen / Notizen
- Apple Pencil, Tastaturkürzel, App Intents, Widgets, Controls, Fokus-Filter, Spotlight, Wallet, Dokumentenscanner, Translation, SpeechAnalyzer
- ★ Mac-Feinschliff (Menüleiste, Fenster) und Handoff
- Anhang-Reader Erweiterung: passwortgeschützte ZIPs, Audio-/Video-Transkription, EML-Viewer

### Phase 12 – Sicherheit
- OpenPGP und S/MIME
- Link-Prüfer
- Wegwerf-Adressen
- Passwortgeschützte Office-Dateien (MS-OFFCRYPTO), Outlook-MSG-Dateien

### Phase 13 – Optional
- Push-Server für Echtzeit-Benachrichtigungen (idealerweise auf dem Heimserver)
- LoRA-Fine-Tuning mit MLX

### Phase 14 – Web & Windows (später, optional)
- Siehe Abschnitt 11
- **Abnahme:** Mindestens eine weitere Plattform kann Konten verbinden, Mails lesen/senden und die KI-Grundfunktionen nutzen

### Phase 15 – Schutzschicht für externe KI (spät)
- Siehe Abschnitt 5.6: Pseudonymisierung mit lokalem Übersetzungslayer, Schutzstufen, Vorschau, Kennzeichnung vertraulicher Anbieter
- **Abnahme:** In automatisierten Tests enthält kein ausgehender Request echte Kontaktdaten, Bankdaten oder (bei „Streng“) Namen; zurückübersetzte Antworten stimmen mit den Originalwerten überein

---

## 10. Qualitätsregeln für Claude Code

- Swift 6, strikte Concurrency, keine Force-Unwraps außer in Tests.
- Jedes Modul mit Unit-Tests; Netzwerk und KI über Mocks testbar.
- Keine Secrets im Code oder in Logs. Mail-Inhalte nie loggen.
- Kein Senden, Löschen oder Cloud-Upload ohne ausdrückliche Nutzeraktion.
- UI-Texte auf Deutsch, lokalisierbar über String Catalogs (`.xcstrings`), Englisch als zweite Sprache.
- Barrierefreiheit: Dynamic Type, VoiceOver-Labels.
- Kleine, nachvollziehbare Commits pro Feature.
- Nach jeder Phase: kurze Notiz in `CHANGELOG.md`, was fertig ist und was offen bleibt.
- **Portabilität:** Die Module `MailCore`, `MailSync`, `MailStore` und `AIKit` importieren weder SwiftUI noch UIKit. Apple-spezifische Dinge (Keychain, EventKit, Foundation Models, BGTaskScheduler) liegen hinter Protokollen in einem eigenen Plattform-Modul.
- Prompt-Templates, Kategorien und Einstellungen als plattformneutrale Dateien (Markdown/JSON), nicht fest im Swift-Code.

---

## 11. Plattform-Erweiterung: Web & Windows (später)

Nicht Teil der ersten Version, aber die Architektur soll den Weg offen halten.

### 11.1 Was sich wiederverwenden lässt
- **Prompt-Templates** und **Kategorie-Definitionen** (liegen als Dateien vor)
- **Datenbankschema** (SQLite läuft überall)
- **Provider-Konzept** der KI (gleiche Schnittstelle, andere Implementierung)
- **Anbieter-Tabelle** für Auto-Discovery (JSON)
- Optional die Swift-Kernmodule: Swift läuft auch unter Windows und Linux, SwiftUI jedoch nicht. Vor dem Start prüfen, wie gut `swift-nio-imap` und GRDB dort aktuell unterstützt werden.

### 11.2 Windows-Desktop
- **Empfehlung:** Tauri (Rust-Kern, Web-Oberfläche, kleine App-Größe) oder Electron.
- Lokale KI über llama.cpp oder eine vorhandene Ollama-/LM-Studio-Installation (OpenAI-kompatibler Endpoint). Auf Windows-PCs mit Grafikkarte sind auch 13B-Modelle realistisch.
- Zugangsdaten im Windows Credential Manager.
- Direkte IMAP-Verbindung wie auf dem iPad, kein Server nötig.

### 11.3 Web-Version (selbst gehostet)
- **Einschränkung:** Browser können kein IMAP/SMTP sprechen. Eine Web-Version braucht einen Backend-Server, der die Mail-Verbindungen hält.
- **Zielbild: Self-Hosting auf dem eigenen Heimserver**, kein öffentlicher Cloud-Dienst. Auslieferung als **Docker-Compose-Paket** (Backend, Web-Oberfläche, optional Ollama).
- Datenschutz-Versprechen bleibt gültig: Der Heimserver gilt hier als „Client“ des Nutzers. Mails und KI verlassen nur den eigenen Server, wenn der Nutzer eine Cloud-API aktiviert.
- Zugriff von außen nur über VPN (Tailscale, WireGuard) oder Reverse Proxy mit HTTPS und Login (inkl. 2FA/Passkey). Standardmäßig nur im Heimnetz erreichbar.
- Zugangsdaten auf dem Server verschlüsselt speichern (Schlüssel aus Nutzer-Passwort abgeleitet oder per Secret-Datei).
- **Synergien:** Derselbe Server kann
  - der **Push-Server** aus Phase 13 sein (hält IMAP-IDLE, schickt Push ans iPad),
  - die **große KI** bereitstellen (5.3), die auch iPad und Windows nutzen,
  - als **Sync-Punkt** für KI-Daten zwischen den Geräten dienen (11.4).
- Vorschlag Stack: TypeScript-Frontend (z. B. SvelteKit oder React), Backend in TypeScript/Node, Rust oder Swift (Vapor).

### 11.4 Synchronisierung zwischen Geräten
- Mails selbst werden über IMAP ohnehin synchron gehalten.
- Für KI-Daten (Stilprofil, gelernte Prioritäten, Snooze, Erinnerungen) wird eine Sync-Schicht nötig: auf Apple-Geräten CloudKit, plattformübergreifend der eigene Heimserver, jeweils mit Ende-zu-Ende-Verschlüsselung. Sync ist Opt-in.
- Das Personalisierungsprofil daher von Beginn an als exportierbares, versioniertes JSON-Format anlegen.

---

## 12. Offene Entscheidungen

- App-Name
- Nur private Nutzung (TestFlight / Sideload) oder App-Store-Release? (beeinflusst Gmail-Verifizierung und Push-Server)
- Kuratierte Modellliste: welche 3B/7B-Modelle standardmäßig anbieten (z. B. aktuelle Llama-, Qwen-, Mistral- oder Gemma-Varianten mit guter Deutsch-Leistung)
- Heimserver-Funktionen: welche zuerst (KI-Endpoint, Push, Web-Oberfläche, Sync)? Welche Hardware/GPU steht zur Verfügung?
- Web- und/oder Windows-Version: wann, und welche Plattform zuerst?
- Belegordner: welches Exportformat (CSV/XLSX, evtl. passend für eine bestimmte Steuersoftware)? Welche Standard-Kategorien?
- Türsteher: für neue Konten standardmäßig an oder aus?
