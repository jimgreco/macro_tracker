import Foundation
import HealthKit
import Combine

struct HealthKitMetricSyncResult {
    let importedCount: Int
    let exportedCount: Int
    let skippedCount: Int
}

enum HealthKitWellnessSyncError: LocalizedError {
    case unavailable
    case missingType(String)
    case saveFailed

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "Apple Health sync is not available on this device."
        case .missingType(let name):
            return "Apple Health \(name) data is not available on this device."
        case .saveFailed:
            return "Apple Health did not save the sample."
        }
    }
}

final class HealthKitWellnessSync: ObservableObject {
    private struct SleepSession {
        let start: Date
        let end: Date
        let durationHours: Double
        let wakeUps: Int
        let externalId: String
    }

    private let healthStore = HKHealthStore()
    private let syncWindowDays = 30
    private let dailyMacrosWeightPrefix = "dailymacros-weight-"
    private let dailyMacrosSleepPrefix = "dailymacros-sleep-"
    private let dailyMacrosSexualActivityPrefix = "dailymacros-sexual-activity-"
    private let dailyMacrosSourceMetadataKey = "com.dailymacros.source"
    private let dailyMacrosEntryIdMetadataKey = "com.dailymacros.entryId"
    private let dailyMacrosActivityTypeMetadataKey = "com.dailymacros.sexualActivityType"

    private let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private let fractionalIsoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    func syncRecentWeight(api: APIClient) async throws -> HealthKitMetricSyncResult {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitWellnessSyncError.unavailable
        }
        guard let bodyMassType = HKQuantityType.quantityType(forIdentifier: .bodyMass) else {
            throw HealthKitWellnessSyncError.missingType("weight")
        }

        try await requestAuthorization(share: [bodyMassType], read: [bodyMassType])

        let cutoff = syncCutoffDate()
        let healthSamples = try await fetchQuantitySamples(type: bodyMassType, since: cutoff)
        let existingResponse = try await api.getWeights(scope: "month", limit: 500, offset: 0)
        var existingExternalIds = Set(existingResponse.entries.compactMap { entry in
            entry.source == "healthkit" ? entry.externalId : nil
        })
        var existingSignatures = Set(existingResponse.entries.compactMap(weightSignature))
        var importedCount = 0
        var skippedCount = 0

        for sample in healthSamples {
            guard shouldImport(sample, dailyMacrosPrefix: dailyMacrosWeightPrefix) else {
                skippedCount += 1
                continue
            }

            let weight = max(0, sample.quantity.doubleValue(for: .pound()))
            let externalId = sample.uuid.uuidString
            let signature = weightSignature(start: sample.startDate, weight: weight)
            if weight <= 0 || existingExternalIds.contains(externalId) || existingSignatures.contains(signature) {
                skippedCount += 1
                continue
            }

            let response = try await api.addWeight(
                weight,
                loggedAt: isoFormatter.string(from: sample.startDate),
                source: "healthkit",
                externalId: externalId
            )

            existingExternalIds.insert(externalId)
            existingSignatures.insert(signature)
            if response.created != false {
                importedCount += 1
            } else {
                skippedCount += 1
            }
        }

        let refreshedResponse = try await api.getWeights(scope: "month", limit: 500, offset: 0)
        var dailyMacrosExternalIds = dailyMacrosExternalUUIDs(from: healthSamples, prefix: dailyMacrosWeightPrefix)
        var exportedCount = 0

        for entry in refreshedResponse.entries {
            guard shouldExport(source: entry.source, loggedAt: entry.loggedAt, cutoff: cutoff) else { continue }

            let externalUUID = "\(dailyMacrosWeightPrefix)\(entry.id)"
            if dailyMacrosExternalIds.contains(externalUUID) {
                skippedCount += 1
                continue
            }

            try await saveWeightToHealthKit(entry, type: bodyMassType, externalUUID: externalUUID)
            dailyMacrosExternalIds.insert(externalUUID)
            exportedCount += 1
        }

        return HealthKitMetricSyncResult(importedCount: importedCount, exportedCount: exportedCount, skippedCount: skippedCount)
    }

    func syncRecentSleep(api: APIClient) async throws -> HealthKitMetricSyncResult {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitWellnessSyncError.unavailable
        }
        guard let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            throw HealthKitWellnessSyncError.missingType("sleep")
        }

        try await requestAuthorization(share: [sleepType], read: [sleepType])

        let cutoff = syncCutoffDate()
        let healthSamples = try await fetchCategorySamples(type: sleepType, since: cutoff)
        let sessions = sleepSessions(from: healthSamples.filter { shouldImport($0, dailyMacrosPrefix: dailyMacrosSleepPrefix) })
        let existingResponse = try await api.getSleepEntries(scope: "month", limit: 500, offset: 0)
        var existingExternalIds = Set(existingResponse.entries.compactMap { entry in
            entry.source == "healthkit" ? entry.externalId : nil
        })
        var existingSignatures = Set(existingResponse.entries.compactMap(sleepSignature))
        var importedCount = 0
        var skippedCount = 0

        for session in sessions {
            let signature = sleepSignature(start: session.start, durationHours: session.durationHours)
            if existingExternalIds.contains(session.externalId) || existingSignatures.contains(signature) {
                skippedCount += 1
                continue
            }

            let response = try await api.addSleepEntry(
                durationHours: session.durationHours,
                wakeUps: session.wakeUps,
                loggedAt: isoFormatter.string(from: session.start),
                source: "healthkit",
                externalId: session.externalId
            )

            existingExternalIds.insert(session.externalId)
            existingSignatures.insert(signature)
            if response.created != false {
                importedCount += 1
            } else {
                skippedCount += 1
            }
        }

        let refreshedResponse = try await api.getSleepEntries(scope: "month", limit: 500, offset: 0)
        var dailyMacrosExternalIds = dailyMacrosExternalUUIDs(from: healthSamples, prefix: dailyMacrosSleepPrefix)
        var exportedCount = 0

        for entry in refreshedResponse.entries {
            guard shouldExport(source: entry.source, loggedAt: entry.loggedAt, cutoff: cutoff),
                  let start = parseDate(entry.loggedAt) else { continue }

            let externalUUID = "\(dailyMacrosSleepPrefix)\(entry.id)"
            if dailyMacrosExternalIds.contains(externalUUID) {
                skippedCount += 1
                continue
            }

            let end = start.addingTimeInterval(max(entry.durationHours * 3600, 60))
            let metadata = dailyMacrosMetadata(externalUUID: externalUUID, entryId: entry.id)
            let sample = HKCategorySample(
                type: sleepType,
                value: HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                start: start,
                end: end,
                metadata: metadata
            )
            try await saveSample(sample)
            dailyMacrosExternalIds.insert(externalUUID)
            exportedCount += 1
        }

        return HealthKitMetricSyncResult(importedCount: importedCount, exportedCount: exportedCount, skippedCount: skippedCount)
    }

    func syncRecentSexualActivity(api: APIClient) async throws -> HealthKitMetricSyncResult {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitWellnessSyncError.unavailable
        }
        guard let sexualActivityType = HKCategoryType.categoryType(forIdentifier: .sexualActivity) else {
            throw HealthKitWellnessSyncError.missingType("sexual activity")
        }

        try await requestAuthorization(share: [sexualActivityType], read: [sexualActivityType])

        let cutoff = syncCutoffDate()
        let healthSamples = try await fetchCategorySamples(type: sexualActivityType, since: cutoff)
        let existingResponse = try await api.getHealthEntries(scope: "month", limit: 500, offset: 0)
        var existingExternalIds = Set(existingResponse.entries.compactMap { entry in
            entry.source == "healthkit" ? entry.externalId : nil
        })
        var existingSignatures = Set(existingResponse.entries.compactMap(sexualActivitySignature))
        var importedCount = 0
        var skippedCount = 0

        for sample in healthSamples {
            guard shouldImport(sample, dailyMacrosPrefix: dailyMacrosSexualActivityPrefix) else {
                skippedCount += 1
                continue
            }

            let type = normalizeActivityType(sample.metadata?[dailyMacrosActivityTypeMetadataKey] as? String)
            let externalId = sample.uuid.uuidString
            let signature = sexualActivitySignature(start: sample.startDate, type: type)
            if existingExternalIds.contains(externalId) || existingSignatures.contains(signature) {
                skippedCount += 1
                continue
            }

            let response = try await api.addHealthEntry(
                type: type,
                loggedAt: isoFormatter.string(from: sample.startDate),
                source: "healthkit",
                externalId: externalId
            )

            existingExternalIds.insert(externalId)
            existingSignatures.insert(signature)
            if response.created != false {
                importedCount += 1
            } else {
                skippedCount += 1
            }
        }

        let refreshedResponse = try await api.getHealthEntries(scope: "month", limit: 500, offset: 0)
        var dailyMacrosExternalIds = dailyMacrosExternalUUIDs(from: healthSamples, prefix: dailyMacrosSexualActivityPrefix)
        var exportedCount = 0

        for entry in refreshedResponse.entries {
            guard shouldExport(source: entry.source, loggedAt: entry.loggedAt, cutoff: cutoff),
                  let start = parseDate(entry.loggedAt) else { continue }

            let externalUUID = "\(dailyMacrosSexualActivityPrefix)\(entry.id)"
            if dailyMacrosExternalIds.contains(externalUUID) {
                skippedCount += 1
                continue
            }

            var metadata = dailyMacrosMetadata(externalUUID: externalUUID, entryId: entry.id)
            metadata[dailyMacrosActivityTypeMetadataKey] = normalizeActivityType(entry.type)
            let sample = HKCategorySample(
                type: sexualActivityType,
                value: HKCategoryValue.notApplicable.rawValue,
                start: start,
                end: start.addingTimeInterval(60),
                metadata: metadata
            )
            try await saveSample(sample)
            dailyMacrosExternalIds.insert(externalUUID)
            exportedCount += 1
        }

        return HealthKitMetricSyncResult(importedCount: importedCount, exportedCount: exportedCount, skippedCount: skippedCount)
    }

    private func requestAuthorization(share shareTypes: Set<HKSampleType>, read readTypes: Set<HKObjectType>) async throws {
        try await healthStore.requestAuthorization(toShare: shareTypes, read: readTypes)
    }

    private func fetchQuantitySamples(type: HKQuantityType, since cutoff: Date) async throws -> [HKQuantitySample] {
        let samples: [HKQuantitySample] = try await fetchSamples(type: type, since: cutoff)
        return samples
    }

    private func fetchCategorySamples(type: HKCategoryType, since cutoff: Date) async throws -> [HKCategorySample] {
        let samples: [HKCategorySample] = try await fetchSamples(type: type, since: cutoff)
        return samples
    }

    private func fetchSamples<T: HKSample>(type: HKSampleType, since cutoff: Date) async throws -> [T] {
        try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(
                withStart: cutoff,
                end: Date(),
                options: [.strictStartDate]
            )
            let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [sort]
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(returning: (samples as? [T]) ?? [])
            }

            healthStore.execute(query)
        }
    }

    private func saveWeightToHealthKit(_ entry: WeightEntry, type: HKQuantityType, externalUUID: String) async throws {
        guard let start = parseDate(entry.loggedAt) else { return }

        let metadata = dailyMacrosMetadata(externalUUID: externalUUID, entryId: entry.id)
        let sample = HKQuantitySample(
            type: type,
            quantity: HKQuantity(unit: .pound(), doubleValue: entry.weight),
            start: start,
            end: start,
            metadata: metadata
        )
        try await saveSample(sample)
    }

    private func saveSample(_ sample: HKSample) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            healthStore.save(sample) { success, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard success else {
                    continuation.resume(throwing: HealthKitWellnessSyncError.saveFailed)
                    return
                }
                continuation.resume(returning: ())
            }
        }
    }

    private func sleepSessions(from samples: [HKCategorySample]) -> [SleepSession] {
        let asleepSamples = samples
            .filter(isAsleepSample)
            .sorted { $0.startDate < $1.startDate }
        let awakeSamples = samples.filter(isAwakeSample)
        guard !asleepSamples.isEmpty else { return [] }

        let maxSessionGap: TimeInterval = 90 * 60
        var sessions: [SleepSession] = []
        var intervals: [(start: Date, end: Date)] = []

        func finishSession() {
            guard let first = intervals.first, let last = intervals.last else { return }
            let start = first.start
            let end = intervals.reduce(last.end) { max($0, $1.end) }
            let durationHours = mergedDurationHours(intervals)
            guard durationHours > 0 else { return }

            let wakeUps = awakeSamples.filter { overlaps($0, start: start, end: end) }.count
            let durationMinutes = Int((durationHours * 60).rounded())
            let externalId = "sleep-\(Int(start.timeIntervalSince1970))-\(Int(end.timeIntervalSince1970))-\(durationMinutes)"
            sessions.append(SleepSession(
                start: start,
                end: end,
                durationHours: min(durationHours, 24),
                wakeUps: wakeUps,
                externalId: externalId
            ))
        }

        for sample in asleepSamples {
            if let lastEnd = intervals.last?.end,
               sample.startDate.timeIntervalSince(lastEnd) > maxSessionGap {
                finishSession()
                intervals = []
            }
            intervals.append((sample.startDate, sample.endDate))
        }

        finishSession()
        return sessions
    }

    private func mergedDurationHours(_ intervals: [(start: Date, end: Date)]) -> Double {
        let sorted = intervals.sorted { $0.start < $1.start }
        var merged: [(start: Date, end: Date)] = []
        for interval in sorted {
            guard interval.end > interval.start else { continue }
            if let last = merged.last, interval.start <= last.end {
                merged[merged.count - 1] = (last.start, max(last.end, interval.end))
            } else {
                merged.append(interval)
            }
        }

        let seconds = merged.reduce(0.0) { total, interval in
            total + interval.end.timeIntervalSince(interval.start)
        }
        return seconds / 3600
    }

    private func overlaps(_ sample: HKSample, start: Date, end: Date) -> Bool {
        sample.startDate < end && sample.endDate > start
    }

    private func isAsleepSample(_ sample: HKCategorySample) -> Bool {
        guard let value = HKCategoryValueSleepAnalysis(rawValue: sample.value) else { return false }
        switch value {
        case .asleep, .asleepUnspecified, .asleepCore, .asleepDeep, .asleepREM:
            return true
        default:
            return false
        }
    }

    private func isAwakeSample(_ sample: HKCategorySample) -> Bool {
        HKCategoryValueSleepAnalysis(rawValue: sample.value) == .awake
    }

    private func shouldImport(_ sample: HKSample, dailyMacrosPrefix: String) -> Bool {
        guard let externalUUID = sample.metadata?[HKMetadataKeyExternalUUID] as? String else {
            return true
        }
        return !externalUUID.hasPrefix(dailyMacrosPrefix)
    }

    private func shouldExport(source: String?, loggedAt: String, cutoff: Date) -> Bool {
        guard source != "healthkit",
              let date = parseDate(loggedAt),
              date >= cutoff else {
            return false
        }
        return true
    }

    private func dailyMacrosExternalUUIDs(from samples: [HKSample], prefix: String) -> Set<String> {
        Set(
            samples.compactMap { sample in
                guard let value = sample.metadata?[HKMetadataKeyExternalUUID] as? String,
                      value.hasPrefix(prefix) else {
                    return nil
                }
                return value
            }
        )
    }

    private func dailyMacrosMetadata(externalUUID: String, entryId: Int) -> [String: Any] {
        [
            HKMetadataKeyExternalUUID: externalUUID,
            HKMetadataKeyWasUserEntered: true,
            dailyMacrosSourceMetadataKey: "DailyMacros",
            dailyMacrosEntryIdMetadataKey: "\(entryId)"
        ]
    }

    private func weightSignature(_ entry: WeightEntry) -> String? {
        guard let start = parseDate(entry.loggedAt) else { return nil }
        return weightSignature(start: start, weight: entry.weight)
    }

    private func weightSignature(start: Date, weight: Double) -> String {
        let fiveMinuteBucket = Int(start.timeIntervalSince1970 / 300)
        let tenths = Int((weight * 10).rounded())
        return "\(fiveMinuteBucket)|\(tenths)"
    }

    private func sleepSignature(_ entry: SleepEntry) -> String? {
        guard let start = parseDate(entry.loggedAt) else { return nil }
        return sleepSignature(start: start, durationHours: entry.durationHours)
    }

    private func sleepSignature(start: Date, durationHours: Double) -> String {
        let thirtyMinuteBucket = Int(start.timeIntervalSince1970 / 1800)
        let durationMinutes = Int((durationHours * 60).rounded())
        return "\(thirtyMinuteBucket)|\(durationMinutes)"
    }

    private func sexualActivitySignature(_ entry: HealthEntry) -> String? {
        guard let start = parseDate(entry.loggedAt) else { return nil }
        return sexualActivitySignature(start: start, type: entry.type)
    }

    private func sexualActivitySignature(start: Date, type: String) -> String {
        let fiveMinuteBucket = Int(start.timeIntervalSince1970 / 300)
        return "\(fiveMinuteBucket)|\(normalizeActivityType(type))"
    }

    private func normalizeActivityType(_ value: String?) -> String {
        let normalized = String(value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if ["masturbation", "oral sex", "vaginal sex", "other"].contains(normalized) {
            return normalized
        }
        return "other"
    }

    private func syncCutoffDate() -> Date {
        Calendar.current.date(byAdding: .day, value: -syncWindowDays, to: Date()) ?? Date()
    }

    private func parseDate(_ value: String) -> Date? {
        fractionalIsoFormatter.date(from: value) ?? isoFormatter.date(from: value)
    }
}
