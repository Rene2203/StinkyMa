import AppFeature
import MailCore
import SwiftUI

/// Rechte Spalte: die ausgewählte Konversation.
struct MessageDetailView: View {
    let model: MailboxBrowserModel

    var body: some View {
        if let message = model.selectedMessage {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(verbatim: message.subject)
                            .font(.title2.bold())
                            .textSelection(.enabled)
                            .accessibilityIdentifier("threadSubject")
                        if let category = message.category {
                            CategoryChip(category: category)
                        }
                    }
                    ForEach(thread(for: message)) { threadMessage in
                        ThreadMessageCard(
                            message: threadMessage,
                            attachments: model.attachmentsByMessageID[threadMessage.id] ?? [],
                            isInitiallyExpanded: threadMessage.id == message.id
                                || threadMessage.id == thread(for: message).last?.id
                        )
                    }
                }
                .padding()
                .frame(maxWidth: 820, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        // Antworten folgt mit dem Composer in Phase 3.
                    } label: {
                        Label("Antworten", systemImage: "arrowshape.turn.up.left")
                    }
                    .disabled(true)
                    .help(Text("Antworten ist ab Phase 3 verfügbar"))

                    Button {
                        Task { await model.toggleFlag(messageID: message.id) }
                    } label: {
                        FlagActionLabel(isFlagged: message.isFlagged)
                    }
                    .keyboardShortcut("l", modifiers: [.command, .shift])

                    Button {
                        Task { await model.archive(messageIDs: [message.id]) }
                    } label: {
                        Label("Archivieren", systemImage: "archivebox")
                    }
                    .keyboardShortcut("e", modifiers: [])

                    Button {
                        Task { await model.moveToTrash(messageIDs: [message.id]) }
                    } label: {
                        Label("In den Papierkorb", systemImage: "trash")
                    }
                    .keyboardShortcut(.delete, modifiers: [.command])
                }
            }
        } else {
            ContentUnavailableView(
                "Keine Mail ausgewählt",
                systemImage: "envelope",
                description: Text("Wähle links eine Mail aus.")
            )
        }
    }

    /// Die geladene Konversation – oder die Mail allein, solange die Konversation noch lädt.
    private func thread(for message: Message) -> [Message] {
        model.threadMessages.contains { $0.id == message.id } ? model.threadMessages : [message]
    }
}

private struct ThreadMessageCard: View {
    let message: Message
    let attachments: [Attachment]
    @State private var isExpanded: Bool

    init(message: Message, attachments: [Attachment], isInitiallyExpanded: Bool) {
        self.message = message
        self.attachments = attachments
        _isExpanded = State(initialValue: isInitiallyExpanded)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.snappy) { isExpanded.toggle() }
            } label: {
                header
            }
            .buttonStyle(.plain)
            .accessibilityHint(isExpanded ? Text("Einklappen") : Text("Aufklappen"))

            if isExpanded {
                Divider()
                // Phase 1 zeigt nur Text. HTML-Mails (WKWebView ohne JavaScript) folgen in Phase 2.
                Text(verbatim: message.bodyText ?? message.snippet)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if !attachments.isEmpty {
                    AttachmentStrip(attachments: attachments)
                }
            }
        }
        .padding()
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(verbatim: message.from.initials)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(Color.accentColor.gradient, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(verbatim: message.from.displayName)
                        .font(.headline)
                    Spacer()
                    Text(message.date, format: .dateTime.day().month().year().hour().minute())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if isExpanded {
                    Text("An: \(message.to.map(\.displayName).formatted(.list(type: .and)))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text(verbatim: message.snippet)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .contentShape(Rectangle())
    }
}

private struct AttachmentStrip: View {
    let attachments: [Attachment]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(attachments) { attachment in
                    HStack(spacing: 8) {
                        Image(systemName: attachment.systemImage)
                            .font(.title3)
                            .foregroundStyle(.tint)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(verbatim: attachment.filename)
                                .font(.caption.weight(.medium))
                                .lineLimit(1)
                            Group {
                                if let pages = attachment.pageCount {
                                    Text("\(Int64(attachment.size).formatted(.byteCount(style: .file))) · \(pages) Seiten")
                                } else {
                                    Text(Int64(attachment.size), format: .byteCount(style: .file))
                                }
                            }
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}
