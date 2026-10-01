/// Welche Mails eine Liste zeigt: gemeinsamer Posteingang, intelligente Ansichten oder ein Ordner.
public enum MessageScope: Hashable, Sendable {
    /// Posteingänge aller Konten.
    case unifiedInbox
    /// Ungelesene Mails aus allen Posteingängen.
    case unread
    /// Markierte Mails aller Konten, egal in welchem Ordner.
    case flagged
    /// Ein bestimmter Ordner.
    case mailbox(id: String)
}
