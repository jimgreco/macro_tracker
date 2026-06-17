import Foundation

enum AppClock {
    static var now: Date {
        #if DEBUG
        if ScreenshotSeedData.isEnabled {
            return ScreenshotSeedData.referenceNow
        }
        #endif

        return Date()
    }
}

#if DEBUG
enum ScreenshotSeedData {
    static let launchArgument = "--app-store-screenshots"

    static var isEnabled: Bool {
        CommandLine.arguments.contains(launchArgument) ||
        ProcessInfo.processInfo.environment["APP_STORE_SCREENSHOTS"] == "1"
    }

    static let referenceDay = "2026-06-17"

    static var referenceNow: Date {
        let formatter = ISO8601DateFormatter()
        return formatter.date(from: "2026-06-17T12:00:00-04:00") ?? Date()
    }

    static var user: User {
        User(
            id: "screenshot-user",
            name: "DailyMacros Preview",
            email: "preview@dailymacros.app",
            picture: nil,
            provider: "screenshot",
            timezone: "America/New_York",
            isAdmin: false,
            setupTutorialResetAt: nil,
            features: UserFeatures(sexualActivity: false)
        )
    }

    static func prepareRuntimeStateIfNeeded() {
        guard isEnabled else { return }

        KeychainHelper.delete(key: "api_token")

        let defaults = UserDefaults.standard
        defaults.set(true, forKey: "onboarding_complete")
        defaults.set(false, forKey: FeaturePreferenceKeys.sexualActivityPageVisible)
        defaults.set(false, forKey: CoachSettingKeys.enabled)
        defaults.set(CoachMode.off.rawValue, forKey: CoachSettingKeys.mode)
        defaults.set("[]", forKey: CoachSettingKeys.disabledCategories)
        defaults.removeObject(forKey: "api_base_url")
    }

    static func dashboard(date: String?, limit: Int, offset: Int) -> DashboardResponse {
        let requestedDay = date ?? referenceDay
        let entriesForDay = mealEntries.filter { $0.day == requestedDay }
        let page = Array(entriesForDay.dropFirst(offset).prefix(limit))
        let totals = dailyTotals.first(where: { $0.day == requestedDay }) ?? emptyTotals(for: requestedDay)

        return DashboardResponse(
            currentDayTotals: totals,
            previousDays: dailyTotals.filter { $0.day != requestedDay },
            sevenDayAverage: SevenDayAverage(
                daysWithData: 7,
                calories: 2082,
                protein: 161,
                carbs: 214,
                fat: 64
            ),
            entries: page,
            targets: targets,
            pagination: Pagination(limit: limit, offset: offset, returned: page.count)
        )
    }

    static func dailyTotalsResponse(scope: String) -> DailyTotalsResponse {
        let data: [DailyTotals]
        switch scope {
        case "month":
            data = monthDailyTotals
        case "year":
            data = yearDailyTotals
        default:
            data = dailyTotals
        }
        return DailyTotalsResponse(dailyTotals: data, targets: targets)
    }

    static func savedItems() -> [SavedItem] {
        [
            SavedItem(
                id: 501,
                name: "Greek Yogurt Bowl",
                quantity: 1,
                unit: "bowl",
                calories: 310,
                protein: 32,
                carbs: 34,
                fat: 6,
                components: nil,
                usageCount: 9
            ),
            SavedItem(
                id: 502,
                name: "Chicken Rice Bowl",
                quantity: 1,
                unit: "bowl",
                calories: 640,
                protein: 54,
                carbs: 66,
                fat: 18,
                components: [
                    SavedItemComponent(itemName: "Grilled Chicken", quantity: 6, unit: "oz", calories: 280, protein: 48, carbs: 0, fat: 7),
                    SavedItemComponent(itemName: "Jasmine Rice", quantity: 1, unit: "cup", calories: 205, protein: 4, carbs: 45, fat: 1),
                    SavedItemComponent(itemName: "Avocado Salsa", quantity: 0.5, unit: "cup", calories: 155, protein: 2, carbs: 21, fat: 10)
                ],
                usageCount: 14
            ),
            SavedItem(
                id: 503,
                name: "Protein Shake",
                quantity: 1,
                unit: "shake",
                calories: 220,
                protein: 38,
                carbs: 10,
                fat: 4,
                components: nil,
                usageCount: 12
            )
        ]
    }

    static func workouts(limit: Int, offset: Int, scope: String) -> WorkoutsResponse {
        let page = Array(workoutEntries.dropFirst(offset).prefix(limit))
        return WorkoutsResponse(
            entries: page,
            dailyCalories: workoutDailyCalories(scope: scope),
            pagination: Pagination(limit: limit, offset: offset, returned: page.count)
        )
    }

    static func weights(scope: String, limit: Int?, offset: Int) -> WeightEntriesResponse {
        let pageLimit = limit ?? weightEntries.count
        let page = Array(weightEntries.dropFirst(offset).prefix(pageLimit))
        return WeightEntriesResponse(
            entries: page,
            pagination: Pagination(limit: pageLimit, offset: offset, returned: page.count)
        )
    }

    static func weightTarget() -> WeightTarget {
        WeightTarget(targetWeight: 180, targetDate: "2026-08-15", effectiveDate: referenceDay)
    }

    static func sleepEntries(scope: String, limit: Int, offset: Int) -> SleepEntriesResponse {
        let page = Array(sleepLog.dropFirst(offset).prefix(limit))
        return SleepEntriesResponse(
            entries: page,
            dailyTotals: sleepDailyTotals(scope: scope),
            pagination: Pagination(limit: limit, offset: offset, returned: page.count)
        )
    }

    static func healthEntries(scope: String, limit: Int, offset: Int) -> HealthEntriesResponse {
        HealthEntriesResponse(
            entries: [],
            dailyTypes: [],
            pagination: Pagination(limit: limit, offset: offset, returned: 0)
        )
    }

    static func latestAnalysis() -> AnalysisReport {
        AnalysisReport(
            id: 901,
            periodDays: 30,
            report: AnalysisReportJson(
                summary: "Your logging is consistent, protein is landing close to target, and workout volume is trending up without crowding out recovery.",
                goalAlignment: GoalAlignment(
                    goal: "Lean fat loss while keeping strength",
                    status: "On track",
                    score: 0.88,
                    reason: "Average calories are near target while protein and training consistency support lean mass."
                ),
                progress: [
                    "Logged meals on 27 of the last 30 days.",
                    "Protein averaged 161g per day.",
                    "Completed 4 workouts this week."
                ],
                needsImprovement: [
                    "Carbs drift higher on weekends.",
                    "Two sleep nights fell below the 8 hour target."
                ],
                nextWeekPlan: [
                    "Prep two high-protein lunches before Monday.",
                    "Keep active calories near 1,200 for the week.",
                    "Move caffeine cutoff earlier on workout days."
                ],
                weekOverWeek: WeekOverWeek(
                    weightChangeDelta: -0.7,
                    avgCaloriesDelta: -85,
                    avgProteinDelta: 9,
                    workoutHoursDelta: 0.6
                ),
                nutritionSignals: NutritionSignals(
                    proteinConsistency: "High",
                    calorieVolatility: 11,
                    lateNightEatingPct: 8,
                    weekendCalorieDrift: 180
                ),
                adherence: AnalysisAdherence(
                    mealLoggingPct: 90,
                    calorieTargetDelta: -118,
                    calorieTargetDeltaPct: -5.4,
                    proteinTargetDelta: -19,
                    proteinTargetDeltaPct: -10.6,
                    completedWorkoutCount: 4,
                    plannedWorkoutCount: 4
                ),
                dataConfidence: DataConfidence(
                    score: 0.93,
                    notes: "Recent nutrition, weight, workout, and sleep logs are all present."
                ),
                confidence: "High"
            ),
            createdAt: iso("2026-06-17", "09:15")
        )
    }

    static func subscription() -> SubscriptionResponse {
        SubscriptionResponse(
            subscription: SubscriptionInfo(
                plan: "pro",
                status: "active",
                stripeCustomerId: "cus_screenshot",
                currentPeriodEnd: "2026-07-17T00:00:00.000-0400",
                cancelAtPeriodEnd: false
            ),
            limits: PlanLimits(
                dailyParses: 200,
                mealParsesPerDay: 150,
                workoutParsesPerDay: 50,
                photoParsesPerDay: 40,
                analysisPerDay: 10
            )
        )
    }

    static func version() -> VersionResponse {
        VersionResponse(
            appBuild: "screenshots",
            packageVersion: "1.0.0",
            nodeVersion: nil,
            startedAt: iso("2026-06-17", "08:00")
        )
    }

    static func coachDismissals() -> CoachDismissalsResponse {
        CoachDismissalsResponse(dismissals: [])
    }

    static func mutationOK(id: Int? = nil) -> EntryMutationResponse {
        EntryMutationResponse(ok: true, id: id, created: true)
    }

    static func ok() -> OkResponse {
        OkResponse(ok: true)
    }

    private static let targets = MacroTargets(
        calories: 2200,
        protein: 180,
        carbs: 240,
        fat: 70,
        workouts: 4,
        workoutCalories: 1200,
        sleepHours: 8
    )

    private static let mealEntries: [Entry] = [
        Entry(
            id: 101,
            itemName: "Egg Whites",
            quantity: 1,
            unit: "cup",
            calories: 126,
            protein: 26,
            carbs: 2,
            fat: 0,
            consumedAt: iso(referenceDay, "07:25"),
            day: referenceDay,
            mealGroup: "meal-breakfast",
            mealName: "Breakfast Burrito",
            mealQuantity: 1,
            mealUnit: "serving"
        ),
        Entry(
            id: 102,
            itemName: "Turkey Sausage",
            quantity: 2,
            unit: "links",
            calories: 170,
            protein: 18,
            carbs: 2,
            fat: 10,
            consumedAt: iso(referenceDay, "07:25"),
            day: referenceDay,
            mealGroup: "meal-breakfast",
            mealName: "Breakfast Burrito",
            mealQuantity: 1,
            mealUnit: "serving"
        ),
        Entry(
            id: 103,
            itemName: "Whole Wheat Tortilla",
            quantity: 1,
            unit: "tortilla",
            calories: 190,
            protein: 6,
            carbs: 30,
            fat: 5,
            consumedAt: iso(referenceDay, "07:25"),
            day: referenceDay,
            mealGroup: "meal-breakfast",
            mealName: "Breakfast Burrito",
            mealQuantity: 1,
            mealUnit: "serving"
        ),
        Entry(
            id: 104,
            itemName: "Greek Yogurt Bowl",
            quantity: 1,
            unit: "bowl",
            calories: 310,
            protein: 32,
            carbs: 34,
            fat: 6,
            consumedAt: iso(referenceDay, "10:30"),
            day: referenceDay,
            mealGroup: nil,
            mealName: nil,
            mealQuantity: nil,
            mealUnit: nil
        ),
        Entry(
            id: 105,
            itemName: "Grilled Chicken",
            quantity: 6,
            unit: "oz",
            calories: 280,
            protein: 48,
            carbs: 0,
            fat: 7,
            consumedAt: iso(referenceDay, "13:10"),
            day: referenceDay,
            mealGroup: "meal-lunch",
            mealName: "Chicken Rice Bowl",
            mealQuantity: 1,
            mealUnit: "bowl"
        ),
        Entry(
            id: 106,
            itemName: "Jasmine Rice",
            quantity: 1,
            unit: "cup",
            calories: 205,
            protein: 4,
            carbs: 45,
            fat: 1,
            consumedAt: iso(referenceDay, "13:10"),
            day: referenceDay,
            mealGroup: "meal-lunch",
            mealName: "Chicken Rice Bowl",
            mealQuantity: 1,
            mealUnit: "bowl"
        ),
        Entry(
            id: 107,
            itemName: "Avocado Salsa",
            quantity: 0.5,
            unit: "cup",
            calories: 155,
            protein: 2,
            carbs: 21,
            fat: 10,
            consumedAt: iso(referenceDay, "13:10"),
            day: referenceDay,
            mealGroup: "meal-lunch",
            mealName: "Chicken Rice Bowl",
            mealQuantity: 1,
            mealUnit: "bowl"
        )
    ]

    private static let dailyTotals: [DailyTotals] = [
        DailyTotals(day: "2026-06-11", calories: 2140, protein: 168, carbs: 220, fat: 63),
        DailyTotals(day: "2026-06-12", calories: 2235, protein: 172, carbs: 236, fat: 68),
        DailyTotals(day: "2026-06-13", calories: 2055, protein: 158, carbs: 210, fat: 61),
        DailyTotals(day: "2026-06-14", calories: 2310, protein: 150, carbs: 258, fat: 73),
        DailyTotals(day: "2026-06-15", calories: 1985, protein: 166, carbs: 202, fat: 59),
        DailyTotals(day: "2026-06-16", calories: 2090, protein: 154, carbs: 212, fat: 64),
        DailyTotals(day: referenceDay, calories: 1760, protein: 142, carbs: 185, fat: 52)
    ]

    private static var monthDailyTotals: [DailyTotals] {
        [
            DailyTotals(day: "2026-05-19", calories: 2290, protein: 151, carbs: 246, fat: 70),
            DailyTotals(day: "2026-05-22", calories: 2110, protein: 160, carbs: 216, fat: 63),
            DailyTotals(day: "2026-05-26", calories: 2185, protein: 166, carbs: 222, fat: 65),
            DailyTotals(day: "2026-05-30", calories: 2075, protein: 157, carbs: 208, fat: 62),
            DailyTotals(day: "2026-06-03", calories: 2160, protein: 169, carbs: 225, fat: 64),
            DailyTotals(day: "2026-06-07", calories: 2045, protein: 162, carbs: 198, fat: 61)
        ] + dailyTotals
    }

    private static var yearDailyTotals: [DailyTotals] {
        [
            DailyTotals(day: "2026-01-15", calories: 2350, protein: 145, carbs: 260, fat: 76),
            DailyTotals(day: "2026-02-15", calories: 2260, protein: 152, carbs: 244, fat: 71),
            DailyTotals(day: "2026-03-15", calories: 2190, protein: 158, carbs: 232, fat: 67),
            DailyTotals(day: "2026-04-15", calories: 2140, protein: 163, carbs: 221, fat: 64),
            DailyTotals(day: "2026-05-15", calories: 2115, protein: 166, carbs: 218, fat: 63)
        ] + monthDailyTotals
    }

    private static let workoutEntries: [WorkoutEntry] = [
        WorkoutEntry(id: 301, description: "Upper Body Strength", intensity: "high", durationHours: 1.05, caloriesBurned: 360, loggedAt: iso(referenceDay, "06:30"), source: "manual", externalId: nil),
        WorkoutEntry(id: 302, description: "Zone 2 Run", intensity: "medium", durationHours: 0.75, caloriesBurned: 420, loggedAt: iso("2026-06-15", "18:20"), source: "HealthKit", externalId: "hk-run-0615"),
        WorkoutEntry(id: 303, description: "Leg Day", intensity: "high", durationHours: 1.10, caloriesBurned: 390, loggedAt: iso("2026-06-13", "09:00"), source: "manual", externalId: nil),
        WorkoutEntry(id: 304, description: "Mobility and Core", intensity: "low", durationHours: 0.45, caloriesBurned: 135, loggedAt: iso("2026-06-11", "07:45"), source: "manual", externalId: nil)
    ]

    private static func workoutDailyCalories(scope: String) -> [WorkoutDailyCalories] {
        let base = [
            WorkoutDailyCalories(day: "2026-06-11", calories: 135, targetCalories: 1200, targetWorkouts: 4),
            WorkoutDailyCalories(day: "2026-06-13", calories: 390, targetCalories: 1200, targetWorkouts: 4),
            WorkoutDailyCalories(day: "2026-06-15", calories: 420, targetCalories: 1200, targetWorkouts: 4),
            WorkoutDailyCalories(day: referenceDay, calories: 360, targetCalories: 1200, targetWorkouts: 4)
        ]
        guard scope != "week" else { return base }
        return [
            WorkoutDailyCalories(day: "2026-05-23", calories: 300, targetCalories: 1200, targetWorkouts: 4),
            WorkoutDailyCalories(day: "2026-05-27", calories: 240, targetCalories: 1200, targetWorkouts: 4),
            WorkoutDailyCalories(day: "2026-06-02", calories: 330, targetCalories: 1200, targetWorkouts: 4),
            WorkoutDailyCalories(day: "2026-06-07", calories: 410, targetCalories: 1200, targetWorkouts: 4)
        ] + base
    }

    private static let weightEntries: [WeightEntry] = [
        WeightEntry(id: 401, weight: 184.8, loggedAt: iso(referenceDay, "07:00"), day: referenceDay, targetWeight: 180, targetDate: "2026-08-15", source: "manual", externalId: nil),
        WeightEntry(id: 402, weight: 185.3, loggedAt: iso("2026-06-14", "07:10"), day: "2026-06-14", targetWeight: 180, targetDate: "2026-08-15", source: "manual", externalId: nil),
        WeightEntry(id: 403, weight: 186.1, loggedAt: iso("2026-06-10", "07:05"), day: "2026-06-10", targetWeight: 180, targetDate: "2026-08-15", source: "HealthKit", externalId: "hk-weight-0610"),
        WeightEntry(id: 404, weight: 186.8, loggedAt: iso("2026-06-05", "07:00"), day: "2026-06-05", targetWeight: 180, targetDate: "2026-08-15", source: "manual", externalId: nil),
        WeightEntry(id: 405, weight: 187.4, loggedAt: iso("2026-05-30", "07:20"), day: "2026-05-30", targetWeight: 180, targetDate: "2026-08-15", source: "manual", externalId: nil),
        WeightEntry(id: 406, weight: 188.6, loggedAt: iso("2026-05-24", "07:15"), day: "2026-05-24", targetWeight: 180, targetDate: "2026-08-15", source: "manual", externalId: nil)
    ]

    private static let sleepLog: [SleepEntry] = [
        SleepEntry(id: 601, durationHours: 8.1, wakeUps: 1, quality: 4, notes: "Felt rested", loggedAt: iso(referenceDay, "06:55"), source: "manual", externalId: nil),
        SleepEntry(id: 602, durationHours: 7.4, wakeUps: 2, quality: 3, notes: "Late workout", loggedAt: iso("2026-06-16", "06:50"), source: "manual", externalId: nil),
        SleepEntry(id: 603, durationHours: 8.3, wakeUps: 0, quality: 5, notes: nil, loggedAt: iso("2026-06-15", "07:05"), source: "HealthKit", externalId: "hk-sleep-0615"),
        SleepEntry(id: 604, durationHours: 6.9, wakeUps: 2, quality: 3, notes: "Travel night", loggedAt: iso("2026-06-14", "07:30"), source: "manual", externalId: nil),
        SleepEntry(id: 605, durationHours: 8.0, wakeUps: 1, quality: 4, notes: nil, loggedAt: iso("2026-06-13", "07:10"), source: "manual", externalId: nil)
    ]

    private static func sleepDailyTotals(scope: String) -> [SleepDailyTotals] {
        let base = [
            SleepDailyTotals(day: "2026-06-11", totalHours: 7.8, targetHours: 8),
            SleepDailyTotals(day: "2026-06-12", totalHours: 8.2, targetHours: 8),
            SleepDailyTotals(day: "2026-06-13", totalHours: 8.0, targetHours: 8),
            SleepDailyTotals(day: "2026-06-14", totalHours: 6.9, targetHours: 8),
            SleepDailyTotals(day: "2026-06-15", totalHours: 8.3, targetHours: 8),
            SleepDailyTotals(day: "2026-06-16", totalHours: 7.4, targetHours: 8),
            SleepDailyTotals(day: referenceDay, totalHours: 8.1, targetHours: 8)
        ]
        guard scope != "week" else { return base }
        return [
            SleepDailyTotals(day: "2026-05-22", totalHours: 7.6, targetHours: 8),
            SleepDailyTotals(day: "2026-05-29", totalHours: 8.4, targetHours: 8),
            SleepDailyTotals(day: "2026-06-05", totalHours: 7.9, targetHours: 8)
        ] + base
    }

    private static func emptyTotals(for day: String) -> DailyTotals {
        DailyTotals(day: day, calories: 0, protein: 0, carbs: 0, fat: 0)
    }

    private static func iso(_ day: String, _ time: String) -> String {
        "\(day)T\(time):00.000-0400"
    }
}
#endif
