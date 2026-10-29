import XCTest
@testable import DailyMacros

final class ScopedHistoryLoadTests: XCTestCase {
    func testAccountAndTimezoneChangesRejectTheSameDayResponse() throws {
        var load = ScopedHistoryLoad()
        let request = try XCTUnwrap(load.begin(scope: "account-a|America/New_York|2026-10-23"))
        XCTAssertFalse(load.isCurrent(request, scope: "account-b|America/New_York|2026-10-23"))
        XCTAssertFalse(load.isCurrent(request, scope: "account-a|Pacific/Honolulu|2026-10-23"))
        let replacement = try XCTUnwrap(load.begin(scope: "account-b|America/New_York|2026-10-23"))
        load.finish(request)
        XCTAssertTrue(load.isLoading)
        XCTAssertTrue(load.isCurrent(replacement, scope: replacement.scope))
    }
    func testChangingPeriodStartsNewRequestWhilePreviousPeriodIsLoading() throws {
        var load = ScopedHistoryLoad()
        let week = try XCTUnwrap(load.begin(scope: "week"))
        let month = try XCTUnwrap(load.begin(scope: "month"))
        XCTAssertFalse(load.isCurrent(week, scope: "month"))
        XCTAssertTrue(load.isCurrent(month, scope: "month"))
        load.finish(week)
        XCTAssertTrue(load.isLoading, "A late response must not dismiss the new period's loading state")
        load.finish(month)
        XCTAssertFalse(load.isLoading)
    }

    func testReturningToSamePeriodDoesNotAcceptItsEarlierResponse() throws {
        var load = ScopedHistoryLoad()
        let firstWeek = try XCTUnwrap(load.begin(scope: "week"))
        _ = load.begin(scope: "month")
        let latestWeek = try XCTUnwrap(load.begin(scope: "week"))
        XCTAssertFalse(load.isCurrent(firstWeek, scope: "week"))
        XCTAssertTrue(load.isCurrent(latestWeek, scope: "week"))
    }

    func testRefreshSupersedesInFlightNextPageWithoutAllowingOverlappingPagination() throws {
        var load = ScopedHistoryLoad()
        let initial = try XCTUnwrap(load.begin(scope: "month"))
        XCTAssertNil(load.begin(scope: "month", reset: false))
        load.finish(initial)
        let nextPage = try XCTUnwrap(load.begin(scope: "month", reset: false))
        XCTAssertNil(load.begin(scope: "month", reset: false))
        let refresh = try XCTUnwrap(load.begin(scope: "month"))
        XCTAssertFalse(load.isCurrent(nextPage, scope: "month"))
        load.finish(nextPage)
        XCTAssertTrue(load.isLoading)
        XCTAssertTrue(load.isCurrent(refresh, scope: "month"))
    }

    func testScopeChangeRejectsLateDataBeforeTheNextRefreshTaskBegins() throws {
        var load = ScopedHistoryLoad()
        let oldDay = try XCTUnwrap(load.begin(scope: "2026-10-11"))
        XCTAssertFalse(load.isCurrent(oldDay, scope: "2026-10-12"))
        XCTAssertNil(load.begin(scope: "2026-10-12", reset: false))
        load.finish(oldDay)
        XCTAssertNil(load.begin(scope: "2026-10-12", reset: false), "Do not page the previous date's list")
        XCTAssertNotNil(load.begin(scope: "2026-10-12"))
    }

    func testLatestRequestCanFinishAndRetryAfterFailure() throws {
        var load = ScopedHistoryLoad()
        let failed = try XCTUnwrap(load.begin(scope: "year"))
        load.finish(failed)
        XCTAssertFalse(load.isLoading)
        let retry = try XCTUnwrap(load.begin(scope: "year"))
        XCTAssertFalse(load.isCurrent(failed, scope: "year"))
        XCTAssertTrue(load.isCurrent(retry, scope: "year"))
    }
}

final class NutritionDayReviewTests: XCTestCase {
    private let zone = TimeZone(identifier: "America/New_York")!
    private let now = ISO8601DateFormatter().date(from: "2026-10-21T02:00:00Z")!

    private func row(_ day: String, _ state: NutritionDayState?, calories: Double = 0) -> DailyTotals {
        DailyTotals(day: day, calories: calories, protein: 0, carbs: 0, fat: 0,
                    completeness: state.map {
                        DayCompleteness(day: day, state: $0, explicit: $0 != .unknown,
                                        eligibleForNutritionAnalysis: true, suggestedState: .complete,
                                        suggestionReason: "Suggestion does not mark a day complete",
                                        timezone: zone.identifier, updatedAt: nil)
                    })
    }

    func testAllRangesEnumerateExactAccountLocalDatesNewestFirst() {
        for (scope, count, first) in [("week", 7, "2026-10-14"), ("month", 30, "2026-09-21"),
                                      ("year", 365, "2025-10-21")] {
            let review = NutritionDayReview(rows: [], scope: scope, today: now, timeZone: zone)
            XCTAssertEqual(review.days.count, count)
            XCTAssertEqual(Set(review.days.map(\.day)).count, count)
            XCTAssertEqual(review.days.first?.day, "2026-10-20")
            XCTAssertEqual(review.days.last?.day, first)
            XCTAssertEqual(review.days(matching: .needsReview).count, count)
            XCTAssertTrue(review.days(matching: .complete).isEmpty)
        }
    }

    func testReviewFiltersUseOnlyExplicitStatusIncludingZeroAndMissingDays() {
        let input = [row("2026-10-20", .partial, calories: 9000), row("2026-10-19", .complete),
                     row("2026-10-18", .unknown, calories: 9000), row("2026-10-17", nil, calories: 9000),
                     row("2026-10-21", .complete), row("2026-10-13", .complete)]
        let review = NutritionDayReview(rows: input, scope: "week", today: now, timeZone: zone)
        XCTAssertEqual(review.days(matching: .complete).map(\.day), ["2026-10-19"])
        XCTAssertEqual(review.days(matching: .needsReview).map(\.day),
                       ["2026-10-20", "2026-10-18", "2026-10-17", "2026-10-16", "2026-10-15", "2026-10-14"])
        XCTAssertEqual(review.days(matching: .all).count, 7)
        XCTAssertEqual(review.days.map(\.statusLabel), ["Partial", "Complete", "Unmarked", "Unmarked", "Unmarked", "Unmarked", "Unmarked"])
        XCTAssertEqual(input.count, 6)
        XCTAssertEqual(input.first?.completeness?.state, .partial)
    }

    func testMarkingAndReopeningChangesMembershipWithoutChangingDateOrder() {
        for status in [NutritionDayState.partial, .complete, .partial] {
            let review = NutritionDayReview(rows: [row("2026-10-20", status)], scope: "week", today: now, timeZone: zone)
            XCTAssertEqual(review.days(matching: .complete).count, status == .complete ? 1 : 0)
            XCTAssertEqual(review.days(matching: .needsReview).count, status == .complete ? 6 : 7)
            XCTAssertEqual(review.days.first?.day, "2026-10-20")
        }
    }

    func testCalendarNavigationAcrossDSTAndLeapDay() throws {
        for (instant, expected) in [
            ("2026-03-10T03:30:00Z", ["2026-03-09", "2026-03-08", "2026-03-07", "2026-03-06", "2026-03-05", "2026-03-04", "2026-03-03"]),
            ("2024-03-03T02:00:00Z", ["2024-03-02", "2024-03-01", "2024-02-29", "2024-02-28", "2024-02-27", "2024-02-26", "2024-02-25"])
        ] {
            let date = try XCTUnwrap(ISO8601DateFormatter().date(from: instant))
            let review = NutritionDayReview(rows: [], scope: "week", today: date, timeZone: zone)
            XCTAssertEqual(review.days.map(\.day), expected)
            let formatter = DateFormatter()
            formatter.timeZone = zone
            formatter.dateFormat = "yyyy-MM-dd"
            XCTAssertEqual(review.days.map { formatter.string(from: $0.date) }, expected,
                           "Selecting a row must open its exact account-local date")
        }
    }

    func testSameInstantUsesAccountTimezoneAndMalformedOrDuplicateRowsCannotAddDays() {
        let input = [row("not-a-date", .complete), row("2026-10-20", .complete), row("2026-10-20", .partial)]
        let western = NutritionDayReview(rows: input, scope: "week", today: now, timeZone: zone)
        let eastern = NutritionDayReview(rows: input, scope: "week", today: now,
                                        timeZone: TimeZone(identifier: "Asia/Tokyo")!)
        XCTAssertEqual(western.days.first?.day, "2026-10-20")
        XCTAssertEqual(eastern.days.first?.day, "2026-10-21")
        XCTAssertEqual(western.days.count, 7)
        XCTAssertEqual(western.days.first?.statusLabel, "Partial")
    }
}

final class TargetHistoryDecodingTests: XCTestCase {
    func testDayScopedWeightAndWorkoutTargetsRemainAttachedToHistoryRows() throws {
        let weightJSON = Data(
            """
            [
              {
                "id": 1,
                "weight": 184.2,
                "loggedAt": "2026-07-01T12:00:00.000Z",
                "day": "2026-07-01",
                "targetWeight": 180,
                "targetDate": "2026-10-01",
                "source": "manual",
                "externalId": null
              },
              {
                "id": 2,
                "weight": 181.8,
                "loggedAt": "2026-07-20T12:00:00.000Z",
                "day": "2026-07-20",
                "targetWeight": 175,
                "targetDate": "2026-12-31",
                "source": "manual",
                "externalId": null
              }
            ]
            """.utf8
        )
        let weights = try JSONDecoder().decode([WeightEntry].self, from: weightJSON)
        XCTAssertEqual(weights.map(\.targetWeight), [180, 175])
        XCTAssertEqual(weights.map(\.targetDate), ["2026-10-01", "2026-12-31"])

        let workoutJSON = Data(
            """
            [
              {
                "day": "2026-07-01",
                "calories": 420,
                "targetCalories": 1200,
                "targetWorkouts": 3
              },
              {
                "day": "2026-07-20",
                "calories": 510,
                "targetCalories": 1600,
                "targetWorkouts": 4
              }
            ]
            """.utf8
        )
        let workouts = try JSONDecoder().decode(
            [WorkoutDailyCalories].self,
            from: workoutJSON
        )
        XCTAssertEqual(workouts.map(\.targetCalories), [1_200, 1_600])
        XCTAssertEqual(workouts.map(\.targetWorkouts), [3, 4])
    }

    func testMacroTargetWireKeysDecodeTheHistoricalTargetContract() throws {
        let data = Data(
            """
            {
              "calories": 2100,
              "protein": 160,
              "carbs": 220,
              "fat": 70,
              "workouts": 4,
              "workout_calories": 1400,
              "sleep_hours": 8
            }
            """.utf8
        )
        let targets = try JSONDecoder().decode(MacroTargets.self, from: data)
        XCTAssertEqual(targets.workoutCalories, 1_400)
        XCTAssertEqual(targets.sleepHours, 8)
    }
}

final class QuickAddPortionTests: XCTestCase {
    private var yogurt: QuickAddTemplate {
        QuickAddTemplate(id: "recent-yogurt", savedItemId: nil, name: "Yogurt", quantity: 170,
                         unit: "g", calories: 120, protein: 18, carbs: 9, fat: 1, lastUsedAt: nil)
    }

    func testHalfPortionScalesQuantityAndNutritionWithoutMutatingTemplate() throws {
        let template = yogurt
        let portion = try XCTUnwrap(template.portion(multiplierText: "0.5"))
        XCTAssertEqual(portion.quantity, 85)
        XCTAssertEqual(portion.calories, 60)
        XCTAssertEqual(portion.protein, 9)
        XCTAssertEqual(portion.carbs, 4.5)
        XCTAssertEqual(portion.fat, 0.5)
        XCTAssertEqual(template.quantity, 170)
        XCTAssertEqual(template.calories, 120)
    }

    func testShortcutsUseTheSamePortionCalculationAsCustomInput() throws {
        for shortcut in QuickAddMultiplierShortcut.allCases {
            let multiplier = try XCTUnwrap(Double(shortcut.rawValue))
            let portion = try XCTUnwrap(yogurt.portion(multiplierText: shortcut.rawValue))
            XCTAssertEqual(portion.quantity, 170 * multiplier)
            XCTAssertEqual(portion.calories, 120 * multiplier)
            XCTAssertTrue(shortcut.isSelected(multiplierText: shortcut.rawValue))
        }
        XCTAssertTrue(QuickAddMultiplierShortcut.half.isSelected(multiplierText: ".50"))
        XCTAssertTrue(QuickAddMultiplierShortcut.original.isSelected(multiplierText: "1.0"))
        XCTAssertTrue(QuickAddMultiplierShortcut.double.isSelected(multiplierText: "2.00"))
        for text in ["1.25", "0.75", "", "  ", "0", "-1", "banana", "nan", "inf"] {
            XCTAssertFalse(QuickAddMultiplierShortcut.allCases.contains { $0.isSelected(multiplierText: text) }, text)
        }
    }

    func testMealPreviewExactlyMatchesScaledComponentsUsedByQueue() throws {
        let components = [
            SavedItemComponent(itemName: "Yogurt", quantity: 170, unit: "g", calories: 120, protein: 10, carbs: 15, fat: 5),
            SavedItemComponent(itemName: "Granola", quantity: 20, unit: "g", calories: 80, protein: 5, carbs: 5, fat: 2)
        ]
        let template = QuickAddTemplate(id: "saved-meal", savedItemId: 1, name: "Breakfast", quantity: 2,
                                        unit: "serving", calories: 400, protein: 30, carbs: 40, fat: 14,
                                        components: components, lastUsedAt: nil)
        let portion = try XCTUnwrap(template.portion(multiplierText: "1.5"))
        XCTAssertEqual(portion.quantity, 3)
        XCTAssertEqual(portion.components.map(\.quantity), [510, 60])
        XCTAssertEqual(portion.calories, 600)
        XCTAssertEqual(portion.calories, portion.components.reduce(0) { $0 + $1.calories })
        XCTAssertEqual(portion.protein, portion.components.reduce(0) { $0 + $1.protein })
        XCTAssertEqual(portion.carbs, portion.components.reduce(0) { $0 + $1.carbs })
        XCTAssertEqual(portion.fat, portion.components.reduce(0) { $0 + $1.fat })
        XCTAssertEqual(template.components, components)
    }

    func testBlankMultiplierDefaultsToOneAndInvalidValuesCannotBeQueued() throws {
        for text in ["", "  \n ", "1"] {
            XCTAssertEqual(try XCTUnwrap(yogurt.portion(multiplierText: text)).quantity, 170)
        }
        for text in ["0", "-1", "banana", "nan", "inf", "1e300"] {
            XCTAssertNil(yogurt.portion(multiplierText: text), text)
        }
    }
}

final class QuickAddSourceFilterTests: XCTestCase {
    private func item(_ id: Int, saved: Bool, name: String = "Rice bowl") -> QuickAddTemplate {
        QuickAddTemplate(id: "item-\(id)", savedItemId: saved ? id : nil, name: name, quantity: 1, unit: "bowl", calories: 200, protein: 10, carbs: 20, fat: 5, lastUsedAt: nil)
    }
    func testSourceFiltersBeforeTheDisplayLimitAndKeepsSearchWithinSource() {
        let templates = (1...45).map { item($0, saved: true) } + [item(46, saved: false, name: "Recent rice")]
        let recent = QuickAddSourceFilter.recent.display(templates: templates, query: " RICE  recent ", limit: 40)
        XCTAssertEqual(recent.items.map(\.id), ["item-46"])
        XCTAssertFalse(recent.hasMore)
        XCTAssertTrue(recent.isSearching)
        let saved = QuickAddSourceFilter.saved.display(templates: templates, query: "", limit: 40)
        XCTAssertEqual(saved.items.count, 40)
        XCTAssertTrue(saved.hasMore)
        XCTAssertTrue(saved.items.allSatisfy(\.isSaved))
        XCTAssertTrue(QuickAddSourceFilter.saved.display(templates: templates, query: "recent", limit: 40).items.isEmpty)
        XCTAssertEqual(QuickAddSourceFilter.all.display(templates: templates, query: "recent", limit: 40).items.first?.id, "item-46")
    }
    func testEmptySourceDoesNotFallbackToOtherItems() {
        let templates = [item(1, saved: true)]
        XCTAssertTrue(QuickAddSourceFilter.recent.display(templates: templates, query: "", limit: 40).items.isEmpty)
        XCTAssertEqual(templates.count, 1)
    }
}


final class MacroTrendSummaryTests: XCTestCase {
    private let zone = TimeZone(identifier: "America/New_York")!
    private let now = ISO8601DateFormatter().date(from: "2026-10-21T02:00:00Z")!

    private func row(_ day: String, _ state: NutritionDayState?, _ calories: Double) -> DailyTotals {
        DailyTotals(day: day, calories: calories, protein: calories / 20,
                    carbs: calories / 10, fat: calories / 40,
                    completeness: state.map {
                        DayCompleteness(day: day, state: $0, explicit: $0 != .unknown,
                                        eligibleForNutritionAnalysis: true, suggestedState: .complete,
                                        suggestionReason: nil, timezone: zone.identifier, updatedAt: nil)
                    })
    }

    func testFiberExcludesUnknownAndPartialDaysButKeepsZero() {
        var known = row("2026-10-20", .complete, 2000)
        known.fiber = 30
        var zero = row("2026-10-19", .complete, 2000)
        zero.fiber = 0
        let unknown = row("2026-10-18", .complete, 2000)
        var partial = row("2026-10-17", .partial, 2000)
        partial.fiber = 90
        for scope in ["week", "month", "year"] {
            let summary = MacroTrendSummary(rows: [known, zero, unknown, partial], scope: scope, today: now, timeZone: zone)
            XCTAssertEqual(summary.average(for: "fiber"), 15)
            XCTAssertEqual(summary.rows(for: "fiber").count, 2)
            XCTAssertEqual(summary.completeDays, 3)
            let missing = MacroTrendSummary(rows: [unknown], scope: scope, today: now, timeZone: zone)
            XCTAssertNil(missing.average(for: "fiber"))
        }
    }

    func testCoverageIncludesEveryCalendarDateAndOnlyExplicitStatuses() {
        for (scope, days, firstDay, excludedDay) in [("week", 7, "2026-10-14", "2026-10-13"),
                                                    ("month", 30, "2026-09-21", "2026-09-20"),
                                                    ("year", 365, "2025-10-21", "2025-10-20")] {
            let input = [row("2026-10-20", .partial, 400), row("2026-10-19", .complete, 0),
                         row("2026-10-18", .unknown, 9000), row("2026-10-17", nil, 9000),
                         row(firstDay, .complete, 1200), row(excludedDay, .partial, 9000),
                         row("2026-10-21", .complete, 9000)]
            let summary = MacroTrendSummary(rows: input, scope: scope, today: now, timeZone: zone)
            XCTAssertEqual(summary.periodDays, days)
            XCTAssertEqual(summary.completeDays, 2)
            XCTAssertEqual(summary.partialDays, 1)
            XCTAssertEqual(summary.unmarkedDays, days - 3)
            XCTAssertEqual(summary.completeDays + summary.partialDays + summary.unmarkedDays, days)
        }
    }

    func testCoverageRecomputesWhenTodayIsCompletedAndReopened() {
        for scope in ["week", "month", "year"] {
            for status in [NutritionDayState.partial, .complete, .partial] {
                let summary = MacroTrendSummary(rows: [row("2026-10-20", status, 0)],
                                                scope: scope, today: now, timeZone: zone)
                XCTAssertEqual(summary.completeDays, status == .complete ? 1 : 0)
                XCTAssertEqual(summary.partialDays, status == .partial ? 1 : 0)
                XCTAssertEqual(summary.unmarkedDays, summary.periodDays - 1)
            }
        }
    }

    func testEmptyAndFullyCompletedCoverageAcrossAllRanges() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = zone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        for scope in ["week", "month", "year"] {
            let empty = MacroTrendSummary(rows: [], scope: scope, today: now, timeZone: zone)
            XCTAssertEqual(empty.completeDays, 0)
            XCTAssertEqual(empty.partialDays, 0)
            XCTAssertEqual(empty.unmarkedDays, empty.periodDays)
            let rows = (0..<empty.periodDays).map { offset in
                row(formatter.string(from: calendar.date(byAdding: .day, value: -offset, to: now)!), .complete, 0)
            }
            let full = MacroTrendSummary(rows: rows, scope: scope, today: now, timeZone: zone)
            XCTAssertEqual(full.completeDays, full.periodDays)
            XCTAssertEqual(full.partialDays, 0)
            XCTAssertEqual(full.unmarkedDays, 0)
        }
    }

    func testAllMacrosUseOnlyExplicitlyCompleteDaysIncludingZeroEntryDays() throws {
        let input = [row("2026-10-20", .partial, 400), row("2026-10-19", .complete, 2000),
                     row("2026-10-18", .unknown, 3000), row("2026-10-17", .complete, 0),
                     row("2026-10-16", nil, 9000)]
        let summary = MacroTrendSummary(rows: input, scope: "week", today: now, timeZone: zone)
        XCTAssertEqual(summary.rows.map(\.day), ["2026-10-19", "2026-10-17"])
        for (macro, expected) in [("calories", 1000.0), ("protein", 50.0), ("carbs", 100.0), ("fat", 25.0)] {
            XCTAssertEqual(try XCTUnwrap(summary.average(for: macro)), expected)
        }
        XCTAssertEqual(input.count, 5, "Raw rows remain available to unrelated consumers")
        XCTAssertEqual(input[0].completeness?.state, .partial)
    }

    func testTodayEntersAndLeavesSampleWhenCompletedAndReopened() throws {
        for (status, expected, count) in [(NutritionDayState.partial, 2000.0, 1), (.complete, 1200.0, 2), (.partial, 2000.0, 1)] {
            let summary = MacroTrendSummary(rows: [row("2026-10-19", .complete, 2000), row("2026-10-20", status, 400)],
                                            scope: "week", today: now, timeZone: zone)
            XCTAssertEqual(summary.rows.count, count)
            XCTAssertEqual(try XCTUnwrap(summary.average(for: "calories")), expected)
        }
    }

    func testAllRangesUseAccountLocalTodayAndExactInclusiveBoundaries() {
        for (scope, firstDay, excludedDay) in [("week", "2026-10-14", "2026-10-13"),
                                              ("month", "2026-09-21", "2026-09-20"),
                                              ("year", "2025-10-21", "2025-10-20")] {
            let summary = MacroTrendSummary(rows: [row(excludedDay, .complete, 9000), row(firstDay, .complete, 1000),
                                                   row("2026-10-20", .complete, 2000), row("2026-10-21", .complete, 9000)],
                                            scope: scope, today: now, timeZone: zone)
            XCTAssertEqual(summary.rows.map(\.day), [firstDay, "2026-10-20"], scope)
        }
    }

    func testNoCompletedDaysHasNoAverageButOneCompleteEmptyDayHasZeroAverage() throws {
        for scope in ["week", "month", "year"] {
            let absent = MacroTrendSummary(rows: [row("2026-10-20", .partial, 400)], scope: scope, today: now, timeZone: zone)
            let empty = MacroTrendSummary(rows: [row("2026-10-20", .complete, 0)], scope: scope, today: now, timeZone: zone)
            for macro in ["calories", "protein", "carbs", "fat"] {
                XCTAssertNil(absent.average(for: macro))
                XCTAssertEqual(try XCTUnwrap(empty.average(for: macro)), 0)
            }
        }
    }

    func testCalendarWindowAcrossDaylightSavingTime() {
        let dstNow = ISO8601DateFormatter().date(from: "2026-03-10T03:30:00Z")!
        let summary = MacroTrendSummary(rows: [row("2026-03-02", .complete, 9000), row("2026-03-03", .complete, 1000),
                                               row("2026-03-09", .complete, 2000), row("2026-03-10", .complete, 9000)],
                                        scope: "week", today: dstNow, timeZone: zone)
        XCTAssertEqual(summary.rows.map(\.day), ["2026-03-03", "2026-03-09"])
    }
}

final class ManualNutritionDraftTests: XCTestCase {
    private var valid: ManualNutritionDraft {
        ManualNutritionDraft(name: "Toast", quantity: "2", unit: "slices", calories: "240", protein: "8", carbs: "38", fat: "6", fiber: "")
    }
    func testPortionTotalsAreNotScaledAndUnknownFiberIsNull() throws {
        let item = try valid.item()
        XCTAssertEqual(item["quantity"] as? Double, 2)
        XCTAssertEqual(item["calories"] as? Double, 240)
        XCTAssertTrue(item["fiber"] is NSNull)
        XCTAssertEqual(item["source"] as? String, "manual")
        XCTAssertEqual(item["needsReview"] as? Bool, false)
        var zero = valid
        zero.fiber = "0"
        XCTAssertEqual(try zero.item()["fiber"] as? Double, 0)
    }
    func testValidationRejectsMissingNegativeNonfiniteAndOutOfRangeValues() {
        for field in ["name", "quantity", "calories", "protein", "fiber"] {
            var draft = valid
            switch field {
            case "name": draft.name = " "
            case "quantity": draft.quantity = "0"
            case "calories": draft.calories = ""
            case "protein": draft.protein = "nan"
            default: draft.fiber = "-1"
            }
            XCTAssertThrowsError(try draft.item(), field)
        }
        var excessive = valid
        excessive.carbs = "5001"
        XCTAssertThrowsError(try excessive.item())
    }
}
