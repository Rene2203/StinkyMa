import Foundation
import GRDB
import MailCore
@testable import MailStore
import Testing

@Suite("Datenbank & Migrationen")
struct MailDatabaseTests {
    @Test func migrationsCreateAllTables() throws {
        let database = try MailDatabase.inMemory()
        let tables = try database.writer.read { db in
            try String.fetchSet(db, sql: "SELECT name FROM sqlite_master WHERE type IN ('table')")
        }
        for table in [
            "account", "mailbox", "thread", "message", "attachment", "attachmentAnalysis", "attachmentText",
            "embedding", "behaviorEvent", "senderProfile", "styleProfile", "reminder", "aiModel", "messageFTS",
        ] {
            #expect(tables.contains(table), "Tabelle \(table) fehlt")
        }
    }

    @Test func migratingTwiceIsHarmless() throws {
        let queue = try DatabaseQueue()
        _ = try MailDatabase(writer: queue)
        _ = try MailDatabase(writer: queue)
        let applied = try queue.read { db in try MailSchema.migrator.appliedMigrations(db) }
        #expect(applied == ["v1-core", "v1-fts"])
    }

    @Test func fileDatabaseIsCreatedWithIntermediateDirectories() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("MailStoreTests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("sub/mail.sqlite")
        let database = try MailDatabase.open(at: url)
        try MockData.seedIfEmpty(database)
        #expect(FileManager.default.fileExists(atPath: url.path))
    }

    @Test func recordsRoundTrip() throws {
        let database = try MailDatabase.inMemory()
        let account = Account(
            id: "acc", email: "a@example.org", displayName: "Test", provider: .gmail,
            imapHost: "imap.example.org", smtpHost: "smtp.example.org", authType: .oauth2,
            color: .purple, aiCloudAllowed: true, sortOrder: 3
        )
        let mailbox = Mailbox(id: "box", accountID: "acc", name: "INBOX", role: .inbox, uidValidity: 4_000_000_000, highestModSeq: 9_000_000_000_000)
        let thread = MailThread(id: "t", subject: "Hallo", participants: [EmailAddress(name: "Ä Ö", address: "x@example.org")], lastDate: Date(timeIntervalSince1970: 1_000))
        let message = Message(
            id: "m", accountID: "acc", mailboxID: "box", uid: 4_000_000_001, messageID: "<m@example.org>", threadID: "t",
            from: EmailAddress(name: nil, address: "x@example.org"),
            to: [EmailAddress(name: "Anna", address: "a@example.org")],
            cc: [EmailAddress(address: "cc@example.org")],
            subject: "Hallo", date: Date(timeIntervalSince1970: 1_000), snippet: "Vorschau",
            bodyText: "Text", bodyHTML: "<p>Text</p>", flags: [.seen, .answered], hasAttachments: true,
            category: .spamSuspect, priorityScore: 0.75, snoozedUntil: Date(timeIntervalSince1970: 2_000)
        )
        let attachment = Attachment(
            id: "att", messageID: "m", filename: "a.pdf", mimeType: "application/pdf", size: 10,
            isEncrypted: true, relevance: .central, analysisStatus: .locked, riskFlags: [.doubleExtension]
        )

        try database.writer.write { db in
            try account.insert(db)
            try mailbox.insert(db)
            try thread.insert(db)
            try message.insert(db)
            try attachment.insert(db)
        }
        let loaded = try database.writer.read { db in
            (
                try Account.fetchOne(db, key: "acc"),
                try Mailbox.fetchOne(db, key: "box"),
                try MailThread.fetchOne(db, key: "t"),
                try Message.fetchOne(db, key: "m"),
                try Attachment.fetchOne(db, key: "att")
            )
        }
        #expect(loaded.0 == account)
        #expect(loaded.1 == mailbox)
        #expect(loaded.2 == thread)
        #expect(loaded.3 == message)
        #expect(loaded.4 == attachment)
    }

    @Test func deletingAccountCascades() throws {
        let database = try MailDatabase.inMemory()
        try MockData.seedIfEmpty(database)
        try database.writer.write { db in
            _ = try Account.deleteOne(db, key: MockData.gmailAccountID)
        }
        let remaining = try database.writer.read { db in
            try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM message WHERE accountId = ?", arguments: [MockData.gmailAccountID])
        }
        #expect(remaining == 0)
    }

    @Test func fullTextIndexFollowsMessages() throws {
        let database = try MailDatabase.inMemory()
        try MockData.seedIfEmpty(database)
        func matches(_ query: String) throws -> [String] {
            try database.writer.read { db in
                try String.fetchAll(db, sql: """
                    SELECT message.id FROM message
                    JOIN messageFTS ON messageFTS.rowid = message.rowid
                    WHERE messageFTS MATCH ?
                    """, arguments: [FTS5Pattern(matchingAllPrefixesIn: query)])
            }
        }
        #expect(try matches("Nebenkosten").count == 1)
        // Umlaute und Groß-/Kleinschreibung spielen keine Rolle.
        #expect(try matches("nudelsalat").count == 2)
        #expect(try matches("ABSCHLAGSRECHNUNG").count == 1)

        try database.writer.write { db in
            try db.execute(sql: "UPDATE message SET subject = 'Völlig neuer Betreff' WHERE subject = 'Nebenkostenabrechnung 2025'")
        }
        #expect(try matches("Völlig").count == 1)
        #expect(try matches("voellig").isEmpty)
    }
}
