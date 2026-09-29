import Foundation

/// Eine einzelne Mail.
public struct Message: Identifiable, Hashable, Sendable {
    public var id: String
    public var accountID: String
    public var mailboxID: String
    /// IMAP-UID innerhalb der Mailbox; `nil` für lokal erzeugte Nachrichten (Entwürfe, Mock-Daten).
    public var uid: UInt32?
    /// `Message-ID`-Header.
    public var messageID: String?
    public var threadID: String
    public var from: EmailAddress
    public var to: [EmailAddress]
    public var cc: [EmailAddress]
    public var subject: String
    public var date: Date
    public var snippet: String
    public var bodyText: String?
    public var bodyHTML: String?
    public var flags: MessageFlags
    public var hasAttachments: Bool
    public var category: MessageCategory?
    /// 0 … 1, von KI und Verhaltensmodell berechnet (ab Phase 5 bzw. 9).
    public var priorityScore: Double?
    public var snoozedUntil: Date?

    public init(
        id: String = UUID().uuidString.lowercased(),
        accountID: String,
        mailboxID: String,
        uid: UInt32? = nil,
        messageID: String? = nil,
        threadID: String,
        from: EmailAddress,
        to: [EmailAddress] = [],
        cc: [EmailAddress] = [],
        subject: String,
        date: Date,
        snippet: String,
        bodyText: String? = nil,
        bodyHTML: String? = nil,
        flags: MessageFlags = [],
        hasAttachments: Bool = false,
        category: MessageCategory? = nil,
        priorityScore: Double? = nil,
        snoozedUntil: Date? = nil
    ) {
        self.id = id
        self.accountID = accountID
        self.mailboxID = mailboxID
        self.uid = uid
        self.messageID = messageID
        self.threadID = threadID
        self.from = from
        self.to = to
        self.cc = cc
        self.subject = subject
        self.date = date
        self.snippet = snippet
        self.bodyText = bodyText
        self.bodyHTML = bodyHTML
        self.flags = flags
        self.hasAttachments = hasAttachments
        self.category = category
        self.priorityScore = priorityScore
        self.snoozedUntil = snoozedUntil
    }

    public var isRead: Bool { flags.contains(.seen) }
    public var isFlagged: Bool { flags.contains(.flagged) }
}

/// IMAP-System-Flags.
public struct MessageFlags: OptionSet, Hashable, Sendable, Codable {
    public let rawValue: Int

    public init(rawValue: Int) {
        self.rawValue = rawValue
    }

    public static let seen = MessageFlags(rawValue: 1 << 0)
    public static let answered = MessageFlags(rawValue: 1 << 1)
    public static let flagged = MessageFlags(rawValue: 1 << 2)
    public static let deleted = MessageFlags(rawValue: 1 << 3)
    public static let draft = MessageFlags(rawValue: 1 << 4)
}

/// KI-Kategorien (Spezifikation 5.5).
public enum MessageCategory: String, Hashable, Sendable, Codable, CaseIterable {
    case personal
    case work
    case newsletter
    case notification
    case invoice
    case appointment
    case spamSuspect = "spam_suspect"
}
