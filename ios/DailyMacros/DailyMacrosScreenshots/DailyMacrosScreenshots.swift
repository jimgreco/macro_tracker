import XCTest

@MainActor
final class DailyMacrosScreenshots: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false

        app = XCUIApplication()
        setupSnapshot(app)
        app.launchArguments += [
            "--app-store-screenshots",
            "-AppleLanguages", "(en)",
            "-AppleLocale", "en_US"
        ]
        app.launchEnvironment["APP_STORE_SCREENSHOTS"] = "1"
        if name.contains("testRapidPrimaryAndHealthTabSwitchingStaysStable") {
            app.launchArguments.append("--tab-stability-testing")
        }
        if name.contains("testDataSourceMatrixUsesLargeTextOverview") {
            app.launchArguments += [
                "-UIPreferredContentSizeCategoryName",
                "UICTContentSizeCategoryAccessibilityXXXL"
            ]
        }
        app.launch()

        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 15))
    }

    func testAppStoreScreenshots() throws {
        snapshot("01-Today")

        selectTab("Workouts")
        XCTAssertTrue(app.staticTexts["Stats"].waitForExistence(timeout: 10))
        snapshot("02-Workouts")

        selectTab("Health")
        selectHealthSection("Weight")
        XCTAssertTrue(app.staticTexts["Target Weight"].waitForExistence(timeout: 10))
        snapshot("03-Weight")

        selectHealthSection("Sleep")
        XCTAssertTrue(app.staticTexts["Sleep Log"].waitForExistence(timeout: 10))
        snapshot("04-Sleep")

        selectTab("Insights")
        XCTAssertTrue(app.staticTexts["30-Day Analysis"].waitForExistence(timeout: 10))
        snapshot("05-Insights")
    }

    func testRapidPrimaryAndHealthTabSwitchingStaysStable() throws {
        let primaryTabs = ["Today", "Macros", "Workouts", "Health", "Insights"]

        for _ in 0..<8 {
            for tab in primaryTabs {
                selectTab(tab)
                XCTAssertEqual(app.state, .runningForeground, "App stopped while selecting \(tab)")
            }

            selectTab("Health")
            selectHealthSection("Weight")
            selectHealthSection("Sleep")
            selectHealthSection("Sexual Activity")
            XCTAssertEqual(app.state, .runningForeground, "App stopped while switching Health sections")
        }
    }

    func testDataSourceMatrixShowsTheCrossSourceOverview() throws {
        openDataSources()
        XCTAssertTrue(app.staticTexts["Data type"].exists)

        let matrix = app.otherElements["integration-data-access-matrix"]
        XCTAssertTrue(matrix.exists)
        let rowScroll = app.scrollViews["integration-data-access-row-scroll"]
        XCTAssertTrue(rowScroll.exists)
        let workoutsCell = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "Workouts, Apple Health.")
        ).firstMatch
        let sleepCell = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "Sleep, Apple Health.")
        ).firstMatch
        XCTAssertTrue(workoutsCell.exists)
        XCTAssertTrue(sleepCell.exists)

        let bedtimeCell = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH %@", "Bedtime, Oura Ring.")
        ).firstMatch
        for _ in 0..<3 where !bedtimeCell.exists {
            rowScroll.swipeUp()
        }
        XCTAssertTrue(bedtimeCell.waitForExistence(timeout: 2))
        let sourceScroll = app.scrollViews["integration-data-access-source-scroll"]
        XCTAssertTrue(sourceScroll.exists)

        let sourceIDs = [
            "Apple Health": "healthkit",
            "Oura Ring": "oura",
            "Workout Planner": "workout_planner"
        ]
        for (sourceName, sourceID) in sourceIDs {
            let sourceColumn = app.descendants(matching: .any)[
                "integration-data-access-source-\(sourceID)"
            ]
            XCTAssertTrue(sourceColumn.exists, "Missing matrix column for \(sourceName)")
        }

        let workoutPlanner = app.descendants(matching: .any)[
            "integration-data-access-source-workout_planner"
        ]
        XCTAssertTrue(workoutPlanner.exists)
        let wasHittable = workoutPlanner.isHittable
        let initialWorkoutPlannerX = workoutPlanner.frame.minX
        for _ in 0..<3 where !workoutPlanner.isHittable {
            sourceScroll.swipeLeft()
        }
        if !wasHittable {
            XCTAssertLessThan(
                workoutPlanner.frame.minX,
                initialWorkoutPlannerX,
                "Horizontal swipe should move later source columns into view"
            )
        }
        XCTAssertTrue(
            workoutPlanner.isHittable,
            "Workout Planner should be visible after horizontal swiping"
        )
    }

    func testDataSourceMatrixUsesLargeTextOverview() throws {
        openDataSources()

        XCTAssertTrue(
            app.otherElements["integration-data-access-accessibility-overview"]
                .waitForExistence(timeout: 5)
        )
        XCTAssertFalse(app.otherElements["integration-data-access-matrix"].exists)
        XCTAssertTrue(
            app.descendants(matching: .any).matching(
                NSPredicate(format: "label CONTAINS %@", "Apple Health")
            ).firstMatch.exists
        )
        XCTAssertTrue(
            app.descendants(matching: .any).matching(
                NSPredicate(format: "label CONTAINS %@", "Oura Ring")
            ).firstMatch.exists
        )
    }

    private func openDataSources() {
        let settingsButton = app.buttons["Open Settings"]
        XCTAssertTrue(settingsButton.waitForExistence(timeout: 5))
        settingsButton.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))

        let manageDataSources = app.staticTexts["Manage Data Sources"]
        for _ in 0..<6 {
            if manageDataSources.exists && manageDataSources.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(manageDataSources.waitForExistence(timeout: 5))
        manageDataSources.tap()
        XCTAssertTrue(app.navigationBars["Data Sources"].waitForExistence(timeout: 5))
    }

    private func selectTab(_ name: String) {
        let tabButton = app.tabBars.buttons[name]
        if tabButton.waitForExistence(timeout: 5) {
            tabButton.tap()
            return
        }

        let fallbackButton = app.buttons[name]
        if fallbackButton.waitForExistence(timeout: 2) {
            fallbackButton.tap()
            return
        }

        let moreButton = app.tabBars.buttons["More"]
        XCTAssertTrue(moreButton.waitForExistence(timeout: 5), "Could not find tab named \(name)")
        moreButton.tap()

        let moreCell = app.cells.containing(.staticText, identifier: name).element
        XCTAssertTrue(moreCell.waitForExistence(timeout: 5), "Could not find More tab item named \(name)")
        moreCell.tap()
    }

    private func selectHealthSection(_ name: String) {
        let button = app.segmentedControls.buttons[name]
        XCTAssertTrue(button.waitForExistence(timeout: 5), "Could not find Health section named \(name)")
        button.tap()
    }
}
