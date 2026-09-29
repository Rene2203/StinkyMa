import AppFeature
import MailCore
import SwiftUI

// Übersetzung der plattformneutralen Modelle in Texte, Symbole und Farben.
// Texte stehen hier als deutsche Schlüssel; Übersetzungen liegen in Localizable.xcstrings.

extension AccountColor {
    var color: Color {
        switch self {
        case .blue: .blue
        case .green: .green
        case .orange: .orange
        case .purple: .purple
        case .pink: .pink
        case .teal: .teal
        case .red: .red
        case .yellow: .yellow
        }
    }
}

extension MailboxRole {
    var title: LocalizedStringResource {
        switch self {
        case .inbox: "Posteingang"
        case .sent: "Gesendet"
        case .drafts: "Entwürfe"
        case .trash: "Papierkorb"
        case .archive: "Archiv"
        case .spam: "Spam"
        case .custom: "Ordner"
        }
    }

    var systemImage: String {
        switch self {
        case .inbox: "tray"
        case .sent: "paperplane"
        case .drafts: "doc"
        case .trash: "trash"
        case .archive: "archivebox"
        case .spam: "xmark.bin"
        case .custom: "folder"
        }
    }
}

extension SidebarItem {
    var title: Text {
        switch kind {
        case .unifiedInbox: Text("Alle Posteingänge")
        case .unread: Text("Ungelesen")
        case .flagged: Text("Markiert")
        case .mailbox(let mailbox) where mailbox.role == .custom: Text(verbatim: mailbox.name)
        case .mailbox(let mailbox): Text(mailbox.role.title)
        }
    }

    var systemImage: String {
        switch kind {
        case .unifiedInbox: "tray.2"
        case .unread: "envelope.badge"
        case .flagged: "flag"
        case .mailbox(let mailbox): mailbox.role.systemImage
        }
    }
}

extension MessageCategory {
    var title: LocalizedStringResource {
        switch self {
        case .personal: "Persönlich"
        case .work: "Arbeit"
        case .newsletter: "Newsletter"
        case .notification: "Benachrichtigung"
        case .invoice: "Rechnung"
        case .appointment: "Termin"
        case .spamSuspect: "Spam-Verdacht"
        }
    }

    var systemImage: String {
        switch self {
        case .personal: "person"
        case .work: "briefcase"
        case .newsletter: "newspaper"
        case .notification: "bell"
        case .invoice: "eurosign.circle"
        case .appointment: "calendar"
        case .spamSuspect: "exclamationmark.shield"
        }
    }

    var tint: Color {
        switch self {
        case .personal: .blue
        case .work: .indigo
        case .newsletter: .teal
        case .notification: .gray
        case .invoice: .green
        case .appointment: .orange
        case .spamSuspect: .red
        }
    }
}

extension Attachment {
    var systemImage: String {
        switch fileExtension {
        case "pdf": "doc.richtext"
        case "jpg", "jpeg", "png", "heic", "gif", "tiff", "webp": "photo"
        case "doc", "docx", "pages", "rtf", "txt", "md": "doc.text"
        case "xls", "xlsx", "numbers", "csv": "tablecells"
        case "ppt", "pptx", "key": "rectangle.on.rectangle"
        case "zip": "doc.zipper"
        case "ics": "calendar"
        case "vcf": "person.crop.rectangle"
        case "m4a", "mp3", "wav": "waveform"
        case "mp4", "mov": "film"
        default: "doc"
        }
    }
}
