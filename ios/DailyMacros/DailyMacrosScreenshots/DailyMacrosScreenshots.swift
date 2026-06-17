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
        app.launch()

        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.staticTexts["Daily Totals"].waitForExistence(timeout: 15))
    }

    func testAppStoreScreenshots() throws {
        snapshot("01-Macros")

        selectTab("Workouts")
        XCTAssertTrue(app.staticTexts["Stats"].waitForExistence(timeout: 10))
        snapshot("02-Workouts")

        selectTab("Weight")
        XCTAssertTrue(app.staticTexts["Target Weight"].waitForExistence(timeout: 10))
        snapshot("03-Weight")

        selectTab("Sleep")
        XCTAssertTrue(app.staticTexts["Sleep Log"].waitForExistence(timeout: 10))
        snapshot("04-Sleep")

        selectTab("Analysis")
        XCTAssertTrue(app.staticTexts["30-Day Analysis"].waitForExistence(timeout: 10))
        snapshot("05-Analysis")
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
}
