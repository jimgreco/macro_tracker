import SwiftUI
import XCTest
@testable import DailyMacros

final class ChartSelectionTests: XCTestCase {
    private let us = Locale(identifier: "en_US")

    private var utcCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    // MARK: - Nearest index

    func testNearestIndexPicksClosestPoint() {
        let xs: [CGFloat?] = [0, 10, 20, 30]
        XCTAssertEqual(ChartSelectionMath.nearestIndex(to: 12, xPositions: xs), 1)
        XCTAssertEqual(ChartSelectionMath.nearestIndex(to: 16, xPositions: xs), 2)
    }

    func testNearestIndexTieGoesToEarlierPoint() {
        XCTAssertEqual(ChartSelectionMath.nearestIndex(to: 5, xPositions: [0, 10]), 0)
    }

    func testNearestIndexSkipsPointsWithoutValues() {
        let xs: [CGFloat?] = [0, nil, nil, 30]
        XCTAssertEqual(ChartSelectionMath.nearestIndex(to: 12, xPositions: xs), 0)
        XCTAssertEqual(ChartSelectionMath.nearestIndex(to: 18, xPositions: xs), 3)
    }

    func testNearestIndexClampsBeyondEdges() {
        let xs: [CGFloat?] = [nil, 10, 20, nil]
        XCTAssertEqual(ChartSelectionMath.nearestIndex(to: -50, xPositions: xs), 1)
        XCTAssertEqual(ChartSelectionMath.nearestIndex(to: 500, xPositions: xs), 2)
    }

    func testNearestIndexIsNilWithoutValues() {
        XCTAssertNil(ChartSelectionMath.nearestIndex(to: 5, xPositions: [nil, nil]))
        XCTAssertNil(ChartSelectionMath.nearestIndex(to: 5, xPositions: []))
    }

    func testXPositionForLinesAndBars() {
        XCTAssertEqual(ChartSelectionMath.xPosition(index: 0, count: 3, minX: 10, width: 100, centeredInSlots: false), 10)
        XCTAssertEqual(ChartSelectionMath.xPosition(index: 2, count: 3, minX: 10, width: 100, centeredInSlots: false), 110)
        XCTAssertEqual(ChartSelectionMath.xPosition(index: 0, count: 1, minX: 10, width: 100, centeredInSlots: false), 60)
        XCTAssertEqual(ChartSelectionMath.xPosition(index: 0, count: 4, minX: 0, width: 100, centeredInSlots: true), 12.5)
        XCTAssertEqual(ChartSelectionMath.xPosition(index: 3, count: 4, minX: 0, width: 100, centeredInSlots: true), 87.5)
    }

    // MARK: - Tap and VoiceOver selection rules

    func testTapSelectsMovesAndClears() {
        XCTAssertEqual(ChartSelectionMath.selection(afterTapping: 2, current: nil), 2)
        XCTAssertEqual(ChartSelectionMath.selection(afterTapping: 4, current: 2), 4)
        XCTAssertNil(ChartSelectionMath.selection(afterTapping: 2, current: 2), "Tapping the selected point clears it")
        XCTAssertNil(ChartSelectionMath.selection(afterTapping: nil, current: 2), "Tapping outside the plot clears it")
    }

    func testAdjustableStepsThroughPointsWithValues() {
        let selectable = [0, 2, 5]
        XCTAssertEqual(ChartSelectionMath.adjustedSelection(nil, increment: true, selectable: selectable), 0)
        XCTAssertEqual(ChartSelectionMath.adjustedSelection(nil, increment: false, selectable: selectable), 5)
        XCTAssertEqual(ChartSelectionMath.adjustedSelection(0, increment: true, selectable: selectable), 2)
        XCTAssertEqual(ChartSelectionMath.adjustedSelection(2, increment: false, selectable: selectable), 0)
        XCTAssertEqual(ChartSelectionMath.adjustedSelection(5, increment: true, selectable: selectable), 5, "Stops at the end")
        XCTAssertEqual(ChartSelectionMath.adjustedSelection(0, increment: false, selectable: selectable), 0, "Stops at the start")
        XCTAssertEqual(ChartSelectionMath.adjustedSelection(3, increment: true, selectable: selectable), 5)
        XCTAssertEqual(ChartSelectionMath.adjustedSelection(3, increment: false, selectable: selectable), 2)
        XCTAssertNil(ChartSelectionMath.adjustedSelection(nil, increment: true, selectable: []))
    }

    // MARK: - Callout placement

    private let bounds = CGSize(width: 300, height: 140)
    private let pill = CGSize(width: 90, height: 18)

    func testCalloutSitsCenteredAbovePoint() {
        let origin = ChartSelectionMath.calloutOrigin(anchor: CGPoint(x: 150, y: 80), calloutSize: pill, bounds: bounds)
        XCTAssertEqual(origin.x, 105)
        XCTAssertEqual(origin.y, 80 - 4 - 4 - 18)
    }

    func testCalloutClampsToLeftAndRightEdges() {
        let left = ChartSelectionMath.calloutOrigin(anchor: CGPoint(x: 10, y: 80), calloutSize: pill, bounds: bounds)
        XCTAssertEqual(left.x, 0)
        let right = ChartSelectionMath.calloutOrigin(anchor: CGPoint(x: 295, y: 80), calloutSize: pill, bounds: bounds)
        XCTAssertEqual(right.x, 300 - 90)
    }

    func testCalloutFlipsBelowNearTop() {
        let origin = ChartSelectionMath.calloutOrigin(anchor: CGPoint(x: 150, y: 12), calloutSize: pill, bounds: bounds)
        XCTAssertEqual(origin.y, 12 + 4 + 4)
        XCTAssertEqual(origin.x, 105)
    }

    func testCalloutGoesBesideWhenChartIsShort() {
        let short = CGSize(width: 300, height: 30)
        let rightSide = ChartSelectionMath.calloutOrigin(anchor: CGPoint(x: 100, y: 15), calloutSize: pill, bounds: short, clearance: 5)
        XCTAssertEqual(rightSide.x, 100 + 5 + 4)
        XCTAssertEqual(rightSide.y, 15 - 9)
        let flipped = ChartSelectionMath.calloutOrigin(anchor: CGPoint(x: 280, y: 15), calloutSize: pill, bounds: short, clearance: 5)
        XCTAssertEqual(flipped.x, 280 - 5 - 4 - 90, "Flips to the left near the right edge")
    }

    func testCalloutStaysInsideBounds() {
        let anchors = [CGPoint(x: 0, y: 0), CGPoint(x: 300, y: 140), CGPoint(x: 0, y: 140), CGPoint(x: 300, y: 0), CGPoint(x: 150, y: 70)]
        for size in [bounds, CGSize(width: 300, height: 30), CGSize(width: 120, height: 42)] {
            for anchor in anchors {
                let origin = ChartSelectionMath.calloutOrigin(anchor: anchor, calloutSize: pill, bounds: size, clearance: 5)
                XCTAssertGreaterThanOrEqual(origin.x, 0)
                XCTAssertGreaterThanOrEqual(origin.y, 0)
                XCTAssertLessThanOrEqual(origin.x + pill.width, size.width)
                XCTAssertLessThanOrEqual(origin.y + pill.height, size.height)
            }
        }
    }

    // MARK: - Formatting

    func testActivityFormats() {
        XCTAssertEqual(ChartValueFormat.metric(5.66, unit: "mi", locale: us), "5.7 mi")
        XCTAssertEqual(ChartValueFormat.miles(5.66, locale: us), "5.7 mi")
        XCTAssertEqual(ChartValueFormat.metric(12345.4, unit: "steps", locale: us), "12,345 steps")
        XCTAssertEqual(ChartValueFormat.steps(8432, locale: us), "8,432 steps")
        XCTAssertEqual(ChartValueFormat.metric(61.6, unit: "bpm", locale: us), "62 bpm")
        XCTAssertEqual(ChartValueFormat.bpm(58, locale: us), "58 bpm")
        XCTAssertEqual(ChartValueFormat.metric(1420.2, unit: "kcal", locale: us), "1,420 kcal")
        XCTAssertEqual(ChartValueFormat.kcal(420, locale: us), "420 kcal")
        XCTAssertEqual(ChartValueFormat.milliseconds(48.4, locale: us), "48 ms")
    }

    func testSleepHoursFormat() {
        XCTAssertEqual(ChartValueFormat.sleepHours(7.5), "7h 30m")
        XCTAssertEqual(ChartValueFormat.sleepHours(8), "8h")
        XCTAssertEqual(ChartValueFormat.sleepHours(0.75), "45m")
        XCTAssertEqual(ChartValueFormat.sleepHours(6.999), "7h")
        XCTAssertEqual(ChartValueFormat.spokenSleepHours(7.5), "7 hours 30 minutes")
        XCTAssertEqual(ChartValueFormat.spokenSleepHours(1.0 + 1.0 / 60), "1 hour 1 minute")
    }

    func testWeightAndMacroFormats() {
        XCTAssertEqual(ChartValueFormat.weight(182.44, locale: us), "182.4 lbs")
        XCTAssertEqual(ChartValueFormat.weight(180, locale: us), "180.0 lbs")
        XCTAssertEqual(ChartValueFormat.macro(2150.4, macro: "calories", locale: us), "2,150 cal")
        XCTAssertEqual(ChartValueFormat.macro(141.6, macro: "protein", locale: us), "142 g")
    }

    func testDayFormat() {
        XCTAssertEqual(ChartValueFormat.day(isoDay: "2026-11-11", calendar: utcCalendar, locale: us), "Nov 11")
        XCTAssertEqual(ChartValueFormat.day(isoDay: "2026-01-02T08:00:00.000Z", calendar: utcCalendar, locale: us), "Jan 2")
        XCTAssertEqual(ChartValueFormat.day(isoDay: "not a day", calendar: utcCalendar, locale: us), "not a day")
        let date = utcCalendar.date(from: DateComponents(year: 2026, month: 11, day: 11, hour: 12))!
        XCTAssertEqual(ChartValueFormat.day(date, calendar: utcCalendar, locale: us), "Nov 11")
    }

    func testCalloutText() {
        let text = ChartCalloutText(value: "5.7 mi", date: "Nov 11")
        XCTAssertEqual(text.text, "5.7 mi · Nov 11")
        XCTAssertEqual(text.accessibilityText, "5.7 mi, Nov 11")
        XCTAssertEqual(ChartCalloutText(value: "5.7 mi", date: "Nov 11", spoken: "5.7 miles, Wednesday").accessibilityText, "5.7 miles, Wednesday")
    }

    func testSharedSelectionKeepsOneChartSelected() {
        var state: ChartSelectionKey?
        let binding = Binding(get: { state }, set: { state = $0 })
        let steps = ChartSelectionKey.binding(binding, chart: "Steps")
        let distance = ChartSelectionKey.binding(binding, chart: "Distance")
        steps.wrappedValue = 3
        XCTAssertEqual(steps.wrappedValue, 3)
        XCTAssertNil(distance.wrappedValue)
        distance.wrappedValue = nil
        XCTAssertEqual(steps.wrappedValue, 3, "Clearing another chart leaves this one selected")
        distance.wrappedValue = 1
        XCTAssertNil(steps.wrappedValue)
        XCTAssertEqual(distance.wrappedValue, 1)
    }
}
