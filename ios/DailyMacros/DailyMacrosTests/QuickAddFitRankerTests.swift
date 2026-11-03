import XCTest
@testable import DailyMacros

final class QuickAddFitRankerTests: XCTestCase {
    private func item(_ id: Int, _ name: String, calories: Double, protein: Double, usage: Int = 0) -> SavedItem {
        SavedItem(
            id: id,
            name: name,
            quantity: 1,
            unit: "serving",
            calories: calories,
            protein: protein,
            carbs: 0,
            fat: 0,
            components: nil,
            usageCount: usage
        )
    }

    private func remaining(calories: Double?, protein: Double?) -> TodayMacroRemaining {
        TodayMacroRemaining(calories: calories, protein: protein, carbs: nil, fat: nil)
    }

    func testRanksProteinDenseItemsWithinRemainingCalories() {
        let items = [
            item(1, "Greek yogurt", calories: 150, protein: 20, usage: 4),
            item(2, "Granola bar", calories: 200, protein: 4, usage: 30),
            item(3, "Steak dinner", calories: 900, protein: 70, usage: 2),
            item(4, "Protein shake", calories: 160, protein: 30, usage: 10),
            item(5, "Water", calories: 0, protein: 0)
        ]
        let fits = QuickAddFitRanker.rank(savedItems: items, remaining: remaining(calories: 500, protein: 25))
        XCTAssertEqual(fits.map(\.name), ["Protein shake", "Greek yogurt", "Granola bar"])
        XCTAssertEqual(fits[0].detail, "Closes protein · 340 cal left")
        XCTAssertEqual(fits[1].detail, "Leaves 350 cal · 5g protein")
    }

    func testPenalizesItemsThatCrowdOutTheProteinGoal() {
        let items = [
            item(1, "Turkey Wrap", calories: 520, protein: 38),
            item(2, "Cottage Cheese", calories: 260, protein: 24)
        ]
        let fits = QuickAddFitRanker.rank(savedItems: items, remaining: remaining(calories: 594, protein: 79))
        XCTAssertEqual(fits.first?.name, "Cottage Cheese")
    }

    func testStaysQuietWhenCalorieBudgetIsSpentOrUnknown() {
        let apple = [item(1, "Apple", calories: 95, protein: 0)]
        XCTAssertTrue(QuickAddFitRanker.rank(savedItems: apple, remaining: remaining(calories: 30, protein: 20)).isEmpty)
        XCTAssertTrue(QuickAddFitRanker.rank(savedItems: apple, remaining: remaining(calories: nil, protein: nil)).isEmpty)
        let proteinMet = QuickAddFitRanker.rank(savedItems: apple, remaining: remaining(calories: 300, protein: 0))
        XCTAssertEqual(proteinMet.first?.detail, "205 cal left after")
    }
}
