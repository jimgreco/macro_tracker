import Foundation
import SwiftUI

/// The Activity metrics, in display order.
enum ActivityMetric: String, CaseIterable, Sendable {
    case steps
    case distance
    case flightsClimbed
    case activeEnergy
    case exercise
    case walkingSpeed
    case stepLength
    case heartRate
    case lowestHeartRate
    case restingHeartRate
    case hrv
    case respiratoryRate
    case bloodOxygen
    case vo2Max
}

/// Health > Activity shows a metric only when the response has a value for it:
/// any day in the selected scope, or the current or previous summary. Metrics
/// with no data (for example heart metrics without an Apple Watch) are hidden,
/// never estimated. Older servers omit the newer fields, which then stay hidden.
enum ActivityMetricVisibility {
    static func visibleMetrics(for response: HealthMetricsResponse?) -> [ActivityMetric] {
        guard let response else { return [] }
        let current = response.summary?.current
        let previous = response.summary?.previous
        return ActivityMetric.allCases.filter { metric in
            let dayKey = dayValue(metric)
            let summaryKey = summaryValue(metric)
            return response.days.contains { $0[keyPath: dayKey] != nil }
                || current?[keyPath: summaryKey] != nil
                || previous?[keyPath: summaryKey] != nil
        }
    }

    static func dayValue(_ metric: ActivityMetric) -> KeyPath<HealthMetricsDay, Double?> {
        switch metric {
        case .steps: return \.steps
        case .distance: return \.walkingRunningDistanceM
        case .flightsClimbed: return \.flightsClimbed
        case .activeEnergy: return \.activeEnergyKcal
        case .exercise: return \.exerciseMinutes
        case .walkingSpeed: return \.walkingSpeedMps
        case .stepLength: return \.walkingStepLengthM
        case .heartRate: return \.heartRateAvgBpm
        case .lowestHeartRate: return \.heartRateMinBpm
        case .restingHeartRate: return \.restingHeartRate
        case .hrv: return \.hrvMs
        case .respiratoryRate: return \.respiratoryRateBrpm
        case .bloodOxygen: return \.oxygenSaturationPct
        case .vo2Max: return \.vo2max
        }
    }

    static func summaryValue(_ metric: ActivityMetric) -> KeyPath<HealthMetricsPeriodSummary, Double?> {
        switch metric {
        case .steps: return \.avgSteps
        case .distance: return \.avgWalkingRunningDistanceM
        case .flightsClimbed: return \.avgFlightsClimbed
        case .activeEnergy: return \.avgActiveEnergyKcal
        case .exercise: return \.avgExerciseMinutes
        case .walkingSpeed: return \.avgWalkingSpeedMps
        case .stepLength: return \.avgWalkingStepLengthM
        case .heartRate: return \.avgHeartRateAvgBpm
        case .lowestHeartRate: return \.avgHeartRateMinBpm
        case .restingHeartRate: return \.avgRestingHeartRate
        case .hrv: return \.avgHrvMs
        case .respiratoryRate: return \.avgRespiratoryRateBrpm
        case .bloodOxygen: return \.avgOxygenSaturationPct
        case .vo2Max: return \.latestVo2Max
        }
    }
}

/// Health > Activity: daily steps, distance, flights climbed, active energy,
/// exercise minutes, walking speed and step length, heart rate (average and
/// daily low), resting heart rate, HRV, respiratory rate, blood oxygen and VO2
/// max read from Apple Health (including values other apps, such as the Oura
/// app, write into Apple Health). Never uses the direct Oura API.
struct ActivityHealthView: View {
    @EnvironmentObject private var api: APIClient
    @Environment(\.presentSettings) private var presentSettings
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ObservedObject private var integrationDataAccess = IntegrationDataAccessStore.shared
    @StateObject private var metricsSync = HealthKitMetricsSync()

    @State private var scope = "week"
    @State private var response: HealthMetricsResponse?
    @State private var metricsLoad = ScopedHistoryLoad()
    @State private var isSyncing = false
    @State private var alertMessage: String?
    @State private var syncStatus: ManualSyncStatus?
    @State private var chartSelection: ChartSelectionKey?

    @ScaledMetric(relativeTo: .body) private var chartHeight: CGFloat = 140

    private let scopes = ["week", "month", "year"]

    private var accessPlan: HealthKitAccessPlan {
        integrationDataAccess.healthKitAccessPlan(includeSexualActivity: false)
    }

    private var activityReadEnabled: Bool { accessPlan.activity.readEnabled }
    private var heartReadEnabled: Bool { accessPlan.heart.readEnabled }
    private var anyReadEnabled: Bool { activityReadEnabled || heartReadEnabled }

    private var days: [HealthMetricsDay] {
        (response?.days ?? []).sorted { $0.day < $1.day }
    }

    private var current: HealthMetricsPeriodSummary? { response?.summary?.current }
    private var previous: HealthMetricsPeriodSummary? { response?.summary?.previous }

    /// Metrics with at least one value in this response; the rest are hidden.
    private var visibleMetrics: [ActivityMetric] {
        ActivityMetricVisibility.visibleMetrics(for: response)
    }

    private func isVisible(_ metric: ActivityMetric) -> Bool {
        visibleMetrics.contains(metric)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: AppVisualSystem.Spacing.xLarge) {
                    content
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .top)
            }
            .appScreenBackground(accent: AppVisualSystem.ColorToken.workout)
            .navigationTitle("Activity")
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        Task { await syncFromAppleHealth() }
                    } label: {
                        if isSyncing {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.triangle.2.circlepath")
                        }
                    }
                    .accessibilityLabel("Sync activity and heart from Apple Health")
                    .disabled(isSyncing)
                }

                ToolbarItem(placement: .primaryAction) {
                    AccountToolbarButton()
                }
            }
            .task {
                await loadMetrics()
            }
            .refreshable {
                await loadMetrics()
            }
            .alert(
                "Activity",
                isPresented: Binding(
                    get: { alertMessage != nil },
                    set: { if !$0 { alertMessage = nil } }
                )
            ) {
                Button("OK") { alertMessage = nil }
            } message: {
                Text(alertMessage ?? "")
            }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        VStack(spacing: 12) {
            ManualSyncStatusLine(status: syncStatus)

            Picker("Scope", selection: $scope) {
                ForEach(scopes, id: \.self) { value in
                    Text(value.capitalized).tag(value)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: scope) { _, _ in
                Task { await loadMetrics() }
            }

            if let response, !response.isEnabled {
                notAvailableCard
            } else if !anyReadEnabled && days.isEmpty {
                accessOffCard
            } else if visibleMetrics.isEmpty {
                noDataCard
            } else {
                summaryGrid
                if days.isEmpty {
                    noDataCard
                } else {
                    if isVisible(.steps) {
                        metricChart(
                            title: "Steps",
                            systemImage: "figure.walk",
                            tint: AppVisualSystem.ColorToken.workout,
                            style: .bars,
                            unit: "steps",
                            value: \.steps,
                            formatter: formatSteps
                        )
                    }
                    if isVisible(.distance) {
                        metricChart(
                            title: "Distance",
                            systemImage: "map.fill",
                            tint: AppVisualSystem.ColorToken.carbs,
                            style: .bars,
                            unit: "mi",
                            value: \.walkingRunningDistanceMiles,
                            formatter: formatOneDecimal,
                            spokenUnit: "miles"
                        )
                    }
                    if isVisible(.activeEnergy) {
                        metricChart(
                            title: "Active energy",
                            systemImage: "flame.fill",
                            tint: AppVisualSystem.ColorToken.calories,
                            style: .bars,
                            unit: "kcal",
                            value: \.activeEnergyKcal,
                            formatter: formatWhole
                        )
                    }
                    if isVisible(.heartRate) {
                        metricChart(
                            title: "Heart rate",
                            systemImage: "heart.text.square.fill",
                            tint: AppVisualSystem.ColorToken.fat,
                            style: .line,
                            unit: "bpm",
                            value: \.heartRateAvgBpm,
                            formatter: formatWhole,
                            spokenUnit: "beats per minute"
                        )
                    }
                    if isVisible(.restingHeartRate) {
                        metricChart(
                            title: "Resting heart rate",
                            systemImage: "heart.fill",
                            tint: AppVisualSystem.ColorToken.danger,
                            style: .line,
                            unit: "bpm",
                            value: \.restingHeartRate,
                            formatter: formatWhole
                        )
                    }
                    if isVisible(.hrv) {
                        metricChart(
                            title: "Heart rate variability",
                            systemImage: "waveform.path.ecg",
                            tint: AppVisualSystem.ColorToken.recovery,
                            style: .line,
                            unit: "ms",
                            value: \.hrvMs,
                            formatter: formatWhole
                        )
                    }
                }
                sourceFootnote
            }
        }
    }

    private var summaryColumns: [GridItem] {
        let count = dynamicTypeSize.isAccessibilitySize ? 1 : 2
        return Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: count)
    }

    private var summaryGrid: some View {
        LazyVGrid(columns: summaryColumns, spacing: 12) {
            if isVisible(.steps) {
                summaryCard(
                    title: "Steps",
                    systemImage: "figure.walk",
                    tint: AppVisualSystem.ColorToken.workout,
                    current: current?.avgSteps,
                    previous: previous?.avgSteps,
                    unit: "steps",
                    formatter: formatSteps,
                    isAverage: true
                )
            }
            if isVisible(.distance) {
                summaryCard(
                    title: "Distance",
                    systemImage: "map.fill",
                    tint: AppVisualSystem.ColorToken.carbs,
                    current: current?.avgWalkingRunningDistanceMiles,
                    previous: previous?.avgWalkingRunningDistanceMiles,
                    unit: "mi",
                    formatter: formatOneDecimal,
                    isAverage: true,
                    spokenTitle: "Walking and running distance",
                    spokenUnit: "miles"
                )
            }
            if isVisible(.flightsClimbed) {
                summaryCard(
                    title: "Flights",
                    systemImage: "figure.stairs",
                    tint: AppVisualSystem.ColorToken.warning,
                    current: current?.avgFlightsClimbed,
                    previous: previous?.avgFlightsClimbed,
                    unit: "flights",
                    formatter: formatWhole,
                    isAverage: true,
                    spokenTitle: "Flights climbed"
                )
            }
            if isVisible(.activeEnergy) {
                summaryCard(
                    title: "Active energy",
                    systemImage: "flame.fill",
                    tint: AppVisualSystem.ColorToken.calories,
                    current: current?.avgActiveEnergyKcal,
                    previous: previous?.avgActiveEnergyKcal,
                    unit: "kcal",
                    formatter: formatWhole,
                    isAverage: true
                )
            }
            if isVisible(.exercise) {
                summaryCard(
                    title: "Exercise",
                    systemImage: "stopwatch.fill",
                    tint: AppVisualSystem.ColorToken.protein,
                    current: current?.avgExerciseMinutes,
                    previous: previous?.avgExerciseMinutes,
                    unit: "min",
                    formatter: formatWhole,
                    isAverage: true
                )
            }
            if isVisible(.walkingSpeed) {
                summaryCard(
                    title: "Walking speed",
                    systemImage: "speedometer",
                    tint: AppVisualSystem.ColorToken.workout,
                    current: current?.avgWalkingSpeedMph,
                    previous: previous?.avgWalkingSpeedMph,
                    unit: "mph",
                    formatter: formatOneDecimal,
                    isAverage: true,
                    spokenUnit: "miles per hour"
                )
            }
            if isVisible(.stepLength) {
                summaryCard(
                    title: "Step length",
                    systemImage: "ruler",
                    tint: AppVisualSystem.ColorToken.workout,
                    current: current?.avgWalkingStepLengthInches,
                    previous: previous?.avgWalkingStepLengthInches,
                    unit: "in",
                    formatter: formatWhole,
                    isAverage: true,
                    spokenUnit: "inches"
                )
            }
            if isVisible(.heartRate) {
                summaryCard(
                    title: "Heart rate",
                    systemImage: "heart.text.square.fill",
                    tint: AppVisualSystem.ColorToken.fat,
                    current: current?.avgHeartRateAvgBpm,
                    previous: previous?.avgHeartRateAvgBpm,
                    unit: "bpm",
                    formatter: formatWhole,
                    isAverage: true,
                    spokenUnit: "beats per minute"
                )
            }
            if isVisible(.lowestHeartRate) {
                summaryCard(
                    title: "Daily low HR",
                    systemImage: "arrow.down.heart.fill",
                    tint: AppVisualSystem.ColorToken.fat,
                    current: current?.avgHeartRateMinBpm,
                    previous: previous?.avgHeartRateMinBpm,
                    unit: "bpm",
                    formatter: formatWhole,
                    isAverage: true,
                    spokenTitle: "Daily lowest heart rate",
                    spokenUnit: "beats per minute"
                )
            }
            if isVisible(.restingHeartRate) {
                summaryCard(
                    title: "Resting HR",
                    systemImage: "heart.fill",
                    tint: AppVisualSystem.ColorToken.danger,
                    current: current?.avgRestingHeartRate,
                    previous: previous?.avgRestingHeartRate,
                    unit: "bpm",
                    formatter: formatWhole,
                    isAverage: true,
                    spokenTitle: "Resting heart rate"
                )
            }
            if isVisible(.hrv) {
                summaryCard(
                    title: "HRV",
                    systemImage: "waveform.path.ecg",
                    tint: AppVisualSystem.ColorToken.recovery,
                    current: current?.avgHrvMs,
                    previous: previous?.avgHrvMs,
                    unit: "ms",
                    formatter: formatWhole,
                    isAverage: true,
                    spokenTitle: "Heart rate variability"
                )
            }
            if isVisible(.respiratoryRate) {
                summaryCard(
                    title: "Respiratory rate",
                    systemImage: "wind",
                    tint: AppVisualSystem.ColorToken.recovery,
                    current: current?.avgRespiratoryRateBrpm,
                    previous: previous?.avgRespiratoryRateBrpm,
                    unit: "br/min",
                    formatter: formatOneDecimal,
                    isAverage: true,
                    spokenUnit: "breaths per minute"
                )
            }
            if isVisible(.bloodOxygen) {
                summaryCard(
                    title: "Blood oxygen",
                    systemImage: "drop.fill",
                    tint: AppVisualSystem.ColorToken.danger,
                    current: current?.avgOxygenSaturationPct,
                    previous: previous?.avgOxygenSaturationPct,
                    unit: "%",
                    formatter: formatOneDecimal,
                    isAverage: true,
                    spokenUnit: "percent"
                )
            }
            if isVisible(.vo2Max) {
                summaryCard(
                    title: "VO₂ max",
                    systemImage: "lungs.fill",
                    tint: AppVisualSystem.ColorToken.carbs,
                    current: current?.latestVo2Max,
                    previous: previous?.latestVo2Max,
                    unit: "mL/kg/min",
                    formatter: formatOneDecimal,
                    isAverage: false,
                    spokenTitle: "V O 2 max"
                )
            }
        }
    }

    private func summaryCard(
        title: String,
        systemImage: String,
        tint: Color,
        current: Double?,
        previous: Double?,
        unit: String,
        formatter: (Double) -> String,
        isAverage: Bool,
        spokenTitle: String? = nil,
        spokenUnit: String? = nil
    ) -> some View {
        let valueText = current.map(formatter) ?? "—"
        let caption = isAverage ? "Daily average" : "Latest"
        let spoken = spokenUnit ?? unit
        let change = changeText(current: current, previous: previous, unit: spoken, formatter: formatter)

        return VStack(alignment: .leading, spacing: AppVisualSystem.Spacing.small) {
            Label(title, systemImage: systemImage)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tint)
                .lineLimit(2)

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(valueText)
                    .font(.title3.weight(.bold))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if current != nil {
                    Text(unit)
                        .font(.caption)
                        .foregroundStyle(AppVisualSystem.ColorToken.textSecondary)
                        .lineLimit(1)
                }
            }

            Text(caption)
                .font(.caption2)
                .foregroundStyle(AppVisualSystem.ColorToken.textTertiary)

            Text(change.text)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(AppVisualSystem.ColorToken.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .appSurface(.tinted(tint), cornerRadius: AppVisualSystem.Radius.card, padding: 14)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenTitle ?? title)
        .accessibilityValue(
            current == nil
                ? "No data"
                : "\(caption) \(valueText) \(spoken). \(change.spoken)"
        )
    }

    private func changeText(
        current: Double?,
        previous: Double?,
        unit: String,
        formatter: (Double) -> String
    ) -> (text: String, spoken: String) {
        guard let current, let previous else {
            return ("No previous \(scope) to compare", "No previous \(scope) to compare.")
        }
        let delta = current - previous
        let magnitude = formatter(abs(delta))
        if magnitude == formatter(0) {
            return ("Same as previous \(scope)", "Same as previous \(scope).")
        }
        let arrow = delta > 0 ? "↑" : "↓"
        let direction = delta > 0 ? "Up" : "Down"
        return (
            "\(arrow) \(magnitude) vs previous \(scope)",
            "\(direction) \(magnitude) \(unit) versus the previous \(scope)."
        )
    }

    // MARK: - States

    private var accessOffCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            AppSectionHeader(
                "Activity and heart are off",
                systemImage: "heart.text.square",
                tint: AppVisualSystem.ColorToken.workout
            )
            Text("To see steps, distance, flights climbed, walking speed and step length, active energy, exercise minutes, heart rate, resting heart rate, HRV, respiratory rate, blood oxygen and VO₂ max from Apple Health, open Settings → Data Sources → Apple Health and turn on Read for Activity or Heart.")
                .font(.subheadline)
                .foregroundStyle(AppVisualSystem.ColorToken.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Button("Open Settings") {
                presentSettings()
            }
            .buttonStyle(.borderedProminent)
            .accessibilityHint("Opens Settings, where Data Sources controls Apple Health access")
        }
        .appSurface(.standard)
        .accessibilityElement(children: .contain)
    }

    private var notAvailableCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            AppSectionHeader(
                "Not available yet",
                systemImage: "clock",
                tint: AppVisualSystem.ColorToken.textSecondary
            )
            Text("Activity and heart history isn't available on the server yet. Check back after the next update.")
                .font(.subheadline)
                .foregroundStyle(AppVisualSystem.ColorToken.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .appSurface(.standard)
        .accessibilityElement(children: .combine)
    }

    private var noDataCard: some View {
        Text(
            anyReadEnabled
                ? "No Apple Health activity or heart data for this \(scope) yet. Tap sync to import the latest days."
                : "No data for this period."
        )
        .font(.subheadline)
        .foregroundStyle(AppVisualSystem.ColorToken.textSecondary)
        .frame(maxWidth: .infinity, alignment: .center)
        .multilineTextAlignment(.center)
        .appSurface(.standard)
    }

    private var sourceFootnote: some View {
        Text("Daily values from Apple Health. Apple Health combines overlapping sources such as iPhone, Apple Watch and the Oura app.")
            .font(.caption2)
            .foregroundStyle(AppVisualSystem.ColorToken.textTertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - Charts

    private enum ChartStyle {
        case bars
        case line
    }

    private func metricChart(
        title: String,
        systemImage: String,
        tint: Color,
        style: ChartStyle,
        unit: String,
        value: KeyPath<HealthMetricsDay, Double?>,
        formatter: @escaping (Double) -> String,
        spokenUnit: String? = nil
    ) -> some View {
        let data = days
        let values = data.compactMap { $0[keyPath: value] }
        let average = values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)

        return VStack(alignment: .leading, spacing: 8) {
            AppSectionHeader(
                title,
                subtitle: average.map { "Avg \(formatter($0)) \(unit)" } ?? "No data",
                systemImage: systemImage,
                tint: tint
            )

            if values.isEmpty {
                Text("No data for this period")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 80)
            } else {
                let selection = ChartSelectionKey.binding($chartSelection, chart: title)
                let selected = selection.wrappedValue
                let callouts = data.map { day in
                    day[keyPath: value].map { metricValue in
                        ChartCalloutText(
                            value: ChartValueFormat.metric(metricValue, unit: unit),
                            date: ChartValueFormat.day(isoDay: day.day),
                            spoken: "\(formatter(metricValue)) \(spokenUnit ?? unit), \(chartSpokenDate(day.day))"
                        )
                    }
                }
                Canvas { context, size in
                    drawMetricChart(
                        data: data,
                        value: value,
                        style: style,
                        tint: tint,
                        formatter: formatter,
                        selectedIndex: selected,
                        context: context,
                        size: size
                    )
                }
                .frame(height: chartHeight)
                .accessibilityElement()
                .accessibilityLabel("\(title) chart")
                .accessibilityIdentifier("activity-chart-\(title)")
                .chartSelection(
                    selection,
                    count: data.count,
                    resetID: scope,
                    plotRect: { MetricChartGeometry(data: data, value: value, style: style, size: $0).plotRect },
                    anchor: { index, size in
                        MetricChartGeometry(data: data, value: value, style: style, size: size).anchor(index)
                    },
                    callout: { callouts.indices.contains($0) ? callouts[$0] : nil },
                    tint: tint,
                    accessibilitySummary: chartAccessibilitySummary(
                        data: data,
                        value: value,
                        unit: spokenUnit ?? unit,
                        formatter: formatter
                    ),
                    descriptor: ChartAccessibilityDescriptor(
                        title: title,
                        yTitle: spokenUnit ?? unit,
                        isContinuous: style == .line,
                        values: data.map { $0[keyPath: value] },
                        callouts: callouts
                    )
                )
            }
        }
        .appSurface(.standard)
    }

    private func chartAccessibilitySummary(
        data: [HealthMetricsDay],
        value: KeyPath<HealthMetricsDay, Double?>,
        unit: String,
        formatter: (Double) -> String
    ) -> String {
        let points = data.compactMap { day in day[keyPath: value].map { (day.day, $0) } }
        guard !points.isEmpty else { return "No data" }
        let average = points.map(\.1).reduce(0, +) / Double(points.count)
        let high = points.max { $0.1 < $1.1 }!
        let low = points.min { $0.1 < $1.1 }!
        let dayWord = points.count == 1 ? "day" : "days"
        return "\(points.count) \(dayWord) with data. Average \(formatter(average)) \(unit). High \(formatter(high.1)) on \(chartDateLabel(high.0)). Low \(formatter(low.1)) on \(chartDateLabel(low.0))."
    }

    /// Scale and plot area shared by drawing and tap selection.
    private struct MetricChartGeometry {
        static let topPadding: CGFloat = 10
        static let rightPadding: CGFloat = 8
        static let bottomPadding: CGFloat = 26
        static let leftPadding: CGFloat = 46

        let points: [(index: Int, value: Double)]
        let values: [Double?]
        let style: ChartStyle
        let count: Int
        let minValue: Double
        let maxValue: Double
        let span: Double
        let chartW: CGFloat
        let chartH: CGFloat

        init(data: [HealthMetricsDay], value: KeyPath<HealthMetricsDay, Double?>, style: ChartStyle, size: CGSize) {
            values = data.map { $0[keyPath: value] }
            points = values.enumerated().compactMap { index, value in value.map { (index, $0) } }
            self.style = style
            count = data.count
            let rawMax = points.map(\.value).max() ?? 1
            let rawMin = points.map(\.value).min() ?? 0
            // Bars start at zero; lines zoom to their range so small changes show.
            switch style {
            case .bars:
                minValue = 0
                maxValue = max(rawMax * 1.1, 1)
            case .line:
                let padding = max((rawMax - rawMin) * 0.2, max(rawMax * 0.05, 1))
                minValue = max(rawMin - padding, 0)
                maxValue = rawMax + padding
            }
            span = max(maxValue - minValue, 1)
            chartW = max(size.width - Self.leftPadding - Self.rightPadding, 1)
            chartH = max(size.height - Self.topPadding - Self.bottomPadding, 1)
        }

        var plotRect: CGRect {
            CGRect(x: Self.leftPadding, y: Self.topPadding, width: chartW, height: chartH)
        }

        func xPos(_ index: Int) -> CGFloat {
            ChartSelectionMath.xPosition(
                index: index,
                count: count,
                minX: Self.leftPadding,
                width: chartW,
                centeredInSlots: style == .bars
            )
        }

        func yPos(_ value: Double) -> CGFloat {
            let ratio = (value - minValue) / span
            return Self.topPadding + chartH * (1 - CGFloat(ratio))
        }

        /// Top of the bar, or the dot, for a point with a value.
        func anchor(_ index: Int) -> CGPoint? {
            guard values.indices.contains(index), let value = values[index] else { return nil }
            return CGPoint(x: xPos(index), y: yPos(value))
        }
    }

    private func drawMetricChart(
        data: [HealthMetricsDay],
        value: KeyPath<HealthMetricsDay, Double?>,
        style: ChartStyle,
        tint: Color,
        formatter: (Double) -> String,
        selectedIndex: Int?,
        context: GraphicsContext,
        size: CGSize
    ) {
        let geometry = MetricChartGeometry(data: data, value: value, style: style, size: size)
        let points = geometry.points
        guard !points.isEmpty else { return }

        let maxValue = geometry.maxValue
        let span = geometry.span
        let topPadding = MetricChartGeometry.topPadding
        let leftPadding = MetricChartGeometry.leftPadding
        let chartW = geometry.chartW
        let chartH = geometry.chartH
        let tickCount = 3
        let count = data.count

        func xPos(_ index: Int) -> CGFloat { geometry.xPos(index) }
        func yPos(_ value: Double) -> CGFloat { geometry.yPos(value) }

        for tickIndex in 0...tickCount {
            let ratio = CGFloat(tickIndex) / CGFloat(tickCount)
            let y = topPadding + ratio * chartH
            let tickValue = maxValue - Double(tickIndex) * span / Double(tickCount)

            var gridPath = Path()
            gridPath.move(to: CGPoint(x: leftPadding, y: y))
            gridPath.addLine(to: CGPoint(x: leftPadding + chartW, y: y))
            context.stroke(gridPath, with: .color(.white.opacity(0.07)), lineWidth: 1)

            context.draw(
                Text(formatAxisValue(tickValue)).font(.caption2).foregroundColor(.secondary),
                at: CGPoint(x: leftPadding - 6, y: y),
                anchor: .trailing
            )
        }

        var axisPath = Path()
        axisPath.move(to: CGPoint(x: leftPadding, y: topPadding))
        axisPath.addLine(to: CGPoint(x: leftPadding, y: topPadding + chartH))
        axisPath.addLine(to: CGPoint(x: leftPadding + chartW, y: topPadding + chartH))
        context.stroke(axisPath, with: .color(.white.opacity(0.15)), lineWidth: 1)

        // Average line
        let average = points.map(\.value).reduce(0, +) / Double(points.count)
        var averagePath = Path()
        averagePath.move(to: CGPoint(x: leftPadding, y: yPos(average)))
        averagePath.addLine(to: CGPoint(x: leftPadding + chartW, y: yPos(average)))
        context.stroke(
            averagePath,
            with: .color(.white.opacity(0.3)),
            style: StrokeStyle(lineWidth: 1, dash: [4, 4])
        )

        switch style {
        case .bars:
            let slot = chartW / CGFloat(max(count, 1))
            let barWidth = max(min(slot * 0.62, 22), 1)
            for point in points {
                let top = yPos(point.value)
                let rect = CGRect(
                    x: xPos(point.index) - barWidth / 2,
                    y: top,
                    width: barWidth,
                    height: max(topPadding + chartH - top, 0)
                )
                let opacity: Double
                if let selectedIndex {
                    opacity = point.index == selectedIndex ? 1 : ChartSelectionStyle.dimmedOpacity
                } else {
                    opacity = 0.85
                }
                context.fill(
                    Path(roundedRect: rect, cornerRadius: min(barWidth / 3, 3)),
                    with: .color(tint.opacity(opacity))
                )
            }
        case .line:
            var linePath = Path()
            for (position, point) in points.enumerated() {
                let location = CGPoint(x: xPos(point.index), y: yPos(point.value))
                if position == 0 {
                    linePath.move(to: location)
                } else {
                    linePath.addLine(to: location)
                }
            }
            context.stroke(linePath, with: .color(tint), lineWidth: 2)

            let dotSize: CGFloat = count > 60 ? 3 : 6
            for point in points {
                let rect = CGRect(
                    x: xPos(point.index) - dotSize / 2,
                    y: yPos(point.value) - dotSize / 2,
                    width: dotSize,
                    height: dotSize
                )
                context.fill(Path(ellipseIn: rect), with: .color(tint))
            }
            if let selectedIndex, let anchor = geometry.anchor(selectedIndex) {
                ChartSelectionStyle.drawSelectedDot(at: anchor, tint: tint, radius: 4, context: context)
            }
        }

        let labelIndices = axisLabelIndices(count: count, desired: 4)
        for (position, index) in labelIndices.enumerated() {
            let anchor: UnitPoint
            if labelIndices.count == 1 {
                anchor = .top
            } else if position == 0 {
                anchor = .topLeading
            } else if position == labelIndices.count - 1 {
                anchor = .topTrailing
            } else {
                anchor = .top
            }
            let x = style == .bars && labelIndices.count > 1
                ? (position == 0 ? leftPadding : (position == labelIndices.count - 1 ? leftPadding + chartW : xPos(index)))
                : xPos(index)
            context.draw(
                Text(chartDateLabel(data[index].day)).font(.caption2).foregroundColor(.secondary),
                at: CGPoint(x: x, y: topPadding + chartH + 8),
                anchor: anchor
            )
        }
    }

    private func axisLabelIndices(count: Int, desired: Int) -> [Int] {
        guard count > 0 else { return [] }
        guard count > desired else { return Array(0..<count) }
        return (0..<desired).reduce(into: [Int]()) { indices, labelIndex in
            let index = Int((Double(labelIndex) * Double(count - 1) / Double(desired - 1)).rounded())
            if indices.last != index {
                indices.append(index)
            }
        }
    }

    // MARK: - Formatting

    private func formatSteps(_ value: Double) -> String {
        Int(value.rounded()).formatted(.number.grouping(.automatic))
    }

    private func formatWhole(_ value: Double) -> String {
        Int(value.rounded()).formatted(.number.grouping(.automatic))
    }

    private func formatOneDecimal(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(1)))
    }

    private func formatAxisValue(_ value: Double) -> String {
        if value >= 10_000 {
            return (value / 1000).formatted(.number.precision(.fractionLength(0))) + "k"
        }
        if value >= 1000 {
            return (value / 1000).formatted(.number.precision(.fractionLength(1))) + "k"
        }
        if value < 10 {
            // Small ranges (distance in miles) keep one decimal on the axis.
            return value.formatted(.number.precision(.fractionLength(0...1)))
        }
        return Int(value.rounded()).formatted()
    }

    private func chartSpokenDate(_ day: String) -> String {
        let input = DateFormatter()
        input.calendar = Calendar(identifier: .gregorian)
        input.locale = Locale(identifier: "en_US_POSIX")
        input.timeZone = .current
        input.dateFormat = "yyyy-MM-dd"
        guard let date = input.date(from: day) else { return day }
        return date.formatted(.dateTime.weekday(.wide).month(.wide).day())
    }

    private func chartDateLabel(_ day: String) -> String {
        let input = DateFormatter()
        input.calendar = Calendar(identifier: .gregorian)
        input.locale = Locale(identifier: "en_US_POSIX")
        input.timeZone = .current
        input.dateFormat = "yyyy-MM-dd"
        guard let date = input.date(from: day) else { return String(day.suffix(5)) }

        let output = DateFormatter()
        output.timeZone = .current
        output.setLocalizedDateFormatFromTemplate(scope == "year" ? "MMM" : "M/d")
        return output.string(from: date)
    }

    // MARK: - Loading and sync

    private func loadMetrics() async {
        if metricsLoad.currentRequest?.scope != scope {
            response = nil
        }
        guard let request = metricsLoad.begin(scope: scope) else { return }
        defer { metricsLoad.finish(request) }
        do {
            let loaded = try await api.getHealthMetrics(scope: request.scope)
            guard metricsLoad.isCurrent(request, scope: scope), !Task.isCancelled else { return }
            response = loaded
        } catch {
            guard metricsLoad.isCurrent(request, scope: scope), !Task.isCancelled else { return }
            if !isCancellation(error) {
                alertMessage = error.localizedDescription
            }
        }
    }

    private func syncFromAppleHealth() async {
        guard !isSyncing else { return }
        guard anyReadEnabled else {
            alertMessage = "Activity and heart sync is off. Turn on Read for Activity or Heart in Settings → Data Sources → Apple Health."
            return
        }
        isSyncing = true
        defer { isSyncing = false }

        do {
            let result = try await metricsSync.syncDailyMetrics(
                api: api,
                activity: accessPlan.activity,
                heart: accessPlan.heart
            )
            syncStatus = ManualSyncStatus(syncedAt: Date(), noNewData: result.importedCount == 0)
            ManualSyncStatusLine.announceSuccess()
        } catch APIError.httpError(let status, _) where status == 403 {
            alertMessage = "Apple Health activity and heart access is off for this account. You can change it in Settings → Data Sources."
        } catch {
            alertMessage = "Apple Health: \(error.localizedDescription)"
        }
        await loadMetrics()
    }

    private func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        if let urlError = error as? URLError, urlError.code == .cancelled { return true }
        if case APIError.networkError(let underlying) = error { return isCancellation(underlying) }
        return false
    }
}
