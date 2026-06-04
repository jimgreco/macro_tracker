import Foundation
import SwiftUI
#if canImport(FoundationModels)
import FoundationModels
#endif

enum CoachBrand {
    static let name = "Coach Tony P."
}

enum CoachSettingKeys {
    static let enabled = "ai_coach_enabled"
    static let mode = "ai_coach_mode"
    static let disabledCategories = "ai_coach_disabled_categories"
}

enum CoachMode: String, CaseIterable, Identifiable, Sendable {
    case localModelWithTemplates = "local_model_with_templates"
    case ruleTemplates = "rule_templates"
    case localModelOnly = "local_model_only"
    case off

    var id: String { rawValue }

    var label: String {
        switch self {
        case .localModelWithTemplates:
            return "On"
        case .ruleTemplates:
            return "Rules Only"
        case .localModelOnly:
            return "Local AI Only"
        case .off:
            return "Off"
        }
    }

    var detail: String {
        switch self {
        case .localModelWithTemplates:
            return "Use local AI when available, with local rule templates as the fallback."
        case .ruleTemplates:
            return "Use deterministic local rules and templated copy only."
        case .localModelOnly:
            return "Show cards only when the on-device model can narrate an eligible rule."
        case .off:
            return "Hide \(CoachBrand.name) cards."
        }
    }

    var allowsTemplateFallback: Bool {
        switch self {
        case .localModelWithTemplates, .ruleTemplates:
            return true
        case .localModelOnly, .off:
            return false
        }
    }

    var allowsLocalModel: Bool {
        switch self {
        case .localModelWithTemplates, .localModelOnly:
            return true
        case .ruleTemplates, .off:
            return false
        }
    }

    static func resolved(rawValue: String, legacyEnabled: Bool) -> CoachMode {
        guard legacyEnabled else { return .off }
        return CoachMode(rawValue: rawValue) ?? .localModelWithTemplates
    }

    static func effective(rawValue: String, legacyEnabled: Bool, isAdmin: Bool) -> CoachMode {
        let mode = resolved(rawValue: rawValue, legacyEnabled: legacyEnabled)
        guard !isAdmin, mode != .off else { return mode }
        return .localModelWithTemplates
    }
}

enum CoachCategoryPreference: String, CaseIterable, Identifiable, Sendable {
    case trends
    case reminders
    case habitSuggestions
    case congratulations
    case alcohol
    case cleanup

    var id: String { rawValue }

    var label: String {
        switch self {
        case .trends:
            return "Trend coaching"
        case .reminders:
            return "Logging reminders"
        case .habitSuggestions:
            return "Habit quick adds"
        case .congratulations:
            return "Celebrations"
        case .alcohol:
            return "Alcohol coaching"
        case .cleanup:
            return "Cleanup prompts"
        }
    }

    private var suggestionCategories: Set<String> {
        switch self {
        case .trends:
            return ["trend", "steering", "goal_tracking", "plateau", "cross_page", "recovery"]
        case .reminders:
            return ["reminder"]
        case .habitSuggestions:
            return ["quick_add"]
        case .congratulations:
            return ["congratulations", "maintenance"]
        case .alcohol:
            return ["alcohol"]
        case .cleanup:
            return ["cleanup"]
        }
    }

    func matches(_ suggestion: CoachSuggestion) -> Bool {
        suggestionCategories.contains(suggestion.category)
    }

    static func disabledIDs(from rawValue: String) -> Set<String> {
        guard let data = rawValue.data(using: .utf8),
              let values = try? JSONDecoder().decode([String].self, from: data) else {
            return Set(rawValue.split(separator: ",").map { String($0) })
        }
        return Set(values)
    }

    static func encoded(_ disabledIDs: Set<String>) -> String {
        let values = disabledIDs.sorted()
        guard let data = try? JSONEncoder().encode(values),
              let rawValue = String(data: data, encoding: .utf8) else {
            return "[]"
        }
        return rawValue
    }

    static func isDisabled(_ suggestion: CoachSuggestion, rawValue: String) -> Bool {
        let disabledIDs = disabledIDs(from: rawValue)
        guard !disabledIDs.isEmpty else { return false }
        return allCases.contains { preference in
            disabledIDs.contains(preference.rawValue) && preference.matches(suggestion)
        }
    }
}

enum CoachSurface: String, Sendable {
    case macros
    case workouts
    case weight
    case sleep
}

enum CoachModelSource: String, Sendable {
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

enum CoachActionType: Sendable {
    case openLogMeal
    case openQuickAdd
    case logMealItem
    case openLogWorkout
    case logWorkoutEntry
    case openLogWeight
    case openLogSleep
    case editTargets
}

struct CoachMealItemPayload: Sendable {
    let itemName: String
    let quantity: Double
    let unit: String
    let calories: Double
    let protein: Double
    let carbs: Double
    let fat: Double
}

struct CoachWorkoutPayload: Sendable {
    let description: String
    let intensity: String
    let durationHours: Double
    let caloriesBurned: Double
}

struct CoachAction: Sendable {
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

struct CoachSuggestion: Identifiable, Sendable {
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

    func narrated(title: String, message: String) -> CoachSuggestion {
        CoachSuggestion(
            id: id,
            surface: surface,
            category: category,
            priority: priority,
            confidence: confidence,
            title: title,
            message: message,
            evidence: evidence,
            primaryAction: primaryAction,
            dismissalKey: dismissalKey,
            expiresAt: expiresAt,
            modelSource: .afmLocal
        )
    }
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
        visibleSuggestions(from: suggestions, now: now).first
    }

    func visibleSuggestions(from suggestions: [CoachSuggestion], now: Date = Date()) -> [CoachSuggestion] {
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

    func syncedRecords(now: Date = Date()) -> [CoachDismissalRecord] {
        removeExpiredTodayDismissals(now: now)

        let todayRecords = loadTodayDismissals().map { key, dismissedUntil in
            CoachDismissalRecord(
                type: "today",
                key: key,
                dismissedUntil: Self.isoString(from: dismissedUntil),
                updatedAt: nil
            )
        }

        let actionRecords = loadActionDismissals().map { key in
            CoachDismissalRecord(
                type: "pattern",
                key: key,
                dismissedUntil: nil,
                updatedAt: nil
            )
        }

        return (todayRecords + actionRecords).sorted {
            if $0.type == $1.type {
                return $0.key < $1.key
            }
            return $0.type < $1.type
        }
    }

    func mergeSyncedRecords(_ records: [CoachDismissalRecord], now: Date = Date()) {
        var todayDismissals = loadTodayDismissals()
        var actionDismissals = loadActionDismissals()

        for record in records {
            switch record.type {
            case "today":
                guard let dismissedUntilString = record.dismissedUntil,
                      let dismissedUntil = Self.parseIsoDate(dismissedUntilString),
                      dismissedUntil > now else {
                    continue
                }
                let existing = todayDismissals[record.key]
                if existing == nil || dismissedUntil > existing! {
                    todayDismissals[record.key] = dismissedUntil
                }
            case "pattern":
                actionDismissals.insert(record.key)
            default:
                continue
            }
        }

        saveTodayDismissals(todayDismissals.filter { $0.value > now })
        saveActionDismissals(actionDismissals)
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

    private static func isoString(from date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    private static func parseIsoDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) {
            return date
        }

        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }
}

struct AICoachSlot: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var auth: AuthManager
    @ObservedObject var dismissals: CoachDismissalStore
    @AppStorage(CoachSettingKeys.enabled) private var legacyCoachEnabled = true
    @AppStorage(CoachSettingKeys.mode) private var coachModeRaw = CoachMode.localModelWithTemplates.rawValue
    @AppStorage(CoachSettingKeys.disabledCategories) private var disabledCategoryIDsRaw = "[]"
    @State private var recordedShownSuggestionKeys: Set<String> = []
    @State private var narratedSuggestion: CoachSuggestion?
    @State private var localAIVetoKey: String?
    @State private var narrationFailureKey: String?
    @State private var didAttemptDismissalSync = false
    @State private var selectedSuggestionID: String?

    let suggestions: [CoachSuggestion]
    let onPrimaryAction: (CoachAction) -> Void

    var body: some View {
        let showsSourceDetails = auth.user?.isAdmin == true
        let mode = CoachMode.effective(
            rawValue: coachModeRaw,
            legacyEnabled: legacyCoachEnabled,
            isAdmin: showsSourceDetails
        )
        let visibleCandidates = dismissals.visibleSuggestions(from: suggestions)
            .filter { !CoachCategoryPreference.isDisabled($0, rawValue: disabledCategoryIDsRaw) }
        let narrationKey = narrationTaskID(for: visibleCandidates, mode: mode)
        let displayedSuggestions = displayedSuggestions(from: visibleCandidates, mode: mode, narrationKey: narrationKey)
        let isLocalAIProcessing = isLocalAIProcessing(for: visibleCandidates, mode: mode, narrationKey: narrationKey)
        let suggestion = selectedSuggestion(from: displayedSuggestions)

        Group {
            if let suggestion {
                VStack(spacing: 8) {
                    AICoachCard(
                        suggestion: suggestion,
                        isLocalAIProcessing: isLocalAIProcessing,
                        showsSourceDetails: showsSourceDetails,
                        onPrimaryAction: { action in
                            recordCoachEvent("acted_on", suggestion: suggestion, action: action)
                            onPrimaryAction(action)
                        },
                        onDismissForToday: {
                            recordCoachEvent("dismissed_today", suggestion: suggestion)
                            dismissals.dismissForToday(suggestion)
                            Task { await syncDismissalsToServer(reason: "dismissed_today") }
                        },
                        onDismissAction: {
                            recordCoachEvent("dismissed_pattern", suggestion: suggestion)
                            dismissals.dismissAction(suggestion)
                            Task { await syncDismissalsToServer(reason: "dismissed_pattern") }
                        },
                        onNotUseful: {
                            recordCoachEvent("not_useful", suggestion: suggestion)
                            dismissals.dismissAction(suggestion)
                            Task { await syncDismissalsToServer(reason: "not_useful") }
                        }
                    )
                    .id(pageID(for: suggestion))
                    .transition(.opacity.combined(with: .scale(scale: 0.99)))

                    if displayedSuggestions.count > 1 {
                        AICoachPageIndicator(
                            suggestions: displayedSuggestions,
                            selectedID: pageID(for: suggestion),
                            pageID: pageID,
                            onSelect: { selectedID in
                                withAnimation(.snappy(duration: 0.22)) {
                                    selectedSuggestionID = selectedID
                                }
                            }
                        )
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .clipped()
                .simultaneousGesture(swipeGesture(for: displayedSuggestions))
                .animation(.snappy(duration: 0.22), value: pageID(for: suggestion))
                .onAppear { recordShown(suggestion) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipped()
        .task {
            await syncDismissalsFromServerIfNeeded()
        }
        .task(id: narrationTaskID(for: visibleCandidates, mode: mode)) {
            await refreshNarration(for: visibleCandidates, mode: mode)
        }
    }

    private func recordShown(_ suggestion: CoachSuggestion) {
        let shownKey = pageID(for: suggestion)
        guard !recordedShownSuggestionKeys.contains(shownKey) else { return }
        recordedShownSuggestionKeys.insert(shownKey)
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

    @MainActor
    private func syncDismissalsFromServerIfNeeded() async {
        guard !didAttemptDismissalSync else { return }
        didAttemptDismissalSync = true

        do {
            let response = try await api.getCoachDismissals()
            dismissals.mergeSyncedRecords(response.dismissals)
            let mergedRecords = dismissals.syncedRecords()
            if !mergedRecords.isEmpty {
                let synced = try await api.syncCoachDismissals(mergedRecords)
                dismissals.mergeSyncedRecords(synced.dismissals)
            }
            Diagnostics.shared.record(
                category: "coach",
                message: "\(CoachBrand.name) synced dismissals",
                details: ["count": "\(mergedRecords.count)"]
            )
        } catch {
            Diagnostics.shared.record(
                level: "warning",
                category: "coach",
                message: "\(CoachBrand.name) dismissal sync skipped",
                details: ["error": error.localizedDescription]
            )
        }
    }

    @MainActor
    private func syncDismissalsToServer(reason: String) async {
        let records = dismissals.syncedRecords()
        guard !records.isEmpty else { return }

        do {
            let response = try await api.syncCoachDismissals(records)
            dismissals.mergeSyncedRecords(response.dismissals)
            Diagnostics.shared.record(
                category: "coach",
                message: "\(CoachBrand.name) pushed dismissals",
                details: ["reason": reason, "count": "\(records.count)"]
            )
        } catch {
            Diagnostics.shared.record(
                level: "warning",
                category: "coach",
                message: "\(CoachBrand.name) dismissal push skipped",
                details: ["reason": reason, "error": error.localizedDescription]
            )
        }
    }

    private func displayedSuggestions(from candidates: [CoachSuggestion], mode: CoachMode, narrationKey: String) -> [CoachSuggestion] {
        guard mode != .off else { return [] }
        let topCandidates = Array(candidates.prefix(3))
        guard !topCandidates.isEmpty else { return [] }

        if localAIVetoKey == narrationKey {
            return []
        }

        if let narratedSuggestion,
           topCandidates.contains(where: { $0.dismissalKey == narratedSuggestion.dismissalKey }) {
            if mode.allowsTemplateFallback {
                let remainingCandidates = topCandidates.filter { $0.dismissalKey != narratedSuggestion.dismissalKey }
                return [narratedSuggestion] + remainingCandidates
            }
            return [narratedSuggestion]
        }

        if mode.allowsLocalModel, !mode.allowsTemplateFallback, narrationFailureKey != narrationKey {
            return []
        }

        return mode.allowsTemplateFallback ? topCandidates : []
    }

    private func isLocalAIProcessing(for candidates: [CoachSuggestion], mode: CoachMode, narrationKey: String) -> Bool {
        guard mode.allowsLocalModel, !candidates.isEmpty else { return false }
        if localAIVetoKey == narrationKey || narrationFailureKey == narrationKey {
            return false
        }

        let topCandidates = Array(candidates.prefix(3))
        if let narratedSuggestion,
           topCandidates.contains(where: { $0.dismissalKey == narratedSuggestion.dismissalKey }) {
            return false
        }

        return true
    }

    private func selectedSuggestion(from suggestions: [CoachSuggestion]) -> CoachSuggestion? {
        guard !suggestions.isEmpty else { return nil }
        if let selectedSuggestionID,
           let selected = suggestions.first(where: { pageID(for: $0) == selectedSuggestionID }) {
            return selected
        }
        return suggestions.first
    }

    private func pageID(for suggestion: CoachSuggestion) -> String {
        "\(suggestion.id):\(suggestion.modelSource.rawValue)"
    }

    private func swipeGesture(for suggestions: [CoachSuggestion]) -> some Gesture {
        DragGesture(minimumDistance: 24)
            .onEnded { value in
                let horizontal = value.translation.width
                let vertical = value.translation.height
                guard suggestions.count > 1,
                      abs(horizontal) > 44,
                      abs(horizontal) > abs(vertical),
                      let current = selectedSuggestion(from: suggestions),
                      let currentIndex = suggestions.firstIndex(where: { pageID(for: $0) == pageID(for: current) }) else {
                    return
                }

                let nextIndex = horizontal < 0
                    ? min(currentIndex + 1, suggestions.count - 1)
                    : max(currentIndex - 1, 0)
                guard nextIndex != currentIndex else { return }

                withAnimation(.snappy(duration: 0.22)) {
                    selectedSuggestionID = pageID(for: suggestions[nextIndex])
                }
                recordShown(suggestions[nextIndex])
            }
    }

    private func narrationTaskID(for candidates: [CoachSuggestion], mode: CoachMode) -> String {
        let candidateKey = candidates
            .prefix(3)
            .map { "\($0.id):\($0.dismissalKey):\($0.priority)" }
            .joined(separator: "|")
        return "\(mode.rawValue):\(dismissals.revision):\(candidateKey)"
    }

    @MainActor
    private func refreshNarration(for candidates: [CoachSuggestion], mode: CoachMode) async {
        guard mode.allowsLocalModel, !candidates.isEmpty else {
            narratedSuggestion = nil
            localAIVetoKey = nil
            narrationFailureKey = nil
            return
        }

        let activeKey = narrationTaskID(for: candidates, mode: mode)
        let eligibleCandidates = Array(candidates.prefix(3))
        let result = await CoachNarrationWorker.shared.narrate(candidates: eligibleCandidates, mode: mode)

        guard activeKey == narrationTaskID(for: candidates, mode: mode) else {
            return
        }

        switch result {
        case .narrated(let narrated):
            narratedSuggestion = narrated
            localAIVetoKey = nil
            narrationFailureKey = nil
            recordCoachEvent("local_ai_narrated", suggestion: narrated)
        case .vetoed(let reason):
            narratedSuggestion = nil
            localAIVetoKey = activeKey
            narrationFailureKey = nil
            Diagnostics.shared.record(
                category: "coach",
                message: "\(CoachBrand.name) local_ai_vetoed",
                details: [
                    "mode": mode.rawValue,
                    "candidate_count": "\(eligibleCandidates.count)",
                    "candidate_ids": eligibleCandidates.map(\.id).joined(separator: ","),
                    "reason": reason
                ]
            )
        case .unavailable:
            narratedSuggestion = nil
            localAIVetoKey = nil
            if narrationFailureKey != activeKey {
                narrationFailureKey = activeKey
                Diagnostics.shared.record(
                    level: "warning",
                    category: "coach",
                    message: mode.allowsTemplateFallback ? "\(CoachBrand.name) used template fallback" : "\(CoachBrand.name) local AI unavailable",
                    details: ["mode": mode.rawValue, "candidate_count": "\(eligibleCandidates.count)"]
                )
            }
        }
    }
}

actor CoachCandidateWorker {
    static let shared = CoachCandidateWorker()

    func macros(dashboard: DashboardResponse, selectedDate: Date, savedItems: [SavedItem]) -> [CoachSuggestion] {
        CoachCandidateEngine.macros(dashboard: dashboard, selectedDate: selectedDate, savedItems: savedItems)
    }

    func workouts(
        entries: [WorkoutEntry],
        dailyCalories: [WorkoutDailyCalories],
        workoutsTarget: Double,
        caloriesTarget: Double,
        sleepDailyTotals: [SleepDailyTotals],
        sleepTargetHours: Double?
    ) -> [CoachSuggestion] {
        CoachCandidateEngine.workouts(
            entries: entries,
            dailyCalories: dailyCalories,
            workoutsTarget: workoutsTarget,
            caloriesTarget: caloriesTarget,
            sleepDailyTotals: sleepDailyTotals,
            sleepTargetHours: sleepTargetHours
        )
    }

    func weight(
        entries: [WeightEntry],
        target: WeightTarget?,
        macroDailyTotals: [DailyTotals],
        macroTargets: MacroTargets?
    ) -> [CoachSuggestion] {
        CoachCandidateEngine.weight(
            entries: entries,
            target: target,
            macroDailyTotals: macroDailyTotals,
            macroTargets: macroTargets
        )
    }

    func sleep(
        entries: [SleepEntry],
        dailyTotals: [SleepDailyTotals],
        targetHours: Double
    ) -> [CoachSuggestion] {
        CoachCandidateEngine.sleep(entries: entries, dailyTotals: dailyTotals, targetHours: targetHours)
    }
}

actor CoachNarrationWorker {
    static let shared = CoachNarrationWorker()

    func narrate(candidates: [CoachSuggestion], mode: CoachMode) async -> CoachNarrationResult {
        guard mode.allowsLocalModel, !candidates.isEmpty else { return .unavailable }
        return await CoachNarrator.shared.narrate(candidates: Array(candidates.prefix(3)))
    }
}

actor CoachNarrator {
    static let shared = CoachNarrator()

    func narrate(candidates: [CoachSuggestion]) async -> CoachNarrationResult {
        guard !candidates.isEmpty else { return .unavailable }

        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            return await FoundationCoachNarrator.narrate(candidates: candidates)
        }
        #endif

        return .unavailable
    }

    static var availabilitySummary: String {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            return FoundationCoachNarrator.availabilitySummary
        }
        #endif

        return "Local AI requires iOS 26 and an Apple Intelligence-capable device."
    }
}

private struct CoachNarrationCandidatePayload: Encodable {
    let id: String
    let surface: String
    let category: String
    let priority: Int
    let confidence: Double
    let title: String
    let message: String
    let evidence: [String]
    let actionKind: String?
    let actionLabel: String?
    let actionItemName: String?
}

private struct CoachNarrationResponse: Decodable {
    let display: Bool
    let id: String?
    let title: String?
    let message: String?
    let reason: String?
}

enum CoachNarrationResult: Sendable {
    case narrated(CoachSuggestion)
    case vetoed(reason: String)
    case unavailable
}

#if canImport(FoundationModels)
@available(iOS 26.0, *)
private enum FoundationCoachNarrator {
    static func narrate(candidates: [CoachSuggestion]) async -> CoachNarrationResult {
        let model = SystemLanguageModel.default
        guard model.isAvailable else { return .unavailable }

        let session = LanguageModelSession(
            model: model,
            instructions: """
            You are Coach Tony P., a firm but friendly coach inside DailyMacros.
            You receive only rule-approved, high-confidence coaching candidates, but you are the final judgment layer.
            You may hide all candidates if the coaching would feel awkward, socially tone-deaf, low-value, or like it is encouraging an unhelpful behavior.
            Choose the clearest candidate only when it is genuinely useful for the user right now, then rewrite only its title and message.
            Do not encourage alcohol. If the best candidate is a one-tap action for alcohol, hide it.
            Preserve the facts exactly. Do not add numbers, dates, health claims, diagnoses, guarantees, shame, or medical advice.
            Keep the title under 45 characters and the message under 190 characters.
            Return JSON only.
            """
        )

        let prompt = """
        Pick one candidate by id from this JSON array:
        \(candidateJSON(candidates))

        Return exactly one of these JSON objects:
        {"display":true,"id":"candidate id","title":"short title","message":"firm friendly message","reason":"why this should be shown"}
        {"display":false,"id":null,"title":null,"message":null,"reason":"why every candidate should be hidden"}
        """

        do {
            let response = try await session.respond(
                to: prompt,
                options: GenerationOptions(sampling: .greedy, temperature: 0.1, maximumResponseTokens: 180)
            )
            return validate(response.content, candidates: candidates)
        } catch {
            return .unavailable
        }
    }

    static var availabilitySummary: String {
        switch SystemLanguageModel.default.availability {
        case .available:
            return "Local AI is available for \(CoachBrand.name) narration."
        case .unavailable(.deviceNotEligible):
            return "Local AI is unavailable because this device is not eligible for Apple Intelligence."
        case .unavailable(.appleIntelligenceNotEnabled):
            return "Local AI is unavailable until Apple Intelligence is enabled in iOS Settings."
        case .unavailable(.modelNotReady):
            return "Local AI is unavailable while the Apple Intelligence model is still preparing."
        @unknown default:
            return "Local AI is unavailable on this device right now."
        }
    }

    private static func candidateJSON(_ candidates: [CoachSuggestion]) -> String {
        let payload = candidates.map {
            CoachNarrationCandidatePayload(
                id: $0.id,
                surface: $0.surface.rawValue,
                category: $0.category,
                priority: $0.priority,
                confidence: $0.confidence,
                title: $0.title,
                message: $0.message,
                evidence: $0.evidence,
                actionKind: actionKind($0.primaryAction?.type),
                actionLabel: $0.primaryAction?.label,
                actionItemName: $0.primaryAction?.mealItem?.itemName ?? $0.primaryAction?.searchText
            )
        }

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(payload),
              let json = String(data: data, encoding: .utf8) else {
            return "[]"
        }
        return json
    }

    private static func actionKind(_ type: CoachActionType?) -> String? {
        guard let type else { return nil }

        switch type {
        case .openLogMeal:
            return "open_log_meal"
        case .openQuickAdd:
            return "open_quick_add"
        case .logMealItem:
            return "log_meal_item"
        case .openLogWorkout:
            return "open_log_workout"
        case .logWorkoutEntry:
            return "log_workout_entry"
        case .openLogWeight:
            return "open_log_weight"
        case .openLogSleep:
            return "open_log_sleep"
        case .editTargets:
            return "edit_targets"
        }
    }

    private static func validate(_ content: String, candidates: [CoachSuggestion]) -> CoachNarrationResult {
        guard let data = jsonData(from: content),
              let response = try? JSONDecoder().decode(CoachNarrationResponse.self, from: data) else {
            return .unavailable
        }

        guard response.display else {
            return .vetoed(reason: sanitizedReason(response.reason))
        }

        guard let id = response.id,
              let title = response.title,
              let message = response.message,
              let candidate = candidates.first(where: { $0.id == id }) else {
            return .unavailable
        }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedMessage = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValidTitle(trimmedTitle), isValidMessage(trimmedMessage) else {
            return .unavailable
        }

        return .narrated(candidate.narrated(title: trimmedTitle, message: trimmedMessage))
    }

    private static func jsonData(from content: String) -> Data? {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        if let data = trimmed.data(using: .utf8),
           (try? JSONDecoder().decode(CoachNarrationResponse.self, from: data)) != nil {
            return data
        }

        guard let start = trimmed.firstIndex(of: "{"),
              let end = trimmed.lastIndex(of: "}"),
              start <= end else {
            return nil
        }
        return String(trimmed[start...end]).data(using: .utf8)
    }

    private static func sanitizedReason(_ reason: String?) -> String {
        let trimmed = (reason ?? "Local AI hid every candidate.")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\n", with: " ")
        let fallback = trimmed.isEmpty ? "Local AI hid every candidate." : trimmed
        return String(fallback.prefix(180))
    }

    private static func isValidTitle(_ title: String) -> Bool {
        !title.isEmpty && title.count <= 60 && !title.contains("\n")
    }

    private static func isValidMessage(_ message: String) -> Bool {
        guard !message.isEmpty, message.count <= 230, !message.contains("\n") else {
            return false
        }

        let lowercased = message.lowercased()
        let blockedPhrases = ["guarantee", "diagnose", "disease", "cure", "you failed", "you must"]
        return !blockedPhrases.contains { lowercased.contains($0) }
    }
}
#endif

private struct AICoachPageIndicator: View {
    let suggestions: [CoachSuggestion]
    let selectedID: String
    let pageID: (CoachSuggestion) -> String
    let onSelect: (String) -> Void

    var body: some View {
        HStack(spacing: 7) {
            ForEach(Array(suggestions.enumerated()), id: \.offset) { index, suggestion in
                let id = pageID(suggestion)
                Button {
                    onSelect(id)
                } label: {
                    Circle()
                        .fill(id == selectedID ? Color.cyan : Color.secondary.opacity(0.35))
                        .frame(width: id == selectedID ? 8 : 6, height: id == selectedID ? 8 : 6)
                        .frame(width: 28, height: 22)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(CoachBrand.name) suggestion \(index + 1) of \(suggestions.count)")
                .accessibilityAddTraits(id == selectedID ? [.isSelected] : [])
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 1)
        .accessibilityElement(children: .contain)
    }
}

struct AICoachCard: View {
    @State private var showingWhyDetails = false

    let suggestion: CoachSuggestion
    let isLocalAIProcessing: Bool
    let showsSourceDetails: Bool
    let onPrimaryAction: (CoachAction) -> Void
    let onDismissForToday: () -> Void
    let onDismissAction: () -> Void
    let onNotUseful: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .top, spacing: 12) {
                ZStack(alignment: .topTrailing) {
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
                        .accessibilityLabel("\(CoachBrand.name) suggestion")

                    if isLocalAIProcessing {
                        ProgressView()
                            .controlSize(.mini)
                            .tint(.white)
                            .frame(width: 20, height: 20)
                            .background(.black.opacity(0.42), in: Circle())
                            .overlay {
                                Circle()
                                    .stroke(.white.opacity(0.38), lineWidth: 1)
                            }
                            .offset(x: 5, y: -5)
                            .accessibilityHidden(true)
                    }
                }

                VStack(alignment: .leading, spacing: 5) {
                    Text(suggestion.title)
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(coachSubtitle)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .accessibilityLabel(coachSubtitle)
                }

                Spacer(minLength: 8)

                Menu {
                    Button("Why am I seeing this?") {
                        showingWhyDetails = true
                    }
                    Divider()
                    Button("Dismiss for today", action: onDismissForToday)
                    Button("Hide this pattern", action: onDismissAction)
                    Button("Not useful", action: onNotUseful)
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(.secondary)
                        .frame(width: 36, height: 36)
                }
                .accessibilityLabel("Dismiss \(CoachBrand.name) suggestion")
                .accessibilityHint("Opens options to explain or dismiss this suggestion")
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
                    .accessibilityLabel("Evidence: \(suggestion.evidence.joined(separator: ", "))")
            }

            if let action = suggestion.primaryAction {
                Button {
                    onPrimaryAction(action)
                } label: {
                    Label(action.label, systemImage: actionIcon(for: action.type))
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
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
        .sheet(isPresented: $showingWhyDetails) {
            AICoachWhySheet(suggestion: suggestion, showsSourceDetails: showsSourceDetails)
        }
        .accessibilityElement(children: .combine)
    }

    private var coachSubtitle: String {
        if showsSourceDetails {
            return "\(CoachBrand.name) - \(suggestion.modelSource.label)"
        }
        return CoachBrand.name
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

private struct AICoachWhySheet: View {
    @Environment(\.dismiss) private var dismiss

    let suggestion: CoachSuggestion
    let showsSourceDetails: Bool

    var body: some View {
        NavigationStack {
            List {
                Section("Reason") {
                    Text(suggestion.message)
                }

                if !suggestion.evidence.isEmpty {
                    Section("Evidence") {
                        ForEach(Array(suggestion.evidence.enumerated()), id: \.offset) { _, item in
                            Label(item, systemImage: "checkmark.circle")
                        }
                    }
                }

                Section("Confidence") {
                    detailRow("Confidence", "\(Int((suggestion.confidence * 100).rounded()))%")
                    if showsSourceDetails {
                        detailRow("Source", suggestion.modelSource.label)
                    }
                    detailRow("Category", readableCategory(suggestion.category))
                    detailRow("Expires", formatExpiration(suggestion.expiresAt))
                }
            }
            .navigationTitle("Why this appeared")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
    }

    private func readableCategory(_ category: String) -> String {
        category
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
    }

    private func formatExpiration(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

enum CoachCandidateEngine {
    private enum CoachDaypart: String, CaseIterable, Sendable {
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

    private struct MealWindowSummary: Sendable {
        let daypart: CoachDaypart
        let dayCount: Int
        let latestFirstLogHour: Int
        let averageFirstLogHour: Double
    }

    private struct HabitualItemCandidate: Sendable {
        let normalizedName: String
        let displayName: String
        let dayCount: Int
        let latestLoggedAt: Date
        let mealItem: CoachMealItemPayload
    }

    private struct HabitualWorkoutCandidate: Sendable {
        let normalizedDescription: String
        let displayName: String
        let dayCount: Int
        let latestLoggedAt: Date
        let workout: CoachWorkoutPayload
    }

    static func macros(
        dashboard: DashboardResponse,
        selectedDate: Date,
        savedItems: [SavedItem] = [],
        now: Date = Date()
    ) -> [CoachSuggestion] {
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

        if let steering = macroEndOfDaySteering(
            totals: dashboard.currentDayTotals,
            targets: targets,
            selectedIsToday: selectedIsToday,
            now: now
        ) {
            candidates.append(steering)
        }

        if let alcohol = alcoholPrompt(entries: dashboard.entries, now: now) {
            candidates.append(alcohol)
        }

        if let cleanup = savedItemCleanupPrompt(savedItems: savedItems, now: now) {
            candidates.append(cleanup)
        }

        return candidates
    }

    static func workouts(
        entries: [WorkoutEntry],
        dailyCalories: [WorkoutDailyCalories],
        workoutsTarget: Double,
        caloriesTarget: Double,
        sleepDailyTotals: [SleepDailyTotals] = [],
        sleepTargetHours: Double? = nil,
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

        if let recovery = workoutSleepRecoveryGuardrail(
            entries: entries,
            sleepDailyTotals: sleepDailyTotals,
            sleepTargetHours: sleepTargetHours,
            now: now
        ) {
            candidates.append(recovery)
        }

        if let repeatWorkout = repeatWorkoutPrompt(entries: entries, now: now) {
            candidates.append(repeatWorkout)
        }

        return candidates
    }

    static func weight(
        entries: [WeightEntry],
        target: WeightTarget?,
        macroDailyTotals: [DailyTotals] = [],
        macroTargets: MacroTargets? = nil,
        now: Date = Date()
    ) -> [CoachSuggestion] {
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

        if let targetWeight = target?.targetWeight,
           let maintenance = weightMaintenanceSuggestion(
            recentEntries: Array(recentFourteen),
            targetWeight: targetWeight,
            now: now
           ) {
            candidates.append(maintenance)
        }

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

        if let plateau = weightPlateauSuggestion(entries: sorted, target: target, now: now) {
            candidates.append(plateau)
        }

        if let macroConsistency = weightMacroConsistencySuggestion(
            entries: sorted,
            target: target,
            macroDailyTotals: macroDailyTotals,
            macroTargets: macroTargets,
            now: now
        ) {
            candidates.append(macroConsistency)
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

    private static func weightMacroConsistencySuggestion(
        entries: [WeightEntry],
        target: WeightTarget?,
        macroDailyTotals: [DailyTotals],
        macroTargets: MacroTargets?,
        now: Date
    ) -> CoachSuggestion? {
        guard let targetWeight = target?.targetWeight,
              let macroTargets,
              macroTargets.calories > 0,
              macroTargets.protein > 0 else {
            return nil
        }

        let recentTwentyEight = entries
            .filter { parseDate($0.loggedAt) >= addingDays(-28, to: now) }
            .sorted { parseDate($0.loggedAt) < parseDate($1.loggedAt) }
        guard recentTwentyEight.count >= 6,
              let firstDate = recentTwentyEight.first.map({ parseDate($0.loggedAt) }),
              let latestDate = recentTwentyEight.last.map({ parseDate($0.loggedAt) }),
              daysBetween(firstDate, latestDate) >= 14 else {
            return nil
        }

        let splitIndex = recentTwentyEight.count / 2
        let earlier = Array(recentTwentyEight.prefix(splitIndex))
        let later = Array(recentTwentyEight.suffix(recentTwentyEight.count - splitIndex))
        let earlierAverage = average(earlier.map(\.weight))
        let laterAverage = average(later.map(\.weight))
        let recentAverage = average(later.suffix(min(4, later.count)).map(\.weight))
        let distanceToGoal = abs(recentAverage - targetWeight)
        guard distanceToGoal > 1.5 else { return nil }

        let movingTowardGoal = abs(laterAverage - targetWeight) < abs(earlierAverage - targetWeight)
        let rollingChange = laterAverage - earlierAverage
        guard !movingTowardGoal || abs(rollingChange) <= 0.35 else {
            return nil
        }

        let completeMacroDays = macroDailyTotals
            .filter { parseDay($0.day) >= addingDays(-28, to: now) }
            .filter { isCompleteMacroDay($0, targets: macroTargets) }
        guard completeMacroDays.count >= 10 else { return nil }

        let highCalorieDays = completeMacroDays.filter { $0.calories > macroTargets.calories * 1.05 }
        let lowProteinDays = completeMacroDays.filter { $0.protein < macroTargets.protein * 0.85 }
        let patternThreshold = max(5, Int(ceil(Double(completeMacroDays.count) * 0.40)))
        guard highCalorieDays.count >= patternThreshold || lowProteinDays.count >= patternThreshold else {
            return nil
        }

        var evidence = [
            "\(completeMacroDays.count) complete macro days",
            "weight \(formatWeight(distanceToGoal)) from target"
        ]
        if highCalorieDays.count >= patternThreshold {
            evidence.append("\(highCalorieDays.count) calorie-high days")
        }
        if lowProteinDays.count >= patternThreshold {
            evidence.append("\(lowProteinDays.count) low-protein days")
        }

        return suggestion(
            id: "weight-macro-consistency-\(dayString(now))",
            surface: .weight,
            category: "cross_page",
            priority: 83,
            confidence: 0.88,
            title: "Macro consistency is the lever",
            message: "Weight is not moving toward the target yet, and the macro pattern has been loose across complete days. Tighten the next few logs before changing the goal.",
            evidence: evidence,
            action: CoachAction(label: "Review targets", type: .editTargets),
            dismissalKey: "weight:macro_consistency:v1:\(completeMacroDays.count):\(highCalorieDays.count):\(lowProteinDays.count)"
        )
    }

    private static func weightPlateauSuggestion(
        entries: [WeightEntry],
        target: WeightTarget?,
        now: Date
    ) -> CoachSuggestion? {
        guard let targetWeight = target?.targetWeight else { return nil }

        let recentTwentyEight = entries
            .filter { parseDate($0.loggedAt) >= addingDays(-28, to: now) }
            .sorted { parseDate($0.loggedAt) < parseDate($1.loggedAt) }
        guard recentTwentyEight.count >= 8,
              let firstDate = recentTwentyEight.first.map({ parseDate($0.loggedAt) }),
              let latestDate = recentTwentyEight.last.map({ parseDate($0.loggedAt) }) else {
            return nil
        }

        let spanDays = daysBetween(firstDate, latestDate)
        guard spanDays >= 21 else { return nil }

        let splitIndex = recentTwentyEight.count / 2
        let earlier = Array(recentTwentyEight.prefix(splitIndex))
        let later = Array(recentTwentyEight.suffix(recentTwentyEight.count - splitIndex))
        let earlierAverage = average(earlier.map(\.weight))
        let laterAverage = average(later.map(\.weight))
        let recentAverage = average(later.suffix(min(4, later.count)).map(\.weight))
        let delta = laterAverage - earlierAverage
        let distanceToGoal = abs(recentAverage - targetWeight)

        guard distanceToGoal > 1.5, abs(delta) <= 0.35 else { return nil }

        return suggestion(
            id: "weight-plateau-\(dayString(now))",
            surface: .weight,
            category: "plateau",
            priority: 84,
            confidence: 0.87,
            title: "Weight trend is flat",
            message: "Your rolling weight average has been flat for a few weeks while the goal still needs movement. Review recent macro consistency before changing the target.",
            evidence: [
                "\(recentTwentyEight.count) weigh-ins across \(spanDays) days",
                "rolling change \(formatWeight(abs(delta)))",
                "\(formatWeight(distanceToGoal)) from target"
            ],
            action: CoachAction(label: "Review target", type: .editTargets),
            dismissalKey: "weight:plateau:v1:\(Int(targetWeight.rounded())):\(Int(distanceToGoal.rounded()))"
        )
    }

    private static func weightMaintenanceSuggestion(
        recentEntries: [WeightEntry],
        targetWeight: Double,
        now: Date
    ) -> CoachSuggestion? {
        let sorted = recentEntries.sorted { parseDate($0.loggedAt) < parseDate($1.loggedAt) }
        guard sorted.count >= 5,
              let firstDate = sorted.first.map({ parseDate($0.loggedAt) }),
              let latestDate = sorted.last.map({ parseDate($0.loggedAt) }) else {
            return nil
        }

        let spanDays = daysBetween(firstDate, latestDate)
        guard spanDays >= 10 else { return nil }

        let outsideBand = sorted.filter { abs($0.weight - targetWeight) > 1.0 }
        guard outsideBand.isEmpty else { return nil }

        let recentAverage = average(sorted.map(\.weight))
        return suggestion(
            id: "weight-maintenance-\(dayString(now))",
            surface: .weight,
            category: "maintenance",
            priority: 94,
            confidence: 0.96,
            title: "Goal range is holding",
            message: "Your recent weigh-ins have stayed within 1 lb of target long enough to count as maintenance. Keep the routine steady.",
            evidence: [
                "\(sorted.count) weigh-ins across \(spanDays) days",
                "all within 1 lb of \(formatWeight(targetWeight))",
                "average \(formatWeight(recentAverage))"
            ],
            action: nil,
            dismissalKey: "weight:maintenance:v1:\(Int(targetWeight.rounded())):\(spanDays)"
        )
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

        let streak = sleepTargetStreakSuggestion(
            dailyTotals: recentTotals,
            targetHours: targetHours,
            now: now
        )
        if let streak {
            candidates.append(streak)
        }

        let improvement = streak == nil
            ? sleepImprovementSuggestion(dailyTotals: recentTotals, targetHours: targetHours, now: now)
            : nil
        if let improvement {
            candidates.append(improvement)
        }

        if targetHours > 0, averageHours <= targetHours - 0.75, improvement == nil {
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

    private static func sleepTargetStreakSuggestion(
        dailyTotals: [SleepDailyTotals],
        targetHours: Double,
        now: Date
    ) -> CoachSuggestion? {
        guard targetHours > 0 else { return nil }

        let sorted = dailyTotals.sorted { $0.day > $1.day }
        guard let latest = sorted.first else { return nil }

        let latestDate = parseDay(latest.day)
        guard daysBetween(latestDate, now) <= 1 else { return nil }

        var streakCount = 0
        var expectedDay = latestDate

        for total in sorted {
            let totalDate = parseDay(total.day)
            guard dayString(totalDate) == dayString(expectedDay), total.totalHours >= targetHours else {
                break
            }

            streakCount += 1
            expectedDay = addingDays(-1, to: expectedDay)
        }

        guard streakCount >= 3 else { return nil }

        return suggestion(
            id: "sleep-target-streak-\(dayString(now))",
            surface: .sleep,
            category: "congratulations",
            priority: 90,
            confidence: 0.94,
            title: "Sleep streak is holding",
            message: "You have met the sleep target for \(streakCount) straight logged nights. Keep tonight's routine boring and repeatable.",
            evidence: [
                "\(streakCount) consecutive target nights",
                "target \(formatHours(targetHours))"
            ],
            action: nil,
            dismissalKey: "sleep:target_streak:v1:\(streakCount):\(Int(targetHours.rounded()))"
        )
    }

    private static func sleepImprovementSuggestion(
        dailyTotals: [SleepDailyTotals],
        targetHours: Double,
        now: Date
    ) -> CoachSuggestion? {
        guard targetHours > 0 else { return nil }

        let sorted = dailyTotals
            .filter { $0.totalHours > 0 }
            .sorted { $0.day < $1.day }
        guard sorted.count >= 6,
              let latest = sorted.last else {
            return nil
        }

        let latestDate = parseDay(latest.day)
        guard daysBetween(latestDate, now) <= 2 else { return nil }

        let recent = Array(sorted.suffix(3))
        let baseline = Array(sorted.dropLast(3).suffix(3))
        guard recent.count == 3, baseline.count == 3 else { return nil }

        let recentAverage = average(recent.map(\.totalHours))
        let baselineAverage = average(baseline.map(\.totalHours))
        guard baselineAverage > 0 else { return nil }

        let improvement = recentAverage - baselineAverage
        guard improvement >= 0.5 || improvement / baselineAverage >= 0.10 else { return nil }

        return suggestion(
            id: "sleep-improving-\(dayString(now))",
            surface: .sleep,
            category: "congratulations",
            priority: 86,
            confidence: 0.89,
            title: "Sleep is improving",
            message: "The last three logged nights are up from your prior baseline. Keep the bedtime routine repeatable and protect the same start window tonight.",
            evidence: [
                "last 3 avg \(formatHours(recentAverage))",
                "prior 3 avg \(formatHours(baselineAverage))"
            ],
            action: nil,
            dismissalKey: "sleep:improving:v1:\(Int((improvement * 10).rounded())):\(dayString(latestDate))"
        )
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

    private static func macroEndOfDaySteering(
        totals: DailyTotals,
        targets: MacroTargets,
        selectedIsToday: Bool,
        now: Date
    ) -> CoachSuggestion? {
        guard selectedIsToday,
              targets.calories > 0,
              targets.protein > 0,
              totals.calories > 0 else {
            return nil
        }

        let hour = easternCalendar.component(.hour, from: now)
        guard hour >= 16 else { return nil }

        let caloriesRemaining = targets.calories - totals.calories
        guard caloriesRemaining >= max(250, targets.calories * 0.15) else { return nil }

        let proteinRemaining = targets.protein - totals.protein
        let calorieProgress = totals.calories / targets.calories
        let proteinProgress = totals.protein / targets.protein
        guard proteinRemaining >= 30, proteinProgress + 0.15 < calorieProgress else { return nil }

        return suggestion(
            id: "macro-evening-protein-\(totals.day)",
            surface: .macros,
            category: "steering",
            priority: 81,
            confidence: 0.88,
            title: "Make dinner protein-first",
            message: "Calories are still available, but protein is behind the day's pace. Make the next meal protein-first before adding extras.",
            evidence: [
                "\(Int(caloriesRemaining.rounded())) cal remaining",
                "\(Int(proteinRemaining.rounded()))g protein short",
                "after \(formatHour(hour))"
            ],
            action: CoachAction(label: "Log dinner", type: .openLogMeal),
            dismissalKey: "macro:evening_protein:v1:\(Int(proteinRemaining.rounded() / 10)):\(Int(caloriesRemaining.rounded() / 100))"
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
            .filter { alcoholTag(for: $0.itemName) == nil }
            .map { normalizedName($0.itemName) })
        let recent = entries
            .filter { entryDay($0) != today }
            .filter { parseDate($0.consumedAt) >= addingDays(-14, to: now) }
            .filter { daypart.hours.contains(hourOfDay(parseDate($0.consumedAt))) }
            .filter { alcoholTag(for: $0.itemName) == nil }

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

    private static func savedItemCleanupPrompt(savedItems: [SavedItem], now: Date) -> CoachSuggestion? {
        guard savedItems.count >= 4 else { return nil }

        let duplicateGroups = Dictionary(grouping: savedItems, by: savedItemSignature)
            .values
            .filter { $0.count >= 2 }
            .sorted {
                if $0.count != $1.count { return $0.count > $1.count }
                return ($0.first?.usageCount ?? 0) < ($1.first?.usageCount ?? 0)
            }

        if let duplicateGroup = duplicateGroups.first,
           let first = duplicateGroup.first {
            return suggestion(
                id: "macro-saved-cleanup-duplicates-\(dayString(now))",
                surface: .macros,
                category: "cleanup",
                priority: 74,
                confidence: 0.89,
                title: "Quick Adds need cleanup",
                message: "You have repeated saved items for \(first.name). Clean those up so the fastest choices stay trustworthy.",
                evidence: [
                    "\(duplicateGroup.count) matching saved items",
                    "\(savedItems.count) total Quick Adds"
                ],
                action: CoachAction(label: "Review Quick Adds", type: .openQuickAdd, searchText: first.name),
                dismissalKey: "macro:saved_cleanup_duplicates:v1:\(savedItemSignature(first)):\(duplicateGroup.count)"
            )
        }

        let unusedItems = savedItems.filter { $0.usageCount == 0 }
        if savedItems.count >= 10, unusedItems.count >= max(5, savedItems.count / 3) {
            return suggestion(
                id: "macro-saved-cleanup-unused-\(dayString(now))",
                surface: .macros,
                category: "cleanup",
                priority: 70,
                confidence: 0.86,
                title: "Quick Adds are getting noisy",
                message: "Several saved foods have never been used. Trim the stale ones so your repeat meals are easier to find.",
                evidence: [
                    "\(unusedItems.count) unused saved items",
                    "\(savedItems.count) total Quick Adds"
                ],
                action: CoachAction(label: "Review Quick Adds", type: .openQuickAdd),
                dismissalKey: "macro:saved_cleanup_unused:v1:\(unusedItems.count):\(savedItems.count)"
            )
        }

        return nil
    }

    private static func alcoholPrompt(entries: [Entry], now: Date) -> CoachSuggestion? {
        let cutoff = addingDays(-7, to: now)
        let alcoholEntries: [(entry: Entry, tag: String)] = entries.compactMap { entry in
            guard parseDate(entry.consumedAt) >= cutoff,
                  let tag = alcoholTag(for: entry.itemName) else {
                return nil
            }
            return (entry, tag)
        }

        guard alcoholEntries.count >= 2 else { return nil }

        let calories = alcoholEntries.reduce(0.0) { $0 + $1.entry.calories }
        guard calories >= 300 else { return nil }
        let alcoholDays = Set(alcoholEntries.map { dayString(parseDate($0.entry.consumedAt)) })
        guard alcoholDays.count >= 2 || calories >= 500 else { return nil }
        let tags = Set(alcoholEntries.map(\.tag)).sorted()

        return suggestion(
            id: "macro-alcohol-\(dayString(now))",
            surface: .macros,
            category: "alcohol",
            priority: 78,
            confidence: 0.86,
            title: "Alcohol is affecting the week",
            message: "Alcohol has shown up more than once recently. Keep the next couple of choices cleaner if you want the calorie trend back on target.",
            evidence: [
                "\(alcoholDays.count) alcohol days in 7 days",
                "\(Int(calories.rounded())) logged calories",
                "matched \(tags.prefix(3).joined(separator: ", "))"
            ],
            action: CoachAction(label: "Log next meal", type: .openLogMeal),
            dismissalKey: "macro:alcohol:v2:\(alcoholDays.count):\(Int(calories.rounded() / 100))"
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

        let recentCalories = average(recent.map(\.caloriesBurned))
        let baselineCalories = average(baseline.map(\.caloriesBurned))
        if baselineCalories > 0 {
            let calorieDelta = (recentCalories - baselineCalories) / baselineCalories
            if abs(calorieDelta) >= 0.15 {
                let direction = calorieDelta > 0 ? "higher" : "lower"
                return suggestion(
                    id: "workout-calorie-trend-\(dayString(now))",
                    surface: .workouts,
                    category: "trend",
                    priority: 75,
                    confidence: 0.86,
                    title: "Workout calorie burn shifted",
                    message: "Your last 3 workouts are trending \(direction) calorie burn than your recent baseline. Keep logging sessions consistently so the trend stays readable.",
                    evidence: ["last 3 avg \(Int(recentCalories.rounded())) cal", "baseline \(Int(baselineCalories.rounded())) cal"],
                    action: CoachAction(label: "Log workout", type: .openLogWorkout),
                    dismissalKey: "workouts:calorie_trend:v1:\(Int((calorieDelta * 100).rounded()))"
                )
            }
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

    private static func workoutSleepRecoveryGuardrail(
        entries: [WorkoutEntry],
        sleepDailyTotals: [SleepDailyTotals],
        sleepTargetHours: Double?,
        now: Date
    ) -> CoachSuggestion? {
        guard let targetHours = sleepTargetHours, targetHours > 0 else { return nil }

        let recentSleep = sleepDailyTotals
            .filter { parseDay($0.day) >= addingDays(-5, to: now) }
            .sorted { $0.day > $1.day }
        guard recentSleep.count >= 3 else { return nil }

        let averageSleep = average(recentSleep.map(\.totalHours))
        let sleepShortfall = targetHours - averageSleep
        guard sleepShortfall >= 0.75 else { return nil }

        let recentWorkouts = entries
            .filter { parseDate($0.loggedAt) >= addingDays(-5, to: now) }
            .sorted { parseDate($0.loggedAt) > parseDate($1.loggedAt) }
        guard recentWorkouts.count >= 2 else { return nil }

        let highIntensityDays = Set(recentWorkouts
            .filter { intensityScore($0.intensity) >= 3 }
            .map { dayString(parseDate($0.loggedAt)) })
        guard highIntensityDays.count >= 2 else { return nil }

        return suggestion(
            id: "workout-sleep-recovery-\(dayString(now))",
            surface: .workouts,
            category: "recovery",
            priority: 85,
            confidence: 0.88,
            title: "Keep recovery in view",
            message: "Sleep has been under target while recent workouts were high intensity. Make the next session easier or keep it cleanly logged.",
            evidence: [
                "\(recentSleep.count) recent sleep nights",
                "average \(formatHours(averageSleep)) vs target \(formatHours(targetHours))",
                "\(highIntensityDays.count) high-intensity workout days"
            ],
            action: CoachAction(label: "Log workout", type: .openLogWorkout),
            dismissalKey: "workouts:recovery:v1:\(Int((sleepShortfall * 10).rounded())):\(highIntensityDays.count)"
        )
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

    private static func savedItemSignature(_ item: SavedItem) -> String {
        [
            normalizedName(item.name),
            normalizedName(item.unit ?? ""),
            "\(Int((item.quantity * 10).rounded()))",
            "\(Int(item.calories.rounded()))",
            "\(Int((item.protein * 10).rounded()))",
            "\(Int((item.carbs * 10).rounded()))",
            "\(Int((item.fat * 10).rounded()))"
        ].joined(separator: "|")
    }

    private static func alcoholTag(for name: String) -> String? {
        let normalized = normalizedName(name)
        guard !normalized.isEmpty else { return nil }

        let exclusions = [
            "non alcoholic", "non-alcoholic", "no alcohol", "alcohol free", "zero proof",
            "0 proof", "na beer", "n/a beer", "mocktail", "virgin ", "root beer",
            "ginger beer", "birch beer", "butterbeer", "apple cider vinegar", "sparkling cider"
        ]
        if exclusions.contains(where: { normalized.contains($0) }) {
            return nil
        }

        let phraseTags: [(phrase: String, tag: String)] = [
            ("hard seltzer", "hard seltzer"),
            ("spiked seltzer", "hard seltzer"),
            ("white claw", "hard seltzer"),
            ("high noon", "hard seltzer"),
            ("hard cider", "cider"),
            ("red wine", "wine"),
            ("white wine", "wine"),
            ("sparkling wine", "wine"),
            ("old fashioned", "cocktail"),
            ("moscow mule", "cocktail"),
            ("tequila soda", "cocktail"),
            ("vodka soda", "cocktail"),
            ("gin tonic", "cocktail")
        ]
        if let match = phraseTags.first(where: { normalized.contains($0.phrase) }) {
            return match.tag
        }

        let tokens = Set(
            normalized
                .split { !$0.isLetter && !$0.isNumber }
                .map(String.init)
        )
        let alcoholTokens: [String: String] = [
            "beer": "beer",
            "ale": "beer",
            "lager": "beer",
            "ipa": "beer",
            "stout": "beer",
            "porter": "beer",
            "pilsner": "beer",
            "wine": "wine",
            "prosecco": "wine",
            "champagne": "wine",
            "cocktail": "cocktail",
            "margarita": "cocktail",
            "martini": "cocktail",
            "mojito": "cocktail",
            "daiquiri": "cocktail",
            "negroni": "cocktail",
            "mimosa": "cocktail",
            "sangria": "cocktail",
            "spritz": "cocktail",
            "vodka": "spirits",
            "gin": "spirits",
            "rum": "spirits",
            "tequila": "spirits",
            "mezcal": "spirits",
            "whiskey": "spirits",
            "whisky": "spirits",
            "bourbon": "spirits",
            "scotch": "spirits",
            "brandy": "spirits",
            "cognac": "spirits",
            "liqueur": "spirits",
            "liquor": "spirits",
            "schnapps": "spirits",
            "sake": "spirits",
            "soju": "spirits"
        ]
        return tokens.compactMap { alcoholTokens[$0] }.sorted().first
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
