# Swift-Seite: später nachholen

Die iPad-/Mac-App (Swift, `App/` und `Packages/StinkyMaKit`) ist seit 30.09.2026 zurückgestellt
(Entscheidung des Nutzers: Ressourcen auf Windows und Server bündeln). Das Ziel iPad/Mac bleibt bestehen.

**Stand beim Zurückstellen:** Phase 1 der Swift-App (Mock-Posteingang, Navigation, Datenbank). Schema bis
Migration `v3-pending-actions` in Swift und TypeScript gleich; 43 Swift-Tests grün. Der iPad-UI-Test lief zuletzt
rot wegen eines Zeitlimits auf dem CI-Simulator (Lauf #13); die Korrektur (Zeitlimits 30 s) ist eingecheckt,
aber ungeprüft.

**Wieder aufnehmen:** Apple-CI von Hand starten (Actions → „CI iPad & Mac“ → „Run workflow“), dann die Liste
unten abarbeiten.

## Offene Punkte

| Seit | Was | Wo in TypeScript |
|------|-----|------------------|
| 01.10.2026 | Migration `v14-account-sync-days`: Spalte `account.syncDays INTEGER` (NULL = 30 Tage, 0 = alle); kürzer → ältere Mails lokal entfernen, nachgeladene alte Mails lösen keine Benachrichtigung/Regel aus; viele Verschiebungen als ein MOVE | `core/src/models.ts` (`syncSince`), `mail/mailService.ts` (`setSyncDays`, `#applyMoves`), `mail/accountSync.ts` (`arrivedSince`) |
| 01.10.2026 | Aufräumen: Gruppen nach Absender/Domain, Schutz-Regeln (Rechnung, Bestellung, Ticket, Zugangsdaten …), Löschen in den Papierkorb, „KI prüfen“ vorrangig | `core/src/cleanup.ts`, `sqlite/cleanupStore.ts`, `mail/cleanupService.ts`, `llm/aiService.ts` (`categorizeMessages`) |
| 01.10.2026 | Migration `v13-sender-category`: Tabelle `senderCategory(address TEXT PRIMARY KEY, category TEXT, learnedAt TEXT)`; `message.categoryOrigin` kennt zusätzlich „user“ und „learned“ | `core/src/sqlite/schema.ts`, `sqlite/aiStore.ts` |
| 01.10.2026 | Migration `v12-mail-rules`: Tabellen `mailRule(id, text, accountId → account, definition JSON, enabled, createdAt)` und `ruleQueue(messageId → message, queuedAt)`; Regeln aus Text (ohne KI: `parseRuleText`, mit KI nur als Rückfall), Anwenden auf neu angekommene Mails | `core/src/sqlite/schema.ts`, `core/src/rules.ts`, `core/src/ai/rules.ts`, `core/src/mail/ruleService.ts` |
| 01.10.2026 | Migration `v11-screener`: Spalte `account.screener INTEGER NOT NULL DEFAULT 0`, Tabelle `senderDecision(address TEXT PRIMARY KEY, decision TEXT, decidedAt TEXT)`; Türsteher-Filter im Posteingang | `core/src/sqlite/schema.ts`, `sqlite/repository.ts` (`screenedOut`) |
| 01.10.2026 | Migration `v10-message-actions` (Tabellen `messageAction`, `messageActionScan`; `reminder.actionId`, `reminder.status`) | `core/src/sqlite/schema.ts`, `sqlite/actionStore.ts` |
| 01.10.2026 | Aktionen erkennen (Regeln + KI mit Belegprüfung), Erinnerungen, .ics; Phishing-Check mit Gründen | `core/src/ai/actions.ts`, `core/src/calendar.ts`, `core/src/phishing.ts` |
| 01.10.2026 | Verschieben einer Mail (neue ID) behält Anhang-Text, Leseergebnis, Aktionen, Erinnerungen | `core/src/sqlite/writer.ts` (`relocateMessage`) |
| 01.10.2026 | OAuth (Gmail/Outlook): PKCE, Loopback-Anmeldung, XOAUTH2 für IMAP/SMTP, Token-Erneuerung, „Erneut anmelden“ – auf iPad/Mac mit ASWebAuthenticationSession | `web/packages/core/src/oauth.ts`, `node/oauthLoopback.ts`, `mail/mailService.ts` |
| 01.10.2026 | Bilder/Scans mit KI lesen (Ergebnis in `attachmentAnalysis`, Text in `attachmentText` mit Quelle `vision`) | `core/src/llm/llamaServer.ts`, `core/src/sqlite/aiStore.ts` |
| 01.10.2026 | Migration `v9-ai-results`: `message.categoryOrigin`, Index `message_on_uncategorized`, Tabelle `threadSummary` | `web/packages/core/src/sqlite/schema.ts`, `sqlite/aiStore.ts` |
| 01.10.2026 | KI-Kern: Router mit Freigabe-Prüfung, Prompts (v2), Antwortprüfung, Testsatz + Messlauf | `web/packages/core/src/ai/` |
| 01.10.2026 | Lokale KI: Modell-Download (fortsetzbar, SHA-256), llama.cpp-Anbieter, KI-Dienst (Zusammenfassen, Einordnen im Hintergrund) – auf dem iPad über MLX/llama.cpp-Swift nachzubauen | `web/packages/core/src/llm/` |
| 30.09.2026 | Migration `v4-remote-content-exceptions`: Tabelle `remoteContentException(pattern TEXT PRIMARY KEY, createdAt TEXT)` | `web/packages/core/src/sqlite/schema.ts` |
| 30.09.2026 | Ausnahmeliste für externe Inhalte (Adresse/Domain, Subdomains) + Repository-Methoden | `web/packages/core/src/remoteContent.ts`, `repository.ts` |
| 30.09.2026 | Optionen-Dialog, „Externe Inhalte laden“ pro Mail | `web/packages/ui/src/components/OptionsDialog.tsx`, `SafeHtml.tsx` |
| 30.09.2026 | Migration `v5-outbox`: Tabelle `outbox` (Postausgang, siehe schema.ts) | `web/packages/core/src/sqlite/schema.ts` |
| 01.10.2026 | Migration `v8-attachment-search` (attachmentFTS + Trigger), Anhang-Text beim Abgleich | `core/src/sqlite/schema.ts`, `core/src/mail/attachmentText.ts` |
| 01.10.2026 | Volltextsuche (Syntax, gleiche Regeln) | `core/src/search.ts` |
| 01.10.2026 | Neue Mails sofort (IDLE-Wächter), Benachrichtigungs-Modi | `core/src/mail/mailService.ts` (`startWatching`), `core/src/appSettings.ts` |
| 30.09.2026 | Weiterleiten mit Original-HTML und Original-Anhängen | `core/src/compose.ts` (`prepareCompose`, `emailHtml`), `mailService.send` |
| 30.09.2026 | Migration `v7-account-signature` (`account.signatureHtml`), Signatur beim Schreiben | `core/src/sqlite/schema.ts`, `core/src/compose.ts` |
| 30.09.2026 | Adressvorschläge (`suggestAddresses`, `rankContacts`) | `core/src/sqlite/repository.ts`, `core/src/compose.ts` |
| 30.09.2026 | Migration `v6-drafts` (Tabelle `draft`), Entwürfe mit Server-Abgleich | `core/src/sqlite/schema.ts`, `mail/mailService.ts` (`#flushDrafts`) |
| 30.09.2026 | Anhänge öffnen/speichern (bei Bedarf vom Server), riskante Endungen | `core/src/files.ts`, `mailService.attachmentContent` |
| 30.09.2026 | Formatierter Editor (HTML-Mails schreiben), HTML-Aufbereitung für den Versand | `web/packages/ui/src/components/RichTextEditor.tsx`, `core/src/compose.ts` (`emailHtml`) |
| 30.09.2026 | Schreiben: Antworten/Weiterleiten-Regeln, Empfängerzeile, Postausgang, SMTP | `web/packages/core/src/compose.ts`, `mail/smtp.ts`, `mail/mailService.ts` |

Funktional fehlt der Swift-App alles ab Windows-Phase W2 (echte IMAP-Konten, Abruf, Warteschlange, HTML-Ansicht).
Die Logik dazu liegt plattformneutral in `web/packages/core` und dient als Vorlage.
