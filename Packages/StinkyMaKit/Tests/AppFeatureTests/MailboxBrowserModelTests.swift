import AppFeature
import Foundation
import MailCore
import MailStore
import Testing

@MainActor
@Suite("Posteingang-Modell")
struct MailboxBrowserModelTests {
    let repository: GRDBMailRepository
    let model: MailboxBrowserModel

    init() throws {
        let database = try MailDatabase.inMemory()
        try MockData.seedIfEmpty(database, now: Date(timeIntervalSince1970: 1_790_000_000))
        repository = GRDBMailRepository(database: database)
        model = MailboxBrowserModel(repository: repository)
    }

    @Test func sidebarHasSmartMailboxesAndOneSectionPerAccount() async {
        await model.loadSidebar()
        #expect(model.sections.count == 4)
        #expect(model.sections.first?.kind == .smartMailboxes)
        #expect(model.sections.first?.items.map(\.scope) == [.unifiedInbox, .unread, .flagged])
        #expect(model.accountsByID.count == 3)
        #expect(model.sidebarItem(for: .unifiedInbox)?.unreadCount ?? 0 > 0)
        #expect(model.errorMessage == nil)
    }

    @Test func startsWithUnifiedInbox() async {
        await model.loadSidebar()
        await model.loadMessages()
        #expect(model.selectedScope == .unifiedInbox)
        #expect(!model.messages.isEmpty)
        #expect(model.showsAccountIndicator)
    }

    @Test func switchingScopeReloads() async {
        await model.loadSidebar()
        model.selectedScope = .mailbox(id: MockData.mailboxID(MockData.workAccountID, .drafts))
        await model.loadMessages()
        #expect(model.messages.count == 1)
        #expect(model.messages.first?.flags.contains(.draft) == true)
        #expect(!model.showsAccountIndicator)
    }

    @Test func openingMessageLoadsThreadAndMarksRead() async throws {
        await model.loadSidebar()
        await model.loadMessages()
        let unread = try #require(model.messages.first { !$0.isRead && $0.threadID == "mock-thread-relaunch" })
        let unreadBefore = model.sidebarItem(for: .unifiedInbox)?.unreadCount ?? 0

        model.selectedMessageID = unread.id
        await model.loadSelectedThread()

        #expect(model.threadMessages.count == 3)
        #expect(model.selectedMessage?.isRead == true)
        #expect(model.messages.first { $0.id == unread.id }?.isRead == true)
        #expect(model.sidebarItem(for: .unifiedInbox)?.unreadCount == unreadBefore - 1)
        #expect(try await repository.message(id: unread.id)?.isRead == true)
    }

    @Test func threadAttachmentsAreLoaded() async throws {
        await model.loadMessages()
        let invoice = try #require(model.messages.first { $0.subject == "Nebenkostenabrechnung 2025" })
        model.selectedMessageID = invoice.id
        await model.loadSelectedThread()
        #expect(model.attachmentsByMessageID[invoice.id]?.map(\.filename) == ["Nebenkosten_2025.pdf"])
    }

    @Test func toggleFlagAndRead() async throws {
        await model.loadMessages()
        let message = try #require(model.messages.first { !$0.isFlagged && $0.isRead })
        await model.toggleFlag(messageID: message.id)
        #expect(model.messages.first { $0.id == message.id }?.isFlagged == true)
        await model.toggleRead(messageID: message.id)
        #expect(model.messages.first { $0.id == message.id }?.isRead == false)
        #expect(try await repository.message(id: message.id)?.flags.contains([.flagged]) == true)
    }

    @Test func archivingSelectsNextMessage() async throws {
        await model.loadSidebar()
        await model.loadMessages()
        let list = model.messages
        let first = list[0]
        model.selectedMessageID = first.id

        await model.archive(messageIDs: [first.id])

        #expect(!model.messages.contains { $0.id == first.id })
        #expect(model.selectedMessageID == list[1].id)
        #expect(try await repository.message(id: first.id)?.mailboxID == MockData.mailboxID(first.accountID, .archive))
    }

    @Test func trashingLastMessageSelectsPrevious() async throws {
        await model.loadMessages()
        let list = model.messages
        let last = try #require(list.last)
        model.selectedMessageID = last.id
        await model.moveToTrash(messageIDs: [last.id])
        #expect(model.selectedMessageID == list[list.count - 2].id)
        #expect(try await repository.message(id: last.id)?.mailboxID == MockData.mailboxID(last.accountID, .trash))
    }

    @Test func searchFiltersLocally() async {
        await model.loadMessages()
        model.searchText = "nebenkosten"
        #expect(model.visibleMessages.map(\.subject) == ["Nebenkostenabrechnung 2025"])
        model.searchText = "petra"
        #expect(model.visibleMessages.count == 2)
        #expect(model.visibleMessages.allSatisfy { $0.threadID == "mock-thread-relaunch" })
        model.searchText = "  "
        #expect(model.visibleMessages.count == model.messages.count)
    }

    @Test func mockEnvironmentIsUsable() async throws {
        let environment = try AppEnvironment.mock()
        #expect(try await environment.repository.accounts().count == 3)
        try environment.secrets.setString("x", for: .accountPassword(accountID: "a"))
    }
}
