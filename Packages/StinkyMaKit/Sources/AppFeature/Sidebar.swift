import MailCore

/// Ein Abschnitt der Seitenleiste: intelligente Postfächer oder die Ordner eines Kontos.
public struct SidebarSection: Identifiable, Hashable, Sendable {
    public enum Kind: Hashable, Sendable {
        case smartMailboxes
        case account(Account)
    }

    public var kind: Kind
    public var items: [SidebarItem]

    public var id: String {
        switch kind {
        case .smartMailboxes: "smart"
        case .account(let account): "account-\(account.id)"
        }
    }
}

/// Ein Eintrag der Seitenleiste. Die Oberfläche übersetzt `kind` in Titel und Symbol.
public struct SidebarItem: Identifiable, Hashable, Sendable {
    public enum Kind: Hashable, Sendable {
        case unifiedInbox
        case unread
        case flagged
        case mailbox(Mailbox)
    }

    public var kind: Kind
    public var unreadCount: Int

    public var scope: MessageScope {
        switch kind {
        case .unifiedInbox: .unifiedInbox
        case .unread: .unread
        case .flagged: .flagged
        case .mailbox(let mailbox): .mailbox(id: mailbox.id)
        }
    }

    public var id: MessageScope { scope }
}
