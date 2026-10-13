import XCTest
@testable import DailyMacros

final class ScopedHistoryLoadTests: XCTestCase {
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
