import SwiftUI

struct WorkoutsView: View {
    @EnvironmentObject var api: APIClient
    @State private var workouts: [WorkoutEntry] = []
    @State private var dailyCalories: [WorkoutDailyCalories] = []
    @State private var workoutText = ""
    @State private var parsedWorkout: ParseWorkoutResponse?
    @State private var workoutLogDate = Date()
    @State private var parsedDescription = ""
    @State private var parsedIntensity = "medium"
    @State private var parsedDurationHours = ""
    @State private var parsedCalories = ""
    @State private var isParsing = false
    @State private var isSaving = false
    @State private var isSyncing = false
    @State private var showLogSheet = false
    @State private var showEditTargets = false
    @State private var editingWorkout: WorkoutEntry?
    @State private var errorMessage: String?
    @State private var scope = "week"

    // Stats from dashboard targets
    @State private var workoutsTarget: Double = 5
    @State private var caloriesTarget: Double = 0

    // Target editing state
    @State private var editWorkoutsPerWeek = ""
    @State private var editCaloriesPerWeek = ""
    @State private var editWorkoutDescription = ""
    @State private var editWorkoutIntensity = "medium"
    @State private var editWorkoutDuration = ""
    @State private var editWorkoutCalories = ""
    @State private var editWorkoutDate = Date()
    @State private var editWorkoutBaseDuration: Double = 0
    @State private var editWorkoutBaseCalories: Double = 0

    private let scopes = ["week", "month", "year"]
    private let intensityOptions = ["low", "medium", "high"]

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
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        Task { await syncWorkouts() }
                    } label: {
                        if isSyncing {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.triangle.2.circlepath")
                        }
                    }
                    .disabled(isSyncing)

                    Button {
                        workoutLogDate = Date()
                        showLogSheet = true
                    } label: {
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
            .sheet(item: $editingWorkout) { workout in
                editWorkoutSheet(workout)
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
        .contentShape(Rectangle())
        .onTapGesture {
            beginEditWorkout(workout)
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                Task { await deleteWorkout(workout) }
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
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
                    Button("Cancel") { resetWorkoutSheet() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var workoutInputView: some View {
        VStack(spacing: 16) {
            DatePicker("Logged At", selection: $workoutLogDate)
                .datePickerStyle(.compact)

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

    private func parsedWorkoutView(_: ParseWorkoutResponse) -> some View {
        VStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                TextField("Activity", text: $parsedDescription)
                    .textFieldStyle(.roundedBorder)

                Picker("Intensity", selection: $parsedIntensity) {
                    ForEach(intensityOptions, id: \.self) { option in
                        Text(option.capitalized).tag(option)
                    }
                }
                .pickerStyle(.segmented)

                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Hours")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("Hours", text: $parsedDurationHours)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.decimalPad)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Calories")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("Calories", text: $parsedCalories)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.numberPad)
                    }
                }

                DatePicker("Logged At", selection: $workoutLogDate)
                    .datePickerStyle(.compact)
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)

            Button {
                Task { await saveWorkout() }
            } label: {
                if isSaving {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Text("Save").font(.headline).frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.cyan)
            .disabled(isSaving || parsedDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Spacer()
        }
    }

    // MARK: - Edit Workout Sheet

    private func beginEditWorkout(_ workout: WorkoutEntry) {
        editWorkoutDescription = workout.description
        editWorkoutIntensity = normalizeWorkoutIntensity(workout.intensity)
        editWorkoutDuration = String(format: "%.2g", workout.durationHours)
        editWorkoutCalories = "\(Int(workout.caloriesBurned))"
        editWorkoutDate = parseISO(workout.loggedAt)
        editWorkoutBaseDuration = workout.durationHours
        editWorkoutBaseCalories = workout.caloriesBurned
        editingWorkout = workout
    }

    private func editWorkoutSheet(_ workout: WorkoutEntry) -> some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    TextField("Description", text: $editWorkoutDescription)
                        .textFieldStyle(.roundedBorder)

                    Picker("Intensity", selection: $editWorkoutIntensity) {
                        ForEach(intensityOptions, id: \.self) { option in
                            Text(option.capitalized).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)

                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Hours")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            TextField("Hours", text: $editWorkoutDuration)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.decimalPad)
                                .onChange(of: editWorkoutDuration) { _, newValue in
                                    scaleWorkoutCalories(newDuration: newValue)
                                }
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Calories")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            TextField("Calories", text: $editWorkoutCalories)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.numberPad)
                        }
                    }

                    DatePicker("Logged At", selection: $editWorkoutDate)
                        .datePickerStyle(.compact)

                    Button {
                        Task { await updateWorkout(workout) }
                    } label: {
                        if isSaving {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Save").font(.headline).frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.cyan)
                    .disabled(editWorkoutDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)

                    Button(role: .destructive) {
                        Task { await deleteWorkout(workout) }
                    } label: {
                        Text("Delete Workout").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                .padding()
            }
            .navigationTitle("Edit Workout")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editingWorkout = nil }
                }
            }
        }
        .presentationDetents([.medium, .large])
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
            let parsed = try await api.parseWorkout(text: workoutText)
            parsedWorkout = parsed
            parsedDescription = parsed.description
            parsedIntensity = normalizeWorkoutIntensity(parsed.intensity)
            parsedDurationHours = String(format: "%.2g", parsed.durationHours)
            parsedCalories = "\(Int(parsed.caloriesBurned))"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveWorkout() async {
        isSaving = true
        defer { isSaving = false }
        do {
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.addWorkout(
                description: parsedDescription.trimmingCharacters(in: .whitespacesAndNewlines),
                intensity: normalizeWorkoutIntensity(parsedIntensity),
                durationHours: Double(parsedDurationHours) ?? 1,
                caloriesBurned: Double(parsedCalories) ?? 0,
                loggedAt: f.string(from: workoutLogDate)
            )
            resetWorkoutSheet()
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

    private func updateWorkout(_ workout: WorkoutEntry) async {
        isSaving = true
        defer { isSaving = false }
        do {
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.updateWorkout(
                id: workout.id,
                description: editWorkoutDescription.trimmingCharacters(in: .whitespacesAndNewlines),
                intensity: normalizeWorkoutIntensity(editWorkoutIntensity),
                durationHours: Double(editWorkoutDuration) ?? workout.durationHours,
                caloriesBurned: Double(editWorkoutCalories) ?? workout.caloriesBurned,
                loggedAt: f.string(from: editWorkoutDate)
            )
            editingWorkout = nil
            await loadWorkouts()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteWorkout(_ workout: WorkoutEntry) async {
        do {
            try await api.deleteWorkout(id: workout.id)
            editingWorkout = nil
            await loadWorkouts()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func syncWorkouts() async {
        isSyncing = true
        defer { isSyncing = false }
        do {
            let response = try await api.syncWorkouts()
            if let message = response.message, response.syncedCount == 0 {
                errorMessage = message
            }
            await loadWorkouts()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func resetWorkoutSheet() {
        showLogSheet = false
        workoutText = ""
        parsedWorkout = nil
        parsedDescription = ""
        parsedIntensity = "medium"
        parsedDurationHours = ""
        parsedCalories = ""
        workoutLogDate = Date()
    }

    private func scaleWorkoutCalories(newDuration: String) {
        guard editWorkoutBaseDuration > 0,
              let duration = Double(newDuration),
              duration >= 0 else { return }
        editWorkoutCalories = "\(Int(editWorkoutBaseCalories * (duration / editWorkoutBaseDuration)))"
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
        normalizeWorkoutIntensity(intensity).capitalized
    }

    private func intensityColor(_ intensity: String) -> Color {
        switch normalizeWorkoutIntensity(intensity) {
        case "low": return .green
        case "medium": return .yellow
        case "high": return .red
        default: return .cyan
        }
    }

    private func normalizeWorkoutIntensity(_ intensity: String) -> String {
        switch intensity.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "low", "light", "easy":
            return "low"
        case "high", "intense", "hard":
            return "high"
        case "medium", "moderate", "":
            return "medium"
        default:
            return "medium"
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

    private func parseISO(_ iso: String) -> Date {
        let isoFormatter = ISO8601DateFormatter()
        if let date = isoFormatter.date(from: iso) {
            return date
        }

        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
        return f.date(from: iso) ?? Date()
    }
}
