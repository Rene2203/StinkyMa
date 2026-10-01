/// Ein Ordner (IMAP-Mailbox) eines Kontos.
public struct Mailbox: Identifiable, Hashable, Sendable {
    public var id: String
    public var accountID: String
    /// Server-Name bzw. Pfad, z. B. `INBOX` oder `Archiv/2025`.
    public var name: String
    public var role: MailboxRole
    public var uidValidity: UInt32?
    public var highestModSeq: UInt64?

    public init(
        id: String,
        accountID: String,
        name: String,
        role: MailboxRole,
        uidValidity: UInt32? = nil,
        highestModSeq: UInt64? = nil
    ) {
        self.id = id
        self.accountID = accountID
        self.name = name
        self.role = role
        self.uidValidity = uidValidity
        self.highestModSeq = highestModSeq
    }
}

public enum MailboxRole: String, Hashable, Sendable, Codable, CaseIterable {
    case inbox, sent, drafts, trash, archive, spam, custom

    /// Reihenfolge in der Seitenleiste.
    public var sortRank: Int {
        switch self {
        case .inbox: 0
        case .drafts: 1
        case .sent: 2
        case .archive: 3
        case .spam: 4
        case .trash: 5
        case .custom: 6
        }
    }
}
