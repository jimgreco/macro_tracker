import Foundation
import SwiftUI

enum HealthViewMode: Equatable {
    case sleep
    case sexualActivity

    var navigationTitle: String {
        switch self {
        case .sleep: return "Sleep"
        case .sexualActivity: return "Sexual Activity"
        }
    }

    var alertTitle: String { navigationTitle }
}

struct SleepView: View {
    var body: some View {
        HealthView(mode: .sleep)
    }
}

struct SexualActivityView: View {
    var body: some View {
        HealthView(mode: .sexualActivity)
    }
}

struct HealthView: View {
    let mode: HealthViewMode

    @EnvironmentObject var api: APIClient
    @EnvironmentObject var auth: AuthManager
    @StateObject private var healthKitSync = HealthKitWellnessSync()

    init(mode: HealthViewMode = .sleep) {
        self.mode = mode
    }

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
    @State private var sleepHours = ""
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
    @State private var isSyncingHealthKit = false

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
                    modeContent
                }
                .padding()
            }
            .navigationTitle(mode.navigationTitle)
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        Task { await syncHealthKit() }
                    } label: {
                        if isSyncingHealthKit {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.triangle.2.circlepath")
                        }
                    }
                    .disabled(isSyncingHealthKit || (mode == .sexualActivity && !sexualActivityEnabled))

                    Button {
                        showLogSheetForMode()
                    } label: {
                        Image(systemName: "plus")
                    }
                    .disabled(mode == .sexualActivity && !sexualActivityEnabled)
                }
            }
            .sheet(isPresented: $showLogHealth) { logHealthSheet }
            .sheet(isPresented: $showLogSleep) { logSleepSheet }
            .sheet(isPresented: $showEditSleepTargets) { editSleepTargetsSheet }
            .sheet(item: $editingHealth) { entry in editHealthSheet(entry) }
            .sheet(item: $editingSleep) { entry in editSleepSheet(entry) }
            .task {
                await loadVisibleData()
            }
            .refreshable {
                await loadVisibleData()
            }
            .alert(mode.alertTitle, isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    @ViewBuilder
    private var modeContent: some View {
        switch mode {
        case .sleep:
            sleepSection
        case .sexualActivity:
            if sexualActivityEnabled {
                sexualActivitySection
            } else {
                ContentUnavailableView(
                    "Sexual Activity Hidden",
                    systemImage: "heart.slash",
                    description: Text("An admin can enable this view for your account.")
                )
            }
        }
    }

    // MARK: - Sexual Activity Section

    private var sexualActivitySection: some View {
        VStack(spacing: 12) {
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
        let unit = "days active"

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
        case "year": return "Last 365 Days"
        default: return "Activity Days"
        }
    }

    private var activityOccurrencePoints: [ActivityOccurrencePoint] {
        let calendar = healthCalendar
        let today = calendar.startOfDay(for: Date())
        let typesByDay = Dictionary(uniqueKeysWithValues: dailyTypes.map { ($0.day, orderedActivityTypes($0.types)) })

        let days = activityOccurrenceDayCount
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
            } else if healthScope == "year" {
                activityYearOccurrenceGrid(points)
            } else {
                Canvas { context, size in
                    drawActivityOccurrenceCanvas(points, context: context, size: size)
                }
            }
        }
        .frame(height: healthScope == "year" ? nil : activityOccurrenceDotPlotHeight)
        .accessibilityLabel("\(activityOccurrenceTitle): \(points.filter(\.active).count) active days")
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

    private func activityYearOccurrenceGrid(_ points: [ActivityOccurrencePoint]) -> some View {
        let columns = [
            GridItem(.adaptive(minimum: 6, maximum: 6), spacing: 3)
        ]

        return LazyVGrid(columns: columns, alignment: .leading, spacing: 3) {
            ForEach(points) { point in
                Circle()
                    .fill(point.active ? activityOccurrenceColor(point) : Color.clear)
                    .overlay {
                        if !point.active {
                            Circle()
                                .stroke(point.isToday ? .cyan.opacity(0.55) : .white.opacity(0.15), lineWidth: point.isToday ? 1.2 : 1)
                        }
                    }
                    .shadow(color: point.active ? activityOccurrenceColor(point).opacity(0.35) : .clear, radius: 3)
                    .frame(width: 5, height: 5)
                    .frame(width: 6, height: 6)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func activityOccurrenceColor(_ point: ActivityOccurrencePoint) -> Color {
        let types = orderedActivityTypes(point.types)
        return activityColor(types.first ?? "other")
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
        if healthScope == "week" || healthScope == "year" {
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

    private var activityOccurrenceDayCount: Int {
        switch healthScope {
        case "year": return 365
        case "month": return 30
        default: return 7
        }
    }

    private var activityOccurrenceDotPlotHeight: CGFloat {
        healthScope == "week" ? 58 : 42
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
            HStack {
                Spacer()
                Button("edit targets") {
                    editSleepTargetHours = formatTargetHours(sleepTargetHours)
                    showEditSleepTargets = true
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(.cyan)
            }

            if sleepDailyTotals.isEmpty {
                Text("No data for this period")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(height: 120)
            } else {
                Canvas { context, size in
                    drawSleepChart(context: context, size: size)
                }
                .frame(height: 150)
                .accessibilityLabel("Sleep chart with dates on the horizontal axis and hours on the vertical axis")
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
                .frame(maxWidth: .infinity, alignment: .center)
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
                                editSleepHours = sleepHoursEditText(for: entry)
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
                    DatePicker("Logged At", selection: $healthLogDate)
                        .datePickerStyle(.compact)

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
                    DatePicker("Logged At", selection: $sleepLogDate)
                        .datePickerStyle(.compact)

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
                    .tint(canLogSleepEntry ? .cyan : .gray)
                    .disabled(!canLogSleepEntry)

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

    private var canLogSleepEntry: Bool {
        guard !isSavingSleep else { return false }
        guard let hours = Double(sleepHours.trimmingCharacters(in: .whitespacesAndNewlines)), hours > 0, hours <= 24 else {
            return false
        }
        guard let wakeUps = Int(sleepWakeUps.trimmingCharacters(in: .whitespacesAndNewlines)), wakeUps >= 0 else {
            return false
        }
        return true
    }

    // MARK: - Edit Sleep Targets Sheet

    private var editSleepTargetsSheet: some View {
        let canSave = canSaveSleepTarget

        return NavigationStack {
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
                    .tint(canSave ? .cyan : .gray)
                    .disabled(!canSave)

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

    private var canSaveSleepTarget: Bool {
        guard !isSavingSleepTarget else { return false }
        guard let targetHours = Double(editSleepTargetHours.trimmingCharacters(in: .whitespacesAndNewlines)), targetHours > 0, targetHours <= 24 else {
            return false
        }
        return abs(targetHours - sleepTargetHours) > 0.001
    }

    // MARK: - Edit Health Sheet

    private func editHealthSheet(_ entry: HealthEntry) -> some View {
        let canSave = canSaveHealthEdit(entry)

        return NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    DatePicker("Logged At", selection: $editHealthDate)
                        .datePickerStyle(.compact)

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
                    .frame(maxWidth: .infinity, alignment: .leading)

                    HStack(spacing: 12) {
                        Button(role: .destructive) {
                            Task { await deleteHealth(entry) }
                        } label: {
                            Text("Delete").font(.headline).frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)

                        Button {
                            Task { await updateHealth(entry) }
                        } label: {
                            if isSavingHealth {
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
            .navigationTitle("Edit Sexual Activity")
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

    private func canSaveHealthEdit(_ entry: HealthEntry) -> Bool {
        guard sexualActivityEnabled, !isSavingHealth else { return false }

        let typeChanged = editHealthType != entry.type
        let loggedAtChanged = !isSameDisplayedMinute(editHealthDate, parseISO(entry.loggedAt))

        return typeChanged || loggedAtChanged
    }

    // MARK: - Edit Sleep Sheet

    private func editSleepSheet(_ entry: SleepEntry) -> some View {
        let canSave = canSaveSleepEdit(entry)

        return NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    DatePicker("Logged At", selection: $editSleepDate)
                        .datePickerStyle(.compact)

                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Hours")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            TextField("7.5", text: $editSleepHours)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.decimalPad)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Wake-ups")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            TextField("0", text: $editSleepWakeUps)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.numberPad)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    HStack(spacing: 12) {
                        Button(role: .destructive) {
                            Task { await deleteSleep(entry) }
                        } label: {
                            Text("Delete").font(.headline).frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)

                        Button {
                            Task { await updateSleep(entry) }
                        } label: {
                            if isSavingSleep {
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

    private func canSaveSleepEdit(_ entry: SleepEntry) -> Bool {
        guard !isSavingSleep else { return false }
        guard let hours = Double(editSleepHours.trimmingCharacters(in: .whitespacesAndNewlines)), hours > 0, hours <= 24 else {
            return false
        }
        guard let wakeUps = Int(editSleepWakeUps.trimmingCharacters(in: .whitespacesAndNewlines)), wakeUps >= 0 else {
            return false
        }

        let baselineHours = Double(sleepHoursEditText(for: entry)) ?? entry.durationHours
        let hoursChanged = abs(hours - baselineHours) > 0.001
        let wakeUpsChanged = wakeUps != entry.wakeUps
        let loggedAtChanged = !isSameDisplayedMinute(editSleepDate, parseISO(entry.loggedAt))

        return hoursChanged || wakeUpsChanged || loggedAtChanged
    }

    private func sleepHoursEditText(for entry: SleepEntry) -> String {
        String(format: "%.2g", entry.durationHours)
    }

    private func isSameDisplayedMinute(_ lhs: Date, _ rhs: Date) -> Bool {
        Calendar.current.compare(lhs, to: rhs, toGranularity: .minute) == .orderedSame
    }

    // MARK: - Actions

    private func showErrorUnlessCancelled(_ error: Error) {
        guard !isCancellation(error) else { return }
        errorMessage = error.localizedDescription
    }

    private func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError {
            return true
        }

        if let urlError = error as? URLError, urlError.code == .cancelled {
            return true
        }

        if case APIError.networkError(let underlying) = error {
            return isCancellation(underlying)
        }

        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    }

    private func refreshAccountFeatures() async {
        do {
            if let user = try await api.getMe() {
                auth.user = user
            }
        } catch {
            showErrorUnlessCancelled(error)
        }
    }

    private func loadVisibleData() async {
        await refreshAccountFeatures()

        switch mode {
        case .sleep:
            await loadSleep(reset: true)
        case .sexualActivity:
            if sexualActivityEnabled {
                await loadHealth(reset: true)
            } else {
                healthEntries = []
                dailyTypes = []
            }
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
            showErrorUnlessCancelled(error)
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
            showErrorUnlessCancelled(error)
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
            showErrorUnlessCancelled(error)
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
            triggerSexualActivityHealthKitExport()
            await loadHealth(reset: true)
        } catch {
            showErrorUnlessCancelled(error)
        }
    }

    private func saveSleepEntry() async {
        guard canLogSleepEntry else { return }
        isSavingSleep = true
        defer { isSavingSleep = false }
        do {
            guard let hours = Double(sleepHours.trimmingCharacters(in: .whitespacesAndNewlines)), hours > 0, hours <= 24 else {
                errorMessage = "Hours must be between 0 and 24."
                return
            }
            let wakeUps = Int(sleepWakeUps.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.addSleepEntry(durationHours: hours, wakeUps: wakeUps, loggedAt: f.string(from: sleepLogDate))
            showLogSleep = false
            sleepHours = ""
            sleepWakeUps = "0"
            sleepLogDate = Date()
            triggerSleepHealthKitExport()
            await loadSleep(reset: true)
        } catch {
            showErrorUnlessCancelled(error)
        }
    }

    private func triggerSleepHealthKitExport() {
        Task {
            _ = try? await healthKitSync.syncRecentSleep(api: api)
        }
    }

    private func triggerSexualActivityHealthKitExport() {
        Task {
            _ = try? await healthKitSync.syncRecentSexualActivity(api: api)
        }
    }

    private func saveSleepTargets() async {
        guard canSaveSleepTarget else { return }
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
            showErrorUnlessCancelled(error)
        }
    }

    private func updateHealth(_ entry: HealthEntry) async {
        guard sexualActivityEnabled else {
            errorMessage = "Sexual activity tracking is not enabled for this account."
            return
        }
        isSavingHealth = true
        defer { isSavingHealth = false }
        do {
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.updateHealthEntry(id: entry.id, type: editHealthType, loggedAt: f.string(from: editHealthDate))
            editingHealth = nil
            await loadHealth(reset: true)
        } catch {
            showErrorUnlessCancelled(error)
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
            showErrorUnlessCancelled(error)
        }
    }

    private func updateSleep(_ entry: SleepEntry) async {
        isSavingSleep = true
        defer { isSavingSleep = false }
        do {
            guard let hours = Double(editSleepHours.trimmingCharacters(in: .whitespacesAndNewlines)), hours > 0, hours <= 24 else {
                errorMessage = "Hours must be between 0 and 24."
                return
            }
            let wakeUps = Int(editSleepWakeUps.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
            let f = ISO8601DateFormatter()
            f.timeZone = TimeZone(identifier: "America/New_York")
            try await api.updateSleepEntry(id: entry.id, durationHours: hours, wakeUps: wakeUps, loggedAt: f.string(from: editSleepDate))
            editingSleep = nil
            await loadSleep(reset: true)
        } catch {
            showErrorUnlessCancelled(error)
        }
    }

    private func deleteSleep(_ entry: SleepEntry) async {
        do {
            try await api.deleteSleepEntry(id: entry.id)
            editingSleep = nil
            await loadSleep(reset: true)
        } catch {
            showErrorUnlessCancelled(error)
        }
    }

    private func syncHealthKit() async {
        isSyncingHealthKit = true
        defer { isSyncingHealthKit = false }

        switch mode {
        case .sleep:
            do {
                let sleepResult = try await healthKitSync.syncRecentSleep(api: api)
                errorMessage = syncMessage(name: "Sleep", result: sleepResult, empty: "no new sleep entries from the last 30 days.")
                await loadSleep(reset: true)
            } catch {
                errorMessage = "Sleep: \(error.localizedDescription)"
            }
        case .sexualActivity:
            guard sexualActivityEnabled else {
                errorMessage = "Sexual activity tracking is not enabled for this account."
                return
            }
            do {
                let activityResult = try await healthKitSync.syncRecentSexualActivity(api: api)
                errorMessage = syncMessage(name: "Sexual Activity", result: activityResult, empty: "no new entries from the last 30 days.")
                await loadHealth(reset: true)
            } catch {
                errorMessage = "Sexual Activity: \(error.localizedDescription)"
            }
        }
    }

    private func syncMessage(name: String, result: HealthKitMetricSyncResult, empty: String) -> String {
        if result.importedCount > 0 || result.exportedCount > 0 {
            return "\(name): imported \(result.importedCount), wrote \(result.exportedCount)."
        }
        return "\(name): \(empty)"
    }

    private func showLogSheetForMode() {
        switch mode {
        case .sleep:
            sleepLogDate = Date()
            sleepHours = ""
            sleepWakeUps = "0"
            showLogSleep = true
        case .sexualActivity:
            guard sexualActivityEnabled else {
                errorMessage = "Sexual activity tracking is not enabled for this account."
                return
            }
            healthLogDate = Date()
            showLogHealth = true
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
