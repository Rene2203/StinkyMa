import GRDB

/// Schema und Migrationen. Bestehende Migrationen nie ändern, sondern neue anhängen.
enum MailSchema {
    static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v1-core", migrate: createCoreTables)
        migrator.registerMigration("v1-fts", migrate: createFullTextSearch)
        migrator.registerMigration("v2-account-connection", migrate: addAccountConnection)
        migrator.registerMigration("v3-pending-actions", migrate: createPendingActions)
        return migrator
    }

    /// Kern-Datenmodell aus Abschnitt 8 der Spezifikation.
    private static func createCoreTables(_ db: Database) throws {
        try db.create(table: "account") { t in
            t.primaryKey("id", .text)
            t.column("email", .text).notNull()
            t.column("displayName", .text).notNull()
            t.column("provider", .text).notNull()
            t.column("imapHost", .text).notNull()
            t.column("imapPort", .integer).notNull()
            t.column("smtpHost", .text).notNull()
            t.column("smtpPort", .integer).notNull()
            t.column("authType", .text).notNull()
            t.column("color", .text).notNull()
            t.column("aiCloudAllowed", .boolean).notNull().defaults(to: false)
            t.column("sortOrder", .integer).notNull().defaults(to: 0)
        }

        try db.create(table: "mailbox") { t in
            t.primaryKey("id", .text)
            t.belongsTo("account", onDelete: .cascade).notNull()
            t.column("name", .text).notNull()
            t.column("role", .text).notNull()
            t.column("uidValidity", .integer)
            t.column("highestModSeq", .integer)
            t.uniqueKey(["accountId", "name"])
        }
        try db.create(index: "mailbox_on_accountId_role", on: "mailbox", columns: ["accountId", "role"])

        try db.create(table: "thread") { t in
            t.primaryKey("id", .text)
            t.column("subject", .text).notNull()
            t.column("participants", .jsonText).notNull()
            t.column("lastDate", .datetime).notNull()
            t.column("summary", .text)
            t.column("summaryUpdatedAt", .datetime)
        }

        try db.create(table: "message") { t in
            // Kein WITHOUT ROWID: die Volltextsuche (FTS5, externer Inhalt) braucht die rowid.
            t.primaryKey("id", .text)
            t.belongsTo("account", onDelete: .cascade).notNull()
            t.belongsTo("mailbox", onDelete: .cascade).notNull()
            t.column("uid", .integer)
            t.column("messageId", .text)
            t.belongsTo("thread", onDelete: .restrict).notNull()
            t.column("fromName", .text)
            t.column("fromAddress", .text).notNull()
            t.column("to", .jsonText).notNull()
            t.column("cc", .jsonText).notNull()
            t.column("subject", .text).notNull()
            t.column("date", .datetime).notNull()
            t.column("snippet", .text).notNull()
            t.column("bodyText", .text)
            t.column("bodyHTML", .text)
            t.column("flags", .integer).notNull().defaults(to: 0)
            t.column("hasAttachments", .boolean).notNull().defaults(to: false)
            t.column("category", .text)
            t.column("priorityScore", .double)
            t.column("snoozedUntil", .datetime)
        }
        try db.create(index: "message_on_mailboxId_date", on: "message", columns: ["mailboxId", "date"])
        try db.create(index: "message_on_fromAddress", on: "message", columns: ["fromAddress"])
        try db.create(index: "message_on_messageId", on: "message", columns: ["messageId"])
        try db.create(
            index: "message_on_mailboxId_uid",
            on: "message",
            columns: ["mailboxId", "uid"],
            options: .unique,
            condition: Column("uid") != nil
        )

        try db.create(table: "attachment") { t in
            t.primaryKey("id", .text)
            t.belongsTo("message", onDelete: .cascade).notNull()
            t.column("filename", .text).notNull()
            t.column("mimeType", .text).notNull()
            t.column("size", .integer).notNull()
            t.column("localPath", .text)
            t.column("sha256", .text).indexed()
            t.column("isInline", .boolean).notNull().defaults(to: false)
            t.column("contentId", .text)
            t.column("pageCount", .integer)
            t.column("isEncrypted", .boolean).notNull().defaults(to: false)
            t.column("relevance", .text)
            t.column("relevanceReason", .text)
            t.column("documentType", .text)
            t.column("analysisStatus", .text).notNull().defaults(to: "pending")
            t.column("riskFlags", .integer).notNull().defaults(to: 0)
        }

        try db.create(table: "attachmentAnalysis") { t in
            t.primaryKey {
                t.belongsTo("attachment", onDelete: .cascade)
            }
            t.column("summary", .text)
            t.column("extractedJSON", .jsonText)
            t.column("modelId", .text).notNull()
            t.column("privacyClass", .text).notNull()
            t.column("analyzedAt", .datetime).notNull()
        }

        try db.create(table: "attachmentText") { t in
            t.primaryKey {
                t.belongsTo("attachment", onDelete: .cascade)
            }
            t.column("text", .text).notNull()
            t.column("source", .text).notNull()
            t.column("confidence", .double)
        }

        try db.create(table: "embedding") { t in
            t.belongsTo("message", onDelete: .cascade).notNull()
            t.column("chunkIndex", .integer).notNull()
            t.column("vector", .blob).notNull()
            t.primaryKey(["messageId", "chunkIndex"])
        }

        try db.create(table: "behaviorEvent") { t in
            t.autoIncrementedPrimaryKey("id")
            t.belongsTo("message", onDelete: .setNull)
            t.column("type", .text).notNull()
            t.column("timestamp", .datetime).notNull().indexed()
            t.column("metadata", .jsonText)
        }

        try db.create(table: "senderProfile") { t in
            t.primaryKey("address", .text)
            t.column("domain", .text).notNull().indexed()
            t.column("interactionRate", .double)
            t.column("avgReplyTime", .double)
            t.column("userPriority", .integer)
        }

        try db.create(table: "styleProfile") { t in
            t.primaryKey("recipientGroup", .text)
            t.column("greeting", .text)
            t.column("closing", .text)
            t.column("formality", .text)
            t.column("examples", .jsonText)
        }

        try db.create(table: "reminder") { t in
            t.primaryKey("id", .text)
            t.belongsTo("message", onDelete: .setNull)
            t.column("dueDate", .datetime).notNull()
            t.column("text", .text).notNull()
            t.column("eventKitId", .text)
        }

        try db.create(table: "aiModel") { t in
            t.primaryKey("id", .text)
            t.column("name", .text).notNull()
            t.column("providerType", .text).notNull()
            t.column("filePath", .text)
            t.column("sizeBytes", .integer)
            t.column("quantization", .text)
            t.column("paramCount", .integer)
        }
    }

    /// Anmeldename, Verbindungssicherheit und Sync-Status pro Konto. Gleich in web/packages/core/src/sqlite/schema.ts.
    private static func addAccountConnection(_ db: Database) throws {
        try db.alter(table: "account") { t in
            t.add(column: "username", .text).notNull().defaults(to: "")
            t.add(column: "imapSecurity", .text).notNull().defaults(to: "tls")
            t.add(column: "smtpSecurity", .text).notNull().defaults(to: "starttls")
            t.add(column: "lastSyncAt", .datetime)
            t.add(column: "syncError", .text)
        }
    }

    /// Warteschlange für Aktionen, die noch zum Mailserver müssen (offline-fähig, Spezifikation 4.3).
    /// Gleich in web/packages/core/src/sqlite/schema.ts.
    private static func createPendingActions(_ db: Database) throws {
        try db.create(table: "pendingAction") { t in
            t.autoIncrementedPrimaryKey("id")
            t.belongsTo("account", onDelete: .cascade).notNull()
            t.column("messageId", .text).notNull()
            t.column("kind", .text).notNull()
            t.column("payload", .jsonText).notNull()
            t.column("createdAt", .datetime).notNull()
            t.column("attempts", .integer).notNull().defaults(to: 0)
            t.column("lastError", .text)
        }
        try db.create(index: "pendingAction_on_accountId_id", on: "pendingAction", columns: ["accountId", "id"])
    }

    /// Volltextindex über Betreff, Absender und Text. Wird per Trigger aktuell gehalten.
    private static func createFullTextSearch(_ db: Database) throws {
        try db.create(virtualTable: "messageFTS", using: FTS5()) { t in
            t.synchronize(withTable: "message")
            t.tokenizer = .unicode61(diacritics: .remove)
            t.prefixes = [2, 3]
            t.column("subject")
            t.column("fromName")
            t.column("fromAddress")
            t.column("snippet")
            t.column("bodyText")
        }
    }
}
