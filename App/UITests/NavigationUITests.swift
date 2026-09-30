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
        #if os(iOS)
        if !flagged.exists {
            // Im Hochformat ist die Seitenleiste eingeklappt: über den Zurück-Knopf öffnen.
            app.navigationBars.buttons.firstMatch.tap()
        }
        #endif
        XCTAssertTrue(flagged.waitForExistence(timeout: 10), "Seitenleiste nicht erreichbar")
        click(flagged)
        let flaggedRow = rows.firstMatch
        XCTAssertTrue(flaggedRow.waitForExistence(timeout: 10), "Keine markierten Mails")
        snapshot(app, "03-Markiert")

        // 4. Ordner eines einzelnen Kontos: Entwürfe im Arbeitskonto
        let drafts = app.descendants(matching: .any).matching(identifier: "sidebar.mailbox.mock-work-drafts").firstMatch
        XCTAssertTrue(drafts.waitForExistence(timeout: 10))
        click(drafts)
        let oneDraft = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count == 1"), object: rows)
        XCTAssertEqual(XCTWaiter().wait(for: [oneDraft], timeout: 10), .completed, "Im Entwurfsordner liegt genau ein Entwurf")
        snapshot(app, "04-Entwuerfe")
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
