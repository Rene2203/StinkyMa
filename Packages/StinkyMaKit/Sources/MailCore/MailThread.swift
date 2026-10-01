import Foundation

/// Eine Konversation. Heißt `MailThread`, um nicht mit `Foundation.Thread` zu kollidieren.
public struct MailThread: Identifiable, Hashable, Sendable {
    public var id: String
    public var subject: String
    public var participants: [EmailAddress]
    public var lastDate: Date
    public var summary: String?
    public var summaryUpdatedAt: Date?

    public init(
        id: String,
        subject: String,
        participants: [EmailAddress],
        lastDate: Date,
        summary: String? = nil,
        summaryUpdatedAt: Date? = nil
    ) {
        self.id = id
        self.subject = subject
        self.participants = participants
        self.lastDate = lastDate
        self.summary = summary
        self.summaryUpdatedAt = summaryUpdatedAt
    }
}
