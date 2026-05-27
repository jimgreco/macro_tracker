import SwiftUI

struct WorkoutsView: View {
    @EnvironmentObject var api: APIClient
    @StateObject private var healthKitSync = HealthKitWorkoutSync()
    @StateObject private var coachDismissals = CoachDismissalStore.shared
    @State private var workouts: [WorkoutEntry] = []
    @State private var dailyCalories: [WorkoutDailyCalories] = []
    @State private var sleepDailyTotals: [SleepDailyTotals] = []
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
    @State private var workoutOffset = 0
    @State private var hasMoreWorkouts = true
    @State private var isLoadingWorkoutPage = false

    // Stats from dashboard targets
    @State private var workoutsTarget: Double = 5
    @State private var caloriesTarget: Double = 0
    @State private var sleepTargetHours: Double = 8

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
    private let logPageSize = 30
    private let logWorkoutSheetTopAnchor = "log-workout-sheet-top"

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 16) {
                    AICoachSlot(
                        dismissals: coachDismissals,
                        suggestions: CoachCandidateEngine.workouts(
                            entries: workouts,
                            dailyCalories: dailyCalories,
                            workoutsTarget: workoutsTarget,
                            caloriesTarget: caloriesTarget,
                            sleepDailyTotals: sleepDailyTotals,
                            sleepTargetHours: sleepTargetHours
                        ),
                        onPrimaryAction: handleCoachAction
                    )

                    scopePicker
                    statsSection
                    workoutOccurrenceSection
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
            .task { await loadWorkouts(reset: true) }
            .refreshable { await loadWorkouts(reset: true) }
            .alert("Workouts", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
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
            Task { await loadWorkouts(reset: true) }
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
                    valueText: String(format: "%.1f", workoutsPerWeek),
                    targetText: workoutsTarget > 0 ? formatWholeNumber(workoutsTarget) : nil,
                    color: .cyan
                )
                statChip(
                    icon: "flame",
                    label: "Cal/Week",
                    valueText: formatWholeNumber(caloriesPerWeek),
                    targetText: caloriesTarget > 0 ? formatWholeNumber(caloriesTarget) : nil,
                    color: .orange
                )
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private func statChip(icon: String, label: String, valueText: String, targetText: String?, color: Color) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon)
                .foregroundStyle(color)

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(valueText)
                    .font(.title3.bold())

                if let targetText {
                    Text("/ \(targetText)")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)

            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    // MARK: - Workout Occurrence

    private struct WorkoutOccurrencePoint: Identifiable {
        let id: String
        let date: Date
        let active: Bool
        let count: Int
        let isToday: Bool
    }

    private var workoutOccurrenceSection: some View {
        let points = workoutOccurrencePoints
        let activeCount = points.filter(\.active).count
        let unit = "days active"

        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(occurrenceTitle)
                    .font(.subheadline.bold())
                Spacer()
                Text("\(activeCount) / \(points.count) \(unit)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            occurrenceDotPlot(points)

            occurrenceLabels(points)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private var occurrenceTitle: String {
        switch scope {
        case "week": return "Workout Days"
        case "month": return "Last 30 Days"
        case "year": return "Last 365 Days"
        default: return "Workout Days"
        }
    }

    private var workoutOccurrencePoints: [WorkoutOccurrencePoint] {
        let calendar = workoutCalendar
        let today = calendar.startOfDay(for: Date())
        let workoutDays = Set(dailyCalories.map(\.day))

        let days = occurrenceDayCount
        return (0..<days).reversed().compactMap { dayOffset in
            guard let day = calendar.date(byAdding: .day, value: -dayOffset, to: today) else {
                return nil
            }

            let isoDay = isoDayString(day)
            return WorkoutOccurrencePoint(
                id: isoDay,
                date: day,
                active: workoutDays.contains(isoDay),
                count: workoutDays.contains(isoDay) ? 1 : 0,
                isToday: calendar.isDate(day, inSameDayAs: today)
            )
        }
    }

    private func occurrenceDotPlot(_ points: [WorkoutOccurrencePoint]) -> some View {
        Group {
            if scope == "week" {
                workoutWeekOccurrenceRow(points)
            } else if scope == "year" {
                workoutYearOccurrenceGrid(points)
            } else {
                Canvas { context, size in
                    guard !points.isEmpty else { return }

                    let padX: CGFloat = 8
                    let plotWidth = max(size.width - padX * 2, 1)
                    let dotY = size.height / 2
                    let spacing = points.count > 1 ? plotWidth / CGFloat(points.count - 1) : plotWidth
                    let maxDotRadius: CGFloat = scope == "month" ? 5 : 4
                    let dotRadius = max(1.6, min(maxDotRadius, spacing / 2 - 1))

                    for (index, point) in points.enumerated() {
                        let x = padX + (points.count > 1 ? CGFloat(index) / CGFloat(points.count - 1) * plotWidth : plotWidth / 2)
                        let rect = CGRect(x: x - dotRadius, y: dotY - dotRadius, width: dotRadius * 2, height: dotRadius * 2)

                        if point.active {
                            var activeContext = context
                            activeContext.addFilter(.shadow(color: Color.green.opacity(0.45), radius: 5))
                            activeContext.fill(Path(ellipseIn: rect), with: .color(.green.opacity(0.95)))
                        } else {
                            let strokeColor: Color = point.isToday ? .cyan.opacity(0.55) : .white.opacity(0.15)
                            context.stroke(Path(ellipseIn: rect), with: .color(strokeColor), lineWidth: point.isToday ? 1.5 : 1)
                        }
                    }
                }
            }
        }
        .frame(height: scope == "year" ? nil : occurrenceDotPlotHeight)
        .accessibilityLabel("\(occurrenceTitle): \(points.filter(\.active).count) active days")
    }

    private func workoutWeekOccurrenceRow(_ points: [WorkoutOccurrencePoint]) -> some View {
        GeometryReader { proxy in
            let columnWidth = max(proxy.size.width / CGFloat(max(points.count, 1)), 1)

            HStack(spacing: 0) {
                ForEach(points) { point in
                    VStack(spacing: 8) {
                        workoutOccurrenceMarker(point)
                        Text(weekdayLabel(for: point.date))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                    .frame(width: columnWidth, height: proxy.size.height, alignment: .center)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .center)
        }
    }

    @ViewBuilder
    private func workoutOccurrenceMarker(_ point: WorkoutOccurrencePoint) -> some View {
        ZStack {
            if point.active {
                Circle()
                    .fill(.green.opacity(0.95))
                    .shadow(color: .green.opacity(0.45), radius: 5)
                    .frame(width: 18, height: 18)
            } else {
                Circle()
                    .stroke(point.isToday ? .cyan.opacity(0.55) : .white.opacity(0.15), lineWidth: point.isToday ? 1.5 : 1)
                    .frame(width: 18, height: 18)
            }
        }
        .frame(height: 30)
    }

    private func workoutYearOccurrenceGrid(_ points: [WorkoutOccurrencePoint]) -> some View {
        let columns = [
            GridItem(.adaptive(minimum: 6, maximum: 6), spacing: 3)
        ]

        return LazyVGrid(columns: columns, alignment: .leading, spacing: 3) {
            ForEach(points) { point in
                Circle()
                    .fill(point.active ? Color.green.opacity(0.95) : Color.clear)
                    .overlay {
                        if !point.active {
                            Circle()
                                .stroke(point.isToday ? .cyan.opacity(0.55) : .white.opacity(0.15), lineWidth: point.isToday ? 1.2 : 1)
                        }
                    }
                    .shadow(color: point.active ? .green.opacity(0.35) : .clear, radius: 3)
                    .frame(width: 5, height: 5)
                    .frame(width: 6, height: 6)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func occurrenceLabels(_ points: [WorkoutOccurrencePoint]) -> some View {
        if scope == "week" || scope == "year" {
            EmptyView()
        } else {
            HStack {
                if let first = points.first {
                    Text(shortDateLabel(for: first.date))
                }
                Spacer()
                Spacer()
                if let last = points.last {
                    Text(shortDateLabel(for: last.date))
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
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

    private var occurrenceDayCount: Int {
        switch scope {
        case "year": return 365
        case "month": return 30
        default: return 7
        }
    }

    private var occurrenceDotPlotHeight: CGFloat {
        switch scope {
        case "week": return 58
        case "year": return 98
        default: return 42
        }
    }

    // MARK: - Workouts List

    private var workoutsList: some View {
        VStack(spacing: 12) {
            ForEach(workouts) { workout in
                workoutCard(workout)
                    .onAppear {
                        loadMoreWorkoutsIfNeeded(current: workout)
                    }
            }

            if workouts.isEmpty {
                if isLoadingWorkoutPage {
                    ProgressView("Loading workouts...")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                } else {
                    ContentUnavailableView("No Workouts", systemImage: "figure.run", description: Text("Tap + to log your first workout."))
                }
            } else if isLoadingWorkoutPage {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
        }
    }

    // MARK: - Workout Card

    private func workoutCard(_ workout: WorkoutEntry) -> some View {
        SwipeToDeleteRow {
            Task { await deleteWorkout(workout) }
        } content: {
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
        }
    }

    // MARK: - Edit Targets Sheet

    private var editTargetsSheet: some View {
        let canSave = canSaveWorkoutTargets

        return NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Workouts per Week")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("Workouts/week", text: $editWorkoutsPerWeek)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.numberPad)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Calories Burned per Week")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("Cal/week", text: $editCaloriesPerWeek)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.numberPad)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        Task { await saveWorkoutTargets() }
                    } label: {
                        Text("Save Targets").font(.headline).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(canSave ? .cyan : .gray)
                    .disabled(!canSave)

                    Spacer(minLength: 0)
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Workout Targets")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showEditTargets = false }
                }
            }
        }
        .presentationDetents([.medium])
        .presentationContentInteraction(.scrolls)
    }

    private var canSaveWorkoutTargets: Bool {
        guard let workouts = Double(editWorkoutsPerWeek.trimmingCharacters(in: .whitespacesAndNewlines)), workouts > 0 else {
            return false
        }
        guard let calories = Double(editCaloriesPerWeek.trimmingCharacters(in: .whitespacesAndNewlines)), calories >= 0 else {
            return false
        }

        return abs(workouts - workoutsTarget) > 0.001 || abs(calories - caloriesTarget) > 0.001
    }

    // MARK: - Log Workout Sheet

    private var logWorkoutSheet: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    Color.clear
                        .frame(height: 1)
                        .id(logWorkoutSheetTopAnchor)

                    VStack(spacing: 16) {
                        if let parsed = parsedWorkout {
                            parsedWorkoutView(parsed)
                        } else {
                            workoutInputView
                        }
                    }
                    .padding()
                    .onChange(of: parsedWorkout != nil) { _, _ in
                        resetLogWorkoutSheetScroll(proxy)
                    }
                }
                .scrollDismissesKeyboard(.interactively)
                .navigationTitle(parsedWorkout != nil ? "Confirm Workout" : "Log Workout")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { resetWorkoutSheet() }
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationContentInteraction(.scrolls)
    }

    private func resetLogWorkoutSheetScroll(_ proxy: ScrollViewProxy) {
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.16)) {
                proxy.scrollTo(logWorkoutSheetTopAnchor, anchor: .top)
            }
        }
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

                VStack(alignment: .leading, spacing: 4) {
                    Text("Intensity")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    Picker("Intensity", selection: $parsedIntensity) {
                        ForEach(intensityOptions, id: \.self) { option in
                            Text(option.capitalized).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                }

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
        editWorkoutDuration = workoutDurationEditText(for: workout)
        editWorkoutCalories = workoutCaloriesEditText(for: workout)
        editWorkoutDate = parseISO(workout.loggedAt)
        editWorkoutBaseDuration = workout.durationHours
        editWorkoutBaseCalories = workout.caloriesBurned
        editingWorkout = workout
    }

    private func editWorkoutSheet(_ workout: WorkoutEntry) -> some View {
        let canSave = canSaveWorkoutEdit(workout)

        return NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    DatePicker("Logged At", selection: $editWorkoutDate)
                        .datePickerStyle(.compact)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Workout Name")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("Workout Name", text: $editWorkoutDescription)
                            .textFieldStyle(.roundedBorder)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Intensity")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        Picker("Intensity", selection: $editWorkoutIntensity) {
                            ForEach(intensityOptions, id: \.self) { option in
                                Text(option.capitalized).tag(option)
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

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
                        .frame(maxWidth: .infinity, alignment: .leading)

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Calories")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            TextField("Calories", text: $editWorkoutCalories)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.numberPad)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    HStack(spacing: 12) {
                        Button(role: .destructive) {
                            Task { await deleteWorkout(workout) }
                        } label: {
                            Text("Delete").font(.headline).frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)

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
                        .tint(canSave ? .cyan : .gray)
                        .disabled(!canSave)
                    }
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Edit Workout")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editingWorkout = nil }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationContentInteraction(.scrolls)
    }

    private func canSaveWorkoutEdit(_ workout: WorkoutEntry) -> Bool {
        guard !isSaving else { return false }

        let description = editWorkoutDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !description.isEmpty else { return false }
        guard let duration = Double(editWorkoutDuration), duration > 0 else { return false }
        guard let calories = Double(editWorkoutCalories), calories >= 0 else { return false }
        let baselineDuration = Double(workoutDurationEditText(for: workout)) ?? workout.durationHours
        let baselineCalories = Double(workoutCaloriesEditText(for: workout)) ?? workout.caloriesBurned

        let descriptionChanged = description != workout.description.trimmingCharacters(in: .whitespacesAndNewlines)
        let intensityChanged = normalizeWorkoutIntensity(editWorkoutIntensity) != normalizeWorkoutIntensity(workout.intensity)
        let durationChanged = abs(duration - baselineDuration) > 0.001
        let caloriesChanged = abs(calories - baselineCalories) > 0.5
        let loggedAtChanged = !isSameDisplayedMinute(editWorkoutDate, parseISO(workout.loggedAt))

        return descriptionChanged || intensityChanged || durationChanged || caloriesChanged || loggedAtChanged
    }

    private func workoutDurationEditText(for workout: WorkoutEntry) -> String {
        String(format: "%.2g", workout.durationHours)
    }

    private func workoutCaloriesEditText(for workout: WorkoutEntry) -> String {
        "\(Int(workout.caloriesBurned))"
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

    private func handleCoachAction(_ action: CoachAction) {
        switch action.type {
        case .openLogWorkout:
            resetWorkoutSheet()
            workoutLogDate = Date()
            showLogSheet = true
        case .logWorkoutEntry:
            guard let workout = action.workout else { return }
            workoutLogDate = Date()
            Task { await logCoachWorkout(workout) }
        case .editTargets:
            editWorkoutsPerWeek = "\(Int(workoutsTarget))"
            editCaloriesPerWeek = "\(Int(caloriesTarget))"
            showEditTargets = true
        case .openLogMeal, .openQuickAdd, .logMealItem, .openLogWeight, .openLogSleep:
            break
        }
    }

    private func logCoachWorkout(_ workout: CoachWorkoutPayload) async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }

        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(identifier: "America/New_York")

        do {
            try await api.addWorkout(
                description: workout.description,
                intensity: normalizeWorkoutIntensity(workout.intensity),
                durationHours: workout.durationHours,
                caloriesBurned: workout.caloriesBurned,
                loggedAt: formatter.string(from: workoutLogDate)
            )
            triggerHealthKitExport()
            await loadWorkouts(reset: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadWorkouts(reset: Bool = true) async {
        guard !isLoadingWorkoutPage else { return }
        isLoadingWorkoutPage = true
        defer { isLoadingWorkoutPage = false }

        let offset = reset ? 0 : workoutOffset

        do {
            let response = try await api.getWorkouts(limit: logPageSize, offset: offset, scope: scope)
            if reset {
                workouts = response.entries
            } else {
                appendUniqueWorkouts(response.entries)
            }
            dailyCalories = response.dailyCalories
            workoutOffset = offset + response.entries.count
            hasMoreWorkouts = response.entries.count == logPageSize
        } catch {
            errorMessage = error.localizedDescription
        }

        guard reset else { return }
        await loadWorkoutTargets()
        await loadWorkoutRecoveryContext()
    }

    private func loadWorkoutTargets() async {
        do {
            let dash = try await api.getDashboard(limit: 1)
            workoutsTarget = dash.targets.workouts
            caloriesTarget = dash.targets.workoutCalories ?? 0
            sleepTargetHours = dash.targets.sleepHours ?? sleepTargetHours
        } catch { /* non-critical */ }
    }

    private func loadWorkoutRecoveryContext() async {
        do {
            let response = try await api.getSleepEntries(scope: "week", limit: 1)
            sleepDailyTotals = response.dailyTotals
        } catch { /* non-critical */ }
    }

    private func appendUniqueWorkouts(_ entries: [WorkoutEntry]) {
        let existingIds = Set(workouts.map(\.id))
        workouts.append(contentsOf: entries.filter { !existingIds.contains($0.id) })
    }

    private func loadMoreWorkoutsIfNeeded(current workout: WorkoutEntry) {
        guard hasMoreWorkouts, workout.id == workouts.last?.id else { return }
        Task { await loadWorkouts(reset: false) }
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
            triggerHealthKitExport()
            await loadWorkouts(reset: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func triggerHealthKitExport() {
        Task {
            _ = try? await healthKitSync.syncRecentWorkouts(api: api)
        }
    }

    private func saveWorkoutTargets() async {
        guard canSaveWorkoutTargets else { return }
        do {
            if let w = Double(editWorkoutsPerWeek) {
                try await api.setMacroTarget(macro: "workouts", target: w)
            }
            if let c = Double(editCaloriesPerWeek) {
                try await api.setMacroTarget(macro: "workout_calories", target: c)
            }
            showEditTargets = false
            await loadWorkouts(reset: true)
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
            await loadWorkouts(reset: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteWorkout(_ workout: WorkoutEntry) async {
        do {
            try await api.deleteWorkout(id: workout.id)
            editingWorkout = nil
            await loadWorkouts(reset: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func syncWorkouts() async {
        isSyncing = true
        defer { isSyncing = false }

        var syncMessages: [String] = []
        var workoutPlannerMessage: String?
        var workoutPlannerError: String?

        do {
            let response = try await api.syncWorkouts()
            if response.syncedCount > 0 {
                syncMessages.append("Workout Planner: synced \(response.syncedCount) workout(s).")
            } else if let message = response.message {
                workoutPlannerMessage = "Workout Planner: \(message)"
            }
        } catch {
            workoutPlannerError = "Workout Planner: \(error.localizedDescription)"
        }

        do {
            let healthResult = try await healthKitSync.syncRecentWorkouts(api: api)
            if healthResult.importedCount > 0 || healthResult.exportedCount > 0 {
                syncMessages.append("Apple Health: imported \(healthResult.importedCount), wrote \(healthResult.exportedCount).")
            } else {
                syncMessages.append("Apple Health: no new workouts from the last 30 days.")
            }
        } catch {
            syncMessages.append("Apple Health: \(error.localizedDescription)")
        }

        if syncMessages.count == 1,
           syncMessages.first == "Apple Health: no new workouts from the last 30 days.",
           let workoutPlannerMessage {
            syncMessages.insert(workoutPlannerMessage, at: 0)
        }

        if let workoutPlannerError,
           !workoutPlannerError.contains("Syncing requires a Google account") {
            syncMessages.append(workoutPlannerError)
        }

        if !syncMessages.isEmpty {
            errorMessage = syncMessages.joined(separator: "\n")
        }

        await loadWorkouts(reset: true)
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

    private var workoutCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York") ?? .current
        return calendar
    }

    private func isoDayString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = workoutCalendar
        formatter.timeZone = workoutCalendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private func weekdayLabel(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = workoutCalendar
        formatter.timeZone = workoutCalendar.timeZone
        formatter.dateFormat = "E"
        return String(formatter.string(from: date).prefix(2))
    }

    private func shortDateLabel(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = workoutCalendar
        formatter.timeZone = workoutCalendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMM d")
        return formatter.string(from: date)
    }

    private func formatWholeNumber(_ value: Double) -> String {
        Int(value.rounded()).formatted(.number.grouping(.automatic))
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

    private func isSameDisplayedMinute(_ lhs: Date, _ rhs: Date) -> Bool {
        Calendar.current.compare(lhs, to: rhs, toGranularity: .minute) == .orderedSame
    }
}
