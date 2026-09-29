import Foundation
import GRDB
import MailCore

/// `MailRepository` auf Basis der lokalen GRDB-Datenbank.
public struct GRDBMailRepository: MailRepository {
    private let writer: any DatabaseWriter

    public init(database: MailDatabase) {
        self.writer = database.writer
    }

    public func accounts() async throws -> [Account] {
        try await writer.read { db in
            try Account.order(Column("sortOrder"), Column("email")).fetchAll(db)
        }
    }

    public func mailboxes(accountID: String) async throws -> [Mailbox] {
        try await writer.read { db in
            try Mailbox.filter(Column("accountId") == accountID).fetchAll(db)
                .sorted { ($0.role.sortRank, $0.name) < ($1.role.sortRank, $1.name) }
        }
    }

    public func messages(in scope: MessageScope, limit: Int) async throws -> [Message] {
        try await writer.read { db in
            let (condition, arguments) = Self.sqlCondition(for: scope)
            return try Message.fetchAll(
                db,
                sql: """
                    SELECT message.* FROM message
                    JOIN mailbox ON mailbox.id = message.mailboxId
                    WHERE \(condition)
                    ORDER BY message.date DESC
                    LIMIT ?
                    """,
                arguments: arguments + [limit]
            )
        }
    }

    public func messages(inThread threadID: String) async throws -> [Message] {
        try await writer.read { db in
            try Message
                .filter(Column("threadId") == threadID)
                .order(Column("date"))
                .fetchAll(db)
        }
    }

    public func message(id: String) async throws -> Message? {
        try await writer.read { db in
            try Message.fetchOne(db, key: id)
        }
    }

    public func attachments(messageID: String) async throws -> [Attachment] {
        try await writer.read { db in
            try Attachment
                .filter(Column("messageId") == messageID)
                .order(Column("filename"))
                .fetchAll(db)
        }
    }

    public func unreadCount(in scope: MessageScope) async throws -> Int {
        try await writer.read { db in
            let (condition, arguments) = Self.sqlCondition(for: scope)
            return try Int.fetchOne(
                db,
                sql: """
                    SELECT COUNT(*) FROM message
                    JOIN mailbox ON mailbox.id = message.mailboxId
                    WHERE \(condition) AND (message.flags & ?) = 0
                    """,
                arguments: arguments + [MessageFlags.seen.rawValue]
            ) ?? 0
        }
    }

    public func setFlag(_ flag: MessageFlags, _ enabled: Bool, messageIDs: [String]) async throws {
        guard !messageIDs.isEmpty else { return }
        try await writer.write { db in
            let operation = enabled ? "flags | ?" : "flags & ~?"
            try db.execute(
                sql: "UPDATE message SET flags = \(operation) WHERE id IN \(Self.placeholders(messageIDs.count))",
                arguments: [flag.rawValue] + StatementArguments(messageIDs)
            )
        }
    }

    public func move(messageIDs: [String], to role: MailboxRole) async throws {
        guard !messageIDs.isEmpty else { return }
        try await writer.write { db in
            try db.execute(
                sql: """
                    UPDATE message SET mailboxId = target.id
                    FROM (SELECT id, accountId FROM mailbox WHERE role = ?) AS target
                    WHERE target.accountId = message.accountId
                      AND message.id IN \(Self.placeholders(messageIDs.count))
                    """,
                arguments: [role.rawValue] + StatementArguments(messageIDs)
            )
        }
    }

    // MARK: - SQL-Bausteine

    /// Bedingung auf `message` (verbunden mit `mailbox`) für einen Bereich.
    static func sqlCondition(for scope: MessageScope) -> (String, StatementArguments) {
        switch scope {
        case .unifiedInbox:
            ("mailbox.role = ?", [MailboxRole.inbox.rawValue])
        case .unread:
            ("mailbox.role = ? AND (message.flags & ?) = 0", [MailboxRole.inbox.rawValue, MessageFlags.seen.rawValue])
        case .flagged:
            ("mailbox.role <> ? AND (message.flags & ?) <> 0", [MailboxRole.trash.rawValue, MessageFlags.flagged.rawValue])
        case .mailbox(let id):
            ("message.mailboxId = ?", [id])
        }
    }

    static func placeholders(_ count: Int) -> String {
        "(" + Array(repeating: "?", count: count).joined(separator: ", ") + ")"
    }
}
