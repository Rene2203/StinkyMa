/// Lese- und Schreibzugriff auf den lokalen Mail-Bestand. Die UI spricht nur mit diesem Protokoll,
/// damit sie mit Mock-Daten und in Tests ohne Datenbank laufen kann.
public protocol MailRepository: Sendable {
    func accounts() async throws -> [Account]
    func mailboxes(accountID: String) async throws -> [Mailbox]
    /// Nachrichten eines Bereichs, neueste zuerst.
    func messages(in scope: MessageScope, limit: Int) async throws -> [Message]
    /// Alle Nachrichten einer Konversation, älteste zuerst.
    func messages(inThread threadID: String) async throws -> [Message]
    func message(id: String) async throws -> Message?
    func attachments(messageID: String) async throws -> [Attachment]
    func unreadCount(in scope: MessageScope) async throws -> Int

    func setFlag(_ flag: MessageFlags, _ enabled: Bool, messageIDs: [String]) async throws
    /// Verschiebt Nachrichten in den Ordner mit dieser Rolle im jeweiligen Konto.
    /// Nachrichten, deren Konto keinen solchen Ordner hat, bleiben unverändert.
    func move(messageIDs: [String], to role: MailboxRole) async throws
}
