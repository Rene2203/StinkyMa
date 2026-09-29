import AppFeature
import MailCore
import SwiftUI

struct SidebarView: View {
    @Bindable var model: MailboxBrowserModel

    var body: some View {
        List(selection: $model.selectedScope) {
            ForEach(model.sections) { section in
                Section {
                    ForEach(section.items) { item in
                        SidebarRow(item: item)
                            .tag(item.scope)
                    }
                } header: {
                    SidebarSectionHeader(section: section)
                }
            }
        }
        .navigationTitle("Postfächer")
        #if os(macOS)
        .navigationSplitViewColumnWidth(min: 180, ideal: 220)
        #endif
    }
}

private struct SidebarSectionHeader: View {
    let section: SidebarSection

    var body: some View {
        switch section.kind {
        case .smartMailboxes:
            Text("Übersicht")
        case .account(let account):
            HStack(spacing: 6) {
                Circle()
                    .fill(account.color.color)
                    .frame(width: 8, height: 8)
                    .accessibilityHidden(true)
                Text(verbatim: account.displayName)
            }
            .accessibilityElement(children: .combine)
            .accessibilityHint(Text(verbatim: account.email))
        }
    }
}

private struct SidebarRow: View {
    let item: SidebarItem

    var body: some View {
        Label {
            item.title
        } icon: {
            Image(systemName: item.systemImage)
        }
        .badge(item.unreadCount)
    }
}
