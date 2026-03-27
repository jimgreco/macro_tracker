import Foundation

// MARK: - API Response Types

struct User: Codable {
    let id: String
    let name: String?
    let email: String?
    let picture: String?
    let provider: String?
}

struct MeResponse: Codable {
    let user: User?
}

struct Entry: Codable, Identifiable {
    let id: Int
    let itemName: String
    let quantity: Double
    let unit: String?
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
    let consumedAt: String
    let day: String?
    let mealGroup: String?
    let mealName: String?
    let mealQuantity: Double?
    let mealUnit: String?
}

struct DailyTotals: Codable {
    let day: String
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
}

struct SevenDayAverage: Codable {
    let daysWithData: Int
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
}

struct MacroTargets: Codable {
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
    let workouts: Double
    let workoutCalories: Double?

    enum CodingKeys: String, CodingKey {
        case calories, protein, carbs, fat, workouts
        case workoutCalories = "workout_calories"
    }
}

struct Pagination: Codable {
    let limit: Int
    let offset: Int
    let returned: Int
}

struct DashboardResponse: Codable {
    let currentDayTotals: DailyTotals
    let previousDays: [DailyTotals]
    let sevenDayAverage: SevenDayAverage
    let entries: [Entry]
    let targets: MacroTargets
    let pagination: Pagination?
}

struct WeightEntry: Codable, Identifiable {
    let id: Int
    let weight: Double
    let loggedAt: String
}

struct WeightEntriesResponse: Codable {
    let entries: [WeightEntry]
}

struct WeightTarget: Codable {
    let targetWeight: Double?
    let targetDate: String?
}

struct WorkoutEntry: Codable, Identifiable {
    let id: Int
    let description: String
    let intensity: String
    let durationHours: Double
    let caloriesBurned: Double
    let loggedAt: String
}

struct WorkoutDailyCalories: Codable {
    let day: String
    let calories: Double
}

struct WorkoutsResponse: Codable {
    let entries: [WorkoutEntry]
    let dailyCalories: [WorkoutDailyCalories]
    let pagination: Pagination?
}

struct SavedItem: Codable, Identifiable {
    let id: Int
    let name: String
    let quantity: Double
    let unit: String?
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
    let usageCount: Int
}

struct ParsedMealItem: Codable {
    let itemName: String
    let quantity: Double
    let unit: String?
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
}

struct ParseMealResponse: Codable {
    let items: [ParsedMealItem]
    let mealName: String?
}

struct ParseWorkoutResponse: Codable {
    let description: String
    let intensity: String
    let durationHours: Double
    let caloriesBurned: Double
}

struct SubscriptionInfo: Codable {
    let plan: String
    let status: String
    let stripeCustomerId: String?
    let currentPeriodEnd: String?
    let cancelAtPeriodEnd: Bool?
}

struct PlanLimits: Codable {
    let dailyParses: Int
    let analysisPerDay: Int
}

struct SubscriptionResponse: Codable {
    let subscription: SubscriptionInfo
    let limits: PlanLimits
}

struct ApiToken: Codable, Identifiable {
    let id: Int
    let name: String
    let token: String?
    let createdAt: String
    let expiresAt: String?
    let lastUsedAt: String?
}

struct ApiTokenListResponse: Codable {
    let tokens: [ApiToken]
}

struct OkResponse: Codable {
    let ok: Bool
}

struct CombineResponse: Codable {
    let ok: Bool
    let mealGroup: String
}

struct ErrorResponse: Codable {
    let error: String
}

struct CheckoutResponse: Codable {
    let url: String
}

// MARK: - Daily Totals

struct DailyTotalsResponse: Codable {
    let dailyTotals: [DailyTotals]
    let targets: MacroTargets
}

// MARK: - Analysis

struct AnalysisReport: Codable, Identifiable {
    let id: Int
    let periodDays: Int
    let report: AnalysisReportJson
    let createdAt: String
}

struct AnalysisReportJson: Codable {
    let summary: String?
    let goalAlignment: GoalAlignment?
    let progress: [String]?
    let needsImprovement: [String]?
    let nextWeekPlan: [String]?
    let weekOverWeek: WeekOverWeek?
    let nutritionSignals: NutritionSignals?
    let adherence: AnalysisAdherence?
    let dataConfidence: DataConfidence?
    let confidence: String?
}

struct GoalAlignment: Codable {
    let goal: String?
    let status: String?
    let score: Double?
    let reason: String?
}

struct WeekOverWeek: Codable {
    let weightChangeDelta: Double?
    let avgCaloriesDelta: Double?
    let avgProteinDelta: Double?
    let workoutHoursDelta: Double?
}

struct AnalysisAdherence: Codable {
    let mealLoggingPct: Double?
    let calorieTargetDelta: Double?
    let calorieTargetDeltaPct: Double?
    let proteinTargetDelta: Double?
    let proteinTargetDeltaPct: Double?
    let completedWorkoutCount: Int?
    let plannedWorkoutCount: Int?
}

struct NutritionSignals: Codable {
    let proteinConsistency: String?
    let calorieVolatility: Double?
    let lateNightEatingPct: Double?
    let weekendCalorieDrift: Double?
}

struct DataConfidence: Codable {
    let score: Double?
    let notes: String?
}

struct AnalysisReportResponse: Codable {
    let report: AnalysisReport?
}

struct AppleSignInUser: Codable {
    let id: String
    let name: String?
    let email: String?
}

struct AppleSignInResponse: Codable {
    let ok: Bool
    let token: String
    let user: AppleSignInUser
}
