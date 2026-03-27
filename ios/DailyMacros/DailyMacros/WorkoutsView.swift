import SwiftUI

struct WorkoutsView: View {
    @EnvironmentObject var api: APIClient
    @State private var workouts: [WorkoutEntry] = []
    @State private var dailyCalories: [WorkoutDailyCalories] = []
    @State private var workoutText = ""
    @State private var parsedWorkout: ParseWorkoutResponse?
    @State private var isParsing = false
    @State private var isSaving = false
    @State private var showLogSheet = false
    @State private var showEditTargets = false
    @State private var errorMessage: String?
    @State private var scope = "week"

    // Stats from dashboard targets
    @State private var workoutsTarget: Double = 5
    @State private var caloriesTarget: Double = 0

    // Target editing state
    @State private var editWorkoutsPerWeek = ""
    @State private var editCaloriesPerWeek = ""

    private let scopes = ["week", "month", "year"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    scopePicker
                    statsSection
                    workoutsList
                }
                .padding()
            }
            .navigationTitle("Workouts")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showLogSheet = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showLogSheet) {
                logWorkoutSheet
            }
            .sheet(isPresented: $showEditTargets) {
                editTargetsSheet
            }
            .task { await loadWorkouts() }
            .refreshable { await loadWorkouts() }
            .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: - Scope Picker

    private var scopePicker: some View {
        Picker("Scope", selection: $scope) {
            ForEach(scopes, id: \.self) { s in
                Text(s.capitalized).tag(s)
            }
        }
        .pickerStyle(.segmented)
        .onChange(of: scope) { _, _ in
            Task { await loadWorkouts() }
        }
    }

    // MARK: - Stats Section

    private var statsSection: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Stats")
                    .font(.subheadline.bold())
                Spacer()
                Button("edit targets") {
                    editWorkoutsPerWeek = "\(Int(workoutsTarget))"
                    editCaloriesPerWeek = "\(Int(caloriesTarget))"
                    showEditTargets = true
                }
                .font(.caption)
                .foregroundStyle(.cyan)
            }

            HStack(spacing: 12) {
                statChip(
                    icon: "figure.run",
                    label: "Workouts/Week",
                    value: workoutsPerWeek,
                    target: workoutsTarget,
                    color: .cyan
                )
                statChip(
                    icon: "flame",
                    label: "Cal/Week",
                    value: caloriesPerWeek,
                    target: caloriesTarget,
                    color: .orange
                )
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private func statChip(icon: String, label: String, value: Double, target: Double, color: Color) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .foregroundStyle(color)
            Text(String(format: "%.1f", value))
                .font(.title3.bold())
            if target > 0 {
                Text("/ \(Int(target))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private var workoutsPerWeek: Double {
        guard !dailyCalories.isEmpty else { return 0 }
        let weeks = max(Double(scopeWeeks), 1)
        return Double(dailyCalories.count) / weeks
    }

    private var caloriesPerWeek: Double {
        guard !dailyCalories.isEmpty else { return 0 }
        let totalCal = dailyCalories.reduce(0.0) { $0 + $1.calories }
        let weeks = max(Double(scopeWeeks), 1)
        return totalCal / weeks
    }

    private var scopeWeeks: Int {
        switch scope {
        case "week": return 1
        case "month": return 4
        case "year": return 52
        default: return 1
        }
    }

    // MARK: - Workouts List

    private var workoutsList: some View {
        VStack(spacing: 12) {
            ForEach(workouts) { workout in
                workoutCard(workout)
            }

            if workouts.isEmpty {
                ContentUnavailableView("No Workouts", systemImage: "figure.run", description: Text("Tap + to log your first workout."))
            }
        }
    }

    // MARK: - Workout Card

    private func workoutCard(_ workout: WorkoutEntry) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(workout.description)
                    .font(.headline)
                Spacer()
                Text(intensityBadge(workout.intensity))
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(intensityColor(workout.intensity).opacity(0.2))
                    .foregroundStyle(intensityColor(workout.intensity))
                    .cornerRadius(8)
            }

            HStack(spacing: 16) {
                Label(formatDuration(workout.durationHours), systemImage: "clock")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Label("\(Int(workout.caloriesBurned)) kcal", systemImage: "flame")
                    .font(.subheadline)
                    .foregroundStyle(.orange)
            }

            Text(formatDate(workout.loggedAt))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    // MARK: - Edit Targets Sheet

    private var editTargetsSheet: some View {
        NavigationStack {
            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Workouts per Week")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("Workouts/week", text: $editWorkoutsPerWeek)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.numberPad)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Calories Burned per Week")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("Cal/week", text: $editCaloriesPerWeek)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.numberPad)
                }

                Button {
                    Task { await saveWorkoutTargets() }
                } label: {
                    Text("Save Targets").font(.headline).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.cyan)

                Spacer()
            }
            .padding()
            .navigationTitle("Workout Targets")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showEditTargets = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Log Workout Sheet

    private var logWorkoutSheet: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if let parsed = parsedWorkout {
                    parsedWorkoutView(parsed)
                } else {
                    workoutInputView
                }
            }
            .padding()
            .navigationTitle(parsedWorkout != nil ? "Confirm Workout" : "Log Workout")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showLogSheet = false; workoutText = ""; parsedWorkout = nil }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var workoutInputView: some View {
        VStack(spacing: 16) {
            TextField("Describe your workout...", text: $workoutText, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...6)

            Button {
                Task { await parseWorkout() }
            } label: {
                if isParsing {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Text("Parse Workout").font(.headline).frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.cyan)
            .disabled(workoutText.isEmpty || isParsing)

            Spacer()
        }
    }

    private func parsedWorkoutView(_ parsed: ParseWorkoutResponse) -> some View {
        VStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                detailRow("Activity", value: parsed.description)
                detailRow("Intensity", value: parsed.intensity.capitalized)
                detailRow("Duration", value: formatDuration(parsed.durationHours))
                detailRow("Calories", value: "\(Int(parsed.caloriesBurned)) kcal")
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)

            Button {
                Task { await saveWorkout(parsed) }
            } label: {
                if isSaving {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Text("Save").font(.headline).frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.cyan)
            .disabled(isSaving)

            Spacer()
        }
    }

    private func detailRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.subheadline.bold())
        }
    }

    // MARK: - Actions

    private func loadWorkouts() async {
        do {
            let response = try await api.getWorkouts(scope: scope)
            workouts = response.entries
            dailyCalories = response.dailyCalories
        } catch {
            errorMessage = error.localizedDescription
        }
        // Load targets
        do {
            let dash = try await api.getDashboard()
            workoutsTarget = dash.targets.workouts
            caloriesTarget = dash.targets.workoutCalories ?? 0
        } catch { /* non-critical */ }
    }

    private func parseWorkout() async {
        isParsing = true
        defer { isParsing = false }
        do {
            parsedWorkout = try await api.parseWorkout(text: workoutText)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveWorkout(_ parsed: ParseWorkoutResponse) async {
        isSaving = true
        defer { isSaving = false }
        do {
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.addWorkout(
                description: parsed.description,
                intensity: parsed.intensity,
                durationHours: parsed.durationHours,
                caloriesBurned: parsed.caloriesBurned,
                loggedAt: f.string(from: Date())
            )
            showLogSheet = false
            workoutText = ""
            parsedWorkout = nil
            await loadWorkouts()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveWorkoutTargets() async {
        do {
            if let w = Double(editWorkoutsPerWeek) {
                try await api.setMacroTarget(macro: "workouts", target: w)
            }
            if let c = Double(editCaloriesPerWeek) {
                try await api.setMacroTarget(macro: "workout_calories", target: c)
            }
            showEditTargets = false
            await loadWorkouts()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Helpers

    private func formatDuration(_ hours: Double) -> String {
        let totalMinutes = Int(hours * 60)
        if totalMinutes >= 60 {
            let h = totalMinutes / 60
            let m = totalMinutes % 60
            return m > 0 ? "\(h)h \(m)m" : "\(h)h"
        }
        return "\(totalMinutes)m"
    }

    private func intensityBadge(_ intensity: String) -> String {
        intensity.capitalized
    }

    private func intensityColor(_ intensity: String) -> Color {
        switch intensity.lowercased() {
        case "light": return .green
        case "moderate": return .yellow
        case "intense", "high": return .red
        default: return .cyan
        }
    }

    private func formatDate(_ iso: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
        if let date = f.date(from: iso) {
            f.dateStyle = .medium
            f.timeStyle = .short
            return f.string(from: date)
        }
        return String(iso.prefix(10))
    }
}
