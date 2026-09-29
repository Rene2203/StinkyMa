import Foundation
import MailCore
import MailStore
import PlatformServices

/// Alle Dienste, die die Oberfläche braucht. Wird beim Start einmal erzeugt und injiziert.
public struct AppEnvironment: Sendable {
    public var repository: any MailRepository
    public var secrets: any SecretStore

    public init(repository: any MailRepository, secrets: any SecretStore) {
        self.repository = repository
        self.secrets = secrets
    }

    /// Phase 1: Datenbank im Arbeitsspeicher mit erfundenen Beispielmails, Geheimnisse nur im Speicher.
    public static func mock(now: Date = Date()) throws -> AppEnvironment {
        let database = try MailDatabase.inMemory()
        try MockData.seedIfEmpty(database, now: now)
        return AppEnvironment(
            repository: GRDBMailRepository(database: database),
            secrets: InMemorySecretStore()
        )
    }
}
