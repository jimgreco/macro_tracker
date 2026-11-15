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
    case walkingRunningDistanceM = "walking_running_distance_m"
    case flightsClimbed = "flights_climbed"
    case walkingSpeedMps = "walking_speed_mps"
    case walkingStepLengthM = "walking_step_length_m"
    case heartRateAvgBpm = "heart_rate_avg_bpm"
    case heartRateMinBpm = "heart_rate_min_bpm"
    case respiratoryRateBrpm = "respiratory_rate_brpm"
    case oxygenSaturationPct = "oxygen_saturation_pct"

    enum Aggregation: Sendable {
        /// Daily total (HealthKit deduplicates overlapping sources).
        case sum
        /// Daily average of discrete samples.
        case average
        /// Daily minimum of discrete samples.
        case minimum
    }

    /// The first six ids, which every server release accepts. Servers older
    /// than the wider metric list reject a batch containing newer ids, so the
    /// sync falls back to these alone.
    static let original: [HealthDailyMetric] = [
        .steps, .activeEnergyKcal, .exerciseMinutes, .restingHeartRateBpm, .hrvSdnnMs, .vo2MaxMlKgMin
    ]

    var isOriginal: Bool { Self.original.contains(self) }

    var group: HealthDailyMetricGroup {
        switch self {
        case .steps, .activeEnergyKcal, .exerciseMinutes,
             .walkingRunningDistanceM, .flightsClimbed, .walkingSpeedMps, .walkingStepLengthM:
            return .activity
        case .restingHeartRateBpm, .hrvSdnnMs, .vo2MaxMlKgMin,
             .heartRateAvgBpm, .heartRateMinBpm, .respiratoryRateBrpm, .oxygenSaturationPct:
            return .heart
        }
    }

    var aggregation: Aggregation {
        switch self {
        case .steps, .activeEnergyKcal, .exerciseMinutes, .walkingRunningDistanceM, .flightsClimbed:
            return .sum
        case .heartRateMinBpm:
            return .minimum
        case .walkingSpeedMps, .walkingStepLengthM, .restingHeartRateBpm, .hrvSdnnMs, .vo2MaxMlKgMin,
             .heartRateAvgBpm, .respiratoryRateBrpm, .oxygenSaturationPct:
            return .average
        }
    }

    var quantityTypeIdentifier: HKQuantityTypeIdentifier {
        switch self {
        case .steps: return .stepCount
        case .activeEnergyKcal: return .activeEnergyBurned
        case .exerciseMinutes: return .appleExerciseTime
        case .restingHeartRateBpm: return .restingHeartRate
        case .hrvSdnnMs: return .heartRateVariabilitySDNN
        case .vo2MaxMlKgMin: return .vo2Max
        case .walkingRunningDistanceM: return .distanceWalkingRunning
        case .flightsClimbed: return .flightsClimbed
        case .walkingSpeedMps: return .walkingSpeed
        case .walkingStepLengthM: return .walkingStepLength
        case .heartRateAvgBpm, .heartRateMinBpm: return .heartRate
        case .respiratoryRateBrpm: return .respiratoryRate
        case .oxygenSaturationPct: return .oxygenSaturation
        }
    }

    var quantityType: HKQuantityType? {
        HKQuantityType.quantityType(forIdentifier: quantityTypeIdentifier)
    }

    /// HealthKit options for the daily statistics query.
    var statisticsOptions: HKStatisticsOptions {
        switch aggregation {
        case .sum: return [.cumulativeSum, .separateBySource]
        case .average: return [.discreteAverage]
        case .minimum: return [.discreteMin]
        }
    }

    var unit: HKUnit {
        switch self {
        case .steps, .flightsClimbed:
            return .count()
        case .activeEnergyKcal:
            return .kilocalorie()
        case .exerciseMinutes:
            return .minute()
        case .restingHeartRateBpm, .heartRateAvgBpm, .heartRateMinBpm, .respiratoryRateBrpm:
            return .count().unitDivided(by: .minute())
        case .hrvSdnnMs:
            return .secondUnit(with: .milli)
        case .vo2MaxMlKgMin:
            return HKUnit.literUnit(with: .milli)
                .unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: .minute()))
        case .walkingRunningDistanceM, .walkingStepLengthM:
            return .meter()
        case .walkingSpeedMps:
            return .meter().unitDivided(by: .second())
        case .oxygenSaturationPct:
            return .percent()
        }
    }

    /// Multiplier from `unit` to the stored value: HealthKit reports oxygen
    /// saturation as a 0–1 fraction, the server stores percent (0–100).
    var payloadScale: Double {
        self == .oxygenSaturationPct ? 100 : 1
    }

    /// The server's accepted range (`src/health-metrics.js`). Values outside it
    /// (for example a mis-entered manual sample) are not sent, so one bad day
    /// cannot fail a whole batch.
    var validRange: ClosedRange<Double> {
        switch self {
        case .steps, .walkingRunningDistanceM: return 0...200_000
        case .activeEnergyKcal: return 0...20_000
        case .exerciseMinutes: return 0...1_440
        case .restingHeartRateBpm: return 0...250
        case .hrvSdnnMs: return 0...1_000
        case .vo2MaxMlKgMin: return 0...100
        case .flightsClimbed: return 0...2_000
        case .walkingSpeedMps: return 0...5
        case .walkingStepLengthM: return 0...3
        case .heartRateAvgBpm, .heartRateMinBpm: return 20...250
        case .respiratoryRateBrpm: return 4...60
        case .oxygenSaturationPct: return 50...100
        }
    }

    /// Fraction digits kept in the payload (steps and flights are whole counts).
    var fractionDigits: Int {
        switch self {
        case .steps, .flightsClimbed: return 0
        case .activeEnergyKcal, .exerciseMinutes, .restingHeartRateBpm, .hrvSdnnMs,
             .walkingRunningDistanceM, .heartRateAvgBpm, .heartRateMinBpm,
             .respiratoryRateBrpm, .oxygenSaturationPct:
            return 1
        case .vo2MaxMlKgMin, .walkingSpeedMps, .walkingStepLengthM: return 2
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
            let raw = quantity.doubleValue(for: metric.unit) * metric.payloadScale
            guard raw.isFinite, raw >= 0 else { continue }
            let value = rounded(raw, fractionDigits: metric.fractionDigits)
            guard metric.validRange.contains(value) else { continue }

            let day = formatter.string(from: statistic.dayStart)
            guard seenDays.insert(day).inserted else { continue }

            payloads.append(
                HealthMetricDayPayload(
                    date: day,
                    metric: metric.rawValue,
                    value: value,
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

/// Outcome of uploading one group's payloads.
struct HealthDailyMetricsUploadOutcome: Equatable {
    var upserted = 0
    var skipped = 0
    /// Metric ids the server could not store yet (older server or table
    /// structure). Their history is re-sent on a later sync.
    var unsupportedMetrics: Set<String> = []
}

enum HealthDailyMetricsUploader {
    /// Uploads payloads in batches. A server release older than the wider
    /// metric list rejects any batch with a newer id (400), so that batch is
    /// re-sent with only the original metrics and the newer ids are reported
    /// unsupported. Re-sending a day is harmless: the server upserts.
    static func upload(
        _ payloads: [HealthMetricDayPayload],
        post: ([HealthMetricDayPayload]) async throws -> HealthMetricsUploadResponse
    ) async throws -> HealthDailyMetricsUploadOutcome {
        let originalIds = Set(HealthDailyMetric.original.map(\.rawValue))
        var outcome = HealthDailyMetricsUploadOutcome()
        for batch in HealthDailyMetricsMapper.batches(payloads) {
            let response: HealthMetricsUploadResponse
            do {
                response = try await post(batch)
            } catch APIError.httpError(let status, let message) where status == 400 {
                let original = batch.filter { originalIds.contains($0.metric) }
                let newer = batch.filter { !originalIds.contains($0.metric) }
                guard !newer.isEmpty else { throw APIError.httpError(status: status, message: message) }
                outcome.unsupportedMetrics.formUnion(newer.map(\.metric))
                outcome.skipped += newer.count
                guard !original.isEmpty else { continue }
                response = try await post(original)
            }
            outcome.upserted += response.upserted
            outcome.skipped += response.skipped
            outcome.unsupportedMetrics.formUnion(response.unsupportedMetrics ?? [])
        }
        return outcome
    }
}

/// Reads daily Activity (steps, distance, flights, walking speed and step
/// length, active energy, exercise minutes) and Heart (heart rate average and
/// minimum, resting heart rate, HRV, respiratory rate, blood oxygen, VO2 max)
/// values from Apple Health and upserts them with `POST /health-metrics`.
/// Read-only: never writes to HealthKit.
final class HealthKitMetricsSync: ObservableObject {
    private let healthStore = HKHealthStore()
    private let recentWindowDays = 35
    private let backfillWindowDays = 365

    /// One-time 365-day backfill flag per account and group. Version 2 (the
    /// wider metric list) gives the new metrics a year of history; re-sending
    /// the original metrics alongside is harmless because the server upserts.
    static func backfillKey(group: HealthDailyMetricGroup, owner: String) -> String {
        "healthkit-daily-metrics-backfill-v2-\(group.rawValue)-\(owner)"
    }

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
            let backfillKey = owner.map { Self.backfillKey(group: group, owner: $0) }
            let needsBackfill = backfillKey.map { !UserDefaults.standard.bool(forKey: $0) } == true
            // One account-scoped 365-day pass per group, then a rolling window
            // that covers late-arriving Watch/Oura-app samples.
            let windowDays = needsBackfill ? backfillWindowDays : recentWindowDays
            let todayStart = calendar.startOfDay(for: now)
            let start = calendar.date(byAdding: .day, value: -(windowDays - 1), to: todayStart) ?? todayStart

            // Heart rate feeds both the daily average and the daily minimum;
            // count its samples once.
            var sampleCountsByType: [HKQuantityTypeIdentifier: [Date: Int]] = [:]
            var payloads: [HealthMetricDayPayload] = []
            for metric in group.metrics {
                guard let type = metric.quantityType else { continue }
                var sampleCounts: [Date: Int] = [:]
                if metric.aggregation != .sum {
                    if let cached = sampleCountsByType[metric.quantityTypeIdentifier] {
                        sampleCounts = cached
                    } else {
                        sampleCounts = try await dailySampleCounts(type: type, from: start, to: now, calendar: calendar)
                        sampleCountsByType[metric.quantityTypeIdentifier] = sampleCounts
                    }
                }
                let statistics = try await dailyStatistics(
                    metric: metric,
                    type: type,
                    sampleCounts: sampleCounts,
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

            let outcome = try await HealthDailyMetricsUploader.upload(payloads) { batch in
                try await api.postHealthMetrics(days: batch)
            }
            importedCount += outcome.upserted
            skippedCount += outcome.skipped

            // Apple Health hides read denial as "no data", so only mark the
            // backfill done once it actually found days to upload, and keep it
            // pending while the server still refuses some metrics.
            if needsBackfill, !payloads.isEmpty, outcome.unsupportedMetrics.isEmpty, let backfillKey {
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
        sampleCounts: [Date: Int],
        from start: Date,
        to end: Date,
        calendar: Calendar
    ) async throws -> [HealthDailyMetricStatistic] {
        let collection = try await statisticsCollection(
            type: type,
            options: metric.statisticsOptions,
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
            case .minimum:
                results.append(
                    HealthDailyMetricStatistic(
                        dayStart: dayStart,
                        quantity: statistics.minimumQuantity(),
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
