import Foundation
import MailCore
import PlatformServices
import Testing

@Suite("Sicherer Speicher")
struct InMemorySecretStoreTests {
    @Test func storesReadsAndRemovesStrings() throws {
        let store = InMemorySecretStore()
        let key = SecretKey.accountPassword(accountID: "icloud")
        #expect(try store.string(for: key) == nil)

        try store.setString("abcd-efgh-ijkl-mnop", for: key)
        #expect(try store.string(for: key) == "abcd-efgh-ijkl-mnop")

        try store.setString("neu", for: key)
        #expect(try store.string(for: key) == "neu")

        try store.removeData(for: key)
        #expect(try store.string(for: key) == nil)
        // Entfernen eines fehlenden Eintrags ist kein Fehler.
        try store.removeData(for: key)
    }

    @Test func keysDoNotCollide() throws {
        let store = InMemorySecretStore()
        try store.setString("passwort", for: .accountPassword(accountID: "a"))
        try store.setString("token", for: .oauthRefreshToken(accountID: "a"))
        #expect(try store.string(for: .accountPassword(accountID: "a")) == "passwort")
        #expect(try store.string(for: .oauthRefreshToken(accountID: "a")) == "token")
        #expect(try store.string(for: .accountPassword(accountID: "b")) == nil)
    }

    @Test func invalidUTF8Throws() throws {
        let store = InMemorySecretStore()
        let key = SecretKey.aiAPIKey(providerID: "test")
        try store.setData(Data([0xFF, 0xFE, 0xFD]), for: key)
        #expect(throws: SecretStoreError.invalidEncoding) {
            try store.string(for: key)
        }
    }

    #if canImport(Security)
    // Läuft nur auf Apple-Plattformen. Auf dem Mac ohne Signatur kann der Data-Protection-Keychain
    // `errSecMissingEntitlement` liefern; dann wird der Test übersprungen statt rot zu werden.
    @Test func keychainRoundTrip() throws {
        let store = KeychainSecretStore(servicePrefix: "de.stinkyma.tests.\(UUID().uuidString)")
        let key = SecretKey.accountPassword(accountID: "roundtrip")
        do {
            try store.setString("geheim", for: key)
        } catch SecretStoreError.platform(let status) where status == -34018 {
            return
        }
        defer { try? store.removeData(for: key) }
        #expect(try store.string(for: key) == "geheim")
        try store.setString("geändert", for: key)
        #expect(try store.string(for: key) == "geändert")
        try store.removeData(for: key)
        #expect(try store.string(for: key) == nil)
    }
    #endif
}
