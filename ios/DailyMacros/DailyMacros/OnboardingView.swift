import SwiftUI

enum TutorialSpotlightTarget: Hashable {
    case macros
    case workouts
    case weight
    case sleep
}

struct TutorialSpotlightAnchorPreferenceKey: PreferenceKey {
    static var defaultValue: [TutorialSpotlightTarget: [Anchor<CGRect>]] = [:]

    static func reduce(value: inout [TutorialSpotlightTarget: [Anchor<CGRect>]], nextValue: () -> [TutorialSpotlightTarget: [Anchor<CGRect>]]) {
        for (target, anchors) in nextValue() {
            value[target, default: []].append(contentsOf: anchors)
        }
    }
}

extension View {
    func tutorialSpotlightAnchor(_ target: TutorialSpotlightTarget) -> some View {
        anchorPreference(key: TutorialSpotlightAnchorPreferenceKey.self, value: .bounds) { anchor in
            [target: [anchor]]
        }
    }
}

private func normalizedTutorialTopInset(in size: CGSize, safeAreaInsets: EdgeInsets) -> CGFloat {
    // NavigationStack tutorial backgrounds can report a toolbar-inflated top inset.
    let maximumReasonableTopInset = min(size.height * 0.08, 64)
    return min(max(safeAreaInsets.top, 0), maximumReasonableTopInset)
}

private func tutorialTopInset(in size: CGSize, safeAreaInsets: EdgeInsets, coordinateMinY: CGFloat) -> CGFloat {
    let normalizedTopInset = normalizedTutorialTopInset(in: size, safeAreaInsets: safeAreaInsets)
    return max(normalizedTopInset - max(coordinateMinY, 0), 0)
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

        var focusText: String {
            switch self {
            case .macros:
                return "Tap the arrow-marked add button to log a meal with text, photo, barcode, or Quick Add."
            case .workouts:
                return "Use the arrow-marked controls to sync Health workouts or log a new workout."
            case .weight:
                return "Use the arrow-marked controls to sync Health weight or add a weigh-in."
            case .sleep:
                return "Use the arrow-marked controls to sync Health sleep or log sleep manually."
            case .targets:
                return ""
            }
        }

        var spotlightTarget: TutorialSpotlightTarget? {
            switch self {
            case .macros: return .macros
            case .workouts: return .workouts
            case .weight: return .weight
            case .sleep: return .sleep
            case .targets: return nil
            }
        }

        func spotlightRect(in size: CGSize, topInset: CGFloat) -> CGRect {
            let toolbarY = topInset + 10
            let trailingPadding: CGFloat = 14

            switch self {
            case .macros:
                return CGRect(
                    x: max(size.width - trailingPadding - 62, 16),
                    y: toolbarY,
                    width: 62,
                    height: 54
                )
            case .workouts, .weight, .sleep:
                return CGRect(
                    x: max(size.width - trailingPadding - 112, 16),
                    y: toolbarY,
                    width: 112,
                    height: 54
                )
            case .targets:
                return .zero
            }
        }

        func measuredSpotlightRect(
            from anchorsByTarget: [TutorialSpotlightTarget: [Anchor<CGRect>]],
            in proxy: GeometryProxy
        ) -> CGRect? {
            guard let spotlightTarget,
                  let anchors = anchorsByTarget[spotlightTarget],
                  !anchors.isEmpty else {
                return nil
            }

            let resolvedRects = anchors.map { proxy[$0] }
            guard var rect = resolvedRects.first else {
                return nil
            }
            for item in resolvedRects.dropFirst() {
                rect = rect.union(item)
            }

            let padded = rect.insetBy(dx: -9, dy: -5)
            let minX = max(padded.minX, 12)
            let maxX = min(padded.maxX, proxy.size.width - 12)
            let minY = max(padded.minY, 6)
            let maxY = min(padded.maxY, proxy.size.height - 6)
            guard maxX > minX, maxY > minY else {
                return nil
            }
            return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
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
            let topInset = tutorialTopInset(
                in: proxy.size,
                safeAreaInsets: proxy.safeAreaInsets,
                coordinateMinY: proxy.frame(in: .global).minY
            )
            let fallbackSpotlightRect = setupStep.spotlightRect(in: proxy.size, topInset: topInset)

            tutorialPageBackground
                .id(setupStep)
                .ignoresSafeArea()
                .overlayPreferenceValue(TutorialSpotlightAnchorPreferenceKey.self) { anchorsByTarget in
                    GeometryReader { spotlightProxy in
                        let spotlightRect = setupStep.measuredSpotlightRect(
                            from: anchorsByTarget,
                            in: spotlightProxy
                        ) ?? fallbackSpotlightRect

                        ZStack {
                            Color.black.opacity(0.58)
                                .ignoresSafeArea()
                                .allowsHitTesting(false)

                            tutorialPointerArrow(targetRect: spotlightRect, containerSize: spotlightProxy.size)

                            VStack(spacing: 0) {
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

                                Spacer(minLength: 0)

                                tutorialCalloutCard
                                    .padding(.horizontal, 14)
                                    .padding(.bottom, max(proxy.safeAreaInsets.bottom + 16, 16))
                            }
                        }
                    }
                }
        }
    }

    private func tutorialPointerArrow(targetRect: CGRect, containerSize: CGSize) -> some View {
        let arrowX = min(max(targetRect.minX - 28, 30), containerSize.width - 30)
        let arrowY = min(max(targetRect.maxY + 30, 72), containerSize.height - 220)

        return Image(systemName: "arrow.up.right")
            .font(.system(size: 38, weight: .black))
            .foregroundStyle(.cyan)
            .shadow(color: .cyan.opacity(0.9), radius: 10)
            .shadow(color: .black.opacity(0.65), radius: 8, y: 3)
            .position(x: arrowX, y: arrowY)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var tutorialPageBackground: some View {
        switch setupStep {
        case .macros:
            MacrosView()
        case .workouts:
            WorkoutsView()
        case .weight:
            WeightView()
        case .sleep:
            SleepView()
        case .targets:
            EmptyView()
        }
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

            Label(setupStep.focusText, systemImage: "hand.tap")
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
