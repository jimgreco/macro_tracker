import SwiftUI

struct WorkoutsView: View {
    @EnvironmentObject var api: APIClient
    @State private var workouts: [WorkoutEntry] = []
    @State private var workoutText = ""
    @State private var parsedWorkout: ParseWorkoutResponse?
    @State private var isParsing = false
    @State private var isSaving = false
    @State private var showLogSheet = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    ForEach(workouts) { workout in
                        workoutCard(workout)
                    }

                    if workouts.isEmpty {
                        ContentUnavailableView("No Workouts", systemImage: "figure.run", description: Text("Tap + to log your first workout."))
                    }
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
            .task { await loadWorkouts() }
            .refreshable { await loadWorkouts() }
            .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
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
            let response = try await api.getWorkouts()
            workouts = response.entries
        } catch {
            errorMessage = error.localizedDescription
        }
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
