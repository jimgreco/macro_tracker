import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject var api: APIClient
    @Binding var isComplete: Bool

    @State private var calorieTarget = "2200"
    @State private var proteinTarget = "160"
    @State private var workoutsPerWeek = "4"
    @State private var sleepTarget = "8"
    @State private var startingWeight = ""
    @State private var targetWeight = ""
    @State private var targetDate = Calendar.current.date(byAdding: .month, value: 3, to: Date()) ?? Date()
    @State private var remindersEnabled = false
    @State private var reminderDate = ReminderScheduler.shared.reminderDate
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Set the targets DailyMacros uses for progress bars, weekly analysis, reminders, and your starting weight trend.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Section("Daily Targets") {
                    TextField("Calories", text: $calorieTarget)
                        .keyboardType(.numberPad)
                    TextField("Protein (g)", text: $proteinTarget)
                        .keyboardType(.numberPad)
                    TextField("Sleep (hours)", text: $sleepTarget)
                        .keyboardType(.decimalPad)
                }

                Section("Weekly Targets") {
                    TextField("Workouts per week", text: $workoutsPerWeek)
                        .keyboardType(.numberPad)
                }

                Section("Weight") {
                    TextField("Current weight (optional)", text: $startingWeight)
                        .keyboardType(.decimalPad)
                    TextField("Target weight (optional)", text: $targetWeight)
                        .keyboardType(.decimalPad)
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
                            if isSaving {
                                ProgressView()
                            }
                        }
                    }
                    .disabled(isSaving)
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
        }
    }

    private func saveSetup() async {
        isSaving = true
        defer { isSaving = false }

        do {
            if let calories = positiveDouble(calorieTarget) {
                try await api.setMacroTarget(macro: "calories", target: calories)
            }
            if let protein = positiveDouble(proteinTarget) {
                try await api.setMacroTarget(macro: "protein", target: protein)
            }
            if let workouts = positiveDouble(workoutsPerWeek) {
                try await api.setMacroTarget(macro: "workouts", target: workouts)
            }
            if let sleep = positiveDouble(sleepTarget) {
                try await api.setMacroTarget(macro: "sleep_hours", target: sleep)
            }
            if let weight = positiveDouble(startingWeight) {
                let formatter = ISO8601DateFormatter()
                formatter.timeZone = TimeZone(identifier: "America/New_York")
                try await api.addWeight(weight, loggedAt: formatter.string(from: Date()))
            }
            if let weight = positiveDouble(targetWeight) {
                let formatter = DateFormatter()
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
}
