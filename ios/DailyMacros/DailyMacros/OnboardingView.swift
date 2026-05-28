import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject var api: APIClient
    @Binding var isComplete: Bool

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
            Form {
                Section {
                    Text("Set the targets DailyMacros uses for progress bars, weekly analysis, reminders, and weight goals.")
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
            .navigationTitle("Set Up DailyMacros")
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
            .task {
                await loadExistingTargets()
            }
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
