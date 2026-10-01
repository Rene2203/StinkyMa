import AppFeature
import SwiftUI

@main
struct StinkyMaApp: App {
    private let environment: AppEnvironment

    init() {
        do {
            // Phase 1: Mock-Posteingang im Arbeitsspeicher. Echte Konten folgen ab Phase 2.
            environment = try AppEnvironment.mock()
        } catch {
            fatalError("Mock-Umgebung konnte nicht erstellt werden: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            // Jedes Fenster (Stage Manager, mehrere Mac-Fenster) hat eine eigene Auswahl.
            RootView(environment: environment)
        }
        .commands {
            SidebarCommands()
        }

        #if os(macOS)
        Settings {
            SettingsView()
        }
        #endif
    }
}
