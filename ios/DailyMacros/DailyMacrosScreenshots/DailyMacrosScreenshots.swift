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
        if name.contains("testRapidPrimaryAndHealthTabSwitchingStaysStable") || name.contains("testSexCategorySummaries") {
            app.launchArguments.append("--tab-stability-testing")
        }
        if name.contains("testDataSourceMatrixUsesLargeTextOverview") || name.contains("testQuickAddPortionPreviewAtLargeText") {
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

    func testMealEditorShowsSharedDateAndTime() throws {
        selectTab("Macros")
        let meal = app.staticTexts["Breakfast Burrito"].firstMatch
        for _ in 0..<5 where !meal.isHittable { app.swipeUp() }
        XCTAssertTrue(meal.waitForExistence(timeout: 10))
        meal.tap()
        XCTAssertTrue(app.staticTexts["Meal date and time"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.datePickers.firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Changing this moves every item in the meal to the selected time."].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Meal date and time editor"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testMealEditorSaveIsAvailableWithoutChangesAndForNameOnlyEdits() throws {
        selectTab("Macros")
        let meal = app.staticTexts["Breakfast Burrito"].firstMatch
        for _ in 0..<5 where !meal.isHittable { app.swipeUp() }
        XCTAssertTrue(meal.waitForExistence(timeout: 10))
        meal.tap()
        try assertEditorSaveIsAvailable(nameField: "Meal Name", missingNameMessage: "Enter a meal name.")
    }

    func testEntryEditorSaveIsAvailableWithoutChangesAndForNameOnlyEdits() throws {
        selectTab("Macros")
        let entry = app.staticTexts["Greek Yogurt Bowl"].firstMatch
        for _ in 0..<5 where !entry.isHittable { app.swipeUp() }
        XCTAssertTrue(entry.waitForExistence(timeout: 10))
        entry.tap()
        try assertEditorSaveIsAvailable(nameField: "Item Name", missingNameMessage: "Enter an item name.")
    }

    private func assertEditorSaveIsAvailable(nameField: String, missingNameMessage: String) throws {
        let field = app.textFields[nameField]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        let save = app.buttons["Save"].firstMatch
        XCTAssertTrue(save.isEnabled, "Save must be enabled before making any changes")
        field.tap()
        field.typeText(" renamed")
        XCTAssertTrue((field.value as? String)?.contains("renamed") == true)
        XCTAssertTrue(save.isEnabled, "Changing only the name must not disable Save")

        let value = try XCTUnwrap(field.value as? String)
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        XCTAssertTrue(save.isEnabled, "Validation happens when Save is tapped")
        for _ in 0..<5 where !save.isHittable { app.swipeUp() }
        XCTAssertTrue(save.isHittable)
        save.tap()
        XCTAssertTrue(app.staticTexts[missingNameMessage].waitForExistence(timeout: 5))
        XCTAssertTrue(field.exists, "Invalid input must keep the editor open")
        XCTAssertTrue(save.isEnabled, "Validation must leave Save available for retry")
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "\(nameField) editor Save and validation"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testQuickAddSourceFilters() throws {
        selectTab("Macros")
        app.buttons["Log meal"].tap()
        let filters = app.segmentedControls["quick-source-filter"]
        for _ in 0..<5 where !filters.isHittable { app.swipeUp() }
        XCTAssertTrue(filters.waitForExistence(timeout: 5))
        filters.buttons["Saved"].tap()
        XCTAssertTrue(app.buttons["Add Greek Yogurt Bowl to meal queue"].exists)
        XCTAssertFalse(app.buttons["Add Grilled Chicken to meal queue"].exists)
        snapshot("09-Quick-Add-Saved")
        filters.buttons["Recent"].tap()
        XCTAssertTrue(app.buttons["Add Grilled Chicken to meal queue"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Add Greek Yogurt Bowl to meal queue"].exists)
        snapshot("10-Quick-Add-Recent")
        let search = app.textFields["Search quick entries"]
        search.tap(); search.typeText("rice")
        XCTAssertTrue(app.buttons["Add Jasmine Rice to meal queue"].exists)
        XCTAssertFalse(app.buttons["Add Chicken Rice Bowl to meal queue"].exists)
        filters.buttons["All"].tap()
        XCTAssertTrue(app.buttons["Add Chicken Rice Bowl to meal queue"].waitForExistence(timeout: 5))
    }

    func testQuickAddPortionPreviewMatchesQueue() throws {
        selectTab("Macros")
        app.buttons["Log meal"].tap()
        let multiplier = app.textFields["quick-multiplier"]
        for _ in 0..<5 where !multiplier.isHittable { app.swipeUp() }
        XCTAssertTrue(multiplier.waitForExistence(timeout: 5))
        multiplier.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        multiplier.typeText(XCUIKeyboardKey.delete.rawValue + "0")
        XCTAssertEqual(multiplier.value as? String, "0")
        let yogurt = app.buttons["Add Greek Yogurt Bowl to meal queue"]
        XCTAssertTrue(yogurt.waitForExistence(timeout: 5))
        XCTAssertFalse(yogurt.isEnabled)
        multiplier.typeText(XCUIKeyboardKey.delete.rawValue + "0.5")
        XCTAssertTrue(yogurt.isEnabled)
        XCTAssertEqual(yogurt.value as? String, "0.5 bowl · 155 kcal | Protein 16g | Carbs 17g | Fat 3g")
        let meal = app.buttons["Add Chicken Rice Bowl to meal queue"]
        XCTAssertEqual(meal.value as? String, "0.5 bowl · 320 kcal | Protein 27g | Carbs 33g | Fat 9g")
        if !name.contains("AtLargeText") {
            let quarterCup = app.buttons["Add Avocado Salsa to meal queue"]
            XCTAssertTrue((quarterCup.value as? String)?.hasPrefix("0.25 cup ·") == true)
        }
        for _ in 0..<5 where !meal.isHittable { app.swipeUp() }
        XCTAssertTrue(meal.isHittable)
        snapshot("06-Quick-Add-Portion" + (name.contains("AtLargeText") ? "-Large" : ""))
        meal.tap()
        XCTAssertTrue(app.staticTexts["0.5 bowl queued"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["320 kcal"].exists)
        XCTAssertTrue(app.staticTexts["Ingredients shown per 1 bowl"].exists)
        snapshot("07-Quick-Add-Queue" + (name.contains("AtLargeText") ? "-Large" : ""))
        let save = app.buttons["Save"].firstMatch
        if name.contains("AtLargeText") {
            let queue = app.scrollViews["quick-meal-queue"]
            for _ in 0..<12 where !save.isHittable { queue.swipeUp() }
            snapshot("08-Quick-Add-Queue-Actions-Large")
        }
        XCTAssertTrue(save.isHittable)
        save.tap()
        XCTAssertTrue(app.alerts["Name Meal"].waitForExistence(timeout: 5))
        app.alerts["Name Meal"].buttons["Cancel"].tap()
    }

    func testQuickAddPortionPreviewAtLargeText() throws {
        try testQuickAddPortionPreviewMatchesQueue()
    }

    func testWorkoutHistoryCoverage() throws {
        selectTab("Workouts")
        let year = app.segmentedControls.buttons["Year"]
        for _ in 0..<4 where !year.isHittable { app.swipeUp() }
        XCTAssertTrue(year.isHittable)
        year.tap()
        let summary = app.staticTexts["8 / 26 days active"]
        for _ in 0..<4 where !summary.isHittable { app.swipeUp() }
        XCTAssertTrue(summary.waitForExistence(timeout: 10))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Workout history coverage"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testSexCategorySummaries() throws {
        selectTab("Health")
        selectHealthSection("Sex")
        XCTAssertTrue(app.staticTexts["Manual Stimulation: 0 entries · 0 days counted"].waitForExistence(timeout: 10))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Sex category summaries"
        attachment.lifetime = .keepAlways
        add(attachment)
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
            selectHealthSection("Sex")
            XCTAssertEqual(app.state, .runningForeground, "App stopped while switching Health sections")
        }
    }

    func testNewCheckinCombinesWaistAndPhotosBeforeSaving() throws {
        selectTab("Health")
        selectHealthSection("Weight")
        let newCheckin = app.buttons["New check-in"]
        for _ in 0..<8 where !newCheckin.isHittable { app.swipeUp() }
        XCTAssertTrue(newCheckin.isHittable)
        XCTAssertFalse(app.buttons["Log waist"].exists)
        newCheckin.tap()

        XCTAssertTrue(app.navigationBars["Check-in"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["First waist reading"].exists)
        XCTAssertTrue(app.textFields["Second waist reading (optional)"].exists)
        let waistScreenshot = XCTAttachment(screenshot: app.screenshot())
        waistScreenshot.name = "Combined check-in waist fields"
        waistScreenshot.lifetime = .keepAlways
        add(waistScreenshot)
        for view in ["front", "side", "back"] {
            let picker = app.buttons["Add \(view) photo"]
            for _ in 0..<4 where !picker.isHittable { app.swipeUp() }
            XCTAssertTrue(picker.exists)
            XCTAssertTrue(picker.isEnabled)
        }
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Check-in photo form"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let front = app.buttons["Add front photo"]
        for _ in 0..<4 where !front.isHittable { app.swipeDown() }
        front.tap()
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 5))
        // The system picker must open without creating a check-in first.
        XCTAssertFalse(app.navigationBars["Check-in"].buttons["Save"].isHittable)
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
