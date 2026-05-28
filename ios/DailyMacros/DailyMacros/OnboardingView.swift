import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject var api: APIClient
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
    }

    @State private var setupStep: SetupStep = .macros
    @State private var tutorialMealText = ""
    @State private var tutorialMealStatus: String?
    @State private var isLoggingTutorialMeal = false
    @State private var didLogTutorialMeal = false

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
        NavigationStack {
            Group {
                if setupStep == .targets {
                    targetSetupForm
                } else {
                    tutorialForm
                }
            }
            .navigationTitle(setupStep.title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Skip") {
                        Diagnostics.shared.record(category: "onboarding", message: "Skipped setup")
                        isComplete = true
                    }
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
    }

    private var tutorialForm: some View {
        Form {
            Section {
                tutorialHeader
            }

            tutorialStepSections

            Section {
                tutorialNavigation
            }
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

    private var tutorialHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
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
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var tutorialStepSections: some View {
        switch setupStep {
        case .macros:
            macrosTutorialSections
        case .workouts:
            workoutsTutorialSections
        case .weight:
            weightTutorialSections
        case .sleep:
            sleepTutorialSections
        case .targets:
            EmptyView()
        }
    }

    @ViewBuilder
    private var macrosTutorialSections: some View {
        Section("Log a Meal") {
            Text("Describe a meal in natural language and DailyMacros will turn it into calorie and macro entries.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            TextField("Example: chicken bowl with rice and avocado", text: $tutorialMealText, axis: .vertical)
                .lineLimit(3...5)
                .textInputAutocapitalization(.sentences)

            Button {
                Task { await logTutorialMeal() }
            } label: {
                HStack {
                    Label(didLogTutorialMeal ? "Log Another Meal" : "Log Meal", systemImage: didLogTutorialMeal ? "plus.circle" : "checkmark.circle")
                    Spacer()
                    if isLoggingTutorialMeal {
                        ProgressView()
                    }
                }
            }
            .disabled(isLoggingTutorialMeal || tutorialMealText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if let tutorialMealStatus {
                Label(tutorialMealStatus, systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.green)
            }
        }

        Section("Quick Add") {
            featureRow(
                "Quick Add reuses saved or recent meals when you want to log something you eat often.",
                systemImage: "clock.arrow.circlepath"
            )
        }
    }

    @ViewBuilder
    private var workoutsTutorialSections: some View {
        Section("Workout Logging") {
            featureRow(
                "Describe a workout in natural language and DailyMacros can estimate duration, intensity, and calories burned.",
                systemImage: "text.bubble"
            )
            featureRow(
                "Sync workouts to Apple Health so DailyMacros and Health can stay aligned.",
                systemImage: "heart.text.square"
            )
            featureRow(
                "Import workouts from the Forge: Workout Planner app when you plan or log training there.",
                systemImage: "square.and.arrow.down"
            )
        }
    }

    @ViewBuilder
    private var weightTutorialSections: some View {
        Section("Weight Trends") {
            featureRow(
                "Log weigh-ins manually or pull recent body weight from Apple Health.",
                systemImage: "scalemass"
            )
            featureRow(
                "Bidirectional Apple Health sync can import Health weight entries and write DailyMacros weigh-ins back to Health.",
                systemImage: "arrow.left.arrow.right"
            )
        }
    }

    @ViewBuilder
    private var sleepTutorialSections: some View {
        Section("Sleep and Recovery") {
            featureRow(
                "Track sleep hours and wake-ups so recovery is visible beside meals, workouts, and weight.",
                systemImage: "moon.zzz"
            )
            featureRow(
                "Bidirectional Apple Health sync can import Health sleep sessions and write DailyMacros sleep entries back to Health.",
                systemImage: "arrow.left.arrow.right"
            )
        }
    }

    private var tutorialNavigation: some View {
        HStack(spacing: 12) {
            if setupStep.rawValue > 0 {
                Button("Back") {
                    moveToPreviousStep()
                }
                .disabled(isLoggingTutorialMeal)
            }

            Button(setupStep == .sleep ? "Set Targets" : "Next") {
                moveToNextStep()
            }
            .buttonStyle(.borderedProminent)
            .tint(.cyan)
            .disabled(isLoggingTutorialMeal)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    private func featureRow(_ text: String, systemImage: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .font(.body)
                .foregroundStyle(.cyan)
                .frame(width: 22)

            Text(text)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
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

    private func logTutorialMeal() async {
        let mealText = tutorialMealText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !mealText.isEmpty else { return }

        isLoggingTutorialMeal = true
        tutorialMealStatus = nil
        defer { isLoggingTutorialMeal = false }

        do {
            let consumedAt = isoTimestamp(from: Date())
            let response = try await api.parseMeal(text: mealText, consumedAt: consumedAt)
            guard !response.items.isEmpty else {
                throw APIError.serverError("DailyMacros could not find meal items in that description.")
            }

            try await api.saveMealEntries(
                items: response.items.map(mealItemPayload),
                consumedAt: consumedAt,
                mealName: response.mealName,
                mealQuantity: response.mealQuantity,
                mealUnit: response.mealUnit
            )

            didLogTutorialMeal = true
            tutorialMealText = ""
            tutorialMealStatus = "Meal logged. You can edit it from the Macros page."
            Diagnostics.shared.record(category: "onboarding", message: "Logged tutorial meal")
        } catch {
            Diagnostics.shared.record(level: "error", category: "onboarding", message: "Failed to log tutorial meal", details: ["error": error.localizedDescription])
            errorMessage = error.localizedDescription
        }
    }

    private func mealItemPayload(_ item: ParsedMealItem) -> [String: Any] {
        var payload: [String: Any] = [
            "itemName": item.itemName,
            "quantity": item.quantity,
            "calories": item.calories,
            "protein": item.protein,
            "carbs": item.carbs,
            "fat": item.fat
        ]
        if let unit = item.unit {
            payload["unit"] = unit
        }
        return payload
    }

    private func isoTimestamp(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(identifier: "America/New_York")
        return formatter.string(from: date)
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
