import Foundation
import GRDB
import MailCore

// Abbildung der MailCore-Modelle auf Tabellen. Explizit statt Codable, damit Spaltennamen
// und Formate (Enums als Text, Adresslisten als JSON) stabil und nachvollziehbar bleiben.

extension Account: FetchableRecord, PersistableRecord {
    public static let databaseTableName = "account"

    public init(row: Row) throws {
        self.init(
            id: row["id"],
            email: row["email"],
            displayName: row["displayName"],
            provider: MailProvider(rawValue: row["provider"]) ?? .genericIMAP,
            username: (row["username"] as String?).flatMap { $0.isEmpty ? nil : $0 },
            imapHost: row["imapHost"],
            imapPort: row["imapPort"],
            imapSecurity: ConnectionSecurity(rawValue: row["imapSecurity"] ?? "") ?? .tls,
            smtpHost: row["smtpHost"],
            smtpPort: row["smtpPort"],
            smtpSecurity: ConnectionSecurity(rawValue: row["smtpSecurity"] ?? "") ?? .starttls,
            authType: AuthType(rawValue: row["authType"]) ?? .password,
            color: AccountColor(rawValue: row["color"]) ?? .blue,
            aiCloudAllowed: row["aiCloudAllowed"],
            sortOrder: row["sortOrder"],
            lastSyncAt: row["lastSyncAt"],
            syncError: row["syncError"]
        )
    }

    public func encode(to container: inout PersistenceContainer) throws {
        container["id"] = id
        container["email"] = email
        container["displayName"] = displayName
        container["provider"] = provider.rawValue
        container["username"] = username
        container["imapHost"] = imapHost
        container["imapPort"] = imapPort
        container["imapSecurity"] = imapSecurity.rawValue
        container["smtpHost"] = smtpHost
        container["smtpPort"] = smtpPort
        container["smtpSecurity"] = smtpSecurity.rawValue
        container["authType"] = authType.rawValue
        container["color"] = color.rawValue
        container["aiCloudAllowed"] = aiCloudAllowed
        container["sortOrder"] = sortOrder
        container["lastSyncAt"] = lastSyncAt
        container["syncError"] = syncError
    }
}

extension Mailbox: FetchableRecord, PersistableRecord {
    public static let databaseTableName = "mailbox"

    public init(row: Row) throws {
        let uidValidity: Int64? = row["uidValidity"]
        let highestModSeq: Int64? = row["highestModSeq"]
        self.init(
            id: row["id"],
            accountID: row["accountId"],
            name: row["name"],
            role: MailboxRole(rawValue: row["role"]) ?? .custom,
            uidValidity: uidValidity.map { UInt32(truncatingIfNeeded: $0) },
            highestModSeq: highestModSeq.map { UInt64(bitPattern: $0) }
        )
    }

    public func encode(to container: inout PersistenceContainer) throws {
        container["id"] = id
        container["accountId"] = accountID
        container["name"] = name
        container["role"] = role.rawValue
        container["uidValidity"] = uidValidity.map { Int64($0) }
        container["highestModSeq"] = highestModSeq.map { Int64(bitPattern: $0) }
    }
}

extension MailThread: FetchableRecord, PersistableRecord {
    public static let databaseTableName = "thread"

    public init(row: Row) throws {
        self.init(
            id: row["id"],
            subject: row["subject"],
            participants: try JSONColumn.decode([EmailAddress].self, from: row["participants"]),
            lastDate: row["lastDate"],
            summary: row["summary"],
            summaryUpdatedAt: row["summaryUpdatedAt"]
        )
    }

    public func encode(to container: inout PersistenceContainer) throws {
        container["id"] = id
        container["subject"] = subject
        container["participants"] = try JSONColumn.encode(participants)
        container["lastDate"] = lastDate
        container["summary"] = summary
        container["summaryUpdatedAt"] = summaryUpdatedAt
    }
}

extension Message: FetchableRecord, PersistableRecord {
    public static let databaseTableName = "message"

    public init(row: Row) throws {
        let uid: Int64? = row["uid"]
        let category: String? = row["category"]
        self.init(
            id: row["id"],
            accountID: row["accountId"],
            mailboxID: row["mailboxId"],
            uid: uid.map { UInt32(truncatingIfNeeded: $0) },
            messageID: row["messageId"],
            threadID: row["threadId"],
            from: EmailAddress(name: row["fromName"], address: row["fromAddress"]),
            to: try JSONColumn.decode([EmailAddress].self, from: row["to"]),
            cc: try JSONColumn.decode([EmailAddress].self, from: row["cc"]),
            subject: row["subject"],
            date: row["date"],
            snippet: row["snippet"],
            bodyText: row["bodyText"],
            bodyHTML: row["bodyHTML"],
            flags: MessageFlags(rawValue: row["flags"]),
            hasAttachments: row["hasAttachments"],
            category: category.flatMap(MessageCategory.init(rawValue:)),
            priorityScore: row["priorityScore"],
            snoozedUntil: row["snoozedUntil"]
        )
    }

    public func encode(to container: inout PersistenceContainer) throws {
        container["id"] = id
        container["accountId"] = accountID
        container["mailboxId"] = mailboxID
        container["uid"] = uid.map { Int64($0) }
        container["messageId"] = messageID
        container["threadId"] = threadID
        container["fromName"] = from.name
        container["fromAddress"] = from.address
        container["to"] = try JSONColumn.encode(to)
        container["cc"] = try JSONColumn.encode(cc)
        container["subject"] = subject
        container["date"] = date
        container["snippet"] = snippet
        container["bodyText"] = bodyText
        container["bodyHTML"] = bodyHTML
        container["flags"] = flags.rawValue
        container["hasAttachments"] = hasAttachments
        container["category"] = category?.rawValue
        container["priorityScore"] = priorityScore
        container["snoozedUntil"] = snoozedUntil
    }
}

extension Attachment: FetchableRecord, PersistableRecord {
    public static let databaseTableName = "attachment"

    public init(row: Row) throws {
        let relevance: String? = row["relevance"]
        self.init(
            id: row["id"],
            messageID: row["messageId"],
            filename: row["filename"],
            mimeType: row["mimeType"],
            size: row["size"],
            localPath: row["localPath"],
            sha256: row["sha256"],
            isInline: row["isInline"],
            contentID: row["contentId"],
            pageCount: row["pageCount"],
            isEncrypted: row["isEncrypted"],
            relevance: relevance.flatMap(AttachmentRelevance.init(rawValue:)),
            relevanceReason: row["relevanceReason"],
            documentType: row["documentType"],
            analysisStatus: AttachmentAnalysisStatus(rawValue: row["analysisStatus"]) ?? .pending,
            riskFlags: AttachmentRiskFlags(rawValue: row["riskFlags"])
        )
    }

    public func encode(to container: inout PersistenceContainer) throws {
        container["id"] = id
        container["messageId"] = messageID
        container["filename"] = filename
        container["mimeType"] = mimeType
        container["size"] = size
        container["localPath"] = localPath
        container["sha256"] = sha256
        container["isInline"] = isInline
        container["contentId"] = contentID
        container["pageCount"] = pageCount
        container["isEncrypted"] = isEncrypted
        container["relevance"] = relevance?.rawValue
        container["relevanceReason"] = relevanceReason
        container["documentType"] = documentType
        container["analysisStatus"] = analysisStatus.rawValue
        container["riskFlags"] = riskFlags.rawValue
    }
}

/// JSON-Spalten (z. B. Adresslisten) als UTF-8-Text.
enum JSONColumn {
    static func encode<T: Encodable>(_ value: T) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return String(decoding: try encoder.encode(value), as: UTF8.self)
    }

    static func decode<T: Decodable>(_ type: T.Type, from text: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(text.utf8))
    }
}
