import Foundation

/// Schlüssel für ein Geheimnis im sicheren Speicher (Keychain auf Apple-Geräten).
public struct SecretKey: Hashable, Sendable {
    /// Art des Geheimnisses, z. B. `account-password`.
    public var service: String
    /// Worauf es sich bezieht, z. B. die Konto-ID.
    public var account: String

    public init(service: String, account: String) {
        self.service = service
        self.account = account
    }

    /// Passwort bzw. app-spezifisches Passwort eines Mail-Kontos.
    public static func accountPassword(accountID: String) -> SecretKey {
        SecretKey(service: "account-password", account: accountID)
    }

    /// OAuth-Refresh-Token eines Mail-Kontos.
    public static func oauthRefreshToken(accountID: String) -> SecretKey {
        SecretKey(service: "oauth-refresh-token", account: accountID)
    }

    /// API-Key eines KI-Anbieters, z. B. `anthropic`.
    public static func aiAPIKey(providerID: String) -> SecretKey {
        SecretKey(service: "ai-api-key", account: providerID)
    }

    /// Für einen Absender gemerktes Passwort für Anhänge (Spezifikation 7.8.2).
    public static func attachmentPassword(sender: String) -> SecretKey {
        SecretKey(service: "attachment-password", account: sender.lowercased())
    }
}

public enum SecretStoreError: Error, Equatable, Sendable {
    /// Der Plattform-Speicher meldet einen Fehler, z. B. einen Keychain-`OSStatus`.
    case platform(status: Int32)
    case invalidEncoding
}

/// Sicherer Speicher für Passwörter, Tokens und API-Keys. Inhalte werden nie geloggt.
public protocol SecretStore: Sendable {
    func setData(_ data: Data, for key: SecretKey) throws
    func data(for key: SecretKey) throws -> Data?
    func removeData(for key: SecretKey) throws
}

extension SecretStore {
    public func setString(_ value: String, for key: SecretKey) throws {
        try setData(Data(value.utf8), for: key)
    }

    public func string(for key: SecretKey) throws -> String? {
        guard let data = try data(for: key) else { return nil }
        guard let string = String(data: data, encoding: .utf8) else {
            throw SecretStoreError.invalidEncoding
        }
        return string
    }
}
