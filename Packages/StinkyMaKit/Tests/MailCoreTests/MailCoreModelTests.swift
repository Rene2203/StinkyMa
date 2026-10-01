import Foundation
import MailCore
import Testing

@Suite("MailCore-Modelle")
struct MailCoreModelTests {
    @Test func displayNameFallsBackToAddress() {
        #expect(EmailAddress(name: "Anna", address: "anna@example.org").displayName == "Anna")
        #expect(EmailAddress(name: "  ", address: "anna@example.org").displayName == "anna@example.org")
        #expect(EmailAddress(address: "anna@example.org").displayName == "anna@example.org")
    }

    @Test func domainIsLowercasedAndOptional() {
        #expect(EmailAddress(address: "Anna@Example.ORG").domain == "example.org")
        #expect(EmailAddress(address: "kein-at").domain == nil)
        #expect(EmailAddress(address: "leer@").domain == nil)
    }

    @Test func messageFlagsHelpers() {
        var message = Message(
            accountID: "a", mailboxID: "m", threadID: "t",
            from: EmailAddress(address: "x@example.org"),
            subject: "Test", date: Date(), snippet: ""
        )
        #expect(!message.isRead)
        #expect(!message.isFlagged)
        message.flags.insert([.seen, .flagged])
        #expect(message.isRead)
        #expect(message.isFlagged)
    }

    @Test(arguments: [
        ("Rechnung.pdf", "pdf"),
        ("Rechnung.PDF.exe", "exe"),
        ("ohne_endung", ""),
        (".profile", ""),
    ])
    func attachmentExtension(filename: String, expected: String) {
        let attachment = Attachment(id: "1", messageID: "m", filename: filename, mimeType: "application/octet-stream", size: 1)
        #expect(attachment.fileExtension == expected)
    }

    @Test func mailboxRolesSortInboxFirst() {
        let sorted = MailboxRole.allCases.shuffled().sorted { $0.sortRank < $1.sortRank }
        #expect(sorted.first == .inbox)
        #expect(sorted.last == .custom)
    }

    @Test func secretKeysAreNamespaced() {
        #expect(SecretKey.accountPassword(accountID: "a1") == SecretKey(service: "account-password", account: "a1"))
        #expect(SecretKey.attachmentPassword(sender: "Bank@Example.org").account == "bank@example.org")
        #expect(SecretKey.accountPassword(accountID: "a1") != SecretKey.oauthRefreshToken(accountID: "a1"))
    }
}

@Suite("Initialen")
struct InitialsTests {
    @Test(arguments: [
        (EmailAddress(name: "Anna Beispiel", address: "a@example.org"), "AB"),
        (EmailAddress(name: "Praxis Dr. Sonnenschein", address: "p@example.org"), "PS"),
        (EmailAddress(name: "Mama", address: "m@example.org"), "M"),
        (EmailAddress(address: "tim.kaiser@example.org"), "TK"),
        (EmailAddress(address: "info@example.org"), "I"),
        (EmailAddress(name: "123", address: "4@example.org"), "?"),
    ])
    func initials(address: EmailAddress, expected: String) {
        #expect(address.initials == expected)
    }
}
