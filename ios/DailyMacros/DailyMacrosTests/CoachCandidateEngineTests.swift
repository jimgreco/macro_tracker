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
