import XCTest

/// End-to-end journey against an empty in-memory store (`-uiTesting`), in pounds.
@MainActor
final class SmokeTests: XCTestCase {
    private func launch() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-uiTesting", "-massUnit", "lb", "-defaultRestSeconds", "90"]
        app.launch()
        return app
    }

    func testCatalogSeparatesVariants() {
        let app = launch()
        app.tabBars.buttons["Progress"].tap()
        app.buttons["All exercises"].tap()
        let search = app.searchFields["Search exercises"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("bench barbell")
        XCTAssertTrue(app.staticTexts["Bench Press (Barbell)"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Bench Press (Dumbbell)"].exists)
    }

    func testTemplateToWorkoutToHistoryToChart() {
        let app = launch()
        // Create a Push template with one bench set: 5 reps at 135 lb.
        app.buttons["Create template"].firstMatch.tap()
        let name = app.textFields["Template name, e.g. Push"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Push")
        app.buttons["Add exercises"].tap()
        let search = app.searchFields["Search exercises"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("bench barbell")
        app.staticTexts["Bench Press (Barbell)"].tap()
        app.buttons["Add 1"].tap()

        let minReps = app.textFields["Minimum reps"].firstMatch
        XCTAssertTrue(minReps.waitForExistence(timeout: 5))
        minReps.tap()
        minReps.typeText("5")
        let targetLoad = app.textFields["Target Total load in lb, optional"].firstMatch
        targetLoad.tap()
        targetLoad.typeText("135")
        app.buttons["Save"].tap()

        // Start it with one tap. The suggested values are not completed until confirmed.
        let push = app.buttons.containing(.staticText, identifier: "Push").firstMatch
        XCTAssertTrue(push.waitForExistence(timeout: 5))
        push.tap()
        let markDone = app.buttons["Mark set done"].firstMatch
        XCTAssertTrue(markDone.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Completed"].exists)
        markDone.tap()
        XCTAssertTrue(app.buttons["Completed"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.buttons["Skip"].waitForExistence(timeout: 2), "rest timer starts after a set")
        app.buttons["Skip"].tap()

        // Add a heavier second set.
        app.buttons["Add set"].firstMatch.tap()
        let load = app.textFields.matching(identifier: "Total load in lb").element(boundBy: 1)
        load.tap()
        load.typeText("140")
        let reps = app.textFields.matching(identifier: "Reps").element(boundBy: 1)
        reps.tap()
        reps.typeText("6")
        app.buttons["Done"].firstMatch.tap()
        app.buttons["Mark set done"].firstMatch.tap()

        // Finish: the template change is offered but off by default.
        app.buttons["Finish"].tap()
        XCTAssertTrue(app.staticTexts["Bench Press (Barbell): 1 -> 2 sets"].waitForExistence(timeout: 5))
        app.buttons["Save workout"].tap()

        // History shows the workout and its sets.
        app.tabBars.buttons["History"].tap()
        let row = app.buttons.containing(.staticText, identifier: "Push").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertTrue(app.staticTexts["135 lb x 5"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["140 lb x 6"].exists)

        // The chart reports the heaviest working set.
        app.tabBars.buttons["Progress"].tap()
        app.buttons.containing(.staticText, identifier: "Bench Press (Barbell)").firstMatch.tap()
        XCTAssertTrue(app.staticTexts["140 lb x 6"].waitForExistence(timeout: 5))
    }
}
