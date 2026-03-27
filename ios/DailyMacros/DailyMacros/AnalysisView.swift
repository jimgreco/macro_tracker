import SwiftUI

struct AnalysisView: View {
    @EnvironmentObject var api: APIClient
    @State private var report: AnalysisReport?
    @State private var isGenerating = false
    @State private var isLoading = true
    @State private var selectedDays = 90
    @State private var errorMessage: String?

    private let dayOptions = [30, 60, 90]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    daysPicker

                    if isLoading {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 200)
                    } else if let report {
                        reportView(report)
                    } else {
                        emptyState
                    }
                }
                .padding()
            }
            .navigationTitle("Analysis")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task { await generateReport() }
                    } label: {
                        if isGenerating {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(isGenerating)
                }
            }
            .task { await loadLatest() }
            .refreshable { await loadLatest() }
            .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: - Days Picker

    private var daysPicker: some View {
        Picker("Window", selection: $selectedDays) {
            ForEach(dayOptions, id: \.self) { d in
                Text("\(d) days").tag(d)
            }
        }
        .pickerStyle(.segmented)
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            ContentUnavailableView("No Analysis Yet", systemImage: "chart.bar", description: Text("Generate your first AI analysis report."))

            Button {
                Task { await generateReport() }
            } label: {
                if isGenerating {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Text("Generate Analysis").font(.headline).frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.cyan)
            .disabled(isGenerating)
        }
    }

    // MARK: - Report View

    private func reportView(_ report: AnalysisReport) -> some View {
        let r = report.report

        return VStack(alignment: .leading, spacing: 16) {
            // Header
            HStack {
                Text("\(report.periodDays)-Day Analysis")
                    .font(.headline)
                Spacer()
                Text(formatDate(report.createdAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            // Summary
            if let summary = r.summary {
                sectionCard("Summary", icon: "doc.text") {
                    Text(summary)
                        .font(.subheadline)
                }
            }

            // Goal Alignment
            if let goal = r.goalAlignment {
                sectionCard("Goal Alignment", icon: "target") {
                    VStack(alignment: .leading, spacing: 8) {
                        if let g = goal.goal {
                            adherenceRow("Goal", value: g.capitalized)
                        }
                        if let status = goal.status {
                            adherenceRow("Status", value: status.replacingOccurrences(of: "_", with: " ").capitalized)
                        }
                        if let score = goal.score {
                            adherenceRow("Score", value: "\(Int(score))%")
                        }
                        if let reason = goal.reason {
                            Text(reason)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            // Data Confidence
            if let dc = r.dataConfidence {
                sectionCard("Data Confidence", icon: "checkmark.shield") {
                    VStack(alignment: .leading, spacing: 4) {
                        if let score = dc.score {
                            adherenceRow("Score", value: "\(Int(score))%")
                        }
                        if let notes = dc.notes {
                            Text(notes)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            // Adherence
            if let adherence = r.adherence {
                sectionCard("Adherence", icon: "chart.line.uptrend.xyaxis") {
                    VStack(spacing: 8) {
                        if let rate = adherence.mealLoggingPct {
                            adherenceRow("Meal Log Rate", value: "\(Int(rate))%")
                        }
                        if let completed = adherence.completedWorkoutCount, let planned = adherence.plannedWorkoutCount {
                            adherenceRow("Workouts", value: "\(completed) / \(planned) days")
                        }
                        if let delta = adherence.calorieTargetDelta {
                            deltaRow("Calorie vs Target", delta: delta, unit: " kcal")
                        }
                        if let delta = adherence.proteinTargetDelta {
                            deltaRow("Protein vs Target", delta: delta, unit: "g")
                        }
                    }
                }
            }

            // Week-over-Week
            if let wow = r.weekOverWeek {
                sectionCard("Week over Week", icon: "arrow.left.arrow.right") {
                    VStack(spacing: 8) {
                        if let cal = wow.avgCaloriesDelta {
                            deltaRow("Avg Calories", delta: cal, unit: " kcal")
                        }
                        if let prot = wow.avgProteinDelta {
                            deltaRow("Avg Protein", delta: prot, unit: "g")
                        }
                        if let wt = wow.weightChangeDelta {
                            deltaRow("Weight", delta: wt, unit: " lbs")
                        }
                        if let wh = wow.workoutHoursDelta {
                            deltaRow("Workout Hours", delta: wh, unit: "h")
                        }
                    }
                }
            }

            // Progress
            if let progress = r.progress, !progress.isEmpty {
                sectionCard("Progress Highlights", icon: "star") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(progress, id: \.self) { item in
                            bulletPoint(item, color: .green)
                        }
                    }
                }
            }

            // Needs Improvement
            if let improvements = r.needsImprovement, !improvements.isEmpty {
                sectionCard("Needs Improvement", icon: "exclamationmark.triangle") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(improvements, id: \.self) { item in
                            bulletPoint(item, color: .orange)
                        }
                    }
                }
            }

            // Nutrition Signals
            if let signals = r.nutritionSignals {
                sectionCard("Nutrition Signals", icon: "leaf") {
                    VStack(spacing: 8) {
                        if let pc = signals.proteinConsistency {
                            adherenceRow("Protein Consistency", value: pc.capitalized)
                        }
                        if let cv = signals.calorieVolatility {
                            adherenceRow("Calorie Volatility", value: "\(Int(cv))%")
                        }
                        if let lne = signals.lateNightEatingPct {
                            adherenceRow("Late Night Eating", value: "\(Int(lne))%")
                        }
                        if let wcd = signals.weekendCalorieDrift {
                            deltaRow("Weekend Cal Drift", delta: wcd, unit: "%")
                        }
                    }
                }
            }

            // Next Week Plan
            if let plan = r.nextWeekPlan, !plan.isEmpty {
                sectionCard("Next Week Plan", icon: "list.bullet.clipboard") {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(plan.enumerated()), id: \.offset) { i, item in
                            HStack(alignment: .top, spacing: 8) {
                                Text("\(i + 1).")
                                    .font(.subheadline.bold())
                                    .foregroundStyle(.cyan)
                                    .frame(width: 20, alignment: .leading)
                                Text(item)
                                    .font(.subheadline)
                            }
                        }
                    }
                }
            }

            // Generate new button
            Button {
                Task { await generateReport() }
            } label: {
                if isGenerating {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Text("Generate New Analysis").font(.headline).frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.cyan)
            .disabled(isGenerating)
        }
    }

    // MARK: - Helpers

    private func sectionCard<Content: View>(_ title: String, icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon)
                .font(.subheadline.bold())
                .foregroundStyle(.cyan)
            content()
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private func adherenceRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label).font(.subheadline).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.subheadline.bold())
        }
    }

    private func deltaRow(_ label: String, delta: Double, unit: String) -> some View {
        HStack {
            Text(label).font(.subheadline).foregroundStyle(.secondary)
            Spacer()
            Text(String(format: "%+.1f%@", delta, unit))
                .font(.subheadline.bold())
                .foregroundStyle(delta > 0 ? .green : delta < 0 ? .red : .secondary)
        }
    }

    private func bulletPoint(_ text: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
                .padding(.top, 6)
            Text(text)
                .font(.subheadline)
        }
    }

    // MARK: - Actions

    private func loadLatest() async {
        isLoading = true
        defer { isLoading = false }
        do {
            report = try await api.getLatestAnalysis()
        } catch {
            // Non-critical on first load
        }
    }

    private func generateReport() async {
        isGenerating = true
        defer { isGenerating = false }
        do {
            report = try await api.generateAnalysis(days: selectedDays)
        } catch {
            errorMessage = error.localizedDescription
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
