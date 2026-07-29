import XCTest
@testable import DailyMacros

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
