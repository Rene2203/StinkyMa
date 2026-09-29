import AppFeature
import SwiftUI

/// Drei-Spalten-Layout: Postfächer │ Mail-Liste │ Konversation.
struct RootView: View {
    @State private var model: MailboxBrowserModel
    @State private var columnVisibility = NavigationSplitViewVisibility.all

    init(environment: AppEnvironment) {
        _model = State(initialValue: MailboxBrowserModel(repository: environment.repository))
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(model: model)
        } content: {
            MessageListView(model: model)
        } detail: {
            MessageDetailView(model: model)
        }
        .task {
            await model.loadSidebar()
        }
        .task(id: model.selectedScope) {
            await model.loadMessages()
        }
        .task(id: model.selectedMessageID) {
            await model.loadSelectedThread()
        }
        .alert("Etwas ist schiefgelaufen", isPresented: isShowingError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(verbatim: model.errorMessage ?? "")
        }
    }

    private var isShowingError: Binding<Bool> {
        Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )
    }
}

#Preview {
    if let environment = try? AppEnvironment.mock() {
        RootView(environment: environment)
    }
}
