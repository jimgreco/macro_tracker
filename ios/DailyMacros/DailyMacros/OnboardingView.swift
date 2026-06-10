import SwiftUI

private func normalizedTutorialTopInset(in size: CGSize, safeAreaInsets: EdgeInsets) -> CGFloat {
    // Embedded tutorial surfaces can report a toolbar-inflated top inset.
    let maximumReasonableTopInset = min(size.height * 0.08, 64)
    return min(max(safeAreaInsets.top, 0), maximumReasonableTopInset)
}

struct OnboardingView: View {
    @EnvironmentObject var api: APIClient
    @EnvironmentObject var auth: AuthManager
    @Binding var isComplete: Bool

    private enum SetupStep: Int, CaseIterable {
        case macros
        case workouts
        case weight
        case sleep
        case targets

        var title: String {
            switch self {
            case .macros: return "Macros"
            case .workouts: return "Workouts"
            case .weight: return "Weight"
            case .sleep: return "Sleep"
            case .targets: return "Set Up DailyMacros"
            }
        }

        var systemImage: String {
            switch self {
            case .macros: return "fork.knife"
            case .workouts: return "figure.run"
            case .weight: return "scalemass"
            case .sleep: return "bed.double"
            case .targets: return "target"
            }
        }

        var leadText: String {
            switch self {
            case .macros:
                return "Log meals and track calories, protein, carbs, and fat against your daily targets."
            case .workouts:
                return "Capture training, calories burned, and weekly workout targets in the same place as nutrition."
            case .weight:
                return "Follow weight trends and compare progress against your target weight."
            case .sleep:
                return "Track sleep duration and wake-ups so recovery context is visible beside meals and workouts."
            case .targets:
                return "Set the targets DailyMacros uses for progress bars, weekly analysis, reminders, and weight goals."
            }
        }

        var tourHint: String {
            switch self {
            case .macros:
                return "Scroll the preview to see how daily totals, meals, and trends work together before you have history."
            case .workouts:
                return "Review weekly targets, recent sessions, and consistency patterns without needing synced workouts yet."
            case .weight:
                return "See how target weight, pace, and weigh-in history will read once you start logging."
            case .sleep:
                return "Preview how sleep target nights, wake-ups, and recovery context show up beside the rest of the app."
            case .targets:
                return ""
            }
        }
    }

    @State private var setupStep: SetupStep = .macros

    @State private var calorieTarget = "2200"
    @State private var proteinTarget = "160"
    @State private var carbsTarget = "250"
    @State private var fatTarget = "60"
    @State private var workoutsPerWeek = "4"
    @State private var workoutCaloriesTarget = "0"
    @State private var sleepTarget = "8"
    @State private var targetWeight = ""
    @State private var targetDate = Calendar.current.date(byAdding: .month, value: 3, to: Date()) ?? Date()
    @State private var remindersEnabled = false
    @State private var reminderDate = ReminderScheduler.shared.reminderDate
    @State private var isLoadingTargets = false
    @State private var didLoadExistingTargets = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if setupStep == .targets {
                NavigationStack {
                    targetSetupForm
                        .navigationTitle(setupStep.title)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                skipButton
                            }
                        }
                }
            } else {
                tutorialOverlay
            }
        }
        .alert("Setup", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .task(id: setupStep) {
            guard setupStep == .targets else { return }
            await loadExistingTargets()
        }
    }

    private var skipButton: some View {
        Button("Skip") {
            Diagnostics.shared.record(category: "onboarding", message: "Skipped setup")
            isComplete = true
        }
    }

    private var tutorialOverlay: some View {
        GeometryReader { proxy in
            let topInset = normalizedTutorialTopInset(in: proxy.size, safeAreaInsets: proxy.safeAreaInsets)

            VStack(spacing: 14) {
                HStack {
                    skipButton
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .tint(.white)
                        .background(.ultraThinMaterial, in: Capsule())
                    Spacer()
                }
                .padding(.horizontal, 18)
                .padding(.top, max(topInset + 8, 18))

                tutorialPreviewSurface
                    .padding(.horizontal, 14)
                    .frame(maxHeight: .infinity)

                tutorialCalloutCard
                    .padding(.horizontal, 14)
                    .padding(.bottom, max(proxy.safeAreaInsets.bottom + 16, 16))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(
                LinearGradient(
                    colors: [Color.black, Color(red: 0.02, green: 0.07, blue: 0.08)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
            )
        }
    }

    private var tutorialPreviewSurface: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 14) {
                tutorialPreviewHero
                tutorialPreviewContent
                Color.clear.frame(height: 2)
            }
            .padding(14)
        }
        .id(setupStep)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(.white.opacity(0.14), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.26), radius: 18, y: 8)
    }

    private var tutorialPreviewHero: some View {
        HStack(spacing: 12) {
            Image(systemName: setupStep.systemImage)
                .font(.title2)
                .foregroundStyle(.cyan)
                .frame(width: 42, height: 42)
                .background(.cyan.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text(setupStep.title)
                    .font(.title2.weight(.bold))
                Text("Sample page with starter data")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            Label("Scroll", systemImage: "hand.draw")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.cyan)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(.cyan.opacity(0.12), in: Capsule())
        }
        .padding(14)
        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    @ViewBuilder
    private var tutorialPreviewContent: some View {
        switch setupStep {
        case .macros:
            macroTutorialPreview
        case .workouts:
            workoutTutorialPreview
        case .weight:
            weightTutorialPreview
        case .sleep:
            sleepTutorialPreview
        case .targets:
            EmptyView()
        }
    }

    private var macroTutorialPreview: some View {
        VStack(spacing: 12) {
            tutorialPreviewSection(
                title: "Daily Totals",
                subtitle: "Targets turn food logs into pacing",
                systemImage: "chart.bar.fill"
            ) {
                VStack(spacing: 12) {
                    tutorialProgressRow("Calories", value: "1,180 / 2,200 cal", progress: 0.54, tint: .cyan)
                    tutorialProgressRow("Protein", value: "92 / 160g", progress: 0.58, tint: .green)
                    tutorialProgressRow("Carbs", value: "118 / 250g", progress: 0.47, tint: .orange)
                    tutorialProgressRow("Fat", value: "36 / 60g", progress: 0.60, tint: .pink)
                }
            }

            tutorialPreviewSection(
                title: "Logged Meals",
                subtitle: "Grouped meals keep ingredients readable",
                systemImage: "fork.knife"
            ) {
                VStack(spacing: 10) {
                    tutorialListRow(
                        title: "Greek yogurt + protein scoop",
                        subtitle: "Protein 24g | Carbs 14g | Fat 5g",
                        trailing: "165 cal",
                        systemImage: "checkmark.circle.fill",
                        tint: .green
                    )
                    tutorialListRow(
                        title: "Chicken rice bowl",
                        subtitle: "Protein 46g | Carbs 62g | Fat 12g",
                        trailing: "540 cal",
                        systemImage: "takeoutbag.and.cup.and.straw.fill",
                        tint: .cyan
                    )
                }
            }

            tutorialPreviewSection(
                title: "Trend Snapshot",
                subtitle: "Patterns show up after a few days",
                systemImage: "waveform.path.ecg"
            ) {
                tutorialLineChart(points: [0.48, 0.62, 0.56, 0.74, 0.70, 0.82, 0.78], tint: .cyan)
            }
        }
    }

    private var workoutTutorialPreview: some View {
        VStack(spacing: 12) {
            tutorialPreviewSection(
                title: "Weekly Target",
                subtitle: "See volume and calories against the week",
                systemImage: "figure.run"
            ) {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    tutorialStatChip(title: "Workouts", value: "3 / 4", detail: "this week", tint: .green)
                    tutorialStatChip(title: "Burned", value: "1,420", detail: "calories", tint: .orange)
                }
            }

            tutorialPreviewSection(
                title: "Consistency",
                subtitle: "Workout days become an easy-to-scan calendar",
                systemImage: "calendar"
            ) {
                tutorialWorkoutDots
            }

            tutorialPreviewSection(
                title: "Recent Sessions",
                subtitle: "Duration, burn, and intensity stay together",
                systemImage: "list.bullet.rectangle"
            ) {
                VStack(spacing: 10) {
                    tutorialListRow(
                        title: "Upper body strength",
                        subtitle: "52 min | High intensity",
                        trailing: "410 cal",
                        systemImage: "dumbbell.fill",
                        tint: .green
                    )
                    tutorialListRow(
                        title: "Zone 2 run",
                        subtitle: "38 min | Medium intensity",
                        trailing: "330 cal",
                        systemImage: "figure.run",
                        tint: .cyan
                    )
                }
            }
        }
    }

    private var weightTutorialPreview: some View {
        VStack(spacing: 12) {
            tutorialPreviewSection(
                title: "Target Path",
                subtitle: "Progress is compared to the goal date",
                systemImage: "target"
            ) {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    tutorialStatChip(title: "Current", value: "184.6", detail: "lbs", tint: .cyan)
                    tutorialStatChip(title: "Target", value: "178.0", detail: "by Sep 9", tint: .green)
                }
            }

            tutorialPreviewSection(
                title: "Trend Line",
                subtitle: "The chart smooths out noisy daily weigh-ins",
                systemImage: "chart.xyaxis.line"
            ) {
                tutorialLineChart(points: [0.82, 0.78, 0.80, 0.70, 0.66, 0.60, 0.56], tint: .green)
            }

            tutorialPreviewSection(
                title: "History",
                subtitle: "Each weigh-in keeps date and direction context",
                systemImage: "clock.arrow.circlepath"
            ) {
                VStack(spacing: 10) {
                    tutorialListRow(
                        title: "184.6 lbs",
                        subtitle: "Today at 7:12 AM",
                        trailing: "-0.4",
                        systemImage: "arrow.down.right",
                        tint: .green
                    )
                    tutorialListRow(
                        title: "185.0 lbs",
                        subtitle: "Yesterday at 7:20 AM",
                        trailing: "+0.2",
                        systemImage: "arrow.up.right",
                        tint: .orange
                    )
                }
            }
        }
    }

    private var sleepTutorialPreview: some View {
        VStack(spacing: 12) {
            tutorialPreviewSection(
                title: "Weekly Sleep",
                subtitle: "Target nights stand out immediately",
                systemImage: "bed.double.fill"
            ) {
                tutorialBarChart(values: [0.64, 0.88, 0.72, 0.92, 0.78, 0.96, 0.84], tint: .purple)
            }

            tutorialPreviewSection(
                title: "Recovery Context",
                subtitle: "Wake-ups and sleep totals help explain training days",
                systemImage: "moon.zzz.fill"
            ) {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    tutorialStatChip(title: "Average", value: "7.4h", detail: "last 7 nights", tint: .purple)
                    tutorialStatChip(title: "Wake-ups", value: "1.1", detail: "per night", tint: .cyan)
                }
            }

            tutorialPreviewSection(
                title: "Sleep Log",
                subtitle: "Manual and HealthKit entries use the same timeline",
                systemImage: "list.bullet.clipboard"
            ) {
                VStack(spacing: 10) {
                    tutorialListRow(
                        title: "7.8 hours",
                        subtitle: "1 wake-up | Good quality",
                        trailing: "Met",
                        systemImage: "checkmark.seal.fill",
                        tint: .green
                    )
                    tutorialListRow(
                        title: "6.4 hours",
                        subtitle: "3 wake-ups | Restless",
                        trailing: "Short",
                        systemImage: "exclamationmark.triangle.fill",
                        tint: .orange
                    )
                }
            }
        }
    }

    private func tutorialPreviewSection<Content: View>(
        title: String,
        subtitle: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: systemImage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.cyan)
                    .frame(width: 28, height: 28)
                    .background(.cyan.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)
            }

            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(.white.opacity(0.10), lineWidth: 1)
        )
    }

    private func tutorialProgressRow(_ title: String, value: String, progress: Double, tint: Color) -> some View {
        let clampedProgress = min(max(progress, 0), 1)

        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                    .font(.caption.weight(.semibold))
                Spacer(minLength: 8)
                Text(value)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }

            ProgressView(value: clampedProgress)
                .tint(tint)
        }
    }

    private func tutorialStatChip(title: String, value: String, detail: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(tint)
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func tutorialListRow(title: String, subtitle: String, trailing: String, systemImage: String, tint: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tint)
                .frame(width: 30, height: 30)
                .background(tint.opacity(0.13), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.74)
            }

            Spacer(minLength: 8)

            Text(trailing)
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.78)
        }
        .padding(10)
        .background(.black.opacity(0.16), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func tutorialLineChart(points: [Double], tint: Color) -> some View {
        GeometryReader { geometry in
            let clampedPoints = points.map { min(max($0, 0), 1) }
            let segmentCount = max(clampedPoints.count - 1, 1)

            ZStack {
                VStack(spacing: 0) {
                    ForEach(0..<3, id: \.self) { _ in
                        Rectangle()
                            .fill(.white.opacity(0.08))
                            .frame(height: 1)
                        Spacer()
                    }
                }

                Path { path in
                    for (index, point) in clampedPoints.enumerated() {
                        let x = geometry.size.width * CGFloat(index) / CGFloat(segmentCount)
                        let y = geometry.size.height * CGFloat(1 - point)
                        if index == 0 {
                            path.move(to: CGPoint(x: x, y: y))
                        } else {
                            path.addLine(to: CGPoint(x: x, y: y))
                        }
                    }
                }
                .stroke(tint, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
            }
        }
        .frame(height: 86)
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
        .background(.black.opacity(0.16), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var tutorialWorkoutDots: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 5), count: 7)
        let activeDays: Set<Int> = [1, 4, 6, 9, 13, 16, 18, 22, 25]

        return LazyVGrid(columns: columns, spacing: 5) {
            ForEach(0..<28, id: \.self) { index in
                Circle()
                    .fill(activeDays.contains(index) ? Color.green : Color.white.opacity(0.13))
                    .frame(width: 10, height: 10)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(12)
        .background(.black.opacity(0.16), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func tutorialBarChart(values: [Double], tint: Color) -> some View {
        let labels = ["M", "T", "W", "T", "F", "S", "S"]

        return HStack(alignment: .bottom, spacing: 8) {
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                let clampedValue = min(max(value, 0.12), 1)

                VStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(tint.opacity(index == 3 || index == 5 ? 0.95 : 0.52))
                        .frame(height: 36 + (74 * clampedValue))

                    Text(labels[index % labels.count])
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 136)
        .padding(12)
        .background(.black.opacity(0.16), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var targetSetupForm: some View {
        Form {
            Section {
                Text(SetupStep.targets.leadText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Section("Daily Targets") {
                targetField("Calories", text: $calorieTarget)
                targetField("Protein (g)", text: $proteinTarget)
                targetField("Carbs (g)", text: $carbsTarget)
                targetField("Fat (g)", text: $fatTarget)
                targetField("Sleep (hours)", text: $sleepTarget, usesDecimalKeyboard: true)
            }

            Section("Weekly Targets") {
                targetField("Workouts per week", text: $workoutsPerWeek)
                targetField("Calories burned per week", text: $workoutCaloriesTarget)
            }

            Section("Weight") {
                targetField("Target weight (optional)", text: $targetWeight, usesDecimalKeyboard: true)
                DatePicker("Target date", selection: $targetDate, displayedComponents: .date)
            }

            Section("Reminder") {
                Toggle("Daily log reminder", isOn: $remindersEnabled)
                DatePicker("Time", selection: $reminderDate, displayedComponents: .hourAndMinute)
                    .disabled(!remindersEnabled)
            }

            Section {
                Button {
                    Task { await saveSetup() }
                } label: {
                    HStack {
                        Text("Save Setup")
                        Spacer()
                        if isSaving || isLoadingTargets {
                            ProgressView()
                        }
                    }
                }
                .disabled(isSaving || isLoadingTargets)
            }
        }
    }

    private var tutorialCalloutCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: setupStep.systemImage)
                    .font(.title2)
                    .foregroundStyle(.cyan)
                    .frame(width: 32, height: 32)

                VStack(alignment: .leading, spacing: 2) {
                    Text(setupStep.title)
                        .font(.headline)
                    Text("Step \(setupStep.rawValue + 1) of \(SetupStep.allCases.count)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            ProgressView(value: Double(setupStep.rawValue + 1), total: Double(SetupStep.allCases.count))
                .tint(.cyan)

            Text(setupStep.leadText)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Label(setupStep.tourHint, systemImage: "hand.draw")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)

            tutorialNavigation
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(.white.opacity(0.16), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.25), radius: 20, y: 8)
    }

    private var tutorialNavigation: some View {
        HStack(spacing: 12) {
            Button("Back") {
                moveToPreviousStep()
            }
            .disabled(setupStep.rawValue == 0)

            Spacer()

            Button(setupStep == .sleep ? "Set Targets" : "Next") {
                moveToNextStep()
            }
            .buttonStyle(.borderedProminent)
            .tint(.cyan)
        }
    }

    private func targetField(_ label: String, text: Binding<String>, usesDecimalKeyboard: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField(label, text: text)
                .keyboardType(usesDecimalKeyboard ? .decimalPad : .numberPad)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
    }

    private func moveToNextStep() {
        guard let nextStep = SetupStep(rawValue: setupStep.rawValue + 1) else { return }
        setupStep = nextStep
    }

    private func moveToPreviousStep() {
        guard let previousStep = SetupStep(rawValue: setupStep.rawValue - 1) else { return }
        setupStep = previousStep
    }

    private func loadExistingTargets() async {
        guard !isLoadingTargets, !didLoadExistingTargets else { return }
        isLoadingTargets = true
        defer {
            isLoadingTargets = false
            didLoadExistingTargets = true
        }

        do {
            let dashboard = try await api.getDashboard(limit: 1)
            hydrateMacroTargets(dashboard.targets)
        } catch {
            Diagnostics.shared.record(level: "warning", category: "onboarding", message: "Failed to load existing macro targets", details: ["error": error.localizedDescription])
        }

        do {
            let weightTarget = try await api.getWeightTarget()
            hydrateWeightTarget(weightTarget)
        } catch {
            Diagnostics.shared.record(level: "warning", category: "onboarding", message: "Failed to load existing weight target", details: ["error": error.localizedDescription])
        }
    }

    private func hydrateMacroTargets(_ targets: MacroTargets) {
        if targets.calories > 0 { calorieTarget = targetText(targets.calories) }
        if targets.protein > 0 { proteinTarget = targetText(targets.protein) }
        if targets.carbs > 0 { carbsTarget = targetText(targets.carbs) }
        if targets.fat > 0 { fatTarget = targetText(targets.fat) }
        if targets.workouts > 0 { workoutsPerWeek = targetText(targets.workouts) }
        if let workoutCalories = targets.workoutCalories, workoutCalories >= 0 {
            workoutCaloriesTarget = targetText(workoutCalories, allowZero: true)
        }
        if let sleepHours = targets.sleepHours, sleepHours > 0 {
            sleepTarget = targetText(sleepHours)
        }
    }

    private func hydrateWeightTarget(_ weightTarget: WeightTarget) {
        if let weight = weightTarget.targetWeight, weight > 0 {
            targetWeight = targetText(weight)
        }
        if let dateString = weightTarget.targetDate, let date = parseTargetDate(dateString) {
            targetDate = date
        }
    }

    private func saveSetup() async {
        isSaving = true
        defer { isSaving = false }

        do {
            if let calories = positiveDouble(calorieTarget) {
                try await api.setMacroTarget(macro: "calories", target: calories)
            }
            if let protein = nonNegativeDouble(proteinTarget) {
                try await api.setMacroTarget(macro: "protein", target: protein)
            }
            if let carbs = nonNegativeDouble(carbsTarget) {
                try await api.setMacroTarget(macro: "carbs", target: carbs)
            }
            if let fat = nonNegativeDouble(fatTarget) {
                try await api.setMacroTarget(macro: "fat", target: fat)
            }
            if let workouts = positiveDouble(workoutsPerWeek) {
                try await api.setMacroTarget(macro: "workouts", target: workouts)
            }
            if let workoutCalories = nonNegativeDouble(workoutCaloriesTarget) {
                try await api.setMacroTarget(macro: "workout_calories", target: workoutCalories)
            }
            if let sleep = positiveDouble(sleepTarget) {
                try await api.setMacroTarget(macro: "sleep_hours", target: sleep)
            }
            if let weight = positiveDouble(targetWeight) {
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.dateFormat = "yyyy-MM-dd"
                try await api.setWeightTarget(targetWeight: weight, targetDate: formatter.string(from: targetDate))
            }
            if remindersEnabled {
                try await ReminderScheduler.shared.setEnabled(true, at: reminderDate)
            }

            Diagnostics.shared.record(category: "onboarding", message: "Completed setup")
            isComplete = true
        } catch {
            Diagnostics.shared.record(level: "error", category: "onboarding", message: error.localizedDescription)
            errorMessage = error.localizedDescription
        }
    }

    private func positiveDouble(_ value: String) -> Double? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let number = Double(trimmed), number > 0 else { return nil }
        return number
    }

    private func nonNegativeDouble(_ value: String) -> Double? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let number = Double(trimmed), number >= 0 else { return nil }
        return number
    }

    private func targetText(_ value: Double, allowZero: Bool = false) -> String {
        guard value > 0 || (allowZero && value >= 0) else { return "" }
        if abs(value.rounded() - value) < 0.001 {
            return "\(Int(value.rounded()))"
        }
        return String(format: "%.1f", value)
    }

    private func parseTargetDate(_ dateString: String) -> Date? {
        let trimmed = dateString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let dateOnlyFormatter = DateFormatter()
        dateOnlyFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateOnlyFormatter.dateFormat = "yyyy-MM-dd"
        if let date = dateOnlyFormatter.date(from: trimmed) {
            return date
        }

        return ISO8601DateFormatter().date(from: trimmed)
    }
}
