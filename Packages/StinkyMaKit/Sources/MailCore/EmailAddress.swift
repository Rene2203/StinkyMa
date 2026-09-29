import Foundation

/// Eine Mail-Adresse mit optionalem Anzeigenamen, z. B. `"Anna Beispiel" <anna@example.org>`.
public struct EmailAddress: Hashable, Sendable, Codable {
    public var name: String?
    public var address: String

    public init(name: String? = nil, address: String) {
        self.name = name
        self.address = address
    }

    /// Anzeigename, falls vorhanden und nicht leer, sonst die Adresse.
    public var displayName: String {
        if let name, !name.trimmingCharacters(in: .whitespaces).isEmpty {
            return name
        }
        return address
    }

    /// Domain-Teil der Adresse in Kleinbuchstaben (`example.org`), oder `nil` ohne `@`.
    public var domain: String? {
        guard let at = address.lastIndex(of: "@") else { return nil }
        let domain = address[address.index(after: at)...]
        return domain.isEmpty ? nil : domain.lowercased()
    }
}

extension EmailAddress {
    /// Bis zu zwei Initialen für Avatare, z. B. „AB“ für „Anna Beispiel“ oder „A“ für `anna@…`.
    public var initials: String {
        let source = displayName == address ? String(address.prefix { $0 != "@" }) : displayName
        let words = source
            .split { $0.isWhitespace || $0 == "." || $0 == "-" || $0 == "_" }
            .filter { $0.first?.isLetter == true }
        let letters = words.count >= 2 ? [words[0], words[words.count - 1]] : Array(words.prefix(1))
        let result = letters.compactMap(\.first).map { String($0).uppercased() }.joined()
        return result.isEmpty ? "?" : result
    }
}
