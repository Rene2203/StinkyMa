import Foundation
import MailCore
import Observation

/// Zustand des Drei-Spalten-Layouts: Seitenleiste, Mail-Liste und geöffnete Konversation.
@MainActor
@Observable
public final class MailboxBrowserModel {
    public private(set) var sections: [SidebarSection] = []
    public private(set) var accountsByID: [String: Account] = [:]
    public var selectedScope: MessageScope? = .unifiedInbox

    public private(set) var messages: [Message] = []
    public var selectedMessageID: Message.ID?
    /// Lokaler Filter über Betreff, Absender und Vorschau. Die Volltextsuche (FTS5) folgt in Phase 4.
    public var searchText = ""

    public private(set) var threadMessages: [Message] = []
    public private(set) var attachmentsByMessageID: [String: [Attachment]] = [:]

    /// Letzter Fehler für die Anzeige; wird bei erfolgreicher Aktion nicht automatisch gelöscht.
    public var errorMessage: String?

    public let pageSize: Int
    private let repository: any MailRepository

    public init(repository: any MailRepository, pageSize: Int = 500) {
        self.repository = repository
        self.pageSize = pageSize
    }

    // MARK: - Abgeleitete Werte

    public var visibleMessages: [Message] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return messages }
        return messages.filter { message in
            message.subject.localizedStandardContains(query)
                || message.from.displayName.localizedStandardContains(query)
                || message.from.address.localizedStandardContains(query)
                || message.snippet.localizedStandardContains(query)
        }
    }

    public var selectedMessage: Message? {
        guard let selectedMessageID else { return nil }
        return messages.first { $0.id == selectedMessageID }
            ?? threadMessages.first { $0.id == selectedMessageID }
    }

    /// Zeigt die Liste Mails aus mehreren Konten? Dann kennzeichnet die UI das Konto farbig.
    public var showsAccountIndicator: Bool {
        switch selectedScope {
        case .mailbox: false
        default: accountsByID.count > 1
        }
    }

    public func account(for message: Message) -> Account? {
        accountsByID[message.accountID]
    }

    public func sidebarItem(for scope: MessageScope) -> SidebarItem? {
        sections.lazy.flatMap(\.items).first { $0.scope == scope }
    }

    // MARK: - Laden

    public func loadSidebar() async {
        do {
            let accounts = try await repository.accounts()
            var sections = [
                SidebarSection(kind: .smartMailboxes, items: [
                    SidebarItem(kind: .unifiedInbox, unreadCount: try await repository.unreadCount(in: .unifiedInbox)),
                    SidebarItem(kind: .unread, unreadCount: try await repository.unreadCount(in: .unread)),
                    SidebarItem(kind: .flagged, unreadCount: try await repository.unreadCount(in: .flagged)),
                ]),
            ]
            for account in accounts {
                var items: [SidebarItem] = []
                for mailbox in try await repository.mailboxes(accountID: account.id) {
                    let unread = try await repository.unreadCount(in: .mailbox(id: mailbox.id))
                    items.append(SidebarItem(kind: .mailbox(mailbox), unreadCount: unread))
                }
                sections.append(SidebarSection(kind: .account(account), items: items))
            }
            self.accountsByID = Dictionary(uniqueKeysWithValues: accounts.map { ($0.id, $0) })
            self.sections = sections
        } catch {
            report(error)
        }
    }

    public func loadMessages() async {
        guard let scope = selectedScope else {
            messages = []
            return
        }
        do {
            let loaded = try await repository.messages(in: scope, limit: pageSize)
            guard !Task.isCancelled, scope == selectedScope else { return }
            messages = loaded
            if let selectedMessageID, !loaded.contains(where: { $0.id == selectedMessageID }) {
                self.selectedMessageID = nil
            }
        } catch {
            report(error)
        }
    }

    /// Lädt die Konversation zur ausgewählten Mail und markiert die Mail als gelesen.
    public func loadSelectedThread() async {
        guard let selectedID = selectedMessageID,
              let message = messages.first(where: { $0.id == selectedID })
        else {
            threadMessages = []
            attachmentsByMessageID = [:]
            return
        }
        do {
            let thread = try await repository.messages(inThread: message.threadID)
            var attachments: [String: [Attachment]] = [:]
            for threadMessage in thread where threadMessage.hasAttachments {
                attachments[threadMessage.id] = try await repository.attachments(messageID: threadMessage.id)
            }
            guard !Task.isCancelled, selectedID == selectedMessageID else { return }
            threadMessages = thread.isEmpty ? [message] : thread
            attachmentsByMessageID = attachments

            if !message.isRead {
                try await setFlag(.seen, true, messageIDs: [message.id])
            }
        } catch {
            report(error)
        }
    }

    // MARK: - Aktionen

    public func toggleRead(messageID: Message.ID) async {
        guard let message = message(withID: messageID) else { return }
        await perform { try await self.setFlag(.seen, !message.isRead, messageIDs: [messageID]) }
    }

    public func toggleFlag(messageID: Message.ID) async {
        guard let message = message(withID: messageID) else { return }
        await perform { try await self.setFlag(.flagged, !message.isFlagged, messageIDs: [messageID]) }
    }

    public func archive(messageIDs: [Message.ID]) async {
        await move(messageIDs: messageIDs, to: .archive)
    }

    /// Verschiebt in den Papierkorb. Endgültiges Löschen gibt es nur als eigene, bestätigte Aktion.
    public func moveToTrash(messageIDs: [Message.ID]) async {
        await move(messageIDs: messageIDs, to: .trash)
    }

    private func move(messageIDs: [Message.ID], to role: MailboxRole) async {
        guard !messageIDs.isEmpty else { return }
        let nextSelection = selectionAfterRemoving(messageIDs)
        await perform {
            try await self.repository.move(messageIDs: messageIDs, to: role)
            if let selected = self.selectedMessageID, messageIDs.contains(selected) {
                self.selectedMessageID = nextSelection
            }
            await self.loadMessages()
            await self.loadSidebar()
        }
    }

    // MARK: - Hilfen

    private func setFlag(_ flag: MessageFlags, _ enabled: Bool, messageIDs: [Message.ID]) async throws {
        try await repository.setFlag(flag, enabled, messageIDs: messageIDs)
        let ids = Set(messageIDs)
        func apply(_ list: inout [Message]) {
            for index in list.indices where ids.contains(list[index].id) {
                if enabled {
                    list[index].flags.insert(flag)
                } else {
                    list[index].flags.remove(flag)
                }
            }
        }
        apply(&messages)
        apply(&threadMessages)
        // Aus „Ungelesen“ bzw. „Markiert“ verschwinden Mails erst beim nächsten Laden,
        // damit die Liste beim Lesen nicht unter dem Finger wegspringt.
        await loadSidebar()
    }

    private func message(withID id: Message.ID) -> Message? {
        messages.first { $0.id == id } ?? threadMessages.first { $0.id == id }
    }

    /// Nächste sinnvolle Auswahl, wenn Mails aus der Liste verschwinden: die folgende, sonst die vorherige.
    private func selectionAfterRemoving(_ removed: [Message.ID]) -> Message.ID? {
        let list = visibleMessages
        guard let selected = selectedMessageID,
              removed.contains(selected),
              let index = list.firstIndex(where: { $0.id == selected })
        else { return selectedMessageID }
        let removedSet = Set(removed)
        let after = list[index...].first { !removedSet.contains($0.id) }
        let before = list[..<index].last { !removedSet.contains($0.id) }
        return (after ?? before)?.id
    }

    private func perform(_ action: @MainActor () async throws -> Void) async {
        do {
            try await action()
        } catch {
            report(error)
        }
    }

    private func report(_ error: any Error) {
        // Keine Mail-Inhalte loggen; nur die Fehlermeldung für die Anzeige merken.
        errorMessage = String(describing: error)
    }
}
