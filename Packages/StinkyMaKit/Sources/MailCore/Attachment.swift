/// Ein Anhang einer Mail (Spezifikation 7.8 und 8).
public struct Attachment: Identifiable, Hashable, Sendable {
    public var id: String
    public var messageID: String
    public var filename: String
    public var mimeType: String
    public var size: Int
    public var localPath: String?
    public var sha256: String?
    public var isInline: Bool
    public var contentID: String?
    public var pageCount: Int?
    public var isEncrypted: Bool
    public var relevance: AttachmentRelevance?
    public var relevanceReason: String?
    public var documentType: String?
    public var analysisStatus: AttachmentAnalysisStatus
    public var riskFlags: AttachmentRiskFlags

    public init(
        id: String,
        messageID: String,
        filename: String,
        mimeType: String,
        size: Int,
        localPath: String? = nil,
        sha256: String? = nil,
        isInline: Bool = false,
        contentID: String? = nil,
        pageCount: Int? = nil,
        isEncrypted: Bool = false,
        relevance: AttachmentRelevance? = nil,
        relevanceReason: String? = nil,
        documentType: String? = nil,
        analysisStatus: AttachmentAnalysisStatus = .pending,
        riskFlags: AttachmentRiskFlags = []
    ) {
        self.id = id
        self.messageID = messageID
        self.filename = filename
        self.mimeType = mimeType
        self.size = size
        self.localPath = localPath
        self.sha256 = sha256
        self.isInline = isInline
        self.contentID = contentID
        self.pageCount = pageCount
        self.isEncrypted = isEncrypted
        self.relevance = relevance
        self.relevanceReason = relevanceReason
        self.documentType = documentType
        self.analysisStatus = analysisStatus
        self.riskFlags = riskFlags
    }

    /// Dateiendung in Kleinbuchstaben ohne Punkt (`pdf`), leer wenn keine vorhanden.
    public var fileExtension: String {
        guard let dot = filename.lastIndex(of: "."), dot != filename.startIndex else { return "" }
        return filename[filename.index(after: dot)...].lowercased()
    }
}

public enum AttachmentRelevance: String, Hashable, Sendable, Codable, CaseIterable {
    case central, supporting, irrelevant
}

public enum AttachmentAnalysisStatus: String, Hashable, Sendable, Codable, CaseIterable {
    case pending, skipped, analyzed, locked, failed
}

/// Sicherheitswarnungen für Anhänge (Spezifikation 7.8.4).
public struct AttachmentRiskFlags: OptionSet, Hashable, Sendable, Codable {
    public let rawValue: Int

    public init(rawValue: Int) {
        self.rawValue = rawValue
    }

    public static let executable = AttachmentRiskFlags(rawValue: 1 << 0)
    public static let macroDocument = AttachmentRiskFlags(rawValue: 1 << 1)
    public static let doubleExtension = AttachmentRiskFlags(rawValue: 1 << 2)
    public static let encryptedArchiveFromUnknownSender = AttachmentRiskFlags(rawValue: 1 << 3)
    public static let htmlWithLoginForm = AttachmentRiskFlags(rawValue: 1 << 4)
}
