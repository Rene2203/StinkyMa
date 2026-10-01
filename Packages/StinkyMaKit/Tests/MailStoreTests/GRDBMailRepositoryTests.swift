import Foundation
import MailCore
@testable import MailStore
import Testing

@Suite("Mail-Repository")
struct GRDBMailRepositoryTests {
    let now = Date(timeIntervalSince1970: 1_790_000_000)
    let repository: GRDBMailRepository

    init() throws {
        let database = try MailDatabase.inMemory()
        try MockData.seedIfEmpty(database, now: now)
        repository = GRDBMailRepository(database: database)
    }

    @Test func accountsAreSorted() async throws {
        let accounts = try await repository.accounts()
        #expect(accounts.map(\.id) == [MockData.iCloudAccountID, MockData.gmailAccountID, MockData.workAccountID])
    }

    @Test func mailboxesStartWithInbox() async throws {
        let mailboxes = try await repository.mailboxes(accountID: MockData.iCloudAccountID)
        #expect(mailboxes.first?.role == .inbox)
        #expect(mailboxes.last?.name == "Finanzen")
        #expect(mailboxes.count == 7)
    }

    @Test func unifiedInboxContainsOnlyInboxesNewestFirst() async throws {
        let messages = try await repository.messages(in: .unifiedInbox, limit: 100)
        #expect(!messages.isEmpty)
        let inboxIDs = [MockData.iCloudAccountID, MockData.gmailAccountID, MockData.workAccountID]
            .map { MockData.mailboxID($0, .inbox) }
        #expect(messages.allSatisfy { inboxIDs.contains($0.mailboxID) })
        #expect(messages.map(\.date) == messages.map(\.date).sorted(by: >))
        #expect(Set(messages.map(\.accountID)).count == 3)
    }

    @Test func limitIsRespected() async throws {
        let messages = try await repository.messages(in: .unifiedInbox, limit: 3)
        #expect(messages.count == 3)
    }

    @Test func unreadScopeAndCountsAgree() async throws {
        let unread = try await repository.messages(in: .unread, limit: 100)
        #expect(unread.allSatisfy { !$0.isRead })
        #expect(try await repository.unreadCount(in: .unifiedInbox) == unread.count)
        #expect(try await repository.unreadCount(in: .unread) == unread.count)
    }

    @Test func flaggedScopeSpansMailboxesButNotTrash() async throws {
        let flagged = try await repository.messages(in: .flagged, limit: 100)
        #expect(flagged.count == 2)
        try await repository.move(messageIDs: [flagged[0].id], to: .trash)
        #expect(try await repository.messages(in: .flagged, limit: 100).count == 1)
    }

    @Test func threadIsOrderedOldestFirstAcrossMailboxes() async throws {
        let thread = try await repository.messages(inThread: "mock-thread-relaunch")
        #expect(thread.count == 3)
        #expect(thread.map(\.date) == thread.map(\.date).sorted())
        #expect(Set(thread.map(\.mailboxID)).count == 2)
    }

    @Test func setFlagAddsAndRemovesOnlyThatFlag() async throws {
        let target = try #require(try await repository.messages(in: .unread, limit: 1).first)
        try await repository.setFlag(.seen, true, messageIDs: [target.id])
        var reloaded = try #require(try await repository.message(id: target.id))
        #expect(reloaded.isRead)
        #expect(reloaded.flags.subtracting(.seen) == target.flags)

        try await repository.setFlag(.seen, false, messageIDs: [target.id])
        reloaded = try #require(try await repository.message(id: target.id))
        #expect(reloaded.flags == target.flags)
    }

    @Test func moveUsesTheMessagesOwnAccount() async throws {
        let inbox = try await repository.messages(in: .unifiedInbox, limit: 100)
        let icloud = try #require(inbox.first { $0.accountID == MockData.iCloudAccountID })
        let work = try #require(inbox.first { $0.accountID == MockData.workAccountID })

        try await repository.move(messageIDs: [icloud.id, work.id], to: .archive)

        #expect(try await repository.message(id: icloud.id)?.mailboxID == MockData.mailboxID(MockData.iCloudAccountID, .archive))
        #expect(try await repository.message(id: work.id)?.mailboxID == MockData.mailboxID(MockData.workAccountID, .archive))
        let remaining = try await repository.messages(in: .unifiedInbox, limit: 100)
        #expect(remaining.count == inbox.count - 2)
    }

    @Test func moveWithoutTargetMailboxLeavesMessageAlone() async throws {
        let inbox = try await repository.messages(in: .unifiedInbox, limit: 1)
        let message = try #require(inbox.first)
        try await repository.move(messageIDs: [message.id], to: .custom)
        // `.custom` gibt es nur im iCloud-Konto; die Rolle ist nicht eindeutig genug, um für
        // andere Konten etwas zu verschieben.
        if message.accountID != MockData.iCloudAccountID {
            #expect(try await repository.message(id: message.id)?.mailboxID == message.mailboxID)
        }
    }

    @Test func emptyIDListsAreNoOps() async throws {
        try await repository.setFlag(.seen, true, messageIDs: [])
        try await repository.move(messageIDs: [], to: .trash)
    }

    @Test func attachmentsBelongToMessage() async throws {
        let inbox = try await repository.messages(in: .unifiedInbox, limit: 100)
        let invoice = try #require(inbox.first { $0.subject == "Ihre Abschlagsrechnung Oktober" })
        let attachments = try await repository.attachments(messageID: invoice.id)
        #expect(attachments.map(\.filename) == ["AGB.pdf", "Rechnung_2026-10.pdf"])
        #expect(invoice.hasAttachments)
    }
}
