import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var api: APIClient
    @EnvironmentObject private var navigation: AppNavigationModel
    @StateObject private var offlineQueue = OfflineMutationStore.shared
    @StateObject private var coachDismissals = CoachDismissalStore.shared

    @State private var response: TodayResponse?
    @State private var coachSuggestions: [CoachSuggestion] = []
    @State private var isLoading = true
    @State private var isRefreshing = false
    @State private var isOffline = false
    @State private var loadMessage: String?
    @State private var lastUpdatedAt: Date?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    TimelineView(.periodic(from: .now, by: 60)) { _ in
                        freshnessBanner(at: AppClock.now)
                    }

                    if let response {
                        if response.summary.empty {
                            emptyAccountCard
                        }

                        AICoachSlot(
                            dismissals: coachDismissals,
                            suggestions: coachSuggestions,
                            maximumSuggestions: 1,
                            onPrimaryAction: handleCoachAction
                        )

                        macroCard(response.summary.macros)

                        LazyVGrid(
                            columns: [
                                GridItem(.flexible(), spacing: 12),
                                GridItem(.flexible(), spacing: 12)
                            ],
                            spacing: 12
                        ) {
                            recoveryCard(response.summary.recovery)
                            workoutCard(response.summary.workout)
                            weightCard(response.summary.weight)
                            syncCard
                        }
                        .frame(maxWidth: .infinity)

                        quickActions
                    } else if isLoading {
                        loadingCard
                    } else {
                        unavailableCard
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .clipped()
            .navigationTitle("Today")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        Task { await loadToday(refreshing: true) }
                    } label: {
                        if isRefreshing {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(isRefreshing)
                    .accessibilityLabel("Refresh Today")

                    AccountToolbarButton()
                }
            }
            .task {
                await loadToday(refreshing: false)
            }
            .refreshable {
                await loadToday(refreshing: true)
            }
        }
    }

    private func freshnessBanner(at currentTime: Date) -> some View {
        let color = freshnessColor(at: currentTime)

        return HStack(spacing: 10) {
            Image(systemName: freshnessSymbol(at: currentTime))
                .foregroundStyle(color)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(freshnessTitle(at: currentTime))
                    .font(.subheadline.weight(.semibold))
                Text(freshnessDetail(at: currentTime))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
        .overlay {
            RoundedRectangle(cornerRadius: 14)
                .stroke(color.opacity(0.24), lineWidth: 1)
        }
        .accessibilityElement(children: .combine)
    }

    private func freshnessTitle(at currentTime: Date) -> String {
        if isOffline {
            return response == nil ? "Offline" : "Showing saved Today data"
        }
        if loadMessage != nil {
            return response == nil ? "Today is unavailable" : "Showing saved Today data"
        }
        if isLoading {
            return "Loading today"
        }
        if snapshotIsStale(at: currentTime) {
            return "Showing an older snapshot"
        }
        return "Today is up to date"
    }

    private func freshnessDetail(at currentTime: Date) -> String {
        if isOffline {
            if let lastUpdatedAt {
                return "Last updated \(relativeText(for: lastUpdatedAt, relativeTo: currentTime)). New logs stay protected until sync resumes."
            }
            return loadMessage ?? "Connect to load your account snapshot. You can still start a log."
        }
        if loadMessage != nil {
            if let lastUpdatedAt {
                return "Last updated \(relativeText(for: lastUpdatedAt, relativeTo: currentTime)). Refresh failed; try again."
            }
            return "The account snapshot could not be refreshed. Quick logging remains available."
        }
        if snapshotIsStale(at: currentTime), let lastUpdatedAt {
            return "Last updated \(relativeText(for: lastUpdatedAt, relativeTo: currentTime)). Refresh for current totals."
        }
        if let lastUpdatedAt {
            return "Updated \(relativeText(for: lastUpdatedAt, relativeTo: currentTime)) from your account data."
        }
        return "Loading the latest account facts."
    }

    private func freshnessSymbol(at currentTime: Date) -> String {
        if isOffline {
            return "wifi.slash"
        }
        if loadMessage != nil || snapshotIsStale(at: currentTime) {
            return "clock.badge.exclamationmark"
        }
        return isLoading ? "arrow.triangle.2.circlepath" : "checkmark.icloud.fill"
    }

    private func freshnessColor(at currentTime: Date) -> Color {
        if isOffline || loadMessage != nil || snapshotIsStale(at: currentTime) {
            return .orange
        }
        return isLoading ? .cyan : .green
    }

    private func snapshotIsStale(at currentTime: Date) -> Bool {
        guard let lastUpdatedAt else { return false }
        return currentTime.timeIntervalSince(lastUpdatedAt) > 15 * 60
    }

    private var emptyAccountCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Build your first useful day", systemImage: "sparkles")
                .font(.headline)
            Text("Start with what you know. A meal, sleep entry, workout, or baseline weight will make this page more useful without requiring a full setup.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Button("Log a meal") {
                navigation.request(.logMeal)
            }
            .buttonStyle(.borderedProminent)
            .tint(.cyan)
        }
        .todayCard()
        .accessibilityElement(children: .contain)
    }

    private func macroCard(_ macros: TodayMacroSummary) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Macro status", systemImage: "fork.knife")
                    .font(.headline)
                Spacer()
                Button("Details") {
                    navigation.open(.macros)
                }
                .font(.subheadline.weight(.semibold))
            }

            if macros.state == "needs_targets" {
                Text("Set calorie and protein targets to turn today’s totals into a clear remaining plan.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Open Macros") {
                    navigation.open(.macros)
                }
                .buttonStyle(.bordered)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 20) {
                    remainingMetric(
                        value: macros.remaining.calories,
                        unit: "cal",
                        label: "remaining"
                    )
                    remainingMetric(
                        value: macros.remaining.protein,
                        unit: "g",
                        label: "protein remaining"
                    )
                }

                macroProgress(
                    label: "Calories",
                    current: macros.totals.calories,
                    target: macros.targets.calories,
                    unit: "cal"
                )
                macroProgress(
                    label: "Protein",
                    current: macros.totals.protein,
                    target: macros.targets.protein,
                    unit: "g"
                )

                HStack(spacing: 16) {
                    Text("\(formatNumber(macros.totals.carbs))g carbs")
                    Text("\(formatNumber(macros.totals.fat))g fat")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .todayCard()
    }

    private func remainingMetric(value: Double?, unit: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value.map { "\(formatNumber($0)) \(unit)" } ?? "—")
                .font(.title2.weight(.bold))
                .foregroundStyle(.cyan)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func macroProgress(label: String, current: Double, target: Double, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(label)
                Spacer()
                Text("\(formatNumber(current)) / \(formatNumber(target)) \(unit)")
                    .foregroundStyle(.secondary)
            }
            .font(.caption)
            ProgressView(value: target > 0 ? min(current / target, 1) : 0)
                .tint(.cyan)
        }
        .accessibilityElement(children: .combine)
    }

    private func recoveryCard(_ recovery: TodayRecoverySummary) -> some View {
        summaryCard(
            title: "Recovery",
            symbol: "moon.stars.fill",
            accent: recovery.state == "stale" ? .orange : .indigo
        ) {
            if let hours = recovery.sleepHours {
                Text("\(formatNumber(hours)) hr")
                    .font(.title3.weight(.bold))
                Text(recoveryFreshnessText(recovery))
                    .font(.caption)
                    .foregroundStyle(recovery.state == "stale" ? .orange : .secondary)
            } else {
                Text("No recovery data")
                    .font(.subheadline.weight(.semibold))
                Text("Log sleep to establish a baseline.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if recovery.ouraStatus == "disconnected" {
                Label("Oura not connected", systemImage: "circle.dashed")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Button(recovery.sleepHours == nil ? "Log sleep" : "View sleep") {
                if recovery.sleepHours == nil {
                    navigation.request(.logSleep)
                } else {
                    navigation.healthArea = .sleep
                    navigation.open(.health)
                }
            }
            .font(.caption.weight(.semibold))
        }
    }

    private func workoutCard(_ workout: TodayWorkoutSummary) -> some View {
        summaryCard(title: "Workout", symbol: "figure.run", accent: .green) {
            if workout.state == "logged" {
                Text(workout.latestDescription ?? "Workout logged")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                Text("\(formatNumber(workout.activeCalories)) active cal today")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("Not logged today")
                    .font(.subheadline.weight(.semibold))
                Text("\(workout.weeklyActiveDays) of \(formatNumber(workout.targetPerWeek)) target days this week")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Button(workout.state == "logged" ? "View workouts" : "Log workout") {
                if workout.state == "logged" {
                    navigation.open(.workouts)
                } else {
                    navigation.request(.logWorkout)
                }
            }
            .font(.caption.weight(.semibold))
        }
    }

    private func weightCard(_ weight: TodayWeightSummary) -> some View {
        summaryCard(
            title: "Weight cadence",
            symbol: "scalemass.fill",
            accent: weight.state == "due" ? .orange : .pink
        ) {
            if let latestWeight = weight.latestWeight {
                Text("\(formatNumber(latestWeight)) lb")
                    .font(.title3.weight(.bold))
                Text(weightCadenceText(weight))
                    .font(.caption)
                    .foregroundStyle(weight.state == "due" ? .orange : .secondary)
            } else {
                Text("No baseline yet")
                    .font(.subheadline.weight(.semibold))
                Text("One weigh-in starts the cadence.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Button(weight.state == "due" || weight.state == "empty" ? "Log weight" : "View weight") {
                if weight.state == "due" || weight.state == "empty" {
                    navigation.request(.logWeight)
                } else {
                    navigation.healthArea = .weight
                    navigation.open(.health)
                }
            }
            .font(.caption.weight(.semibold))
        }
    }

    private var syncCard: some View {
        summaryCard(
            title: "Sync",
            symbol: offlineQueue.pendingCount > 0 ? "arrow.triangle.2.circlepath.icloud" : "checkmark.icloud.fill",
            accent: offlineQueue.pendingCount > 0 ? .orange : .green
        ) {
            if offlineQueue.pendingCount > 0 {
                Text("\(offlineQueue.pendingCount) pending")
                    .font(.title3.weight(.bold))
                Text("Saved safely for this account.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text(isOffline ? "Offline" : "All caught up")
                    .font(.subheadline.weight(.semibold))
                Text(isOffline ? "New logs will wait here." : "No pending changes.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func summaryCard<Content: View>(
        title: String,
        symbol: String,
        accent: Color,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Label(title, systemImage: symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(accent)
            content()
            Spacer(minLength: 0)
        }
        .todayCard()
        .frame(maxWidth: .infinity, minHeight: 170, alignment: .topLeading)
        .accessibilityElement(children: .contain)
    }

    private var quickActions: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Quick log")
                .font(.headline)

            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: 10),
                    GridItem(.flexible(), spacing: 10)
                ],
                spacing: 10
            ) {
                quickAction("Meal", symbol: "fork.knife", action: .logMeal)
                quickAction("Workout", symbol: "figure.run", action: .logWorkout)
                quickAction("Weight", symbol: "scalemass", action: .logWeight)
                quickAction("Sleep", symbol: "moon.zzz", action: .logSleep)
            }
        }
        .todayCard()
    }

    private func quickAction(_ title: String, symbol: String, action: AppQuickAction) -> some View {
        Button {
            navigation.request(action)
        } label: {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
        .tint(.cyan)
        .accessibilityLabel("Log \(title.lowercased())")
        .accessibilityHint("Opens the \(title.lowercased()) log form")
    }

    private var loadingCard: some View {
        VStack(spacing: 14) {
            ProgressView()
            Text("Building today’s snapshot…")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .todayCard()
    }

    private var unavailableCard: some View {
        ContentUnavailableView {
            Label("Today is unavailable", systemImage: "wifi.slash")
        } description: {
            Text(loadMessage ?? "Connect to load the latest account facts. Quick logging is still available from the tabs below.")
        } actions: {
            Button("Try Again") {
                Task { await loadToday(refreshing: true) }
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, minHeight: 260)
        .todayCard()
    }

    private func loadToday(refreshing: Bool) async {
        if refreshing {
            isRefreshing = true
        } else if response == nil {
            isLoading = true
        }
        defer {
            isRefreshing = false
            isLoading = false
        }

        do {
            let next = try await api.getToday()
            response = next
            lastUpdatedAt = parseDate(next.generatedAt) ?? Date()
            isOffline = false
            loadMessage = nil
            await rebuildCoachSuggestions(from: next)
        } catch {
            isOffline = isNetworkError(error)
            loadMessage = error.localizedDescription
            if response == nil {
                coachSuggestions = []
            }
        }
    }

    private func rebuildCoachSuggestions(from response: TodayResponse) async {
        let context = response.context
        let macroDailyTotals = context.dashboard.previousDays + [context.dashboard.currentDayTotals]

        async let macroSuggestions = CoachCandidateWorker.shared.macros(
            dashboard: context.dashboard,
            selectedDate: AppClock.now,
            savedItems: []
        )
        async let workoutSuggestions = CoachCandidateWorker.shared.workouts(
            entries: context.workouts.entries,
            dailyCalories: context.workouts.dailyCalories,
            workoutsTarget: context.dashboard.targets.workouts,
            caloriesTarget: context.dashboard.targets.workoutCalories ?? 0,
            sleepDailyTotals: context.sleep.dailyTotals,
            sleepTargetHours: context.dashboard.targets.sleepHours
        )
        async let weightSuggestions = CoachCandidateWorker.shared.weight(
            entries: context.weights.entries,
            target: context.weightTarget,
            macroDailyTotals: macroDailyTotals,
            macroTargets: context.dashboard.targets
        )
        async let sleepSuggestions = CoachCandidateWorker.shared.sleep(
            entries: context.sleep.entries,
            dailyTotals: context.sleep.dailyTotals,
            targetHours: context.dashboard.targets.sleepHours ?? 8
        )

        let (macros, workouts, weight, sleep) = await (
            macroSuggestions,
            workoutSuggestions,
            weightSuggestions,
            sleepSuggestions
        )
        let combined = macros + workouts + weight + sleep
        guard !Task.isCancelled else { return }
        coachSuggestions = combined.sorted {
            if $0.priority == $1.priority {
                return $0.confidence > $1.confidence
            }
            return $0.priority > $1.priority
        }
    }

    private func handleCoachAction(_ suggestion: CoachSuggestion, _ action: CoachAction) {
        navigation.request(action, from: suggestion.surface)
    }

    private func weightCadenceText(_ weight: TodayWeightSummary) -> String {
        let days = weight.daysSinceLast ?? 0
        if weight.state == "due" {
            return days == 1 ? "Check-in due after 1 day" : "Check-in due after \(days) days"
        }
        let remaining = max(0, weight.cadenceDays - days)
        return remaining == 1 ? "Next check-in in 1 day" : "Next check-in in \(remaining) days"
    }

    private func formatNumber(_ value: Double) -> String {
        if abs(value.rounded() - value) < 0.05 {
            return String(Int(value.rounded()))
        }
        return String(format: "%.1f", value)
    }

    private func recoveryFreshnessText(_ recovery: TodayRecoverySummary) -> String {
        var parts = [recovery.state == "stale" ? "Sleep data is stale" : recovery.sourceLabel]
        if let ageHours = recovery.ageHours {
            if ageHours < 1 {
                parts.append("updated recently")
            } else if ageHours < 24 {
                parts.append("\(ageHours) hr old")
            } else {
                let days = ageHours / 24
                parts.append("\(days) day\(days == 1 ? "" : "s") old")
            }
        }
        return parts.joined(separator: " · ")
    }

    private func relativeText(for date: Date, relativeTo currentTime: Date) -> String {
        if abs(currentTime.timeIntervalSince(date)) < 60 {
            return "just now"
        }
        return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: currentTime)
    }

    private func parseDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }

    private func isNetworkError(_ error: Error) -> Bool {
        if case APIError.networkError = error {
            return true
        }
        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain
    }
}

private extension View {
    func todayCard() -> some View {
        self
            .padding(16)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
            .overlay {
                RoundedRectangle(cornerRadius: 18)
                    .stroke(Color.white.opacity(0.06), lineWidth: 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
