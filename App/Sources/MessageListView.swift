import AppFeature
import MailCore
import SwiftUI

struct MessageListView: View {
    @Bindable var model: MailboxBrowserModel

    var body: some View {
        List(selection: $model.selectedMessageID) {
            ForEach(model.visibleMessages) { message in
                MessageRow(
                    message: message,
                    account: model.account(for: message),
                    showsAccount: model.showsAccountIndicator
                )
                .tag(message.id)
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    Button {
                        Task { await model.toggleRead(messageID: message.id) }
                    } label: {
                        ReadActionLabel(isRead: message.isRead)
                    }
                    .tint(.blue)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button {
                        Task { await model.archive(messageIDs: [message.id]) }
                    } label: {
                        Label("Archivieren", systemImage: "archivebox")
                    }
                    .tint(.indigo)

                    Button {
                        Task { await model.moveToTrash(messageIDs: [message.id]) }
                    } label: {
                        Label("In den Papierkorb", systemImage: "trash")
                    }
                    .tint(.red)

                    Button {
                        Task { await model.toggleFlag(messageID: message.id) }
                    } label: {
                        FlagActionLabel(isFlagged: message.isFlagged)
                    }
                    .tint(.orange)
                }
                .contextMenu {
                    MessageActions(model: model, message: message)
                }
            }
        }
        #if os(iOS)
        .listStyle(.plain)
        #else
        .listStyle(.inset)
        .navigationSplitViewColumnWidth(min: 280, ideal: 360)
        #endif
        .navigationTitle(title)
        .searchable(text: $model.searchText, prompt: Text("Suchen"))
        .overlay {
            if model.visibleMessages.isEmpty {
                if model.searchText.isEmpty {
                    ContentUnavailableView(
                        "Keine Mails",
                        systemImage: "tray",
                        description: Text("Hier ist gerade nichts.")
                    )
                } else {
                    ContentUnavailableView.search(text: model.searchText)
                }
            }
        }
    }

    private var title: Text {
        guard let scope = model.selectedScope, let item = model.sidebarItem(for: scope) else {
            return Text("Mails")
        }
        return item.title
    }
}

/// Aktionen für eine Mail – im Kontextmenü der Liste und in der Detailansicht.
struct MessageActions: View {
    let model: MailboxBrowserModel
    let message: Message

    var body: some View {
        Button {
            Task { await model.toggleRead(messageID: message.id) }
        } label: {
            ReadActionLabel(isRead: message.isRead)
        }
        Button {
            Task { await model.toggleFlag(messageID: message.id) }
        } label: {
            FlagActionLabel(isFlagged: message.isFlagged)
        }
        Divider()
        Button {
            Task { await model.archive(messageIDs: [message.id]) }
        } label: {
            Label("Archivieren", systemImage: "archivebox")
        }
        Button(role: .destructive) {
            Task { await model.moveToTrash(messageIDs: [message.id]) }
        } label: {
            Label("In den Papierkorb", systemImage: "trash")
        }
    }
}

struct ReadActionLabel: View {
    let isRead: Bool

    var body: some View {
        if isRead {
            Label("Als ungelesen markieren", systemImage: "envelope.badge")
        } else {
            Label("Als gelesen markieren", systemImage: "envelope.open")
        }
    }
}

struct FlagActionLabel: View {
    let isFlagged: Bool

    var body: some View {
        if isFlagged {
            Label("Markierung entfernen", systemImage: "flag.slash")
        } else {
            Label("Markieren", systemImage: "flag")
        }
    }
}
