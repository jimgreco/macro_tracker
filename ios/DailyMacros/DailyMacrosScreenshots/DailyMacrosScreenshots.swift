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
        if name.contains("testManualNutritionAtLargeText") || name.contains("testDataSourceMatrixUsesLargeTextOverview") || name.contains("testQuickAddPortionPreviewAtLargeText") || name.contains("testQuickAddPortionShortcutsAtLargeText") || name.contains("testCompletedTrendsAtLargeText") || name.contains("testNutritionDayReviewEmptyAtLargeText") {
            app.launchArguments += [
                "-UIPreferredContentSizeCategoryName",
                "UICTContentSizeCategoryAccessibilityXXXL"
            ]
        }
        if name.contains("testCompletedTrends") {
            app.launchArguments.append("--completed-trend-testing")
            if name.contains("Empty") { app.launchArguments.append("--empty-trend-testing") }
        }
        if name.contains("testNutritionDayReview") {
            app.launchArguments += ["--completed-trend-testing", "--day-review-testing"]
            if name.contains("Empty") { app.launchArguments.append("--empty-trend-testing") }
            if name.contains("Interrupted") { app.launchArguments.append("--day-review-delay-testing") }
            if name.contains("PageFailure") { app.launchArguments.append("--day-review-page-failure-testing") }
        }
        app.launch()

        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 15))
    }

    private func revealTrend() {
        let picker = app.segmentedControls["macro-trend-period"]
        for _ in 0..<14 {
            if picker.exists && picker.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(picker.isHittable)
        app.swipeUp(velocity: .slow)
    }

    private func trendValue(_ macro: String) -> String? {
        app.buttons["macro-trend-chip-\(macro)"].value as? String
    }

    private func assertTrendCoverage(complete: Int, days: Int, partial: Int) {
        let count = "\(complete) of \(days) days complete"
        let detail = "\(partial) partial · \(days - complete - partial) unmarked"
        XCTAssertEqual(app.staticTexts["macro-trend-coverage-count"].label, count)
        XCTAssertEqual(app.staticTexts["macro-trend-coverage-detail"].label, detail)
        XCTAssertEqual(app.progressIndicators["macro-trend-coverage-progress"].value as? String, count)
    }

    private func setTodayComplete(_ complete: Bool) {
        let button = app.buttons[complete ? "Mark nutrition day complete" : "Reopen nutrition day"]
        for _ in 0..<14 {
            if button.exists && button.isHittable { break }
            app.swipeDown()
        }
        XCTAssertTrue(button.isHittable)
        button.tap()
    }

    private func attachTrend(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testCompletedTrendsRangesAndCompletionToggle() throws {
        selectTab("Macros")
        revealTrend()
        XCTAssertEqual(trendValue("calories"), "1,000 cal")
        XCTAssertEqual(trendValue("protein"), "50 g")
        XCTAssertEqual(trendValue("carbs"), "100 g")
        XCTAssertEqual(trendValue("fat"), "25 g")
        assertTrendCoverage(complete: 2, days: 7, partial: 2)
        attachTrend("Completed-trends-week")
        let picker = app.segmentedControls["macro-trend-period"]
        picker.buttons["Month"].tap()
        XCTAssertTrue(app.buttons["macro-trend-chip-calories"].waitForExistence(timeout: 5))
        let month = NSPredicate(format: "value == %@", "3,750 cal")
        expectation(for: month, evaluatedWith: app.buttons["macro-trend-chip-calories"])
        waitForExpectations(timeout: 5)
        assertTrendCoverage(complete: 4, days: 30, partial: 2)
        attachTrend("Completed-trends-month")
        picker.buttons["Year"].tap()
        expectation(for: NSPredicate(format: "value == %@", "4,200 cal"), evaluatedWith: app.buttons["macro-trend-chip-calories"])
        waitForExpectations(timeout: 5)
        assertTrendCoverage(complete: 5, days: 365, partial: 2)
        attachTrend("Completed-trends-year")
        picker.buttons["Week"].tap()
        setTodayComplete(true)
        revealTrend()
        XCTAssertEqual(trendValue("calories"), "800 cal")
        assertTrendCoverage(complete: 3, days: 7, partial: 1)
        attachTrend("Completed-trends-today-complete")
        setTodayComplete(false)
        revealTrend()
        XCTAssertEqual(trendValue("calories"), "1,000 cal")
        assertTrendCoverage(complete: 2, days: 7, partial: 2)
    }

    func testCompletedTrendsEmptyAndZeroEntryDay() throws {
        selectTab("Macros")
        revealTrend()
        XCTAssertEqual(trendValue("calories"), "No completed days")
        XCTAssertTrue(app.staticTexts["macro-trend-empty"].exists)
        assertTrendCoverage(complete: 0, days: 7, partial: 0)
        attachTrend("Completed-trends-empty")
        setTodayComplete(true)
        revealTrend()
        XCTAssertEqual(trendValue("calories"), "0 cal")
        XCTAssertFalse(app.staticTexts["macro-trend-empty"].exists)
        XCTAssertTrue(app.staticTexts["macro-trend-average"].exists)
        assertTrendCoverage(complete: 1, days: 7, partial: 0)
        attachTrend("Completed-trends-zero-entry")
        setTodayComplete(false)
        revealTrend()
        XCTAssertEqual(trendValue("calories"), "No completed days")
        XCTAssertTrue(app.staticTexts["macro-trend-empty"].exists)
    }

    func testCompletedTrendsAtLargeText() throws {
        selectTab("Macros")
        revealTrend()
        XCTAssertEqual(trendValue("calories"), "1,000 cal")
        assertTrendCoverage(complete: 2, days: 7, partial: 2)
        attachTrend("Completed-trends-large-text")
    }

    private func openDayReview() {
        revealTrend()
        let review = app.buttons["macro-review-days"]
        for _ in 0..<5 where !review.isHittable { app.swipeUp() }
        XCTAssertTrue(review.waitForExistence(timeout: 5))
        XCTAssertTrue(review.isEnabled)
        review.tap()
        XCTAssertTrue(app.navigationBars["Review days"].waitForExistence(timeout: 5))
    }

    func testNutritionDayReviewCopyDatePickerAndCancel() throws {
        selectTab("Macros")
        openDayReview()
        app.buttons["nutrition-review-day-2026-06-15"].tap()
        let item = app.staticTexts["Historical review item"].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 8)); item.tap()
        let copy = app.buttons["Copy to date"]
        for _ in 0..<8 where !copy.isHittable { app.swipeUp() }
        XCTAssertTrue(copy.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Copy to Today"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["copy-target-date"].firstMatch.exists)
        attachTrend("Copy saved entry to a chosen date")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["nutrition-selected-day"].label, "June 15, 2026")
    }

    func testNutritionDayReviewFiltersRangesAndNavigation() throws {
        selectTab("Macros")
        openDayReview()
        let filter = app.segmentedControls["nutrition-review-filter"]
        XCTAssertEqual(app.staticTexts["nutrition-review-count"].label, "5 of 7 days · newest first")
        XCTAssertFalse(app.buttons["nutrition-review-day-2026-06-16"].exists)
        filter.buttons["Complete"].tap()
        XCTAssertEqual(app.staticTexts["nutrition-review-count"].label, "2 of 7 days · newest first")
        XCTAssertTrue(app.buttons["nutrition-review-day-2026-06-14"].exists, "A complete zero-entry day remains navigable")
        filter.buttons["All"].tap()
        XCTAssertEqual(app.staticTexts["nutrition-review-count"].label, "7 of 7 days · newest first")
        attachTrend("Nutrition-day-review-all")
        app.buttons["nutrition-review-day-2026-06-15"].tap()
        XCTAssertTrue(app.staticTexts["Historical review item"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["nutrition-selected-day"].label, "June 15, 2026")
        attachTrend("Nutrition-day-review-open-log")
        openDayReview()
        XCTAssertEqual(app.staticTexts["nutrition-review-count"].label, "5 of 7 days · newest first", "Opening a fresh sheet restores Needs review")
        app.buttons["Done"].tap()
        XCTAssertEqual(app.staticTexts["nutrition-selected-day"].label, "June 15, 2026", "Dismissing the sheet never changes the selected log")
        for (period, count) in [("Month", "26 of 30 days · newest first"), ("Year", "360 of 365 days · newest first")] {
            revealTrend()
            app.segmentedControls["macro-trend-period"].buttons[period].tap()
            openDayReview()
            XCTAssertEqual(app.staticTexts["nutrition-review-count"].label, count)
            app.buttons["Done"].tap()
        }
        app.terminate()
        app.launch()
        selectTab("Macros")
        openDayReview()
        XCTAssertEqual(app.staticTexts["nutrition-review-count"].label, "5 of 7 days · newest first")
    }

    func testNutritionDayReviewInterruptedLoadStaysOnNewerDay() throws {
        selectTab("Macros")
        openDayReview()
        app.buttons["nutrition-review-day-2026-06-15"].tap()
        XCTAssertTrue(app.buttons["Next day"].waitForExistence(timeout: 5))
        app.buttons["Next day"].tap()
        XCTAssertTrue(app.staticTexts["Recent review item"].waitForExistence(timeout: 5))
        let delayedResponse = expectation(description: "Allow superseded day request to return")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { delayedResponse.fulfill() }
        wait(for: [delayedResponse], timeout: 4)
        XCTAssertEqual(app.staticTexts["nutrition-selected-day"].label, "June 16, 2026")
        XCTAssertFalse(app.staticTexts["Historical review item"].exists)
        XCTAssertTrue(app.staticTexts["Recent review item"].exists)
        attachTrend("Nutrition-day-review-interrupted-load")
    }

    func testNutritionDayReviewPageFailureRetainsNoPartialMealAndRetries() throws {
        selectTab("Macros")
        openDayReview()
        app.buttons["nutrition-review-day-2026-06-13"].tap()
        let retry = app.buttons["Retry loading entries"]
        XCTAssertTrue(retry.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Review meal across pages"].exists, "A first-page partial group must never be editable")
        attachTrend("Nutrition-day-review-page-failure")
        retry.tap()
        XCTAssertTrue(app.staticTexts["Review meal across pages"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["101 items"].exists)
        XCTAssertFalse(app.staticTexts["nutrition-day-entries-error"].exists)
        attachTrend("Nutrition-day-review-page-retry")
    }

    func testNutritionDayReviewEmptyAtLargeText() throws {
        selectTab("Macros")
        openDayReview()
        XCTAssertEqual(app.staticTexts["nutrition-review-count"].label, "7 of 7 days · newest first")
        let filter = app.buttons["nutrition-review-filter"]
        XCTAssertTrue(filter.exists)
        filter.tap()
        app.buttons["Complete"].tap()
        XCTAssertTrue(app.staticTexts["nutrition-review-empty"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["nutrition-review-count"].label, "0 of 7 days · newest first")
        attachTrend("Nutrition-day-review-empty-large-text")
        app.buttons["Done"].tap()
        XCTAssertFalse(app.navigationBars["Review days"].exists)
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

    func testManualNutritionValidationAndCancel() throws {
        selectTab("Macros")
        app.buttons["Log meal"].tap()
        let open = app.buttons["manual-entry-open"]
        for _ in 0..<6 where !open.isHittable { app.swipeUp() }
        open.tap()
        let save = app.buttons["manual-entry-save"]
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        save.tap()
        let error = app.staticTexts["manual-entry-error"]
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertTrue(error.label.contains("item name"))
        XCTAssertTrue(save.isEnabled)
        for _ in 0..<6 where !app.textFields["Item Name"].isHittable { app.swipeDown() }
        app.textFields["Item Name"].tap(); app.textFields["Item Name"].typeText("Homemade toast")
        let quantity = app.textFields["Quantity"]
        quantity.tap(); quantity.typeText(XCUIKeyboardKey.delete.rawValue + "2")
        for (label, value) in [("Calories", "240"), ("Protein (g)", "8"), ("Carbs (g)", "38"), ("Fat (g)", "6")] {
            let field = app.textFields[label]
            for _ in 0..<6 where !field.isHittable { app.swipeUp() }
            field.tap(); field.typeText(value)
            if name.contains("AtLargeText") && label == "Protein (g)" {
                attachTrend("Manual-nutrition-large-text-fields")
            }
        }
        XCTAssertFalse(error.exists, "Editing should clear the stale validation message")
        app.swipeDown()
        XCTAssertEqual(app.textFields["Calories"].value as? String, "240")
        if !name.contains("AtLargeText") { attachTrend("Manual-nutrition-totals") }
        if name.contains("AtLargeText") {
            let toggle = app.switches["Save as Quick Add"]
            for _ in 0..<8 where !toggle.isHittable { app.swipeUp() }
            attachTrend("Manual-nutrition-large-text-date")
        }
        app.buttons["Cancel"].firstMatch.tap()
        XCTAssertTrue(open.waitForExistence(timeout: 5))
        open.tap()
        XCTAssertEqual(app.textFields["Item Name"].value as? String, "Item Name")
        app.buttons["Cancel"].firstMatch.tap()
    }

    func testManualNutritionAtLargeText() throws {
        try testManualNutritionValidationAndCancel()
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

    func testQuickAddPortionShortcuts() throws {
        selectTab("Macros")
        app.buttons["Log meal"].tap()
        let multiplier = app.textFields["quick-multiplier"]
        for _ in 0..<5 where !multiplier.isHittable { app.swipeUp() }
        XCTAssertTrue(multiplier.waitForExistence(timeout: 5))
        let original = app.buttons["quick-multiplier-1"]
        for _ in 0..<5 where !original.isHittable || original.frame.maxY > app.frame.maxY - 40 { app.swipeUp() }
        XCTAssertTrue(original.isHittable)
        let screenshotName = "11-Quick-Add-Shortcuts" + (name.contains("AtLargeText") ? "-Large" : "")
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = screenshotName
        attachment.lifetime = .keepAlways
        add(attachment)
        snapshot(screenshotName)
        for _ in 0..<5 where !multiplier.isHittable { app.swipeDown() }
        multiplier.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        multiplier.typeText(XCUIKeyboardKey.delete.rawValue + "1.25")
        XCTAssertEqual(multiplier.value as? String, "1.25")
        XCTAssertFalse(original.isSelected)
        XCTAssertEqual(original.label, "Original portion")
        XCTAssertGreaterThanOrEqual(original.frame.width, 44, "Compact shortcuts must retain accessible touch targets")
        XCTAssertGreaterThanOrEqual(original.frame.height, 44)
        XCTAssertLessThan(original.frame.width, app.frame.width / 4, "Portion shortcuts must not expand across the sheet")
        if !name.contains("AtLargeText") {
            XCTAssertLessThanOrEqual(original.frame.height, 44, "The compact row must not inherit bordered-button padding")
        }

        let filters = app.segmentedControls["quick-source-filter"]
        for _ in 0..<5 where !filters.isHittable { app.swipeUp() }
        filters.buttons["Saved"].tap()
        XCTAssertEqual(multiplier.value as? String, "1.25", "Filtering must preserve custom portions")
        let yogurt = app.buttons["Add Greek Yogurt Bowl to meal queue"]
        for (value, preview) in [("0.5", "0.5 bowl · 155 kcal"), ("2", "2 bowl · 620 kcal"), ("1", "1 bowl · 310 kcal")] {
            let shortcut = app.buttons["quick-multiplier-\(value)"]
            for _ in 0..<5 where !shortcut.isHittable { app.swipeDown() }
            XCTAssertTrue(shortcut.isHittable)
            shortcut.tap()
            XCTAssertEqual(multiplier.value as? String, value)
            XCTAssertTrue(shortcut.isSelected)
            XCTAssertTrue((yogurt.value as? String)?.hasPrefix(preview) == true)
            for otherValue in ["0.5", "1", "2"] where otherValue != value {
                XCTAssertFalse(app.buttons["quick-multiplier-\(otherValue)"].isSelected)
            }
        }
    }

    func testQuickAddPortionShortcutsAtLargeText() throws {
        try testQuickAddPortionShortcuts()
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
