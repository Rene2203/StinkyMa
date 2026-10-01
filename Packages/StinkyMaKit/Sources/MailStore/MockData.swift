import Foundation
import GRDB
import MailCore

/// Erfundene Beispieldaten für Phase 1 (Mock-Posteingang), Vorschauen und Tests.
/// Alle Namen, Firmen und Adressen sind ausgedacht; Domains enden auf `.example`.
public enum MockData {
    public static let iCloudAccountID = "mock-icloud"
    public static let gmailAccountID = "mock-gmail"
    public static let workAccountID = "mock-work"

    /// Mailbox-ID eines Mock-Kontos für eine Rolle, z. B. `mock-icloud-inbox`.
    public static func mailboxID(_ accountID: String, _ role: MailboxRole) -> String {
        "\(accountID)-\(role.rawValue)"
    }

    /// Befüllt eine leere Datenbank. Enthält sie schon Konten, passiert nichts.
    /// - Parameter now: Bezugszeitpunkt, relativ zu dem alle Datumsangaben erzeugt werden.
    public static func seedIfEmpty(_ database: MailDatabase, now: Date = Date()) throws {
        try database.writer.write { db in
            guard try Account.fetchCount(db) == 0 else { return }
            try seed(db, now: now)
        }
    }

    // MARK: - Inhalt

    private static let me = (
        privat: EmailAddress(name: "Anna Beispiel", address: "anna.beispiel@icloud.example"),
        gmail: EmailAddress(name: "Anna Beispiel", address: "anna.beispiel@gmail.example"),
        work: EmailAddress(name: "Anna Beispiel", address: "anna@beispiel-agentur.example")
    )

    private static func seed(_ db: Database, now: Date) throws {
        func ago(days: Double = 0, hours: Double = 0, minutes: Double = 0) -> Date {
            now.addingTimeInterval(-(days * 86_400 + hours * 3_600 + minutes * 60))
        }

        let accounts = [
            Account(
                id: iCloudAccountID, email: me.privat.address, displayName: "Privat",
                provider: .iCloud, imapHost: "imap.mail.me.com", smtpHost: "smtp.mail.me.com",
                authType: .password, color: .blue, sortOrder: 0
            ),
            Account(
                id: gmailAccountID, email: me.gmail.address, displayName: "Gmail",
                provider: .gmail, imapHost: "imap.gmail.com", smtpHost: "smtp.gmail.com",
                authType: .oauth2, color: .red, sortOrder: 1
            ),
            Account(
                id: workAccountID, email: me.work.address, displayName: "Agentur",
                provider: .genericIMAP, imapHost: "imap.beispiel-agentur.example", smtpHost: "smtp.beispiel-agentur.example",
                authType: .password, color: .green, sortOrder: 2
            ),
        ]
        let standardFolders: [(MailboxRole, String)] = [
            (.inbox, "INBOX"), (.drafts, "Entwürfe"), (.sent, "Gesendet"),
            (.archive, "Archiv"), (.spam, "Spam"), (.trash, "Papierkorb"),
        ]
        for account in accounts {
            try account.insert(db)
            for (role, name) in standardFolders {
                try Mailbox(id: mailboxID(account.id, role), accountID: account.id, name: name, role: role).insert(db)
            }
        }
        try Mailbox(id: "\(iCloudAccountID)-finanzen", accountID: iCloudAccountID, name: "Finanzen", role: .custom).insert(db)

        var builder = Builder(db: db)

        // --- Privat (iCloud) ---
        let grill = EmailAddress(name: "Jonas Weber", address: "jonas.weber@post.example")
        try builder.add(
            thread: "grillabend", account: iCloudAccountID, role: .inbox, from: grill, to: [me.privat],
            subject: "Grillabend am Samstag", date: ago(days: 1, hours: 3), flags: [.seen, .answered],
            category: .personal,
            body: """
                Hi Anna,

                wir grillen am Samstag ab 18 Uhr bei uns im Garten. Kommst du? Bring gern jemanden mit.
                Falls du einen Salat mitbringen könntest, wäre das super.

                Viele Grüße
                Jonas
                """
        )
        try builder.add(
            thread: "grillabend", account: iCloudAccountID, role: .sent, from: me.privat, to: [grill],
            subject: "Re: Grillabend am Samstag", date: ago(days: 1, hours: 1), flags: [.seen],
            category: .personal,
            body: """
                Hallo Jonas,

                ich bin dabei! Ich bringe einen Nudelsalat mit und schicke dir bis Freitag noch Bescheid, ob Lea auch kommt.

                Bis Samstag
                Anna
                """
        )
        try builder.add(
            thread: "grillabend", account: iCloudAccountID, role: .inbox, from: grill, to: [me.privat],
            subject: "Re: Grillabend am Samstag", date: ago(hours: 2), flags: [],
            category: .personal,
            body: """
                Super, freut mich! Nudelsalat klingt perfekt.

                Jonas
                """
        )

        let stadtwerke = EmailAddress(name: "Stadtwerke Musterstadt", address: "rechnung@stadtwerke-musterstadt.example")
        try builder.add(
            thread: "abschlag", account: iCloudAccountID, role: .inbox, from: stadtwerke, to: [me.privat],
            subject: "Ihre Abschlagsrechnung Oktober", date: ago(hours: 5), flags: [.flagged],
            category: .invoice,
            body: """
                Sehr geehrte Frau Beispiel,

                anbei erhalten Sie Ihre Abschlagsrechnung für Oktober. Der Betrag von 86,00 € wird am 15.10. von Ihrem Konto abgebucht.

                Mit freundlichen Grüßen
                Ihre Stadtwerke Musterstadt
                """,
            attachments: [
                .init(filename: "Rechnung_2026-10.pdf", mimeType: "application/pdf", size: 84_213, pageCount: 2),
                .init(filename: "AGB.pdf", mimeType: "application/pdf", size: 212_004, pageCount: 6),
            ]
        )

        let streaming = EmailAddress(name: "Streamflix", address: "no-reply@streamflix.example")
        try builder.add(
            thread: "probeabo", account: iCloudAccountID, role: .inbox, from: streaming, to: [me.privat],
            subject: "Dein Probeabo endet in 3 Tagen", date: ago(days: 2), flags: [],
            category: .notification,
            body: """
                Hallo Anna,

                dein kostenloses Probeabo endet in 3 Tagen. Danach kostet dein Abo 12,99 € im Monat.
                Du kannst jederzeit in deinem Konto kündigen.

                Dein Streamflix-Team
                """
        )

        let newsletter = EmailAddress(name: "Tech-Briefing", address: "briefing@tech-briefing.example")
        try builder.add(
            thread: "briefing", account: iCloudAccountID, role: .inbox, from: newsletter, to: [me.privat],
            subject: "Wochenrückblick: KI auf dem Gerät und Datenschutz", date: ago(days: 3), flags: [.seen],
            category: .newsletter,
            body: """
                Die Themen der Woche: Warum lokale Sprachmodelle auf Tablets immer besser werden, \
                was neue Datenschutzregeln für Apps bedeuten und drei Tipps für ein aufgeräumtes Postfach.
                """
        )

        let paket = EmailAddress(name: "Paketblitz", address: "info@paketblitz.example")
        try builder.add(
            thread: "paket", account: iCloudAccountID, role: .inbox, from: paket, to: [me.privat],
            subject: "Deine Sendung ist unterwegs", date: ago(days: 1, hours: 8), flags: [.seen],
            category: .notification,
            body: """
                Deine Sendung PB 4711 0815 42 ist unterwegs und wird voraussichtlich morgen zwischen 10 und 14 Uhr zugestellt.
                """
        )

        let phishing = EmailAddress(name: "Sicherheitsteam", address: "service@konto-sicherung.example")
        try builder.add(
            thread: "phishing", account: iCloudAccountID, role: .inbox, from: phishing, to: [me.privat],
            subject: "Dringend: Ihr Konto wurde gesperrt", date: ago(days: 4), flags: [],
            category: .spamSuspect,
            body: """
                Sehr geehrter Kunde,

                wir haben ungewöhnliche Aktivitäten festgestellt. Bestätigen Sie innerhalb von 24 Stunden Ihre Daten, \
                sonst wird Ihr Konto endgültig gelöscht.
                """
        )

        try builder.add(
            thread: "steuer", account: iCloudAccountID, role: .archive,
            from: EmailAddress(name: "Steuerbüro Klar", address: "kanzlei@steuerbuero-klar.example"), to: [me.privat],
            subject: "Unterlagen für die Steuererklärung 2025", date: ago(days: 40), flags: [.seen],
            category: .personal,
            body: """
                Liebe Frau Beispiel,

                bitte senden Sie uns bis Ende des Monats Ihre Belege für Arbeitsmittel und Handwerkerleistungen.

                Freundliche Grüße
                Steuerbüro Klar
                """
        )

        // --- Gmail ---
        let mama = EmailAddress(name: "Mama", address: "gabi.beispiel@post.example")
        try builder.add(
            thread: "fotos", account: gmailAccountID, role: .inbox, from: mama, to: [me.gmail],
            subject: "Fotos vom Wochenende", date: ago(minutes: 45), flags: [],
            category: .personal,
            body: """
                Hallo mein Schatz,

                hier die Fotos vom Wochenende am See. Das Wetter war herrlich!

                Liebe Grüße, Mama
                """,
            attachments: [
                .init(filename: "IMG_2041.heic", mimeType: "image/heic", size: 2_431_120),
                .init(filename: "IMG_2044.heic", mimeType: "image/heic", size: 2_118_502),
            ]
        )

        let praxis = EmailAddress(name: "Praxis Dr. Sonnenschein", address: "termine@praxis-sonnenschein.example")
        try builder.add(
            thread: "arzt", account: gmailAccountID, role: .inbox, from: praxis, to: [me.gmail],
            subject: "Terminerinnerung: Dienstag, 9:30 Uhr", date: ago(hours: 20), flags: [.seen],
            category: .appointment,
            body: """
                Wir erinnern Sie an Ihren Termin am Dienstag um 9:30 Uhr. Bitte bringen Sie Ihre Versichertenkarte mit.
                """
        )

        let hausverwaltung = EmailAddress(name: "Hausverwaltung Nord", address: "abrechnung@hv-nord.example")
        try builder.add(
            thread: "nebenkosten", account: gmailAccountID, role: .inbox, from: hausverwaltung, to: [me.gmail],
            subject: "Nebenkostenabrechnung 2025", date: ago(days: 2, hours: 4), flags: [],
            category: .invoice,
            body: """
                Sehr geehrte Frau Beispiel,

                anbei die Nebenkostenabrechnung für 2025. Es ergibt sich eine Nachzahlung von 142,37 €, \
                fällig bis zum 31.10.

                Mit freundlichen Grüßen
                Hausverwaltung Nord
                """,
            attachments: [
                .init(filename: "Nebenkosten_2025.pdf", mimeType: "application/pdf", size: 156_880, pageCount: 4),
            ]
        )

        try builder.add(
            thread: "verein", account: gmailAccountID, role: .inbox,
            from: EmailAddress(name: "TSV Musterstadt", address: "news@tsv-musterstadt.example"), to: [me.gmail],
            subject: "Vereinsnachrichten September", date: ago(days: 5), flags: [.seen],
            category: .newsletter,
            body: "Neue Kurszeiten, das Sommerfest im Rückblick und die Termine für die Hallensaison."
        )

        // --- Arbeit ---
        let kundin = EmailAddress(name: "Petra Schulz", address: "p.schulz@moebelhaus-schulz.example")
        try builder.add(
            thread: "relaunch", account: workAccountID, role: .inbox, from: kundin, to: [me.work],
            subject: "Angebot Website-Relaunch", date: ago(days: 3, hours: 2), flags: [.seen, .answered],
            category: .work,
            body: """
                Hallo Frau Beispiel,

                wie besprochen würden wir gern unsere Website neu aufsetzen. Können Sie uns ein Angebot schicken?

                Viele Grüße
                Petra Schulz
                """
        )
        try builder.add(
            thread: "relaunch", account: workAccountID, role: .sent, from: me.work, to: [kundin],
            subject: "Re: Angebot Website-Relaunch", date: ago(days: 2, hours: 22), flags: [.seen],
            category: .work,
            body: """
                Hallo Frau Schulz,

                sehr gern. Ich schicke Ihnen das Angebot bis Freitag.

                Beste Grüße
                Anna Beispiel
                """
        )
        try builder.add(
            thread: "relaunch", account: workAccountID, role: .inbox, from: kundin, to: [me.work],
            subject: "Re: Angebot Website-Relaunch", date: ago(hours: 1), flags: [],
            category: .work,
            body: """
                Hallo Frau Beispiel,

                kurze Frage vorab: Wäre ein Start im November realistisch? Dann könnten wir das Budget noch dieses Jahr einplanen.

                Viele Grüße
                Petra Schulz
                """
        )

        let kollege = EmailAddress(name: "Tim Kaiser", address: "tim@beispiel-agentur.example")
        try builder.add(
            thread: "protokoll", account: workAccountID, role: .inbox, from: kollege, to: [me.work],
            subject: "Protokoll Teammeeting", date: ago(days: 1, hours: 5), flags: [.seen],
            category: .work,
            body: """
                Hi Anna,

                anbei das Protokoll vom Montag. Deine To-dos stehen unter Punkt 3.

                Tim
                """,
            attachments: [
                .init(
                    filename: "Protokoll_Teammeeting.docx",
                    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    size: 38_450
                ),
            ]
        )

        try builder.add(
            thread: "workshop", account: workAccountID, role: .inbox,
            from: EmailAddress(name: "Lukas Brandt", address: "l.brandt@kreativwerk.example"), to: [me.work],
            subject: "Terminanfrage: Workshop nächste Woche", date: ago(hours: 3), flags: [.flagged],
            category: .appointment,
            body: """
                Hallo Anna,

                wann passt es dir nächste Woche für einen zweistündigen Workshop? Dienstag oder Donnerstag wären ideal.

                Gruß
                Lukas
                """
        )

        try builder.add(
            thread: "login", account: workAccountID, role: .inbox,
            from: EmailAddress(name: "Projektportal", address: "noreply@projektportal.example"), to: [me.work],
            subject: "Neue Anmeldung in deinem Konto", date: ago(days: 6), flags: [.seen],
            category: .notification,
            body: "Es gab eine neue Anmeldung in deinem Konto von einem Mac in Musterstadt."
        )

        try builder.add(
            thread: "entwurf", account: workAccountID, role: .drafts, from: me.work, to: [kundin],
            subject: "Angebot Website-Relaunch (Entwurf)", date: ago(hours: 6), flags: [.seen, .draft],
            category: .work,
            body: """
                Hallo Frau Schulz,

                anbei unser Angebot für den Relaunch …
                """
        )

        try builder.flushThreads()
    }

    struct MockAttachment {
        var filename: String
        var mimeType: String
        var size: Int
        var pageCount: Int?
    }

    /// Hilfsobjekt, das Nachrichten anlegt und Threads am Ende zusammenfasst.
    private struct Builder {
        let db: Database
        var threads: [String: MailThread] = [:]
        var counter = 0

        init(db: Database) {
            self.db = db
        }

        mutating func add(
            thread threadKey: String,
            account: String,
            role: MailboxRole,
            from: EmailAddress,
            to: [EmailAddress],
            subject: String,
            date: Date,
            flags: MessageFlags,
            category: MessageCategory,
            body: String,
            attachments: [MockAttachment] = []
        ) throws {
            counter += 1
            let threadID = "mock-thread-\(threadKey)"
            let messageID = "mock-message-\(counter)"
            let participants = [from] + to

            if var existing = threads[threadID] {
                existing.lastDate = max(existing.lastDate, date)
                for address in participants where !existing.participants.contains(address) {
                    existing.participants.append(address)
                }
                threads[threadID] = existing
            } else {
                let rootSubject = subject.hasPrefix("Re: ") ? String(subject.dropFirst(4)) : subject
                let thread = MailThread(id: threadID, subject: rootSubject, participants: participants, lastDate: date)
                try thread.insert(db)
                threads[threadID] = thread
            }

            let message = Message(
                id: messageID,
                accountID: account,
                mailboxID: MockData.mailboxID(account, role),
                messageID: "<\(messageID)@mock.example>",
                threadID: threadID,
                from: from,
                to: to,
                subject: subject,
                date: date,
                snippet: MockData.snippet(from: body),
                bodyText: body,
                flags: flags,
                hasAttachments: !attachments.isEmpty,
                category: category
            )
            try message.insert(db)

            for (index, file) in attachments.enumerated() {
                try Attachment(
                    id: "\(messageID)-attachment-\(index)",
                    messageID: messageID,
                    filename: file.filename,
                    mimeType: file.mimeType,
                    size: file.size,
                    pageCount: file.pageCount
                ).insert(db)
            }
        }

        func flushThreads() throws {
            for thread in threads.values {
                try thread.update(db)
            }
        }
    }

    /// Erste Zeilen ohne Umbrüche, gekürzt auf etwa zwei Listenzeilen.
    static func snippet(from body: String, maxLength: Int = 140) -> String {
        let collapsed = body
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        guard collapsed.count > maxLength else { return collapsed }
        return String(collapsed.prefix(maxLength)).trimmingCharacters(in: .whitespaces) + "…"
    }
}
