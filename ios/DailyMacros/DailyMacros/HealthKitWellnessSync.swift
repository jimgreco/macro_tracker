import Foundation
import HealthKit
import Combine

struct HealthKitMetricSyncResult {
    let importedCount: Int
    let exportedCount: Int
    let skippedCount: Int

    static let empty = HealthKitMetricSyncResult(importedCount: 0, exportedCount: 0, skippedCount: 0)
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
        let evidence: [String: Any]
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

    func syncRecentWeight(
        api: APIClient,
        access: IntegrationDirectionSelection
    ) async throws -> HealthKitMetricSyncResult {
        guard access.readEnabled || access.writeEnabled else { return .empty }
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitWellnessSyncError.unavailable
        }
        guard let bodyMassType = HKQuantityType.quantityType(forIdentifier: .bodyMass) else {
            throw HealthKitWellnessSyncError.missingType("weight")
        }

        try await requestAuthorization(
            share: access.writeEnabled ? [bodyMassType] : [],
            read: access.readEnabled ? [bodyMassType] : []
        )

        let cutoff = syncCutoffDate()
        let healthSamples = access.readEnabled
            ? try await fetchQuantitySamples(type: bodyMassType, since: cutoff)
            : []
        if access.readEnabled { await recordSourceDiagnostics(healthSamples, cutoff: cutoff) }
        var importedCount = 0
        var skippedCount = 0

        if access.readEnabled {
            let existingResponse = try await api.getWeights(scope: "month", limit: 500, offset: 0)
            var existingExternalIds = Set(existingResponse.entries.compactMap { entry in
                entry.source == "healthkit" ? entry.externalId : nil
            })
            var existingSignatures = Set(existingResponse.entries.compactMap(weightSignature))

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
        }

        var exportedCount = 0
        // Historical export needs a HealthKit query for deduplication, so it is
        // allowed only when Read is also enabled. Write-only mode is still fully
        // supported for newly created entries through exportWeight(_:access:).
        if access.readEnabled && access.writeEnabled {
            let refreshedResponse = try await api.getWeights(scope: "month", limit: 500, offset: 0)
            var dailyMacrosExternalIds = dailyMacrosExternalUUIDs(from: healthSamples, prefix: dailyMacrosWeightPrefix)

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
        }

        return HealthKitMetricSyncResult(importedCount: importedCount, exportedCount: exportedCount, skippedCount: skippedCount)
    }

    func exportWeight(
        _ entry: WeightEntry,
        access: IntegrationDirectionSelection
    ) async throws -> HealthKitMetricSyncResult {
        guard access.writeEnabled else { return .empty }
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitWellnessSyncError.unavailable
        }
        guard let bodyMassType = HKQuantityType.quantityType(forIdentifier: .bodyMass) else {
            throw HealthKitWellnessSyncError.missingType("weight")
        }
        try await requestAuthorization(share: [bodyMassType], read: [])
        try await saveWeightToHealthKit(
            entry,
            type: bodyMassType,
            externalUUID: "\(dailyMacrosWeightPrefix)\(entry.id)"
        )
        return HealthKitMetricSyncResult(importedCount: 0, exportedCount: 1, skippedCount: 0)
    }

    func syncRecentSleep(
        api: APIClient,
        access: IntegrationDirectionSelection
    ) async throws -> HealthKitMetricSyncResult {
        guard access.readEnabled || access.writeEnabled else { return .empty }
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitWellnessSyncError.unavailable
        }
        guard let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            throw HealthKitWellnessSyncError.missingType("sleep")
        }

        try await requestAuthorization(
            share: access.writeEnabled ? [sleepType] : [],
            read: access.readEnabled ? [sleepType] : []
        )

        let cutoff = syncCutoffDate()
        let owner = await api.authenticatedUserId
        let evidenceKey = owner.map { "healthkit-source-evidence-v1-syncRecentSleep-\($0)" }
        let needsSourceBackfill = access.readEnabled && evidenceKey.map { !UserDefaults.standard.bool(forKey: $0) } == true
        // One account-scoped 90-day source-evidence pass aligns with direct Oura's
        // first backfill. Subsequent queries and historical exports remain 30 days.
        let sourceCutoff = needsSourceBackfill
            ? Calendar.current.date(byAdding: .day, value: -90, to: Date()) ?? cutoff
            : cutoff
        let healthSamples = access.readEnabled
            ? try await fetchCategorySamples(type: sleepType, since: sourceCutoff)
            : []
        if access.readEnabled { await recordSourceDiagnostics(healthSamples, cutoff: sourceCutoff) }
        var importedCount = 0
        var skippedCount = 0

        if access.readEnabled {
            let sessions = sleepSessions(from: healthSamples.filter {
                shouldImport($0, dailyMacrosPrefix: dailyMacrosSleepPrefix)
            })
            let existingResponse = try await api.getSleepEntries(scope: "month", limit: 500, offset: 0)
            var existingHealthKitEntries = existingResponse.entries.filter {
                $0.source?.lowercased() == "healthkit"
            }

            for session in sessions {
                let existingIndex = existingHealthKitEntries.firstIndex {
                    isSameSleepSession($0, as: session)
                }
                let response = try await api.addSleepEntry(
                    durationHours: session.durationHours,
                    wakeUps: session.wakeUps,
                    loggedAt: isoFormatter.string(from: session.start),
                    source: "healthkit",
                    externalId: session.externalId,
                    healthkitMetadata: session.evidence
                )

                let syncedEntry = SleepEntry(
                    id: response.id ?? existingIndex.map { existingHealthKitEntries[$0].id } ?? -1,
                    durationHours: session.durationHours,
                    wakeUps: session.wakeUps,
                    quality: existingIndex.flatMap { existingHealthKitEntries[$0].quality },
                    notes: existingIndex.flatMap { existingHealthKitEntries[$0].notes },
                    loggedAt: isoFormatter.string(from: session.start),
                    source: "healthkit",
                    externalId: session.externalId
                )
                if let existingIndex {
                    existingHealthKitEntries[existingIndex] = syncedEntry
                } else {
                    existingHealthKitEntries.append(syncedEntry)
                }
                if response.created != false {
                    importedCount += 1
                } else {
                    skippedCount += 1
                }
            }
        }

        var exportedCount = 0
        if access.readEnabled && access.writeEnabled {
            let refreshedResponse = try await api.getSleepEntries(scope: "month", limit: 500, offset: 0)
            var dailyMacrosExternalIds = dailyMacrosExternalUUIDs(from: healthSamples, prefix: dailyMacrosSleepPrefix)

            for entry in refreshedResponse.entries {
                guard shouldExport(source: entry.source, loggedAt: entry.loggedAt, cutoff: cutoff) else { continue }
                let externalUUID = "\(dailyMacrosSleepPrefix)\(entry.id)"
                if dailyMacrosExternalIds.contains(externalUUID) {
                    skippedCount += 1
                    continue
                }

                try await saveSleepToHealthKit(entry, type: sleepType, externalUUID: externalUUID)
                dailyMacrosExternalIds.insert(externalUUID)
                exportedCount += 1
            }
        }

        if needsSourceBackfill, let evidenceKey { UserDefaults.standard.set(true, forKey: evidenceKey) }
        return HealthKitMetricSyncResult(importedCount: importedCount, exportedCount: exportedCount, skippedCount: skippedCount)
    }

    func exportSleep(
        _ entry: SleepEntry,
        access: IntegrationDirectionSelection
    ) async throws -> HealthKitMetricSyncResult {
        guard access.writeEnabled else { return .empty }
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitWellnessSyncError.unavailable
        }
        guard let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            throw HealthKitWellnessSyncError.missingType("sleep")
        }
        try await requestAuthorization(share: [sleepType], read: [])
        try await saveSleepToHealthKit(
            entry,
            type: sleepType,
            externalUUID: "\(dailyMacrosSleepPrefix)\(entry.id)"
        )
        return HealthKitMetricSyncResult(importedCount: 0, exportedCount: 1, skippedCount: 0)
    }

    func syncRecentSexualActivity(
        api: APIClient,
        access: IntegrationDirectionSelection
    ) async throws -> HealthKitMetricSyncResult {
        guard access.readEnabled || access.writeEnabled else { return .empty }
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitWellnessSyncError.unavailable
        }
        guard let sexualActivityType = HKCategoryType.categoryType(forIdentifier: .sexualActivity) else {
            throw HealthKitWellnessSyncError.missingType("sexual activity")
        }

        try await requestAuthorization(
            share: access.writeEnabled ? [sexualActivityType] : [],
            read: access.readEnabled ? [sexualActivityType] : []
        )

        let cutoff = syncCutoffDate()
        let healthSamples = access.readEnabled
            ? try await fetchCategorySamples(type: sexualActivityType, since: cutoff)
            : []
        if access.readEnabled { await recordSourceDiagnostics(healthSamples, cutoff: cutoff) }
        var importedCount = 0
        var skippedCount = 0

        if access.readEnabled {
            let existingResponse = try await api.getHealthEntries(scope: "month", limit: 500, offset: 0)
            var existingExternalIds = Set(existingResponse.entries.compactMap { entry in
                entry.source == "healthkit" ? entry.externalId : nil
            })
            var existingSignatures = Set(existingResponse.entries.compactMap(sexualActivitySignature))

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
        }

        var exportedCount = 0
        if access.readEnabled && access.writeEnabled {
            let refreshedResponse = try await api.getHealthEntries(scope: "month", limit: 500, offset: 0)
            var dailyMacrosExternalIds = dailyMacrosExternalUUIDs(
                from: healthSamples,
                prefix: dailyMacrosSexualActivityPrefix
            )

            for entry in refreshedResponse.entries {
                guard shouldExport(source: entry.source, loggedAt: entry.loggedAt, cutoff: cutoff) else { continue }
                let externalUUID = "\(dailyMacrosSexualActivityPrefix)\(entry.id)"
                if dailyMacrosExternalIds.contains(externalUUID) {
                    skippedCount += 1
                    continue
                }

                try await saveSexualActivityToHealthKit(
                    entry,
                    type: sexualActivityType,
                    externalUUID: externalUUID
                )
                dailyMacrosExternalIds.insert(externalUUID)
                exportedCount += 1
            }
        }

        return HealthKitMetricSyncResult(importedCount: importedCount, exportedCount: exportedCount, skippedCount: skippedCount)
    }

    func exportSexualActivity(
        _ entry: HealthEntry,
        access: IntegrationDirectionSelection
    ) async throws -> HealthKitMetricSyncResult {
        guard access.writeEnabled else { return .empty }
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitWellnessSyncError.unavailable
        }
        guard let sexualActivityType = HKCategoryType.categoryType(forIdentifier: .sexualActivity) else {
            throw HealthKitWellnessSyncError.missingType("sexual activity")
        }
        try await requestAuthorization(share: [sexualActivityType], read: [])
        try await saveSexualActivityToHealthKit(
            entry,
            type: sexualActivityType,
            externalUUID: "\(dailyMacrosSexualActivityPrefix)\(entry.id)"
        )
        return HealthKitMetricSyncResult(importedCount: 0, exportedCount: 1, skippedCount: 0)
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
                    let failure = error as NSError
                    Task { @MainActor in
                        Diagnostics.shared.record(level: "warning", category: "healthkit-sources", message: "Apple Health query failed", details: [
                            "type": type.identifier, "errorDomain": failure.domain, "errorCode": "\(failure.code)"
                        ])
                    }
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(returning: (samples as? [T]) ?? [])
            }

            healthStore.execute(query)
        }
    }

    private func recordSourceDiagnostics(_ samples: [HKSample], cutoff: Date) async {
        let groups = Dictionary(grouping: samples) {
            "\($0.sampleType.identifier)|\($0.sourceRevision.source.bundleIdentifier)|\($0.sourceRevision.source.name)"
        }
        for (source, values) in groups.sorted(by: { $0.key < $1.key }) {
            await Diagnostics.shared.record(category: "healthkit-sources", message: "Observed Apple Health source", details: [
                "typeBundleName": source, "sampleCount": "\(values.count)",
                "queryStart": isoFormatter.string(from: cutoff), "queryEnd": isoFormatter.string(from: Date()),
                "readAuthorization": "Requested; Apple does not disclose read denial"
            ])
        }
        if samples.isEmpty {
            await Diagnostics.shared.record(category: "healthkit-sources", message: "No readable samples", details: [
                "queryStart": isoFormatter.string(from: cutoff), "sampleCount": "0",
                "readAuthorization": "Requested; empty results do not prove read denial"
            ])
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

    private func saveSleepToHealthKit(
        _ entry: SleepEntry,
        type: HKCategoryType,
        externalUUID: String
    ) async throws {
        guard let start = parseDate(entry.loggedAt) else { return }
        let end = start.addingTimeInterval(max(entry.durationHours * 3600, 60))
        let metadata = dailyMacrosMetadata(externalUUID: externalUUID, entryId: entry.id)
        let sample = HKCategorySample(
            type: type,
            value: HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
            start: start,
            end: end,
            metadata: metadata
        )
        try await saveSample(sample)
    }

    private func saveSexualActivityToHealthKit(
        _ entry: HealthEntry,
        type: HKCategoryType,
        externalUUID: String
    ) async throws {
        guard let start = parseDate(entry.loggedAt) else { return }
        var metadata = dailyMacrosMetadata(externalUUID: externalUUID, entryId: entry.id)
        metadata[dailyMacrosActivityTypeMetadataKey] = normalizeActivityType(entry.type)
        let sample = HKCategorySample(
            type: type,
            value: HKCategoryValue.notApplicable.rawValue,
            start: start,
            end: start.addingTimeInterval(60),
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
        Dictionary(grouping: samples, by: { $0.sourceRevision.source.bundleIdentifier })
            .values.flatMap { sourceSleepSessions(from: $0) }
            .sorted { $0.start < $1.start }
    }

    private func sourceSleepSessions(from samples: [HKCategorySample]) -> [SleepSession] {
        let asleepSamples = samples
            .filter(isAsleepSample)
            .sorted { $0.startDate < $1.startDate }
        let awakeSamples = samples.filter(isAwakeSample)
        guard !asleepSamples.isEmpty else { return [] }

        let maxSessionGap: TimeInterval = 90 * 60
        var sessions: [SleepSession] = []
        var intervals: [(start: Date, end: Date)] = []
        var currentSessionEnd: Date?

        func finishSession() {
            guard let first = intervals.first else { return }
            let start = first.start
            let end = intervals.reduce(first.end) { max($0, $1.end) }
            let durationHours = mergedDurationHours(intervals)
            guard durationHours > 0 else { return }

            let awakeIntervals = awakeSamples.compactMap { sample -> (start: Date, end: Date)? in
                guard overlaps(sample, start: start, end: end) else { return nil }
                return (max(sample.startDate, start), min(sample.endDate, end))
            }
            guard let source = samples.first?.sourceRevision.source else { return }
            var evidence: [String: Any] = [
                "sourceName": source.name,
                "sourceBundleId": source.bundleIdentifier,
                "endedAt": isoFormatter.string(from: end),
                "awakeSeconds": mergedDurationHours(awakeIntervals) * 3600
            ]
            for (key, stage) in [("lightSleepSeconds", HKCategoryValueSleepAnalysis.asleepCore),
                                 ("deepSleepSeconds", .asleepDeep), ("remSleepSeconds", .asleepREM)] {
                let stageIntervals = samples.filter { $0.value == stage.rawValue && overlaps($0, start: start, end: end) }
                    .map { (start: max($0.startDate, start), end: min($0.endDate, end)) }
                if !stageIntervals.isEmpty { evidence[key] = mergedDurationHours(stageIntervals) * 3600 }
            }
            sessions.append(SleepSession(
                start: start,
                end: end,
                durationHours: min(durationHours, 24),
                evidence: evidence,
                wakeUps: 0,
                externalId: "\(source.bundleIdentifier):\(sleepSessionExternalId(start: start))"
            ))
        }

        for sample in asleepSamples {
            if let sessionEnd = currentSessionEnd,
               sample.startDate.timeIntervalSince(sessionEnd) > maxSessionGap {
                finishSession()
                intervals = []
                currentSessionEnd = nil
            }
            intervals.append((sample.startDate, sample.endDate))
            currentSessionEnd = max(currentSessionEnd ?? sample.endDate, sample.endDate)
        }

        finishSession()
        return sessions
    }

    private func mergedDurationHours(_ intervals: [(start: Date, end: Date)]) -> Double {
        let merged = mergedIntervals(intervals)
        let seconds = merged.reduce(0.0) { total, interval in
            total + interval.end.timeIntervalSince(interval.start)
        }
        return seconds / 3600
    }

    private func mergedIntervals(
        _ intervals: [(start: Date, end: Date)]
    ) -> [(start: Date, end: Date)] {
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
        return merged
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
        if sample.sourceRevision.source.bundleIdentifier == Bundle.main.bundleIdentifier ||
            sample.metadata?[dailyMacrosSourceMetadataKey] != nil { return false }
        guard let externalUUID = sample.metadata?[HKMetadataKeyExternalUUID] as? String else {
            return true
        }
        return !externalUUID.hasPrefix(dailyMacrosPrefix)
    }

    private func shouldExport(source: String?, loggedAt: String, cutoff: Date) -> Bool {
        guard source != "healthkit", source != "oura",
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

    private func sleepSessionExternalId(start: Date) -> String {
        let thirtyMinuteBucket = Int(start.timeIntervalSince1970 / 1800)
        return "sleep-v2-\(thirtyMinuteBucket)"
    }

    private func isSameSleepSession(_ entry: SleepEntry, as session: SleepSession) -> Bool {
        guard let entryStart = parseDate(entry.loggedAt) else { return false }
        if entry.externalId == session.externalId {
            return true
        }
        if abs(entryStart.timeIntervalSince(session.start)) <= 15 * 60 {
            return true
        }
        let entryEnd = entryStart.addingTimeInterval(entry.durationHours * 3600)
        return entryStart < session.end && entryEnd > session.start
    }

    private func sleepEntry(_ entry: SleepEntry, matches session: SleepSession) -> Bool {
        guard entry.externalId == session.externalId,
              let entryStart = parseDate(entry.loggedAt) else {
            return false
        }
        return abs(entryStart.timeIntervalSince(session.start)) < 1
            && abs(entry.durationHours - session.durationHours) < 0.011
            && entry.wakeUps == session.wakeUps
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
