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
| 30.09.2026 | Migration `v4-remote-content-exceptions`: Tabelle `remoteContentException(pattern TEXT PRIMARY KEY, createdAt TEXT)` | `web/packages/core/src/sqlite/schema.ts` |
| 30.09.2026 | Ausnahmeliste für externe Inhalte (Adresse/Domain, Subdomains) + Repository-Methoden | `web/packages/core/src/remoteContent.ts`, `repository.ts` |
| 30.09.2026 | Optionen-Dialog, „Externe Inhalte laden“ pro Mail | `web/packages/ui/src/components/OptionsDialog.tsx`, `SafeHtml.tsx` |
| 30.09.2026 | Migration `v5-outbox`: Tabelle `outbox` (Postausgang, siehe schema.ts) | `web/packages/core/src/sqlite/schema.ts` |
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
