import XCTest
@testable import DailyMacros

final class CoachCandidateEngineTests: XCTestCase {
    func testProteinTrendRequiresExplicitlyCompleteEvidence() throws {
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-07-29T16:00:00Z"))
        let completeDashboard = dashboard(
            previousDays: (1...5).map { offset in
                totals(
                    day: "2026-07-\(String(format: "%02d", 29 - offset))",
                    protein: 100,
                    state: .complete
                )
            }
        )

        let completeCandidates = CoachCandidateEngine.macros(
            dashboard: completeDashboard,
            selectedDate: now,
            now: now
        )
        let proteinTrend = completeCandidates.first {
            $0.id.hasPrefix("macro-protein-shortfall-")
        }
        XCTAssertNotNil(proteinTrend)
        XCTAssertGreaterThanOrEqual(proteinTrend?.confidence ?? 0, 0.85)
        XCTAssertEqual(proteinTrend?.primaryAction?.type, .openLogMeal)

        let unknownDashboard = dashboard(
            previousDays: (1...5).map { offset in
                totals(
                    day: "2026-07-\(String(format: "%02d", 29 - offset))",
                    protein: 100,
                    state: .unknown
                )
            }
        )
        let unknownCandidates = CoachCandidateEngine.macros(
            dashboard: unknownDashboard,
            selectedDate: now,
            now: now
        )
        XCTAssertFalse(
            unknownCandidates.contains { $0.id.hasPrefix("macro-protein-shortfall-") },
            "unknown nutrition days must not become coaching evidence"
        )
    }

    func testNonAdminModeKeepsRulesAvailableWithoutExposingAdminOnlyModes() {
        XCTAssertEqual(
            CoachMode.effective(
                rawValue: CoachMode.ruleTemplates.rawValue,
                legacyEnabled: true,
                isAdmin: false
            ),
            .localModelWithTemplates
        )
        XCTAssertEqual(
            CoachMode.effective(
                rawValue: CoachMode.off.rawValue,
                legacyEnabled: true,
                isAdmin: false
            ),
            .off
        )
    }

    func testOuraSleepCanDriveRulesButCannotEnterAINarration() async throws {
        let now = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2026-08-09T16:00:00Z")
        )
        let totals = (3...8).map { day in
            SleepDailyTotals(
                day: "2026-08-\(String(format: "%02d", day))",
                totalHours: 6.5,
                targetHours: 8
            )
        }

        let suggestions = await CoachCandidateWorker.shared.sleep(
            entries: [],
            dailyTotals: totals,
            targetHours: 8,
            includesOuraData: true,
            now: now
        )

        XCTAssertTrue(suggestions.contains { $0.id.hasPrefix("sleep-below-target-") })
        XCTAssertTrue(suggestions.allSatisfy { !$0.allowsAINarration })
    }

    func testOuraRecoveryGuardrailIsRuleOnlyWithoutRestrictingOtherWorkoutRules() async throws {
        let now = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2026-08-09T16:00:00Z")
        )
        let workouts = [
            WorkoutEntry(
                id: 1,
                description: "Intervals",
                intensity: "high",
                durationHours: 0.75,
                caloriesBurned: 450,
                loggedAt: "2026-08-08T18:00:00-04:00",
                source: "manual",
                externalId: nil
            ),
            WorkoutEntry(
                id: 2,
                description: "Tempo run",
                intensity: "high",
                durationHours: 0.6,
                caloriesBurned: 400,
                loggedAt: "2026-08-07T18:00:00-04:00",
                source: "manual",
                externalId: nil
            )
        ]
        let sleepTotals = (5...8).map { day in
            SleepDailyTotals(
                day: "2026-08-\(String(format: "%02d", day))",
                totalHours: 6.5,
                targetHours: 8
            )
        }

        let suggestions = await CoachCandidateWorker.shared.workouts(
            entries: workouts,
            dailyCalories: [],
            workoutsTarget: 0,
            caloriesTarget: 0,
            sleepDailyTotals: sleepTotals,
            sleepTargetHours: 8,
            includesOuraSleepData: true,
            now: now
        )

        let recovery = suggestions.first { $0.category == "recovery" }
        XCTAssertNotNil(recovery)
        XCTAssertEqual(recovery?.allowsAINarration, false)
        XCTAssertTrue(
            suggestions.filter { $0.category != "recovery" }.allSatisfy(\.allowsAINarration)
        )
    }

    private func dashboard(previousDays: [DailyTotals]) -> DashboardResponse {
        DashboardResponse(
            currentDayTotals: totals(
                day: "2026-07-29",
                protein: 0,
                state: .unknown
            ),
            previousDays: previousDays,
            sevenDayAverage: SevenDayAverage(
                daysWithData: previousDays.count,
                calories: 1_900,
                protein: 100,
                carbs: 210,
                fat: 65
            ),
            entries: [],
            targets: MacroTargets(
                calories: 2_100,
                protein: 160,
                carbs: 220,
                fat: 70,
                workouts: 4,
                workoutCalories: 1_400,
                sleepHours: 8
            ),
            pagination: nil
        )
    }

    private func totals(
        day: String,
        protein: Double,
        state: NutritionDayState
    ) -> DailyTotals {
        DailyTotals(
            day: day,
            calories: protein > 0 ? 1_900 : 0,
            protein: protein,
            carbs: protein > 0 ? 210 : 0,
            fat: protein > 0 ? 65 : 0,
            completeness: DayCompleteness(
                day: day,
                state: state,
                explicit: state != .unknown,
                eligibleForNutritionAnalysis: state == .complete,
                suggestedState: nil,
                suggestionReason: nil,
                timezone: "America/New_York",
                updatedAt: nil
            )
        )
    }
}
