import Foundation

/// Ein eingerichtetes Mail-Konto.
public struct Account: Identifiable, Hashable, Sendable {
    public var id: String
    public var email: String
    public var displayName: String
    public var provider: MailProvider
    /// Anmeldename am Server; meist die Mail-Adresse.
    public var username: String
    public var imapHost: String
    public var imapPort: Int
    public var imapSecurity: ConnectionSecurity
    public var smtpHost: String
    public var smtpPort: Int
    public var smtpSecurity: ConnectionSecurity
    public var authType: AuthType
    public var color: AccountColor
    /// Nutzer-Freigabe: Darf eine Cloud-KI Mails dieses Kontos verarbeiten? Standard: nein (Spezifikation 5.0).
    public var aiCloudAllowed: Bool
    public var sortOrder: Int
    /// Letzter erfolgreicher Abgleich, `nil` = noch nie.
    public var lastSyncAt: Date?
    /// Letzter Fehler beim Abgleich, `nil` = alles gut.
    public var syncError: String?

    public init(
        id: String = UUID().uuidString.lowercased(),
        email: String,
        displayName: String,
        provider: MailProvider,
        username: String? = nil,
        imapHost: String,
        imapPort: Int = 993,
        imapSecurity: ConnectionSecurity = .tls,
        smtpHost: String,
        smtpPort: Int = 587,
        smtpSecurity: ConnectionSecurity = .starttls,
        authType: AuthType,
        color: AccountColor,
        aiCloudAllowed: Bool = false,
        sortOrder: Int = 0,
        lastSyncAt: Date? = nil,
        syncError: String? = nil
    ) {
        self.id = id
        self.email = email
        self.displayName = displayName
        self.provider = provider
        self.username = username ?? email
        self.imapHost = imapHost
        self.imapPort = imapPort
        self.imapSecurity = imapSecurity
        self.smtpHost = smtpHost
        self.smtpPort = smtpPort
        self.smtpSecurity = smtpSecurity
        self.authType = authType
        self.color = color
        self.aiCloudAllowed = aiCloudAllowed
        self.sortOrder = sortOrder
        self.lastSyncAt = lastSyncAt
        self.syncError = syncError
    }
}

/// Verbindungssicherheit: TLS ab Verbindungsbeginn (993/465), STARTTLS (143/587) oder – nur für Tests – ohne.
public enum ConnectionSecurity: String, Hashable, Sendable, Codable, CaseIterable {
    case tls
    case starttls
    case none
}

public enum MailProvider: String, Hashable, Sendable, Codable, CaseIterable {
    case iCloud = "icloud"
    case gmail
    case outlook
    case yahoo
    case genericIMAP = "imap"
}

public enum AuthType: String, Hashable, Sendable, Codable, CaseIterable {
    /// Passwort bzw. app-spezifisches Passwort (iCloud, Yahoo, GMX …).
    case password
    /// OAuth2 mit XOAUTH2 (Gmail, Outlook).
    case oauth2
}

/// Farbe eines Kontos in Liste und Seitenleiste. Plattformneutral; die UI bildet sie auf echte Farben ab.
public enum AccountColor: String, Hashable, Sendable, Codable, CaseIterable {
    case blue, green, orange, purple, pink, teal, red, yellow
}
