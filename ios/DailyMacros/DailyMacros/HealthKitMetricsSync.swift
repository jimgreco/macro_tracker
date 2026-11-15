import Foundation
import HealthKit
import Combine

/// Apple Health data-access groups for daily metrics. Each maps to one
/// optional HealthKit data type in the server's integration catalog.
enum HealthDailyMetricGroup: String, CaseIterable, Sendable {
    case activity
    case heart

    var metrics: [HealthDailyMetric] {
        HealthDailyMetric.allCases.filter { $0.group == self }
    }
}

/// The daily metrics macrovana reads from Apple Health. Raw values are the
/// server contract's metric ids.
enum HealthDailyMetric: String, CaseIterable, Sendable {
    case steps = "steps"
    case activeEnergyKcal = "active_energy_kcal"
    case exerciseMinutes = "exercise_minutes"
    case restingHeartRateBpm = "resting_heart_rate_bpm"
    case hrvSdnnMs = "hrv_sdnn_ms"
    case vo2MaxMlKgMin = "vo2max_ml_kg_min"

    enum Aggregation: Sendable {
        /// Daily total (HealthKit deduplicates overlapping sources).
        case sum
        /// Daily average of discrete samples.
        case average
    }

    var group: HealthDailyMetricGroup {
        switch self {
        case .steps, .activeEnergyKcal, .exerciseMinutes: return .activity
        case .restingHeartRateBpm, .hrvSdnnMs, .vo2MaxMlKgMin: return .heart
        }
    }

    var aggregation: Aggregation {
        group == .activity ? .sum : .average
    }

    var quantityTypeIdentifier: HKQuantityTypeIdentifier {
        switch self {
        case .steps: return .stepCount
        case .activeEnergyKcal: return .activeEnergyBurned
        case .exerciseMinutes: return .appleExerciseTime
        case .restingHeartRateBpm: return .restingHeartRate
        case .hrvSdnnMs: return .heartRateVariabilitySDNN
        case .vo2MaxMlKgMin: return .vo2Max
        }
    }

    var quantityType: HKQuantityType? {
        HKQuantityType.quantityType(forIdentifier: quantityTypeIdentifier)
    }

    var unit: HKUnit {
        switch self {
        case .steps:
            return .count()
        case .activeEnergyKcal:
            return .kilocalorie()
        case .exerciseMinutes:
            return .minute()
        case .restingHeartRateBpm:
            return .count().unitDivided(by: .minute())
        case .hrvSdnnMs:
            return .secondUnit(with: .milli)
        case .vo2MaxMlKgMin:
            return HKUnit.literUnit(with: .milli)
                .unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: .minute()))
        }
    }

    /// Fraction digits kept in the payload (steps are whole counts).
    var fractionDigits: Int {
        switch self {
        case .steps: return 0
        case .activeEnergyKcal, .exerciseMinutes, .restingHeartRateBpm, .hrvSdnnMs: return 1
        case .vo2MaxMlKgMin: return 2
        }
    }
}

/// One daily bucket read from an `HKStatisticsCollection`, before conversion.
struct HealthDailyMetricStatistic {
    let dayStart: Date
    let quantity: HKQuantity?
    /// Samples (discrete metrics) or contributing sources (cumulative metrics)
    /// behind this day's value.
    let sampleCount: Int
}

/// Pure mapping from HealthKit statistics to the server payload; kept free of
/// HealthKit queries so unit conversion, day keys and batching are testable.
enum HealthDailyMetricsMapper {
    static let maximumBatchSize = 1000

    static func payloads(
        metric: HealthDailyMetric,
        statistics: [HealthDailyMetricStatistic],
        calendar: Calendar
    ) -> [HealthMetricDayPayload] {
        let formatter = dayFormatter(calendar: calendar)
        var seenDays = Set<String>()
        var payloads: [HealthMetricDayPayload] = []

        for statistic in statistics {
            // Days without samples have no quantity; never send a zero for them.
            guard let quantity = statistic.quantity,
                  quantity.is(compatibleWith: metric.unit) else { continue }
            let raw = quantity.doubleValue(for: metric.unit)
            guard raw.isFinite, raw >= 0 else { continue }

            let day = formatter.string(from: statistic.dayStart)
            guard seenDays.insert(day).inserted else { continue }

            payloads.append(
                HealthMetricDayPayload(
                    date: day,
                    metric: metric.rawValue,
                    value: rounded(raw, fractionDigits: metric.fractionDigits),
                    sampleCount: max(statistic.sampleCount, 1)
                )
            )
        }

        return payloads
    }

    static func batches(
        _ payloads: [HealthMetricDayPayload],
        size: Int = maximumBatchSize
    ) -> [[HealthMetricDayPayload]] {
        let batchSize = max(1, min(size, maximumBatchSize))
        return stride(from: 0, to: payloads.count, by: batchSize).map { start in
            Array(payloads[start..<min(start + batchSize, payloads.count)])
        }
    }

    static func dayFormatter(calendar: Calendar) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }

    static func rounded(_ value: Double, fractionDigits: Int) -> Double {
        let scale = pow(10, Double(fractionDigits))
        return (value * scale).rounded() / scale
    }
}

enum HealthKitMetricsSyncError: LocalizedError {
    case unavailable

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "Apple Health sync is not available on this device."
        }
    }
}

/// Reads daily Activity (steps, active energy, exercise minutes) and Heart
/// (resting heart rate, HRV, VO2 max) values from Apple Health and upserts
/// them with `POST /health-metrics`. Read-only: never writes to HealthKit.
final class HealthKitMetricsSync: ObservableObject {
    private let healthStore = HKHealthStore()
    private let recentWindowDays = 35
    private let backfillWindowDays = 365

    static func readTypes(for groups: [HealthDailyMetricGroup]) -> Set<HKObjectType> {
        Set(groups.flatMap(\.metrics).compactMap { $0.quantityType })
    }

    static func enabledGroups(
        activity: IntegrationDirectionSelection,
        heart: IntegrationDirectionSelection
    ) -> [HealthDailyMetricGroup] {
        var groups: [HealthDailyMetricGroup] = []
        if activity.readEnabled { groups.append(.activity) }
        if heart.readEnabled { groups.append(.heart) }
        return groups
    }

    func syncDailyMetrics(
        api: APIClient,
        activity: IntegrationDirectionSelection,
        heart: IntegrationDirectionSelection
    ) async throws -> HealthKitMetricSyncResult {
        let groups = Self.enabledGroups(activity: activity, heart: heart)
        guard !groups.isEmpty else { return .empty }
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitMetricsSyncError.unavailable
        }

        try await healthStore.requestAuthorization(
            toShare: [],
            read: Self.readTypes(for: groups)
        )

        let calendar = Calendar.current
        let now = Date()
        let owner = await api.authenticatedUserId
        var importedCount = 0
        var skippedCount = 0

        for group in groups {
            let backfillKey = owner.map { "healthkit-daily-metrics-backfill-v1-\(group.rawValue)-\($0)" }
            let needsBackfill = backfillKey.map { !UserDefaults.standard.bool(forKey: $0) } == true
            // One account-scoped 365-day pass per group, then a rolling window
            // that covers late-arriving Watch/Oura-app samples.
            let windowDays = needsBackfill ? backfillWindowDays : recentWindowDays
            let todayStart = calendar.startOfDay(for: now)
            let start = calendar.date(byAdding: .day, value: -(windowDays - 1), to: todayStart) ?? todayStart

            var payloads: [HealthMetricDayPayload] = []
            for metric in group.metrics {
                guard let type = metric.quantityType else { continue }
                let statistics = try await dailyStatistics(
                    metric: metric,
                    type: type,
                    from: start,
                    to: now,
                    calendar: calendar
                )
                payloads += HealthDailyMetricsMapper.payloads(
                    metric: metric,
                    statistics: statistics,
                    calendar: calendar
                )
            }

            for batch in HealthDailyMetricsMapper.batches(payloads) {
                let response = try await api.postHealthMetrics(days: batch)
                importedCount += response.upserted
                skippedCount += response.skipped
            }

            // Apple Health hides read denial as "no data", so only mark the
            // backfill done once it actually found days to upload.
            if needsBackfill, !payloads.isEmpty, let backfillKey {
                UserDefaults.standard.set(true, forKey: backfillKey)
            }
        }

        return HealthKitMetricSyncResult(
            importedCount: importedCount,
            exportedCount: 0,
            skippedCount: skippedCount
        )
    }

    // MARK: - HealthKit queries

    private func dailyStatistics(
        metric: HealthDailyMetric,
        type: HKQuantityType,
        from start: Date,
        to end: Date,
        calendar: Calendar
    ) async throws -> [HealthDailyMetricStatistic] {
        let sampleCounts: [Date: Int]
        switch metric.aggregation {
        case .sum:
            sampleCounts = [:]
        case .average:
            // Discrete heart samples are sparse, so counting them is cheap.
            sampleCounts = try await dailySampleCounts(type: type, from: start, to: end, calendar: calendar)
        }

        let options: HKStatisticsOptions = metric.aggregation == .sum
            ? [.cumulativeSum, .separateBySource]
            : [.discreteAverage]
        let collection = try await statisticsCollection(
            type: type,
            options: options,
            from: start,
            to: end,
            calendar: calendar
        )

        var results: [HealthDailyMetricStatistic] = []
        collection.enumerateStatistics(from: start, to: end) { statistics, _ in
            let dayStart = calendar.startOfDay(for: statistics.startDate)
            switch metric.aggregation {
            case .sum:
                results.append(
                    HealthDailyMetricStatistic(
                        dayStart: dayStart,
                        quantity: statistics.sumQuantity(),
                        sampleCount: statistics.sources?.count ?? 1
                    )
                )
            case .average:
                results.append(
                    HealthDailyMetricStatistic(
                        dayStart: dayStart,
                        quantity: statistics.averageQuantity(),
                        sampleCount: sampleCounts[dayStart] ?? 1
                    )
                )
            }
        }
        return results
    }

    private func statisticsCollection(
        type: HKQuantityType,
        options: HKStatisticsOptions,
        from start: Date,
        to end: Date,
        calendar: Calendar
    ) async throws -> HKStatisticsCollection {
        try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: options,
                anchorDate: calendar.startOfDay(for: start),
                intervalComponents: DateComponents(day: 1)
            )
            query.initialResultsHandler = { _, collection, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let collection {
                    continuation.resume(returning: collection)
                } else {
                    continuation.resume(throwing: HealthKitMetricsSyncError.unavailable)
                }
            }
            healthStore.execute(query)
        }
    }

    private func dailySampleCounts(
        type: HKQuantityType,
        from start: Date,
        to end: Date,
        calendar: Calendar
    ) async throws -> [Date: Int] {
        try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                var counts: [Date: Int] = [:]
                for sample in samples ?? [] {
                    counts[calendar.startOfDay(for: sample.startDate), default: 0] += 1
                }
                continuation.resume(returning: counts)
            }
            healthStore.execute(query)
        }
    }
}
