import XCTest

/// Abnahme Phase 1: App startet, zeigt den Mock-Posteingang, Navigation funktioniert.
/// Macht dabei Screenshots, die die CI als Artefakt hochlädt.
@MainActor
final class NavigationUITests: XCTestCase {
    func testMockInboxAndNavigation() throws {
        continueAfterFailure = false

        let app = XCUIApplication()
        // Deutsche Oberfläche unabhängig von der Simulator-Sprache.
        app.launchArguments += ["-AppleLanguages", "(de)", "-AppleLocale", "de_DE"]
        app.launch()
        #if os(iOS)
        XCUIDevice.shared.orientation = .landscapeLeft
        #endif

        // 1. Gemeinsamer Posteingang mit Mock-Mails
        let rows = app.descendants(matching: .any).matching(identifier: "messageRow")
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 15), "Mail-Liste erscheint nicht")
        XCTAssertGreaterThan(rows.count, 5)
        snapshot(app, "01-Posteingang")

        // 2. Mail öffnen → Konversation
        click(rows.firstMatch)
        let subject = app.descendants(matching: .any).matching(identifier: "threadSubject").firstMatch
        XCTAssertTrue(subject.waitForExistence(timeout: 10), "Konversation öffnet sich nicht")
        snapshot(app, "02-Konversation")

        // 3. Seitenleiste: „Markiert“
        let flagged = app.descendants(matching: .any).matching(identifier: "sidebar.flagged").firstMatch
        showSidebarIfNeeded(app, element: flagged)
        XCTAssertTrue(flagged.waitForExistence(timeout: 10), "Seitenleiste nicht erreichbar")
        XCTAssertTrue(flagged.isHittable, "Eintrag „Markiert“ ist nicht antippbar")
        click(flagged)
        let flaggedRow = rows.firstMatch
        XCTAssertTrue(flaggedRow.waitForExistence(timeout: 10), "Keine markierten Mails")
        snapshot(app, "03-Markiert")

        // 4. Posteingang eines einzelnen Kontos (Gmail, weit oben in der Seitenleiste)
        let gmailInbox = app.descendants(matching: .any).matching(identifier: "sidebar.mailbox.mock-gmail-inbox").firstMatch
        showSidebarIfNeeded(app, element: gmailInbox)
        XCTAssertTrue(gmailInbox.waitForExistence(timeout: 30))
        click(gmailInbox)
        // Großzügiges Zeitlimit: auf dem CI-Simulator dauert jede Abfrage der Ansicht teils über eine Sekunde.
        let fourMails = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count == 4"), object: rows)
        XCTAssertEqual(XCTWaiter().wait(for: [fourMails], timeout: 30), .completed, "Im Gmail-Posteingang liegen 4 Mails (gefunden: \(rows.count))")
        snapshot(app, "04-Gmail-Posteingang")
    }

    /// Blendet die Seitenleiste ein, falls das iPad sie nach der Auswahl einer Mail eingeklappt hat.
    private func showSidebarIfNeeded(_ app: XCUIApplication, element: XCUIElement) {
        #if os(iOS)
        guard !(element.exists && element.isHittable) else { return }
        let toggle = app.buttons["ToggleSidebar"]
        if toggle.waitForExistence(timeout: 3) {
            toggle.tap()
        }
        #endif
    }

    private func click(_ element: XCUIElement) {
        #if os(macOS)
        element.click()
        #else
        element.tap()
        #endif
    }

    private func snapshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
