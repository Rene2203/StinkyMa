import Foundation
import GRDB
import MailCore
@testable import MailStore
import Testing

@Suite("Mock-Daten")
struct MockDataTests {
    @Test func seedingIsIdempotent() throws {
        let database = try MailDatabase.inMemory()
        try MockData.seedIfEmpty(database)
        let first = try database.writer.read { db in try Message.fetchCount(db) }
        try MockData.seedIfEmpty(database)
        let second = try database.writer.read { db in try Message.fetchCount(db) }
        #expect(first > 15)
        #expect(first == second)
    }

    @Test func threadsSummarizeTheirMessages() throws {
        let database = try MailDatabase.inMemory()
        try MockData.seedIfEmpty(database)
        let (loadedThread, lastDate) = try database.writer.read { db in
            (
                try MailThread.fetchOne(db, key: "mock-thread-grillabend"),
                try Date.fetchOne(db, sql: "SELECT MAX(date) FROM message WHERE threadId = 'mock-thread-grillabend'")
            )
        }
        let thread = try #require(loadedThread)
        #expect(thread.subject == "Grillabend am Samstag")
        #expect(thread.lastDate == lastDate)
        #expect(thread.participants.count == 2)
    }

    @Test func mockAddressesUseReservedDomains() throws {
        let database = try MailDatabase.inMemory()
        try MockData.seedIfEmpty(database)
        let addresses = try database.writer.read { db in
            try String.fetchAll(db, sql: "SELECT fromAddress FROM message UNION SELECT email FROM account")
        }
        #expect(addresses.allSatisfy { $0.hasSuffix(".example") })
    }

    @Test func snippetCollapsesLinesAndTruncates() {
        #expect(MockData.snippet(from: "Hallo\n\n  Welt  \n") == "Hallo Welt")
        let long = String(repeating: "a", count: 200)
        let snippet = MockData.snippet(from: long, maxLength: 10)
        #expect(snippet == "aaaaaaaaaa…")
    }
}
