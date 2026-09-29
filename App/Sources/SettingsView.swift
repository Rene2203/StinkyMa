import SwiftUI

/// Einstellungen-Fenster (macOS). Inhalte folgen mit den jeweiligen Phasen.
struct SettingsView: View {
    var body: some View {
        TabView {
            Tab("Allgemein", systemImage: "gearshape") {
                placeholder(Text("Allgemeine Einstellungen folgen."))
            }
            Tab("Konten", systemImage: "at") {
                placeholder(Text("Konten lassen sich ab Phase 2 einrichten."))
            }
            Tab("KI & Datenschutz", systemImage: "lock.shield") {
                placeholder(Text("Die KI arbeitet auf dem Gerät. Externe Anbieter sind nur nach ausdrücklicher Freigabe möglich."))
            }
        }
        .frame(width: 480, height: 260)
    }

    private func placeholder(_ text: Text) -> some View {
        text
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
