import Foundation

/// Ein eingerichtetes Mail-Konto.
public struct Account: Identifiable, Hashable, Sendable {
    public var id: String
    public var email: String
    public var displayName: String
    public var provider: MailProvider
    public var imapHost: String
    public var imapPort: Int
    public var smtpHost: String
    public var smtpPort: Int
    public var authType: AuthType
    public var color: AccountColor
    /// Nutzer-Freigabe: Darf eine Cloud-KI Mails dieses Kontos verarbeiten? Standard: nein (Spezifikation 5.0).
    public var aiCloudAllowed: Bool
    public var sortOrder: Int

    public init(
        id: String = UUID().uuidString.lowercased(),
        email: String,
        displayName: String,
        provider: MailProvider,
        imapHost: String,
        imapPort: Int = 993,
        smtpHost: String,
        smtpPort: Int = 587,
        authType: AuthType,
        color: AccountColor,
        aiCloudAllowed: Bool = false,
        sortOrder: Int = 0
    ) {
        self.id = id
        self.email = email
        self.displayName = displayName
        self.provider = provider
        self.imapHost = imapHost
        self.imapPort = imapPort
        self.smtpHost = smtpHost
        self.smtpPort = smtpPort
        self.authType = authType
        self.color = color
        self.aiCloudAllowed = aiCloudAllowed
        self.sortOrder = sortOrder
    }
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
