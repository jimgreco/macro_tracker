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
    case openLogWorkout
    case openLogWeight
    case openLogSleep
    case editTargets
}

struct CoachAction {
    let label: String
    let type: CoachActionType
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

    let suggestions: [CoachSuggestion]
    let onPrimaryAction: (CoachActionType) -> Void

    var body: some View {
        if coachEnabled, let suggestion = dismissals.visibleSuggestion(from: suggestions) {
            AICoachCard(
                suggestion: suggestion,
                onPrimaryAction: onPrimaryAction,
                onDismissForToday: { dismissals.dismissForToday(suggestion) },
                onDismissAction: { dismissals.dismissAction(suggestion) }
            )
        }
    }
}

struct AICoachCard: View {
    let suggestion: CoachSuggestion
    let onPrimaryAction: (CoachActionType) -> Void
    let onDismissForToday: () -> Void
    let onDismissAction: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "sparkles")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(
                        LinearGradient(
                            colors: [.cyan, .purple, .pink],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        in: RoundedRectangle(cornerRadius: 10)
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

                    Text(suggestion.message)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .fixedSize(horizontal: false, vertical: true)
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

            if !suggestion.evidence.isEmpty {
                Text("Based on \(suggestion.evidence.joined(separator: " · ")).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let action = suggestion.primaryAction {
                Button {
                    onPrimaryAction(action.type)
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
        case .openLogMeal, .openQuickAdd:
            return "fork.knife"
        case .openLogWorkout:
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
        let wakeUpAverage = average(entries.prefix(7).map { Double($0.wakeUps) })
        let wakeUpPhrase = wakeUpAverage >= 2 ? " Wake-ups are also running high, so keep the plan simple." : ""

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

        if easternCalendar.component(.hour, from: now) >= 11 {
            let historicalBreakfastDays = Set(entries
                .filter { entryDay($0) != today }
                .filter { hourOfDay(parseDate($0.consumedAt)) >= 5 && hourOfDay(parseDate($0.consumedAt)) < 11 }
                .map(entryDay))
            let hasBreakfastToday = todaysEntries.contains { hourOfDay(parseDate($0.consumedAt)) >= 5 && hourOfDay(parseDate($0.consumedAt)) < 11 }
            if historicalBreakfastDays.count >= 3, !hasBreakfastToday {
                return suggestion(
                    id: "macro-breakfast-missing-\(today)",
                    surface: .macros,
                    category: "missing_meal",
                    priority: 86,
                    confidence: 0.88,
                    title: "Still need to enter breakfast?",
                    message: "It is later than your usual breakfast window and breakfast is not logged yet.",
                    evidence: ["breakfast logged on \(historicalBreakfastDays.count) recent days", "no breakfast entry today"],
                    action: CoachAction(label: "Log breakfast", type: .openLogMeal),
                    dismissalKey: "macro:missing_breakfast:v1:\(today)"
                )
            }
        }

        if easternCalendar.component(.hour, from: now) >= 14 {
            let historicalLunchDays = Set(entries
                .filter { entryDay($0) != today }
                .filter { hourOfDay(parseDate($0.consumedAt)) >= 11 && hourOfDay(parseDate($0.consumedAt)) < 15 }
                .map(entryDay))
            let hasLunchToday = todaysEntries.contains { hourOfDay(parseDate($0.consumedAt)) >= 11 && hourOfDay(parseDate($0.consumedAt)) < 15 }
            if historicalLunchDays.count >= 3, !hasLunchToday {
                return suggestion(
                    id: "macro-lunch-missing-\(today)",
                    surface: .macros,
                    category: "missing_meal",
                    priority: 84,
                    confidence: 0.88,
                    title: "Still need to enter lunch?",
                    message: "It is later than your usual lunch window and lunch is not logged yet.",
                    evidence: ["lunch logged on \(historicalLunchDays.count) recent days", "no lunch entry today"],
                    action: CoachAction(label: "Log lunch", type: .openLogMeal),
                    dismissalKey: "macro:missing_lunch:v1:\(today)"
                )
            }
        }

        return nil
    }

    private static func habitualMealPrompt(entries: [Entry], now: Date) -> CoachSuggestion? {
        let today = dayString(now)
        let currentHour = hourOfDay(now)
        let daypart: Range<Int>
        let daypartLabel: String

        switch currentHour {
        case 6..<11:
            daypart = 5..<11
            daypartLabel = "breakfast"
        case 11..<15:
            daypart = 11..<15
            daypartLabel = "lunch"
        case 17..<22:
            daypart = 17..<22
            daypartLabel = "dinner"
        default:
            return nil
        }

        let todayNames = Set(entries.filter { entryDay($0) == today }.map { normalizedName($0.itemName) })
        let recent = entries
            .filter { entryDay($0) != today }
            .filter { parseDate($0.consumedAt) >= addingDays(-14, to: now) }
            .filter { daypart.contains(hourOfDay(parseDate($0.consumedAt))) }

        let grouped = Dictionary(grouping: recent, by: { normalizedName($0.itemName) })
        guard let match = grouped
            .filter({ !todayNames.contains($0.key) && $0.value.count >= 3 })
            .sorted(by: { $0.value.count > $1.value.count })
            .first,
              let displayName = match.value.first?.itemName else {
            return nil
        }

        return suggestion(
            id: "macro-usual-\(match.key)-\(today)",
            surface: .macros,
            category: "quick_add",
            priority: 76,
            confidence: 0.86,
            title: "Usual \(daypartLabel)?",
            message: "You often log \(displayName) around this time. Open quick add if that is today's move.",
            evidence: ["\(match.value.count) similar \(daypartLabel) logs in 14 days"],
            action: CoachAction(label: "Open quick add", type: .openQuickAdd),
            dismissalKey: "macro:usual_item:v1:\(match.key)"
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

    private static func entryDay(_ entry: Entry) -> String {
        if let day = entry.day {
            return day
        }
        return dayString(parseDate(entry.consumedAt))
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

    private static func addingDays(_ days: Int, to date: Date) -> Date {
        easternCalendar.date(byAdding: .day, value: days, to: date) ?? date
    }

    private static func hourOfDay(_ date: Date) -> Int {
        easternCalendar.component(.hour, from: date)
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
