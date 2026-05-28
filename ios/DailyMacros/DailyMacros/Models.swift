import Foundation

// MARK: - API Response Types

struct User: Codable {
    let id: String
    let name: String?
    let email: String?
    let picture: String?
    let provider: String?
    let isAdmin: Bool?
    let setupTutorialResetAt: String?
    let features: UserFeatures?

    init(
        id: String,
        name: String?,
        email: String?,
        picture: String?,
        provider: String?,
        isAdmin: Bool? = nil,
        setupTutorialResetAt: String? = nil,
        features: UserFeatures? = nil
    ) {
        self.id = id
        self.name = name
        self.email = email
        self.picture = picture
        self.provider = provider
        self.isAdmin = isAdmin
        self.setupTutorialResetAt = setupTutorialResetAt
        self.features = features
    }

    var sexualActivityEnabled: Bool {
        features?.sexualActivity == true
    }
}

struct UserFeatures: Codable {
    let sexualActivity: Bool?
}

struct MeResponse: Codable {
    let user: User?
}

struct Entry: Codable, Identifiable, Sendable {
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

struct DailyTotals: Codable, Sendable {
    let day: String
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
}

struct SevenDayAverage: Codable, Sendable {
    let daysWithData: Int
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
}

struct MacroTargets: Codable, Sendable {
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
    let workouts: Double
    let workoutCalories: Double?
    let sleepHours: Double?

    enum CodingKeys: String, CodingKey {
        case calories, protein, carbs, fat, workouts
        case workoutCalories = "workout_calories"
        case sleepHours = "sleep_hours"
    }
}

struct Pagination: Codable, Sendable {
    let limit: Int
    let offset: Int
    let returned: Int
}

struct DashboardResponse: Codable, Sendable {
    let currentDayTotals: DailyTotals
    let previousDays: [DailyTotals]
    let sevenDayAverage: SevenDayAverage
    let entries: [Entry]
    let targets: MacroTargets
    let pagination: Pagination?
}

struct WeightEntry: Codable, Identifiable, Sendable {
    let id: Int
    let weight: Double
    let loggedAt: String
    let source: String?
    let externalId: String?
}

struct WeightEntriesResponse: Codable {
    let entries: [WeightEntry]
    let pagination: Pagination?
}

struct WeightTarget: Codable, Sendable {
    let targetWeight: Double?
    let targetDate: String?
}

struct WorkoutEntry: Codable, Identifiable, Sendable {
    let id: Int
    let description: String
    let intensity: String
    let durationHours: Double
    let caloriesBurned: Double
    let loggedAt: String
    let source: String?
    let externalId: String?
}

struct WorkoutDailyCalories: Codable, Sendable {
    let day: String
    let calories: Double
}

struct WorkoutsResponse: Codable {
    let entries: [WorkoutEntry]
    let dailyCalories: [WorkoutDailyCalories]
    let pagination: Pagination?
}

struct SavedItem: Codable, Identifiable, Sendable {
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
    var itemName: String
    var quantity: Double
    var unit: String?
    var calories: Double
    var protein: Double
    var carbs: Double
    var fat: Double
}

struct ParseMealResponse: Codable {
    let items: [ParsedMealItem]
    let mealName: String?
    let mealQuantity: Double?
    let mealUnit: String?
}

struct BarcodeLookupResponse: Codable {
    let barcode: String
    let found: Bool?
    let source: String?
    let productName: String?
    let brand: String?
    let servingSize: String?
    let item: ParsedMealItem?
    let message: String?
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
    let mealParsesPerDay: Int?
    let workoutParsesPerDay: Int?
    let photoParsesPerDay: Int?
    let analysisPerDay: Int
}

struct SubscriptionResponse: Codable {
    let subscription: SubscriptionInfo
    let limits: PlanLimits
}

struct VersionResponse: Codable {
    let appBuild: String
    let packageVersion: String?
    let nodeVersion: String?
    let startedAt: String?
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

struct WorkoutMutationResponse: Codable {
    let ok: Bool
    let id: Int?
    let created: Bool?
}

struct EntryMutationResponse: Codable {
    let ok: Bool
    let id: Int?
    let created: Bool?
}

struct CreatedIdResponse: Codable {
    let id: Int
}

struct CombineResponse: Codable {
    let ok: Bool
    let mealGroup: String
}

struct SyncWorkoutsResponse: Codable {
    let message: String?
    let syncedCount: Int
}

struct ErrorResponse: Codable {
    let error: String
    let requestId: String?
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

// MARK: - Health (Sexual Activity)

struct HealthEntry: Codable, Identifiable {
    let id: Int
    let type: String
    let loggedAt: String
    let source: String?
    let externalId: String?
}

struct HealthDailyTypes: Codable {
    let day: String
    let types: [String]
}

struct HealthEntriesResponse: Codable {
    let entries: [HealthEntry]
    let dailyTypes: [HealthDailyTypes]
    let pagination: Pagination?
}

// MARK: - Sleep

struct SleepEntry: Codable, Identifiable, Sendable {
    let id: Int
    let durationHours: Double
    let wakeUps: Int
    let quality: Int?
    let loggedAt: String
    let source: String?
    let externalId: String?
}

struct SleepDailyTotals: Codable, Sendable {
    let day: String
    let totalHours: Double
}

struct SleepEntriesResponse: Codable {
    let entries: [SleepEntry]
    let dailyTotals: [SleepDailyTotals]
    let pagination: Pagination?
}

struct CoachDismissalRecord: Codable {
    let type: String
    let key: String
    let dismissedUntil: String?
    let updatedAt: String?
}

struct CoachDismissalsResponse: Codable {
    let dismissals: [CoachDismissalRecord]
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
