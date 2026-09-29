import Foundation
import GRDB

/// Die lokale SQLite-Datenbank der App (GRDB). Hält Mails, Threads, Anhänge und KI-Daten.
public final class MailDatabase: Sendable {
    public let writer: any DatabaseWriter

    /// Öffnet die Datenbank und bringt das Schema per Migration auf den neuesten Stand.
    public init(writer: any DatabaseWriter) throws {
        self.writer = writer
        try MailSchema.migrator.migrate(writer)
    }

    /// Datenbank im Arbeitsspeicher – für Tests, Vorschauen und den Mock-Modus.
    public static func inMemory() throws -> MailDatabase {
        try MailDatabase(writer: DatabaseQueue(configuration: configuration()))
    }

    /// Datenbank als Datei. Legt fehlende Ordner an.
    public static func open(at url: URL) throws -> MailDatabase {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        return try MailDatabase(writer: DatabasePool(path: url.path, configuration: configuration()))
    }

    static func configuration() -> Configuration {
        var configuration = Configuration()
        configuration.foreignKeysEnabled = true
        configuration.label = "MailDatabase"
        return configuration
    }
}
