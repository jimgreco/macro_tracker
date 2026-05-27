import Foundation
import SwiftUI

enum CoachBrand {
    static let name = "Compass"
}

enum CoachSettingKeys {
    static let enabled = "ai_coach_enabled"
}

enum CoachSurface: String {
    case macros
    case workouts
    case weight
    case sleep
}

enum CoachModelSource: String {
    case ruleTemplate = "rule_template"
    case afmLocal = "afm_local"
    case serverFallback = "server_fallback"

    var label: String {
        switch self {
        case .ruleTemplate:
            return "Local rules"
        case .afmLocal:
            return "Local AI"
        case .serverFallback:
            return "Server AI"
        }
    }
}

enum CoachActionType {
    case openLogMeal
    case openQuickAdd
    case logMealItem
    case openLogWorkout
    case logWorkoutEntry
    case openLogWeight
    case openLogSleep
    case editTargets
}

struct CoachMealItemPayload {
    let itemName: String
    let quantity: Double
    let unit: String
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
}

struct CoachWorkoutPayload {
    let description: String
    let intensity: String
    let durationHours: Double
    let caloriesBurned: Double
}

struct CoachAction {
    let label: String
    let type: CoachActionType
    let searchText: String?
    let mealItem: CoachMealItemPayload?
    let workout: CoachWorkoutPayload?

    init(
        label: String,
        type: CoachActionType,
        searchText: String? = nil,
        mealItem: CoachMealItemPayload? = nil,
        workout: CoachWorkoutPayload? = nil
    ) {
        self.label = label
        self.type = type
        self.searchText = searchText
        self.mealItem = mealItem
        self.workout = workout
    }
}

struct CoachSuggestion: Identifiable {
    let id: String
    let surface: CoachSurface
    let category: String
    let priority: Int
    let confidence: Double
    let title: String
    let message: String
    let evidence: [String]
    let primaryAction: CoachAction?
    let dismissalKey: String
    let expiresAt: Date
    let modelSource: CoachModelSource
}

final class CoachDismissalStore: ObservableObject {
    static let shared = CoachDismissalStore()

    @Published private(set) var revision = 0

    private let defaults: UserDefaults
    private let todayDismissalKey = "DailyMacros.aiCoach.dismissedToday.v1"
    private let actionDismissalKey = "DailyMacros.aiCoach.dismissedActions.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func visibleSuggestion(from suggestions: [CoachSuggestion], now: Date = Date()) -> CoachSuggestion? {
        _ = revision
        removeExpiredTodayDismissals(now: now)

        return suggestions
            .filter { $0.confidence >= 0.85 }
            .filter { $0.expiresAt > now }
            .filter { !isDismissed($0, now: now) }
            .sorted {
                if $0.priority == $1.priority {
                    return $0.confidence > $1.confidence
                }
                return $0.priority > $1.priority
            }
            .first
    }

    func dismissForToday(_ suggestion: CoachSuggestion, now: Date = Date()) {
        var dismissals = loadTodayDismissals()
        dismissals[todayDismissalGroup(for: suggestion)] = Self.endOfEasternDay(containing: now)
        saveTodayDismissals(dismissals)
        revision += 1
    }

    func dismissAction(_ suggestion: CoachSuggestion) {
        var keys = loadActionDismissals()
        keys.insert(suggestion.dismissalKey)
        saveActionDismissals(keys)
        revision += 1
    }

    func resetDismissals() {
        defaults.removeObject(forKey: todayDismissalKey)
        defaults.removeObject(forKey: actionDismissalKey)
        revision += 1
    }

    private func isDismissed(_ suggestion: CoachSuggestion, now: Date) -> Bool {
        if loadActionDismissals().contains(suggestion.dismissalKey) {
            return true
        }

        if let dismissedUntil = loadTodayDismissals()[todayDismissalGroup(for: suggestion)] {
            return dismissedUntil > now
        }

        return false
    }

    private func todayDismissalGroup(for suggestion: CoachSuggestion) -> String {
        "\(suggestion.surface.rawValue):\(suggestion.category)"
    }

    private func loadTodayDismissals() -> [String: Date] {
        guard let data = defaults.data(forKey: todayDismissalKey),
              let dismissals = try? JSONDecoder().decode([String: Date].self, from: data) else {
            return [:]
        }
        return dismissals
    }

    private func saveTodayDismissals(_ dismissals: [String: Date]) {
        guard let data = try? JSONEncoder().encode(dismissals) else { return }
        defaults.set(data, forKey: todayDismissalKey)
    }

    private func removeExpiredTodayDismissals(now: Date) {
        let dismissals = loadTodayDismissals()
        let active = dismissals.filter { $0.value > now }
        if active.count != dismissals.count {
            saveTodayDismissals(active)
        }
    }

    private func loadActionDismissals() -> Set<String> {
        guard let keys = defaults.stringArray(forKey: actionDismissalKey) else {
            return []
        }
        return Set(keys)
    }

    private func saveActionDismissals(_ keys: Set<String>) {
        defaults.set(Array(keys).sorted(), forKey: actionDismissalKey)
    }

    private static func endOfEasternDay(containing date: Date) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York") ?? .current
        let start = calendar.startOfDay(for: date)
        return calendar.date(byAdding: DateComponents(day: 1, second: -1), to: start) ?? date
    }
}

struct AICoachSlot: View {
    @ObservedObject var dismissals: CoachDismissalStore
    @AppStorage(CoachSettingKeys.enabled) private var coachEnabled = true
    @State private var recordedShownSuggestionID: String?

    let suggestions: [CoachSuggestion]
    let onPrimaryAction: (CoachAction) -> Void

    var body: some View {
        if coachEnabled, let suggestion = dismissals.visibleSuggestion(from: suggestions) {
            AICoachCard(
                suggestion: suggestion,
                onPrimaryAction: { action in
                    recordCoachEvent("acted_on", suggestion: suggestion, action: action)
                    onPrimaryAction(action)
                },
                onDismissForToday: {
                    recordCoachEvent("dismissed_today", suggestion: suggestion)
                    dismissals.dismissForToday(suggestion)
                },
                onDismissAction: {
                    recordCoachEvent("dismissed_pattern", suggestion: suggestion)
                    dismissals.dismissAction(suggestion)
                }
            )
            .onAppear { recordShown(suggestion) }
        }
    }

    private func recordShown(_ suggestion: CoachSuggestion) {
        guard recordedShownSuggestionID != suggestion.id else { return }
        recordedShownSuggestionID = suggestion.id
        recordCoachEvent("shown", suggestion: suggestion)
    }

    private func recordCoachEvent(_ event: String, suggestion: CoachSuggestion, action: CoachAction? = nil) {
        var details = [
            "surface": suggestion.surface.rawValue,
            "category": suggestion.category,
            "confidence": String(format: "%.2f", suggestion.confidence),
            "source": suggestion.modelSource.rawValue,
            "dismissal_key": suggestion.dismissalKey
        ]
        if let action {
            details["action"] = "\(action.type)"
        }

        Diagnostics.shared.record(
            category: "coach",
            message: "\(CoachBrand.name) \(event)",
            details: details
        )
    }
}

struct AICoachCard: View {
    let suggestion: CoachSuggestion
    let onPrimaryAction: (CoachAction) -> Void
    let onDismissForToday: () -> Void
    let onDismissAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 23, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(
                        LinearGradient(
                            colors: [.cyan, .purple, .pink],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        in: RoundedRectangle(cornerRadius: 13)
                    )
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 5) {
                    Text(suggestion.title)
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(.primary)

                    HStack(spacing: 6) {
                        Text(CoachBrand.name)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(suggestion.modelSource.label)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.white.opacity(0.08), in: Capsule())
                    }
                }

                Spacer(minLength: 8)

                Menu {
                    Button("Dismiss for today", action: onDismissForToday)
                    Button("Hide this pattern", action: onDismissAction)
                    Button("Not useful", action: onDismissAction)
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(.secondary)
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel("Dismiss \(CoachBrand.name) suggestion")
            }

            Text(suggestion.message)
                .font(.subheadline)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)

            if !suggestion.evidence.isEmpty {
                Text("Based on \(suggestion.evidence.joined(separator: " · ")).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let action = suggestion.primaryAction {
                Button {
                    onPrimaryAction(action)
                } label: {
                    Label(action.label, systemImage: actionIcon(for: action.type))
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.cyan)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 14)
                .fill(Color(.secondarySystemBackground))
                .overlay {
                    RoundedRectangle(cornerRadius: 14)
                        .fill(
                            LinearGradient(
                                colors: [.cyan.opacity(0.20), .purple.opacity(0.12), .pink.opacity(0.10)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 14)
                .stroke(.white.opacity(0.12), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
    }

    private func actionIcon(for actionType: CoachActionType) -> String {
        switch actionType {
        case .openLogMeal, .openQuickAdd, .logMealItem:
            return "fork.knife"
        case .openLogWorkout, .logWorkoutEntry:
            return "figure.run"
        case .openLogWeight:
            return "scalemass"
        case .openLogSleep:
            return "moon.zzz"
        case .editTargets:
            return "target"
        }
    }
}

enum CoachCandidateEngine {
    private enum CoachDaypart: String, CaseIterable {
        case breakfast
        case lunch
        case dinner
        case evening
        case lateNight

        var label: String { rawValue }

        var hours: Range<Int> {
            switch self {
            case .breakfast:
                return 5..<11
            case .lunch:
                return 11..<15
            case .dinner:
                return 17..<22
            case .evening:
                return 20..<24
            case .lateNight:
                return 0..<5
            }
        }

        var defaultPromptHour: Int? {
            switch self {
            case .breakfast:
                return 11
            case .lunch:
                return 14
            case .dinner, .evening, .lateNight:
                return nil
            }
        }

        var supportsUsualQuickAdd: Bool {
            switch self {
            case .breakfast, .lunch, .dinner:
                return true
            case .evening, .lateNight:
                return false
            }
        }

        static func currentMealWindow(for date: Date) -> CoachDaypart? {
            let hour = CoachCandidateEngine.hourOfDay(date)
            return allCases.first { $0.supportsUsualQuickAdd && $0.hours.contains(hour) }
        }
    }

    private struct MealWindowSummary {
        let daypart: CoachDaypart
        let dayCount: Int
        let latestFirstLogHour: Int
        let averageFirstLogHour: Double
    }

    private struct HabitualItemCandidate {
        let normalizedName: String
        let displayName: String
        let dayCount: Int
        let latestLoggedAt: Date
        let mealItem: CoachMealItemPayload
    }

    private struct HabitualWorkoutCandidate {
        let normalizedDescription: String
        let displayName: String
        let dayCount: Int
        let latestLoggedAt: Date
        let workout: CoachWorkoutPayload
    }

    static func macros(dashboard: DashboardResponse, selectedDate: Date, now: Date = Date()) -> [CoachSuggestion] {
        var candidates: [CoachSuggestion] = []
        let calendar = easternCalendar
        let selectedDay = dayString(selectedDate)
        let selectedIsToday = calendar.isDate(selectedDate, inSameDayAs: now)
        let targets = dashboard.targets

        if let congratulations = macroTargetCongratulations(
            totals: dashboard.currentDayTotals,
            targets: targets,
            selectedIsToday: selectedIsToday,
            now: now
        ) {
            candidates.append(congratulations)
        }

        let recentCompleteDays = dashboard.previousDays
            .filter { $0.day != selectedDay }
            .filter { isCompleteMacroDay($0, targets: targets) }
            .sorted { $0.day > $1.day }
            .prefix(7)

        if recentCompleteDays.count >= 5 {
            let days = Array(recentCompleteDays)
            let highCalorieDays = days.filter { targets.calories > 0 && $0.calories > targets.calories * 1.10 }
            if highCalorieDays.count >= 4 || days.prefix(3).filter({ targets.calories > 0 && $0.calories > targets.calories * 1.10 }).count >= 2 {
                let averageOverage = highCalorieDays.reduce(0.0) { $0 + ($1.calories - targets.calories) } / Double(max(highCalorieDays.count, 1))
                candidates.append(
                    suggestion(
                        id: "macro-calorie-trend-\(selectedDay)",
                        surface: .macros,
                        category: "trend",
                        priority: 82,
                        confidence: 0.88,
                        title: "Calories are running high",
                        message: "Your logged calories have been above target on \(highCalorieDays.count) of the last \(days.count) complete days. Keep the next meal simpler and protein-forward.",
                        evidence: [
                            "\(highCalorieDays.count) of last \(days.count) complete days above target",
                            "\(Int(averageOverage.rounded())) cal average overage"
                        ],
                        action: CoachAction(label: "Log next meal", type: .openLogMeal),
                        dismissalKey: "macro:calorie_trend:v1:\(highCalorieDays.count):\(Int(averageOverage.rounded() / 50))"
                    )
                )
            }

            let lowProteinDays = days.filter { targets.protein > 0 && $0.protein < targets.protein * 0.85 }
            if lowProteinDays.count >= 3 {
                let averageShortfall = lowProteinDays.reduce(0.0) { $0 + (targets.protein - $1.protein) } / Double(lowProteinDays.count)
                candidates.append(
                    suggestion(
                        id: "macro-protein-shortfall-\(selectedDay)",
                        surface: .macros,
                        category: "trend",
                        priority: 84,
                        confidence: 0.90,
                        title: "Protein is lagging",
                        message: "Protein has landed short on \(lowProteinDays.count) of the last \(days.count) complete days. Make the next meal protein-first.",
                        evidence: [
                            "\(lowProteinDays.count) of last \(days.count) complete days below protein target",
                            "\(Int(averageShortfall.rounded()))g average shortfall"
                        ],
                        action: CoachAction(label: "Log protein", type: .openLogMeal),
                        dismissalKey: "macro:protein_shortfall:v1:\(lowProteinDays.count):\(Int(averageShortfall.rounded() / 10))"
                    )
                )
            }
        }

        if selectedIsToday, let mealPrompt = missedMealPrompt(entries: dashboard.entries, now: now) {
            candidates.append(mealPrompt)
        }

        if selectedIsToday, let habitualMeal = habitualMealPrompt(entries: dashboard.entries, now: now) {
            candidates.append(habitualMeal)
        }

        if let alcohol = alcoholPrompt(entries: dashboard.entries, now: now) {
            candidates.append(alcohol)
        }

        return candidates
    }

    static func workouts(
        entries: [WorkoutEntry],
        dailyCalories: [WorkoutDailyCalories],
        workoutsTarget: Double,
        caloriesTarget: Double,
        now: Date = Date()
    ) -> [CoachSuggestion] {
        var candidates: [CoachSuggestion] = []
        let activeDays = lastSevenWorkoutDays(from: dailyCalories, now: now)
        let activeDayCount = activeDays.count
        let roundedWorkoutTarget = max(Int(workoutsTarget.rounded()), 0)

        if roundedWorkoutTarget > 0, activeDayCount >= roundedWorkoutTarget {
            candidates.append(
                suggestion(
                    id: "workout-target-hit-\(dayString(now))",
                    surface: .workouts,
                    category: "congratulations",
                    priority: 92,
                    confidence: 0.96,
                    title: "Workout target hit",
                    message: "You have hit your workout target for the week. Keep the next session easy if you are feeling worn down.",
                    evidence: ["\(activeDayCount) workout days in the last 7 days", "target \(roundedWorkoutTarget)"],
                    action: nil,
                    dismissalKey: "workouts:target_hit:v1:\(dayString(now)):\(activeDayCount)"
                )
            )
        } else if roundedWorkoutTarget > 0 {
            let elapsedWeekDays = max(easternCalendar.component(.weekday, from: now) - 1, 1)
            let expectedByNow = Int(ceil(Double(roundedWorkoutTarget) * Double(elapsedWeekDays) / 7.0))
            if elapsedWeekDays >= 3, activeDayCount + 1 < expectedByNow {
                candidates.append(
                    suggestion(
                        id: "workout-behind-\(dayString(now))",
                        surface: .workouts,
                        category: "reminder",
                        priority: 82,
                        confidence: 0.88,
                        title: "You are behind workout pace",
                        message: "You are behind your usual weekly target. Get one workout logged today to close the gap.",
                        evidence: ["\(activeDayCount) workout days in the last 7 days", "target \(roundedWorkoutTarget)"],
                        action: CoachAction(label: "Log workout", type: .openLogWorkout),
                        dismissalKey: "workouts:behind_target:v1:\(activeDayCount):\(roundedWorkoutTarget):\(elapsedWeekDays)"
                    )
                )
            }
        }

        if caloriesTarget > 0 {
            let lastSevenCalories = dailyCalories
                .filter { activeDays.contains($0.day) }
                .reduce(0.0) { $0 + $1.calories }
            if lastSevenCalories >= caloriesTarget {
                candidates.append(
                    suggestion(
                        id: "workout-calories-hit-\(dayString(now))",
                        surface: .workouts,
                        category: "congratulations",
                        priority: 88,
                        confidence: 0.94,
                        title: "Workout calories target hit",
                        message: "You have reached your weekly workout-calorie target. That is a strong week.",
                        evidence: ["\(Int(lastSevenCalories.rounded())) cal in the last 7 days", "target \(Int(caloriesTarget.rounded()))"],
                        action: nil,
                        dismissalKey: "workouts:calorie_target_hit:v1:\(dayString(now)):\(Int(lastSevenCalories.rounded() / 100))"
                    )
                )
            }
        }

        if let trend = workoutTrend(entries: entries, now: now) {
            candidates.append(trend)
        }

        if let repeatWorkout = repeatWorkoutPrompt(entries: entries, now: now) {
            candidates.append(repeatWorkout)
        }

        return candidates
    }

    static func weight(entries: [WeightEntry], target: WeightTarget?, now: Date = Date()) -> [CoachSuggestion] {
        let sorted = entries.sorted { parseDate($0.loggedAt) < parseDate($1.loggedAt) }
        guard !sorted.isEmpty else { return [] }

        var candidates: [CoachSuggestion] = []
        let recentFourteen = sorted.filter { parseDate($0.loggedAt) >= addingDays(-14, to: now) }
        let latest = sorted.last

        if let latestDate = latest.map({ parseDate($0.loggedAt) }),
           sorted.count >= 4,
           latestDate < addingDays(-7, to: now) {
            candidates.append(
                suggestion(
                    id: "weight-checkin-\(dayString(now))",
                    surface: .weight,
                    category: "reminder",
                    priority: 78,
                    confidence: 0.87,
                    title: "Weight check-in is due",
                    message: "You usually have enough weight data for a trend, but the latest entry is more than a week old. Log a fresh weigh-in before reading too much into the chart.",
                    evidence: ["\(sorted.count) historical weigh-ins", "last entry \(daysBetween(latestDate, now)) days ago"],
                    action: CoachAction(label: "Log weight", type: .openLogWeight),
                    dismissalKey: "weight:checkin_due:v1:\(dayString(latestDate))"
                )
            )
        }

        guard recentFourteen.count >= 4 else {
            return candidates
        }

        let recentAverage = average(recentFourteen.suffix(min(3, recentFourteen.count)).map(\.weight))

        if let targetWeight = target?.targetWeight, abs(recentAverage - targetWeight) <= 1.0 {
            candidates.append(
                suggestion(
                    id: "weight-goal-hit-\(dayString(now))",
                    surface: .weight,
                    category: "congratulations",
                    priority: 92,
                    confidence: 0.95,
                    title: "Weight goal range reached",
                    message: "Your recent average is within 1 lb of the target. Keep the next few logs steady before making any new adjustments.",
                    evidence: ["\(recentFourteen.count) weigh-ins in the last 14 days", "recent average \(formatWeight(recentAverage))"],
                    action: nil,
                    dismissalKey: "weight:goal_range:v1:\(Int(targetWeight.rounded())):\(Int(recentAverage.rounded()))"
                )
            )
        }

        if let goalPace = weightGoalPaceSuggestion(
            recentEntries: Array(recentFourteen),
            recentAverage: recentAverage,
            target: target,
            now: now
        ) {
            candidates.append(goalPace)
        }

        if recentFourteen.count >= 6 {
            let earlier = Array(recentFourteen.prefix(recentFourteen.count / 2))
            let later = Array(recentFourteen.suffix(recentFourteen.count - earlier.count))
            let earlierAverage = average(earlier.map(\.weight))
            let laterAverage = average(later.map(\.weight))
            let delta = laterAverage - earlierAverage

            if abs(delta) >= 0.75 {
                let targetWeight = target?.targetWeight
                let movingTowardGoal = targetWeight.map { abs(laterAverage - $0) < abs(earlierAverage - $0) } ?? false
                let title = movingTowardGoal ? "Weight trend is moving toward goal" : "Weight trend changed"
                let direction = delta < 0 ? "down" : "up"
                let goalPhrase = movingTowardGoal ? "That is aligned with your target." : "Review the recent macro pattern before making a bigger change."
                candidates.append(
                    suggestion(
                        id: "weight-trend-\(dayString(now))",
                        surface: .weight,
                        category: "trend",
                        priority: movingTowardGoal ? 80 : 82,
                        confidence: 0.88,
                        title: title,
                        message: "Your rolling weight average is \(direction) \(formatWeight(abs(delta))) over the recent window. \(goalPhrase)",
                        evidence: ["\(recentFourteen.count) weigh-ins in the last 14 days", "rolling average change \(formatWeight(abs(delta)))"],
                        action: movingTowardGoal ? nil : CoachAction(label: "Review targets", type: .editTargets),
                        dismissalKey: "weight:trend:v1:\(Int(delta.rounded())):\(recentFourteen.count)"
                    )
                )
            }
        }

        return candidates
    }

    static func sleep(
        entries: [SleepEntry],
        dailyTotals: [SleepDailyTotals],
        targetHours: Double,
        now: Date = Date()
    ) -> [CoachSuggestion] {
        var candidates: [CoachSuggestion] = []
        let recentTotals = dailyTotals
            .filter { parseDay($0.day) >= addingDays(-7, to: now) }
            .sorted { $0.day > $1.day }

        if let latestSleep = entries.sorted(by: { parseDate($0.loggedAt) < parseDate($1.loggedAt) }).last,
           recentTotals.count >= 5 {
            let latestDate = parseDate(latestSleep.loggedAt)
            let latestDay = dayString(latestDate)
            let yesterday = dayString(addingDays(-1, to: now))
            let hour = easternCalendar.component(.hour, from: now)
            if latestDay < yesterday, hour >= 9 {
                candidates.append(
                    suggestion(
                        id: "sleep-log-reminder-\(dayString(now))",
                        surface: .sleep,
                        category: "reminder",
                        priority: 78,
                        confidence: 0.87,
                        title: "Sleep log looks missing",
                        message: "You usually have enough sleep data for a trend, but the latest night is not logged yet.",
                        evidence: ["\(recentTotals.count) logged sleep days in the recent window", "last sleep entry \(daysBetween(latestDate, now)) days ago"],
                        action: CoachAction(label: "Log sleep", type: .openLogSleep),
                        dismissalKey: "sleep:missing_log:v1:\(dayString(latestDate))"
                    )
                )
            }
        }

        guard recentTotals.count >= 5 else {
            return candidates
        }

        let averageHours = average(recentTotals.map(\.totalHours))
        let recentSleepEntries = entries
            .filter { parseDate($0.loggedAt) >= addingDays(-7, to: now) }
            .sorted { parseDate($0.loggedAt) > parseDate($1.loggedAt) }
        let highWakeUpNights = recentSleepEntries.filter { $0.wakeUps >= 2 }
        let wakeUpAverage = average(recentSleepEntries.map { Double($0.wakeUps) })
        let wakeUpPhrase = highWakeUpNights.count >= 3 && wakeUpAverage >= 2
            ? " Wake-ups are also repeatedly elevated, so keep the plan simple."
            : ""

        if targetHours > 0, averageHours <= targetHours - 0.75 {
            candidates.append(
                suggestion(
                    id: "sleep-below-target-\(dayString(now))",
                    surface: .sleep,
                    category: "trend",
                    priority: 84,
                    confidence: 0.90,
                    title: "Sleep is below target",
                    message: "Your sleep average is \(formatHours(targetHours - averageHours)) under target this week.\(wakeUpPhrase) Protect tonight's wind-down window.",
                    evidence: ["\(recentTotals.count) logged nights", "average \(formatHours(averageHours)) vs target \(formatHours(targetHours))"],
                    action: CoachAction(label: "Log sleep", type: .openLogSleep),
                    dismissalKey: "sleep:below_target:v1:\(Int((targetHours - averageHours).rounded())):\(recentTotals.count)"
                )
            )
        } else if targetHours > 0, averageHours >= targetHours {
            candidates.append(
                suggestion(
                    id: "sleep-target-hit-\(dayString(now))",
                    surface: .sleep,
                    category: "congratulations",
                    priority: 88,
                    confidence: 0.92,
                    title: "Sleep target is on track",
                    message: "Your recent sleep average is meeting the target. Keep the routine steady.",
                    evidence: ["\(recentTotals.count) logged nights", "average \(formatHours(averageHours))"],
                    action: nil,
                    dismissalKey: "sleep:target_hit:v1:\(dayString(now)):\(Int(averageHours.rounded()))"
                )
            )
        }

        return candidates
    }

    private static func weightGoalPaceSuggestion(
        recentEntries: [WeightEntry],
        recentAverage: Double,
        target: WeightTarget?,
        now: Date
    ) -> CoachSuggestion? {
        guard recentEntries.count >= 6,
              let targetWeight = target?.targetWeight,
              let targetDateString = target?.targetDate else {
            return nil
        }

        let targetDate = parseDay(targetDateString)
        let remainingDays = daysBetween(now, targetDate)
        guard targetDate > now, remainingDays >= 7, abs(recentAverage - targetWeight) > 1.0 else {
            return nil
        }

        let sorted = recentEntries.sorted { parseDate($0.loggedAt) < parseDate($1.loggedAt) }
        let splitIndex = sorted.count / 2
        let earlier = Array(sorted.prefix(splitIndex))
        let later = Array(sorted.suffix(sorted.count - splitIndex))
        guard let earlierMidpoint = midpointDate(for: earlier),
              let laterMidpoint = midpointDate(for: later) else {
            return nil
        }

        let elapsedDays = max(daysBetween(earlierMidpoint, laterMidpoint), 1)
        let earlierAverage = average(earlier.map(\.weight))
        let laterAverage = average(later.map(\.weight))
        let actualDailyChange = (laterAverage - earlierAverage) / Double(elapsedDays)
        let requiredDailyChange = (targetWeight - recentAverage) / Double(remainingDays)

        guard abs(requiredDailyChange) >= 0.03 else { return nil }

        let movingTowardGoal = actualDailyChange * requiredDailyChange > 0
        let paceRatio = abs(actualDailyChange) / max(abs(requiredDailyChange), 0.001)
        let actualWeeklyChange = abs(actualDailyChange * 7)
        let requiredWeeklyChange = abs(requiredDailyChange * 7)

        if movingTowardGoal, paceRatio >= 0.60 {
            let paceWord = paceRatio >= 1.15 ? "ahead of" : "on"
            return suggestion(
                id: "weight-goal-pace-\(dayString(now))",
                surface: .weight,
                category: "goal_tracking",
                priority: 82,
                confidence: 0.89,
                title: "Weight goal is \(paceWord) pace",
                message: "Your rolling average is moving toward the goal at a pace that fits the current target date. Keep the plan steady.",
                evidence: [
                    "\(recentEntries.count) weigh-ins in 14 days",
                    "trend \(formatWeight(actualWeeklyChange))/week",
                    "needed \(formatWeight(requiredWeeklyChange))/week"
                ],
                action: nil,
                dismissalKey: "weight:goal_pace:v1:on:\(targetDateString):\(Int(paceRatio.rounded()))"
            )
        }

        if !movingTowardGoal || paceRatio < 0.35 {
            return suggestion(
                id: "weight-goal-behind-\(dayString(now))",
                surface: .weight,
                category: "goal_tracking",
                priority: 86,
                confidence: 0.88,
                title: "Goal date needs attention",
                message: "Your rolling average is not moving fast enough for the current goal date. Review macro consistency before changing the target.",
                evidence: [
                    "\(recentEntries.count) weigh-ins in 14 days",
                    "recent average \(formatWeight(recentAverage)) vs target \(formatWeight(targetWeight))",
                    "needed \(formatWeight(requiredWeeklyChange))/week"
                ],
                action: CoachAction(label: "Review target", type: .editTargets),
                dismissalKey: "weight:goal_pace:v1:behind:\(targetDateString):\(Int(recentAverage.rounded()))"
            )
        }

        return nil
    }

    private static func macroTargetCongratulations(
        totals: DailyTotals,
        targets: MacroTargets,
        selectedIsToday: Bool,
        now: Date
    ) -> CoachSuggestion? {
        guard targets.calories > 0, targets.protein > 0, totals.calories > 0 else {
            return nil
        }

        let hour = easternCalendar.component(.hour, from: now)
        let completeEnough = !selectedIsToday || hour >= 19 || totals.calories >= targets.calories * 0.85
        guard completeEnough else { return nil }

        let caloriesClose = abs(totals.calories - targets.calories) / targets.calories <= 0.05
        let proteinHit = totals.protein >= targets.protein * 0.95
        let carbsClose = targets.carbs <= 0 || abs(totals.carbs - targets.carbs) / targets.carbs <= 0.10
        let fatClose = targets.fat <= 0 || abs(totals.fat - targets.fat) / targets.fat <= 0.10
        guard caloriesClose, proteinHit, carbsClose, fatClose else { return nil }

        return suggestion(
            id: "macro-target-hit-\(totals.day)",
            surface: .macros,
            category: "congratulations",
            priority: 94,
            confidence: 0.96,
            title: "Macro targets are dialed in",
            message: "You are close enough to the macro targets for this day. That is the kind of consistency that moves the trend.",
            evidence: ["calories within 5%", "protein at least 95% of target"],
            action: nil,
            dismissalKey: "macro:target_hit:v1:\(totals.day)"
        )
    }

    private static func missedMealPrompt(entries: [Entry], now: Date) -> CoachSuggestion? {
        let today = dayString(now)
        let todaysEntries = entries.filter { entryDay($0) == today }
        let nowHour = hourOfDay(now)

        for daypart in [CoachDaypart.breakfast, .lunch] {
            guard let summary = learnedMealWindow(for: daypart, entries: entries, excludingDay: today, now: now),
                  let defaultPromptHour = daypart.defaultPromptHour else {
                continue
            }

            let promptHour = max(defaultPromptHour, summary.latestFirstLogHour + 1)
            let hasLoggedToday = todaysEntries.contains { daypart.hours.contains(hourOfDay(parseDate($0.consumedAt))) }
            guard nowHour >= promptHour, !hasLoggedToday else { continue }

            return suggestion(
                id: "macro-\(daypart.rawValue)-missing-\(today)",
                surface: .macros,
                category: "missing_\(daypart.rawValue)",
                priority: daypart == .breakfast ? 86 : 84,
                confidence: 0.89,
                title: "Still need to enter \(daypart.label)?",
                message: "It is later than your learned \(daypart.label) logging window and \(daypart.label) is not logged yet.",
                evidence: [
                    "\(daypart.label) usually logged by \(formatHour(summary.latestFirstLogHour))",
                    "\(summary.dayCount) recent \(daypart.label) days",
                    "no \(daypart.label) entry today"
                ],
                action: CoachAction(label: "Log \(daypart.label)", type: .openLogMeal),
                dismissalKey: "macro:missing_\(daypart.rawValue):v2:\(summary.latestFirstLogHour):\(summary.dayCount)"
            )
        }

        return nil
    }

    private static func habitualMealPrompt(entries: [Entry], now: Date) -> CoachSuggestion? {
        let today = dayString(now)
        guard let daypart = CoachDaypart.currentMealWindow(for: now) else { return nil }

        let todayNames = Set(entries
            .filter { entryDay($0) == today }
            .filter { daypart.hours.contains(hourOfDay(parseDate($0.consumedAt))) }
            .map { normalizedName($0.itemName) })
        let recent = entries
            .filter { entryDay($0) != today }
            .filter { parseDate($0.consumedAt) >= addingDays(-14, to: now) }
            .filter { daypart.hours.contains(hourOfDay(parseDate($0.consumedAt))) }

        let grouped = Dictionary(grouping: recent, by: { normalizedName($0.itemName) })
        let candidates = grouped.compactMap { normalizedName, values -> HabitualItemCandidate? in
            let days = Set(values.map(entryDay))
            guard !todayNames.contains(normalizedName), days.count >= 3 else { return nil }
            let sortedValues = values.sorted { parseDate($0.consumedAt) > parseDate($1.consumedAt) }
            guard let latest = sortedValues.first else { return nil }
            return HabitualItemCandidate(
                normalizedName: normalizedName,
                displayName: latest.itemName,
                dayCount: days.count,
                latestLoggedAt: parseDate(latest.consumedAt),
                mealItem: CoachMealItemPayload(
                    itemName: latest.itemName,
                    quantity: latest.quantity,
                    unit: latest.unit ?? "serving",
                    calories: latest.calories,
                    protein: latest.protein,
                    carbs: latest.carbs,
                    fat: latest.fat
                )
            )
        }

        guard let match = candidates
            .sorted(by: {
                if $0.dayCount == $1.dayCount {
                    return $0.latestLoggedAt > $1.latestLoggedAt
                }
                return $0.dayCount > $1.dayCount
            })
            .first,
              match.dayCount >= 3 else {
            return nil
        }

        return suggestion(
            id: "macro-usual-\(match.normalizedName)-\(today)",
            surface: .macros,
            category: "quick_add",
            priority: 76,
            confidence: match.dayCount >= 4 ? 0.89 : 0.86,
            title: "Usual \(daypart.label)?",
            message: "You often log \(match.displayName) around this time. Add it now if that is today's move.",
            evidence: ["\(match.dayCount) \(daypart.label) days in 14 days", "not logged in this window today"],
            action: CoachAction(
                label: "Add usual item",
                type: .logMealItem,
                searchText: match.displayName,
                mealItem: match.mealItem
            ),
            dismissalKey: "macro:usual_item:v2:\(match.normalizedName)"
        )
    }

    private static func alcoholPrompt(entries: [Entry], now: Date) -> CoachSuggestion? {
        let cutoff = addingDays(-7, to: now)
        let alcoholEntries = entries
            .filter { parseDate($0.consumedAt) >= cutoff }
            .filter { hasAlcoholToken($0.itemName) }

        guard alcoholEntries.count >= 2 else { return nil }

        let calories = alcoholEntries.reduce(0.0) { $0 + $1.calories }
        guard calories >= 300 else { return nil }

        return suggestion(
            id: "macro-alcohol-\(dayString(now))",
            surface: .macros,
            category: "trend",
            priority: 78,
            confidence: 0.86,
            title: "Alcohol is affecting the week",
            message: "Alcohol has shown up more than once recently. Keep the next couple of choices cleaner if you want the calorie trend back on target.",
            evidence: ["\(alcoholEntries.count) alcohol entries in 7 days", "\(Int(calories.rounded())) logged calories"],
            action: CoachAction(label: "Log next meal", type: .openLogMeal),
            dismissalKey: "macro:alcohol:v1:\(alcoholEntries.count):\(Int(calories.rounded() / 100))"
        )
    }

    private static func workoutTrend(entries: [WorkoutEntry], now: Date) -> CoachSuggestion? {
        let recentEntries = entries
            .filter { parseDate($0.loggedAt) >= addingDays(-45, to: now) }
            .sorted { parseDate($0.loggedAt) > parseDate($1.loggedAt) }
        guard recentEntries.count >= 8 else { return nil }

        let recent = Array(recentEntries.prefix(3))
        let baseline = Array(recentEntries.dropFirst(3).prefix(5))
        let recentDuration = average(recent.map(\.durationHours))
        let baselineDuration = average(baseline.map(\.durationHours))
        guard baselineDuration > 0 else { return nil }

        let durationDelta = (recentDuration - baselineDuration) / baselineDuration
        if abs(durationDelta) >= 0.15 {
            let direction = durationDelta > 0 ? "longer" : "shorter"
            return suggestion(
                id: "workout-duration-trend-\(dayString(now))",
                surface: .workouts,
                category: "trend",
                priority: 76,
                confidence: 0.87,
                title: "Workout duration changed",
                message: "Your last 3 workouts are running \(direction) than your recent baseline. Keep the intensity honest and log the next session clearly.",
                evidence: ["last 3 avg \(formatHours(recentDuration))", "baseline \(formatHours(baselineDuration))"],
                action: CoachAction(label: "Log workout", type: .openLogWorkout),
                dismissalKey: "workouts:duration_trend:v1:\(Int((durationDelta * 100).rounded()))"
            )
        }

        let recentIntensity = average(recent.map { Double(intensityScore($0.intensity)) })
        let baselineIntensity = average(baseline.map { Double(intensityScore($0.intensity)) })
        if abs(recentIntensity - baselineIntensity) >= 0.8 {
            let direction = recentIntensity > baselineIntensity ? "higher" : "lower"
            return suggestion(
                id: "workout-intensity-trend-\(dayString(now))",
                surface: .workouts,
                category: "trend",
                priority: 74,
                confidence: 0.86,
                title: "Workout intensity shifted",
                message: "Your last few workouts are trending \(direction) intensity than usual. Match the next session to how recovered you feel.",
                evidence: ["last 3 workouts", "prior 5-workout baseline"],
                action: CoachAction(label: "Log workout", type: .openLogWorkout),
                dismissalKey: "workouts:intensity_trend:v1:\(Int((recentIntensity - baselineIntensity).rounded()))"
            )
        }

        return nil
    }

    private static func repeatWorkoutPrompt(entries: [WorkoutEntry], now: Date) -> CoachSuggestion? {
        let today = dayString(now)
        let recentEntries = entries
            .filter { dayString(parseDate($0.loggedAt)) != today }
            .filter { parseDate($0.loggedAt) >= addingDays(-30, to: now) }

        guard recentEntries.count >= 5 else { return nil }

        let todaysWorkoutNames = Set(entries
            .filter { dayString(parseDate($0.loggedAt)) == today }
            .map { normalizedName($0.description) })

        let grouped = Dictionary(grouping: recentEntries, by: { normalizedName($0.description) })
        let candidates = grouped.compactMap { normalizedDescription, values -> HabitualWorkoutCandidate? in
            let days = Set(values.map { dayString(parseDate($0.loggedAt)) })
            guard !todaysWorkoutNames.contains(normalizedDescription), days.count >= 3 else { return nil }

            let sortedValues = values.sorted { parseDate($0.loggedAt) > parseDate($1.loggedAt) }
            guard let latest = sortedValues.first,
                  parseDate(latest.loggedAt) >= addingDays(-14, to: now) else {
                return nil
            }

            return HabitualWorkoutCandidate(
                normalizedDescription: normalizedDescription,
                displayName: latest.description,
                dayCount: days.count,
                latestLoggedAt: parseDate(latest.loggedAt),
                workout: CoachWorkoutPayload(
                    description: latest.description,
                    intensity: normalizeWorkoutIntensity(latest.intensity),
                    durationHours: latest.durationHours,
                    caloriesBurned: latest.caloriesBurned
                )
            )
        }

        guard let match = candidates
            .sorted(by: {
                if $0.dayCount == $1.dayCount {
                    return $0.latestLoggedAt > $1.latestLoggedAt
                }
                return $0.dayCount > $1.dayCount
            })
            .first else {
            return nil
        }

        return suggestion(
            id: "workout-usual-\(match.normalizedDescription)-\(today)",
            surface: .workouts,
            category: "quick_add",
            priority: 75,
            confidence: match.dayCount >= 4 ? 0.89 : 0.86,
            title: "Usual workout?",
            message: "You often log \(match.displayName). Add it now if that is today's workout.",
            evidence: ["\(match.dayCount) matching workout days in 30 days", "not logged today"],
            action: CoachAction(
                label: "Log usual workout",
                type: .logWorkoutEntry,
                workout: match.workout
            ),
            dismissalKey: "workouts:usual:v1:\(match.normalizedDescription)"
        )
    }

    private static func suggestion(
        id: String,
        surface: CoachSurface,
        category: String,
        priority: Int,
        confidence: Double,
        title: String,
        message: String,
        evidence: [String],
        action: CoachAction?,
        dismissalKey: String,
        modelSource: CoachModelSource = .ruleTemplate
    ) -> CoachSuggestion {
        CoachSuggestion(
            id: id,
            surface: surface,
            category: category,
            priority: priority,
            confidence: confidence,
            title: title,
            message: message,
            evidence: evidence,
            primaryAction: action,
            dismissalKey: dismissalKey,
            expiresAt: endOfEasternDay(containing: Date()),
            modelSource: modelSource
        )
    }

    private static func isCompleteMacroDay(_ totals: DailyTotals, targets: MacroTargets) -> Bool {
        if targets.calories > 0 {
            return totals.calories >= max(300, targets.calories * 0.40)
        }
        return totals.calories >= 300
    }

    private static func lastSevenWorkoutDays(from dailyCalories: [WorkoutDailyCalories], now: Date) -> Set<String> {
        let cutoff = dayString(addingDays(-6, to: now))
        return Set(dailyCalories.filter { $0.day >= cutoff }.map(\.day))
    }

    private static func intensityScore(_ intensity: String) -> Int {
        switch intensity.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "low", "light", "easy":
            return 1
        case "high", "intense", "hard":
            return 3
        default:
            return 2
        }
    }

    private static func normalizeWorkoutIntensity(_ intensity: String) -> String {
        switch intensity.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "low", "light", "easy":
            return "low"
        case "high", "intense", "hard":
            return "high"
        default:
            return "medium"
        }
    }

    private static func entryDay(_ entry: Entry) -> String {
        if let day = entry.day {
            return day
        }
        return dayString(parseDate(entry.consumedAt))
    }

    private static func learnedMealWindow(
        for daypart: CoachDaypart,
        entries: [Entry],
        excludingDay: String,
        now: Date
    ) -> MealWindowSummary? {
        let cutoff = addingDays(-21, to: now)
        let matchingEntries = entries
            .filter { entryDay($0) != excludingDay }
            .filter { parseDate($0.consumedAt) >= cutoff }
            .filter { daypart.hours.contains(hourOfDay(parseDate($0.consumedAt))) }

        let entriesByDay = Dictionary(grouping: matchingEntries, by: entryDay)
        guard entriesByDay.count >= 3 else { return nil }

        let firstLogHours = entriesByDay.values.compactMap { dayEntries in
            dayEntries
                .map { hourOfDay(parseDate($0.consumedAt)) }
                .min()
        }
        guard let latestFirstLogHour = firstLogHours.max() else { return nil }

        return MealWindowSummary(
            daypart: daypart,
            dayCount: entriesByDay.count,
            latestFirstLogHour: latestFirstLogHour,
            averageFirstLogHour: average(firstLogHours.map(Double.init))
        )
    }

    private static func hasAlcoholToken(_ name: String) -> Bool {
        let tokens = name
            .lowercased()
            .split { !$0.isLetter }
            .map(String.init)
        let alcoholTokens: Set<String> = [
            "beer", "wine", "cocktail", "vodka", "whiskey", "whisky", "tequila",
            "bourbon", "rum", "gin", "seltzer", "cider", "margarita", "martini"
        ]
        return tokens.contains { alcoholTokens.contains($0) }
    }

    private static func normalizedName(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }

    private static func average(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        return values.reduce(0, +) / Double(values.count)
    }

    private static func formatHours(_ hours: Double) -> String {
        if hours < 1 {
            return "\(Int((hours * 60).rounded()))m"
        }
        let rounded = (hours * 10).rounded() / 10
        if abs(rounded.rounded() - rounded) < 0.01 {
            return "\(Int(rounded))h"
        }
        return String(format: "%.1fh", rounded)
    }

    private static func formatWeight(_ weight: Double) -> String {
        String(format: "%.1f lb", weight)
    }

    private static func daysBetween(_ start: Date, _ end: Date) -> Int {
        max(easternCalendar.dateComponents([.day], from: start, to: end).day ?? 0, 0)
    }

    private static func midpointDate(for entries: [WeightEntry]) -> Date? {
        guard !entries.isEmpty else { return nil }
        let sorted = entries.sorted { parseDate($0.loggedAt) < parseDate($1.loggedAt) }
        return parseDate(sorted[sorted.count / 2].loggedAt)
    }

    private static func addingDays(_ days: Int, to date: Date) -> Date {
        easternCalendar.date(byAdding: .day, value: days, to: date) ?? date
    }

    private static func hourOfDay(_ date: Date) -> Int {
        easternCalendar.component(.hour, from: date)
    }

    private static func formatHour(_ hour: Int) -> String {
        let clampedHour = min(max(hour, 0), 23)
        let components = DateComponents(calendar: easternCalendar, timeZone: easternCalendar.timeZone, hour: clampedHour)
        guard let date = components.date else { return "\(clampedHour):00" }

        let formatter = DateFormatter()
        formatter.calendar = easternCalendar
        formatter.timeZone = easternCalendar.timeZone
        formatter.dateFormat = "h a"
        return formatter.string(from: date)
    }

    private static func dayString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = easternCalendar
        formatter.timeZone = easternCalendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private static func parseDay(_ day: String) -> Date {
        let formatter = DateFormatter()
        formatter.calendar = easternCalendar
        formatter.timeZone = easternCalendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: day) ?? Date.distantPast
    }

    private static func parseDate(_ iso: String) -> Date {
        let isoFormatter = ISO8601DateFormatter()
        if let date = isoFormatter.date(from: iso) {
            return date
        }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
        return formatter.date(from: iso) ?? Date.distantPast
    }

    private static func endOfEasternDay(containing date: Date) -> Date {
        let start = easternCalendar.startOfDay(for: date)
        return easternCalendar.date(byAdding: DateComponents(day: 1, second: -1), to: start) ?? date
    }

    private static var easternCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York") ?? .current
        return calendar
    }
}
