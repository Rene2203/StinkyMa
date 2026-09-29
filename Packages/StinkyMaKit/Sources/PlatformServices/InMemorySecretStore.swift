import Foundation
import MailCore
import Synchronization

/// Flüchtiger Speicher für Geheimnisse – für Tests, Vorschauen und den Mock-Modus.
public final class InMemorySecretStore: SecretStore {
    private let storage = Mutex<[SecretKey: Data]>([:])

    public init() {}

    public func setData(_ data: Data, for key: SecretKey) throws {
        storage.withLock { $0[key] = data }
    }

    public func data(for key: SecretKey) throws -> Data? {
        storage.withLock { $0[key] }
    }

    public func removeData(for key: SecretKey) throws {
        _ = storage.withLock { $0.removeValue(forKey: key) }
    }
}
