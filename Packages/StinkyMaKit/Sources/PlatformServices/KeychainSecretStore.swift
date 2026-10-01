#if canImport(Security)
import Foundation
import MailCore
import Security

/// `SecretStore` auf Basis der Keychain (generische Passwörter).
///
/// - Einträge sind nur auf diesem Gerät gültig (`…ThisDeviceOnly`) und werden nicht per iCloud-Schlüsselbund synchronisiert.
/// - Zugriff ab dem ersten Entsperren nach dem Neustart, damit der Hintergrund-Sync Passwörter lesen kann.
public struct KeychainSecretStore: SecretStore {
    /// Präfix für `kSecAttrService`, z. B. die Bundle-ID.
    public let servicePrefix: String
    /// Optionale Keychain-Zugriffsgruppe, z. B. für Widgets und Erweiterungen.
    public let accessGroup: String?

    public init(servicePrefix: String, accessGroup: String? = nil) {
        self.servicePrefix = servicePrefix
        self.accessGroup = accessGroup
    }

    public func setData(_ data: Data, for key: SecretKey) throws {
        let query = baseQuery(for: key)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        switch status {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            let attributes = query.merging(update) { _, new in new }
            let addStatus = SecItemAdd(attributes as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw SecretStoreError.platform(status: addStatus) }
        default:
            throw SecretStoreError.platform(status: status)
        }
    }

    public func data(for key: SecretKey) throws -> Data? {
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            return result as? Data
        case errSecItemNotFound:
            return nil
        default:
            throw SecretStoreError.platform(status: status)
        }
    }

    public func removeData(for key: SecretKey) throws {
        let status = SecItemDelete(baseQuery(for: key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw SecretStoreError.platform(status: status)
        }
    }

    private func baseQuery(for key: SecretKey) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "\(servicePrefix).\(key.service)",
            kSecAttrAccount as String: key.account,
            // Auf dem Mac den modernen Data-Protection-Keychain nutzen (wie auf iOS).
            kSecUseDataProtectionKeychain as String: true,
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        return query
    }
}
#endif
