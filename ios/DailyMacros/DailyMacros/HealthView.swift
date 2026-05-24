import SwiftUI

struct HealthView: View {
    @EnvironmentObject var api: APIClient
    @EnvironmentObject var auth: AuthManager

    // Sexual activity state
    @State private var healthEntries: [HealthEntry] = []
    @State private var dailyTypes: [HealthDailyTypes] = []
    @State private var healthScope = "week"
    @State private var showLogHealth = false
    @State private var selectedActivityType = "masturbation"
    @State private var healthLogDate = Date()
    @State private var isSavingHealth = false
    @State private var healthOffset = 0
    @State private var hasMoreHealthEntries = true
    @State private var isLoadingHealthPage = false

    // Sleep state
    @State private var sleepEntries: [SleepEntry] = []
    @State private var sleepDailyTotals: [SleepDailyTotals] = []
    @State private var sleepScope = "week"
    @State private var showLogSleep = false
    @State private var sleepHours = "7.5"
    @State private var sleepWakeUps = "0"
    @State private var sleepLogDate = Date()
    @State private var isSavingSleep = false
    @State private var sleepTargetHours: Double = 8
    @State private var showEditSleepTargets = false
    @State private var editSleepTargetHours = "8"
    @State private var isSavingSleepTarget = false
    @State private var sleepOffset = 0
    @State private var hasMoreSleepEntries = true
    @State private var isLoadingSleepPage = false

    // Edit state
    @State private var editingHealth: HealthEntry?
    @State private var editingSleep: SleepEntry?
    @State private var editHealthType = "masturbation"
    @State private var editHealthDate = Date()
    @State private var editSleepHours = ""
    @State private var editSleepWakeUps = ""
    @State private var editSleepDate = Date()

    @State private var errorMessage: String?

    private let activityTypes = ["masturbation", "oral sex", "vaginal sex", "other"]
    private let scopes = ["week", "month", "year"]
    private let logPageSize = 30

    private var sexualActivityEnabled: Bool {
        auth.user?.sexualActivityEnabled == true
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 24) {
                    sleepSection
                    if sexualActivityEnabled {
                        sexualActivitySection
                    }
                }
                .padding()
            }
            .navigationTitle("Health")
            .sheet(isPresented: $showLogHealth) { logHealthSheet }
            .sheet(isPresented: $showLogSleep) { logSleepSheet }
            .sheet(isPresented: $showEditSleepTargets) { editSleepTargetsSheet }
            .sheet(item: $editingHealth) { entry in editHealthSheet(entry) }
            .sheet(item: $editingSleep) { entry in editSleepSheet(entry) }
            .task {
                await refreshAccountFeatures()
                if sexualActivityEnabled {
                    await loadHealth(reset: true)
                }
                await loadSleep(reset: true)
            }
            .refreshable {
                await refreshAccountFeatures()
                if sexualActivityEnabled {
                    await loadHealth(reset: true)
                }
                await loadSleep(reset: true)
            }
            .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: - Sexual Activity Section

    private var sexualActivitySection: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Sexual Activity")
                    .font(.title3.bold())
                Spacer()
                Button { showLogHealth = true } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.title3)
                }
            }

            Picker("Scope", selection: $healthScope) {
                ForEach(scopes, id: \.self) { s in
                    Text(s.capitalized).tag(s)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: healthScope) { _, _ in
                Task { await loadHealth(reset: true) }
            }

            activityOccurrenceSection

            healthEntriesList
        }
    }

    private struct ActivityOccurrencePoint: Identifiable {
        let id: String
        let date: Date
        let types: [String]
        let activeDayCount: Int
        let isToday: Bool

        var active: Bool { !types.isEmpty }
    }

    private var activityOccurrenceSection: some View {
        let points = activityOccurrencePoints
        let activeCount = points.filter(\.active).count
        let unit = healthScope == "year" ? "weeks active" : "days active"

        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(activityOccurrenceTitle)
                    .font(.subheadline.bold())
                Spacer()
                Text("\(activeCount) / \(points.count) \(unit)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            activityOccurrenceDotPlot(points)

            activityOccurrenceLabels(points)

            activityLegend
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private var activityOccurrenceTitle: String {
        switch healthScope {
        case "week": return "Activity Days"
        case "month": return "Last 30 Days"
        case "year": return "Last 52 Weeks"
        default: return "Activity Days"
        }
    }

    private var activityOccurrencePoints: [ActivityOccurrencePoint] {
        let calendar = healthCalendar
        let today = calendar.startOfDay(for: Date())
        let typesByDay = Dictionary(uniqueKeysWithValues: dailyTypes.map { ($0.day, orderedActivityTypes($0.types)) })

        if healthScope == "year" {
            return (0..<52).reversed().compactMap { weekOffset in
                guard let weekEnd = calendar.date(byAdding: .day, value: -weekOffset * 7, to: today),
                      let weekStart = calendar.date(byAdding: .day, value: -6, to: weekEnd) else {
                    return nil
                }

                var weekTypes: [String] = []
                var activeDays = 0
                for dayOffset in 0...6 {
                    guard let day = calendar.date(byAdding: .day, value: dayOffset, to: weekStart) else {
                        continue
                    }
                    let isoDay = isoDayString(day)
                    if let types = typesByDay[isoDay], !types.isEmpty {
                        activeDays += 1
                        weekTypes.append(contentsOf: types)
                    }
                }

                return ActivityOccurrencePoint(
                    id: isoDayString(weekStart),
                    date: weekStart,
                    types: orderedActivityTypes(weekTypes),
                    activeDayCount: activeDays,
                    isToday: false
                )
            }
        }

        let days = healthScope == "month" ? 30 : 7
        return (0..<days).reversed().compactMap { dayOffset in
            guard let day = calendar.date(byAdding: .day, value: -dayOffset, to: today) else {
                return nil
            }

            let isoDay = isoDayString(day)
            let types = typesByDay[isoDay] ?? []
            return ActivityOccurrencePoint(
                id: isoDay,
                date: day,
                types: types,
                activeDayCount: types.isEmpty ? 0 : 1,
                isToday: calendar.isDate(day, inSameDayAs: today)
            )
        }
    }

    private func activityOccurrenceDotPlot(_ points: [ActivityOccurrencePoint]) -> some View {
        Group {
            if healthScope == "week" {
                activityWeekOccurrenceRow(points)
            } else {
                Canvas { context, size in
                    drawActivityOccurrenceCanvas(points, context: context, size: size)
                }
            }
        }
        .frame(height: healthScope == "week" ? 58 : 42)
        .accessibilityLabel("\(activityOccurrenceTitle): \(points.filter(\.active).count) active \(healthScope == "year" ? "weeks" : "days")")
    }

    private func activityWeekOccurrenceRow(_ points: [ActivityOccurrencePoint]) -> some View {
        GeometryReader { proxy in
            let columnWidth = max(proxy.size.width / CGFloat(max(points.count, 1)), 1)

            HStack(spacing: 0) {
                ForEach(points) { point in
                    VStack(spacing: 8) {
                        activityOccurrenceMarker(point)
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
    private func activityOccurrenceMarker(_ point: ActivityOccurrencePoint) -> some View {
        let types = orderedActivityTypes(point.types)

        ZStack {
            if point.active {
                if types.count == 1, let type = types.first {
                    Circle()
                        .fill(activityColor(type))
                        .shadow(color: activityColor(type).opacity(0.45), radius: 5)
                        .frame(width: 18, height: 18)
                } else {
                    VStack(spacing: 3) {
                        ForEach(Array(types.prefix(4)), id: \.self) { type in
                            Circle()
                                .fill(activityColor(type))
                                .frame(width: 7, height: 7)
                        }
                    }
                    .shadow(color: .white.opacity(0.12), radius: 4)
                }
            } else {
                Circle()
                    .stroke(point.isToday ? .cyan.opacity(0.55) : .white.opacity(0.15), lineWidth: point.isToday ? 1.5 : 1)
                    .frame(width: 18, height: 18)
            }
        }
        .frame(height: 30)
    }

    private func drawActivityOccurrenceCanvas(_ points: [ActivityOccurrencePoint], context: GraphicsContext, size: CGSize) {
        guard !points.isEmpty else { return }

        let padX: CGFloat = 8
        let plotWidth = max(size.width - padX * 2, 1)
        let dotY = size.height / 2
        let spacing = points.count > 1 ? plotWidth / CGFloat(points.count - 1) : plotWidth
        let maxDotRadius: CGFloat = healthScope == "month" ? 5 : 4
        let dotRadius = max(1.6, min(maxDotRadius, spacing / 2 - 1))

        for (index, point) in points.enumerated() {
            let x = padX + (points.count > 1 ? CGFloat(index) / CGFloat(points.count - 1) * plotWidth : plotWidth / 2)
            if point.active {
                let types = orderedActivityTypes(point.types)
                let type = types.first ?? "other"
                let rect = CGRect(x: x - dotRadius, y: dotY - dotRadius, width: dotRadius * 2, height: dotRadius * 2)
                var activeContext = context
                activeContext.addFilter(.shadow(color: activityColor(type).opacity(0.45), radius: 5))
                activeContext.fill(Path(ellipseIn: rect), with: .color(activityColor(type)))
            } else {
                let rect = CGRect(x: x - dotRadius, y: dotY - dotRadius, width: dotRadius * 2, height: dotRadius * 2)
                let strokeColor: Color = point.isToday ? .cyan.opacity(0.55) : .white.opacity(0.15)
                context.stroke(Path(ellipseIn: rect), with: .color(strokeColor), lineWidth: point.isToday ? 1.5 : 1)
            }
        }
    }

    @ViewBuilder
    private func activityOccurrenceLabels(_ points: [ActivityOccurrencePoint]) -> some View {
        if healthScope == "week" {
            EmptyView()
        } else {
            HStack {
                if let first = points.first {
                    Text(shortDateLabel(for: first.date))
                }
                Spacer()
                if healthScope == "year" {
                    Text("weekly")
                }
                Spacer()
                if let last = points.last {
                    Text(shortDateLabel(for: last.date))
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
    }

    private var activityLegend: some View {
        HStack(spacing: 12) {
            ForEach(activityTypes, id: \.self) { type in
                HStack(spacing: 4) {
                    Circle()
                        .fill(activityColor(type))
                        .frame(width: 8, height: 8)
                    Text(type.capitalized)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private var healthEntriesList: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Recent Entries")
                    .font(.subheadline.bold())
                Spacer()
            }

            if healthEntries.isEmpty {
                if isLoadingHealthPage {
                    ProgressView("Loading entries...")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                } else {
                    ContentUnavailableView("No Entries", systemImage: "heart", description: Text("Tap + to log activity."))
                }
            } else {
                ForEach(healthEntries) { entry in
                    SwipeToDeleteRow {
                        Task { await deleteHealth(entry) }
                    } content: {
                        healthEntryCard(entry)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                editHealthType = entry.type
                                editHealthDate = parseISO(entry.loggedAt)
                                editingHealth = entry
                            }
                    }
                    .onAppear {
                        loadMoreHealthIfNeeded(current: entry)
                    }
                }

                if isLoadingHealthPage {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
            }
        }
    }

    private func healthEntryCard(_ entry: HealthEntry) -> some View {
        HStack {
            Circle()
                .fill(activityColor(entry.type))
                .frame(width: 10, height: 10)
            Text(entry.type.capitalized)
                .font(.subheadline.bold())
            Spacer()
            Text(formatDate(entry.loggedAt))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(10)
    }

    // MARK: - Sleep Section

    private var sleepSection: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Sleep")
                    .font(.title3.bold())
                Spacer()
                Button("edit targets") {
                    editSleepTargetHours = formatTargetHours(sleepTargetHours)
                    showEditSleepTargets = true
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(.cyan)
                Button { showLogSleep = true } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.title3)
                }
            }

            Picker("Scope", selection: $sleepScope) {
                ForEach(scopes, id: \.self) { s in
                    Text(s.capitalized).tag(s)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: sleepScope) { _, _ in
                Task { await loadSleep(reset: true) }
            }

            sleepChart

            sleepEntriesList
        }
    }

    private var sleepChart: some View {
        VStack(spacing: 4) {
            if sleepDailyTotals.isEmpty {
                Text("No data for this period")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(height: 120)
            } else {
                HStack(alignment: .center, spacing: 4) {
                    Text("Hours")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(-90))
                        .fixedSize()
                        .frame(width: 18, height: 150)

                    Canvas { context, size in
                        drawSleepChart(context: context, size: size)
                    }
                    .frame(height: 150)
                }
                .accessibilityLabel("Sleep chart with dates on the horizontal axis and hours on the vertical axis")

                Text("Date")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }

            if !sleepDailyTotals.isEmpty {
                HStack(spacing: 16) {
                    let avg = sleepDailyTotals.reduce(0.0) { $0 + $1.totalHours } / Double(sleepDailyTotals.count)
                    HStack(spacing: 4) {
                        Rectangle().fill(.white.opacity(0.5)).frame(width: 16, height: 2)
                        Text(String(format: "Avg: %.1fh", avg))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    HStack(spacing: 4) {
                        Rectangle().fill(.green.opacity(0.5)).frame(width: 16, height: 2)
                        Text("Target: \(formatTargetHours(sleepTargetHours))h")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private func drawSleepChart(context: GraphicsContext, size: CGSize) {
        let data = sleepDailyTotals.sorted { $0.day < $1.day }
        guard !data.isEmpty else { return }

        let maxHours = max(data.map(\.totalHours).max() ?? 10, sleepTargetHours, 10)
        let minHours: Double = 0
        let span = max(maxHours - minHours, 1)
        let topPadding: CGFloat = 10
        let rightPadding: CGFloat = 8
        let bottomPadding: CGFloat = 30
        let leftPadding: CGFloat = 42
        let chartW = max(size.width - leftPadding - rightPadding, 1)
        let chartH = max(size.height - topPadding - bottomPadding, 1)
        let tickCount = 4

        func xPos(_ index: Int) -> CGFloat {
            guard data.count > 1 else {
                return leftPadding + chartW / 2
            }
            return leftPadding + CGFloat(index) / CGFloat(data.count - 1) * chartW
        }

        func yPos(_ hours: Double) -> CGFloat {
            let ratio = (hours - minHours) / span
            return topPadding + chartH * (1 - CGFloat(ratio))
        }

        for tickIndex in 0...tickCount {
            let ratio = CGFloat(tickIndex) / CGFloat(tickCount)
            let y = topPadding + ratio * chartH
            let tickValue = maxHours - Double(tickIndex) * span / Double(tickCount)

            var gridPath = Path()
            gridPath.move(to: CGPoint(x: leftPadding, y: y))
            gridPath.addLine(to: CGPoint(x: leftPadding + chartW, y: y))
            context.stroke(gridPath, with: .color(.white.opacity(0.07)), lineWidth: 1)

            context.draw(
                Text(formatSleepAxisValue(tickValue)).font(.caption2).foregroundColor(.secondary),
                at: CGPoint(x: leftPadding - 6, y: y),
                anchor: .trailing
            )
        }

        var axisPath = Path()
        axisPath.move(to: CGPoint(x: leftPadding, y: topPadding))
        axisPath.addLine(to: CGPoint(x: leftPadding, y: topPadding + chartH))
        axisPath.addLine(to: CGPoint(x: leftPadding + chartW, y: topPadding + chartH))
        context.stroke(axisPath, with: .color(.white.opacity(0.15)), lineWidth: 1)

        // Target line
        let targetY = yPos(sleepTargetHours)
        var targetPath = Path()
        targetPath.move(to: CGPoint(x: leftPadding, y: targetY))
        targetPath.addLine(to: CGPoint(x: leftPadding + chartW, y: targetY))
        context.stroke(targetPath, with: .color(.green.opacity(0.4)), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))

        // Average line
        let avg = data.reduce(0.0) { $0 + $1.totalHours } / Double(data.count)
        let avgY = yPos(avg)
        var avgPath = Path()
        avgPath.move(to: CGPoint(x: leftPadding, y: avgY))
        avgPath.addLine(to: CGPoint(x: leftPadding + chartW, y: avgY))
        context.stroke(avgPath, with: .color(.white.opacity(0.3)), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))

        // Data line
        var linePath = Path()
        for (i, d) in data.enumerated() {
            let x = xPos(i)
            let y = yPos(d.totalHours)
            if i == 0 {
                linePath.move(to: CGPoint(x: x, y: y))
            } else {
                linePath.addLine(to: CGPoint(x: x, y: y))
            }
        }
        context.stroke(linePath, with: .color(.cyan), lineWidth: 2)

        // Dots
        for (i, d) in data.enumerated() {
            let x = xPos(i)
            let y = yPos(d.totalHours)
            let rect = CGRect(x: x - 3, y: y - 3, width: 6, height: 6)
            context.fill(Path(ellipseIn: rect), with: .color(.cyan))
        }

        let labelIndices = chartAxisLabelIndices(count: data.count, desired: 4)
        for (position, index) in labelIndices.enumerated() {
            let anchor: UnitPoint
            if position == 0 {
                anchor = .topLeading
            } else if position == labelIndices.count - 1 {
                anchor = .topTrailing
            } else {
                anchor = .top
            }

            context.draw(
                Text(sleepChartDateLabel(data[index].day)).font(.caption2).foregroundColor(.secondary),
                at: CGPoint(x: xPos(index), y: topPadding + chartH + 8),
                anchor: anchor
            )
        }
    }

    private func chartAxisLabelIndices(count: Int, desired: Int) -> [Int] {
        guard count > 0 else { return [] }
        guard count > desired else { return Array(0..<count) }

        return (0..<desired).reduce(into: [Int]()) { indices, labelIndex in
            let index = Int((Double(labelIndex) * Double(count - 1) / Double(desired - 1)).rounded())
            if indices.last != index {
                indices.append(index)
            }
        }
    }

    private func formatSleepAxisValue(_ value: Double) -> String {
        let rounded = value.rounded()
        if abs(value - rounded) < 0.05 {
            return "\(Int(rounded))h"
        }
        return String(format: "%.1fh", value)
    }

    private func sleepChartDateLabel(_ day: String) -> String {
        let inputFormatter = DateFormatter()
        inputFormatter.calendar = healthCalendar
        inputFormatter.timeZone = healthCalendar.timeZone
        inputFormatter.dateFormat = "yyyy-MM-dd"

        guard let date = inputFormatter.date(from: day) else {
            return String(day.prefix(5))
        }

        let outputFormatter = DateFormatter()
        outputFormatter.calendar = healthCalendar
        outputFormatter.timeZone = healthCalendar.timeZone
        outputFormatter.setLocalizedDateFormatFromTemplate("M/d")
        return outputFormatter.string(from: date)
    }

    private var sleepEntriesList: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Sleep Log")
                    .font(.subheadline.bold())
                Spacer()
            }

            if sleepEntries.isEmpty {
                if isLoadingSleepPage {
                    ProgressView("Loading sleep...")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                } else {
                    ContentUnavailableView("No Sleep Data", systemImage: "moon.zzz", description: Text("Tap + to log sleep."))
                }
            } else {
                ForEach(sleepEntries) { entry in
                    SwipeToDeleteRow {
                        Task { await deleteSleep(entry) }
                    } content: {
                        sleepEntryCard(entry)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                editSleepHours = String(format: "%.2g", entry.durationHours)
                                editSleepWakeUps = "\(entry.wakeUps)"
                                editSleepDate = parseISO(entry.loggedAt)
                                editingSleep = entry
                            }
                    }
                    .onAppear {
                        loadMoreSleepIfNeeded(current: entry)
                    }
                }

                if isLoadingSleepPage {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                }
            }
        }
    }

    private func sleepEntryCard(_ entry: SleepEntry) -> some View {
        HStack {
            Image(systemName: "moon.zzz.fill")
                .foregroundStyle(.indigo)
            VStack(alignment: .leading, spacing: 2) {
                Text(String(format: "%.1f hours", entry.durationHours))
                    .font(.subheadline.bold())
                if entry.wakeUps > 0 {
                    Text("\(entry.wakeUps) wake-up\(entry.wakeUps == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(formatDate(entry.loggedAt))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(10)
    }

    // MARK: - Log Health Sheet

    private var logHealthSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Activity Type")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Picker("Type", selection: $selectedActivityType) {
                            ForEach(activityTypes, id: \.self) { type in
                                Text(type.capitalized).tag(type)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Date & Time")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        DatePicker("", selection: $healthLogDate)
                            .labelsHidden()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        Task { await saveHealthEntry() }
                    } label: {
                        if isSavingHealth {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Log Entry").font(.headline).frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.cyan)
                    .disabled(isSavingHealth)

                    Spacer(minLength: 0)
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Log Activity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showLogHealth = false }
                }
            }
        }
        .presentationDetents([.medium])
        .presentationContentInteraction(.scrolls)
    }

    // MARK: - Log Sleep Sheet

    private var logSleepSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Hours")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            TextField("7.5", text: $sleepHours)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.decimalPad)
                                .frame(maxWidth: .infinity)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Wake-ups")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            TextField("0", text: $sleepWakeUps)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.numberPad)
                                .frame(maxWidth: .infinity)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Date & Time")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        DatePicker("", selection: $sleepLogDate)
                            .labelsHidden()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        Task { await saveSleepEntry() }
                    } label: {
                        if isSavingSleep {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Log Sleep").font(.headline).frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.cyan)
                    .disabled(isSavingSleep)

                    Spacer(minLength: 0)
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Log Sleep")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showLogSleep = false }
                }
            }
        }
        .presentationDetents([.medium])
        .presentationContentInteraction(.scrolls)
    }

    // MARK: - Edit Sleep Targets Sheet

    private var editSleepTargetsSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Target Hours")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        TextField("8", text: $editSleepTargetHours)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.decimalPad)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        Task { await saveSleepTargets() }
                    } label: {
                        if isSavingSleepTarget {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Save").font(.headline).frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.cyan)
                    .disabled(isSavingSleepTarget)

                    Spacer(minLength: 0)
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Edit Targets")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showEditSleepTargets = false }
                }
            }
        }
        .presentationDetents([.height(220), .medium])
        .presentationContentInteraction(.scrolls)
    }

    // MARK: - Edit Health Sheet

    private func editHealthSheet(_ entry: HealthEntry) -> some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Activity Type")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Picker("Type", selection: $editHealthType) {
                            ForEach(activityTypes, id: \.self) { type in
                                Text(type.capitalized).tag(type)
                            }
                        }
                        .pickerStyle(.menu)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Date & Time")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        DatePicker("", selection: $editHealthDate)
                            .labelsHidden()
                    }

                    Button {
                        Task { await updateHealth(entry) }
                    } label: {
                        Text("Save").font(.headline).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.cyan)

                    Button(role: .destructive) {
                        Task { await deleteHealth(entry) }
                    } label: {
                        Text("Delete Entry").font(.headline).frame(maxWidth: .infinity)
                    }

                    Spacer(minLength: 0)
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Edit Activity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editingHealth = nil }
                }
            }
        }
        .presentationDetents([.medium])
        .presentationContentInteraction(.scrolls)
    }

    // MARK: - Edit Sleep Sheet

    private func editSleepSheet(_ entry: SleepEntry) -> some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Hours")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            TextField("7.5", text: $editSleepHours)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.decimalPad)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Wake-ups")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            TextField("0", text: $editSleepWakeUps)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.numberPad)
                        }
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Date & Time")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        DatePicker("", selection: $editSleepDate)
                            .labelsHidden()
                    }

                    Button {
                        Task { await updateSleep(entry) }
                    } label: {
                        Text("Save").font(.headline).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.cyan)

                    Button(role: .destructive) {
                        Task { await deleteSleep(entry) }
                    } label: {
                        Text("Delete Entry").font(.headline).frame(maxWidth: .infinity)
                    }

                    Spacer(minLength: 0)
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Edit Sleep")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { editingSleep = nil }
                }
            }
        }
        .presentationDetents([.medium])
        .presentationContentInteraction(.scrolls)
    }

    // MARK: - Actions

    private func refreshAccountFeatures() async {
        do {
            if let user = try await api.getMe() {
                auth.user = user
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadHealth(reset: Bool = true) async {
        guard sexualActivityEnabled else {
            healthEntries = []
            dailyTypes = []
            healthOffset = 0
            hasMoreHealthEntries = false
            return
        }
        guard !isLoadingHealthPage else { return }
        isLoadingHealthPage = true
        defer { isLoadingHealthPage = false }

        let offset = reset ? 0 : healthOffset

        do {
            let response = try await api.getHealthEntries(scope: healthScope, limit: logPageSize, offset: offset)
            if reset {
                healthEntries = response.entries
            } else {
                appendUniqueHealthEntries(response.entries)
            }
            dailyTypes = response.dailyTypes
            healthOffset = offset + response.entries.count
            hasMoreHealthEntries = response.entries.count == logPageSize
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadSleep(reset: Bool = true) async {
        guard !isLoadingSleepPage else { return }
        isLoadingSleepPage = true
        defer { isLoadingSleepPage = false }

        let offset = reset ? 0 : sleepOffset

        do {
            let response = try await api.getSleepEntries(scope: sleepScope, limit: logPageSize, offset: offset)
            if reset {
                sleepEntries = response.entries
            } else {
                appendUniqueSleepEntries(response.entries)
            }
            sleepDailyTotals = response.dailyTotals
            sleepOffset = offset + response.entries.count
            hasMoreSleepEntries = response.entries.count == logPageSize
        } catch {
            errorMessage = error.localizedDescription
        }
        guard reset else { return }
        await loadSleepTarget()
    }

    private func appendUniqueHealthEntries(_ entries: [HealthEntry]) {
        let existingIds = Set(healthEntries.map(\.id))
        healthEntries.append(contentsOf: entries.filter { !existingIds.contains($0.id) })
    }

    private func appendUniqueSleepEntries(_ entries: [SleepEntry]) {
        let existingIds = Set(sleepEntries.map(\.id))
        sleepEntries.append(contentsOf: entries.filter { !existingIds.contains($0.id) })
    }

    private func loadMoreHealthIfNeeded(current entry: HealthEntry) {
        guard sexualActivityEnabled, hasMoreHealthEntries, entry.id == healthEntries.last?.id else { return }
        Task { await loadHealth(reset: false) }
    }

    private func loadMoreSleepIfNeeded(current entry: SleepEntry) {
        guard hasMoreSleepEntries, entry.id == sleepEntries.last?.id else { return }
        Task { await loadSleep(reset: false) }
    }

    private func loadSleepTarget() async {
        do {
            let response = try await api.getDailyTotals(scope: "week")
            sleepTargetHours = response.targets.sleepHours ?? sleepTargetHours
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveHealthEntry() async {
        guard sexualActivityEnabled else {
            errorMessage = "Sexual activity tracking is not enabled for this account."
            return
        }
        isSavingHealth = true
        defer { isSavingHealth = false }
        do {
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.addHealthEntry(type: selectedActivityType, loggedAt: f.string(from: healthLogDate))
            showLogHealth = false
            healthLogDate = Date()
            await loadHealth(reset: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveSleepEntry() async {
        isSavingSleep = true
        defer { isSavingSleep = false }
        do {
            guard let hours = Double(sleepHours), hours > 0, hours <= 24 else {
                errorMessage = "Hours must be between 0 and 24."
                return
            }
            let wakeUps = Int(sleepWakeUps) ?? 0
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.addSleepEntry(durationHours: hours, wakeUps: wakeUps, loggedAt: f.string(from: sleepLogDate))
            showLogSleep = false
            sleepHours = "7.5"
            sleepWakeUps = "0"
            sleepLogDate = Date()
            await loadSleep(reset: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveSleepTargets() async {
        isSavingSleepTarget = true
        defer { isSavingSleepTarget = false }
        do {
            guard let targetHours = Double(editSleepTargetHours), targetHours > 0, targetHours <= 24 else {
                errorMessage = "Target hours must be between 0 and 24."
                return
            }
            try await api.setMacroTarget(macro: "sleep_hours", target: targetHours)
            sleepTargetHours = targetHours
            showEditSleepTargets = false
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func updateHealth(_ entry: HealthEntry) async {
        guard sexualActivityEnabled else {
            errorMessage = "Sexual activity tracking is not enabled for this account."
            return
        }
        do {
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.updateHealthEntry(id: entry.id, type: editHealthType, loggedAt: f.string(from: editHealthDate))
            editingHealth = nil
            await loadHealth(reset: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteHealth(_ entry: HealthEntry) async {
        guard sexualActivityEnabled else {
            errorMessage = "Sexual activity tracking is not enabled for this account."
            return
        }
        do {
            try await api.deleteHealthEntry(id: entry.id)
            editingHealth = nil
            await loadHealth(reset: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func updateSleep(_ entry: SleepEntry) async {
        do {
            guard let hours = Double(editSleepHours), hours > 0, hours <= 24 else {
                errorMessage = "Hours must be between 0 and 24."
                return
            }
            let wakeUps = Int(editSleepWakeUps) ?? 0
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.updateSleepEntry(id: entry.id, durationHours: hours, wakeUps: wakeUps, loggedAt: f.string(from: editSleepDate))
            editingSleep = nil
            await loadSleep(reset: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteSleep(_ entry: SleepEntry) async {
        do {
            try await api.deleteSleepEntry(id: entry.id)
            editingSleep = nil
            await loadSleep(reset: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Helpers

    private var healthCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York") ?? .current
        return calendar
    }

    private func isoDayString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = healthCalendar
        formatter.timeZone = healthCalendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private func weekdayLabel(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = healthCalendar
        formatter.timeZone = healthCalendar.timeZone
        formatter.dateFormat = "E"
        return String(formatter.string(from: date).prefix(2))
    }

    private func shortDateLabel(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = healthCalendar
        formatter.timeZone = healthCalendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMM d")
        return formatter.string(from: date)
    }

    private func orderedActivityTypes(_ types: [String]) -> [String] {
        let normalizedTypes = Set(types.map { $0.lowercased() })
        let knownTypes = activityTypes.filter { normalizedTypes.contains($0) }
        let unknownTypes = normalizedTypes.subtracting(Set(activityTypes)).sorted()
        return knownTypes + unknownTypes
    }

    private func formatTargetHours(_ hours: Double) -> String {
        let rounded = hours.rounded()
        if abs(hours - rounded) < 0.01 {
            return "\(Int(rounded))"
        }
        return String(format: "%.1f", hours)
    }

    private func activityColor(_ type: String) -> Color {
        switch type.lowercased() {
        case "masturbation": return .pink
        case "oral sex": return .cyan
        case "vaginal sex": return .green
        case "other": return .purple
        default: return .gray
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
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
        return f.date(from: iso) ?? Date()
    }
}
