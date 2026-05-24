import Foundation
import HealthKit
import Combine

struct HealthKitWorkoutSyncResult {
    let importedCount: Int
    let exportedCount: Int
    let skippedCount: Int
}

enum HealthKitWorkoutSyncError: LocalizedError {
    case unavailable
    case missingActiveEnergyType
    case workoutUnavailable

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "Apple Health workout sync is not available on this device."
        case .missingActiveEnergyType:
            return "Apple Health active energy data is not available on this device."
        case .workoutUnavailable:
            return "Apple Health saved the workout, but did not return a workout record."
        }
    }
}

final class HealthKitWorkoutSync: ObservableObject {
    private let healthStore = HKHealthStore()
    private let syncWindowDays = 30
    private let dailyMacrosExternalPrefix = "dailymacros-workout-"
    private let dailyMacrosSourceMetadataKey = "com.dailymacros.source"
    private let dailyMacrosWorkoutIdMetadataKey = "com.dailymacros.workoutId"

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

    func syncRecentWorkouts(api: APIClient) async throws -> HealthKitWorkoutSyncResult {
        guard HKHealthStore.isHealthDataAvailable() else {
            throw HealthKitWorkoutSyncError.unavailable
        }

        try await requestAuthorization()

        let cutoff = syncCutoffDate()
        let healthWorkouts = try await fetchHealthWorkouts(since: cutoff)
        let existingResponse = try await api.getWorkouts(limit: 500, offset: 0, scope: "month")
        var existingExternalIds = Set(existingResponse.entries.compactMap { entry in
            entry.source == "healthkit" ? entry.externalId : nil
        })
        var existingSignatures = Set(existingResponse.entries.compactMap(workoutSignature))

        var importedCount = 0
        var skippedCount = 0

        for healthWorkout in healthWorkouts {
            guard shouldImport(healthWorkout) else {
                skippedCount += 1
                continue
            }

            let externalId = healthWorkout.uuid.uuidString
            let durationHours = max(healthWorkout.duration / 3600, 0.01)
            let signature = workoutSignature(start: healthWorkout.startDate, durationHours: durationHours)

            if existingExternalIds.contains(externalId) || existingSignatures.contains(signature) {
                skippedCount += 1
                continue
            }

            let response = try await api.addWorkout(
                description: displayName(for: healthWorkout.workoutActivityType),
                intensity: intensity(for: healthWorkout.workoutActivityType),
                durationHours: durationHours,
                caloriesBurned: activeEnergyCalories(for: healthWorkout),
                loggedAt: isoFormatter.string(from: healthWorkout.startDate),
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

        let refreshedResponse = try await api.getWorkouts(limit: 500, offset: 0, scope: "month")
        var dailyMacrosExternalIds = dailyMacrosExternalUUIDs(from: healthWorkouts)
        var exportedCount = 0

        for workout in refreshedResponse.entries {
            guard shouldExport(workout, cutoff: cutoff) else { continue }

            let externalUUID = dailyMacrosExternalUUID(for: workout)
            if dailyMacrosExternalIds.contains(externalUUID) {
                skippedCount += 1
                continue
            }

            try await saveWorkoutToHealthKit(workout, externalUUID: externalUUID)
            dailyMacrosExternalIds.insert(externalUUID)
            exportedCount += 1
        }

        return HealthKitWorkoutSyncResult(
            importedCount: importedCount,
            exportedCount: exportedCount,
            skippedCount: skippedCount
        )
    }

    private func requestAuthorization() async throws {
        guard let activeEnergyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) else {
            throw HealthKitWorkoutSyncError.missingActiveEnergyType
        }

        let workoutType = HKObjectType.workoutType()
        let shareTypes: Set<HKSampleType> = [workoutType, activeEnergyType]
        let readTypes: Set<HKObjectType> = [workoutType, activeEnergyType]
        try await healthStore.requestAuthorization(toShare: shareTypes, read: readTypes)
    }

    private func fetchHealthWorkouts(since cutoff: Date) async throws -> [HKWorkout] {
        try await withCheckedThrowingContinuation { continuation in
            let workoutType = HKObjectType.workoutType()
            let predicate = HKQuery.predicateForSamples(
                withStart: cutoff,
                end: Date(),
                options: [.strictStartDate]
            )
            let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
            let query = HKSampleQuery(
                sampleType: workoutType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [sort]
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(returning: (samples as? [HKWorkout]) ?? [])
            }

            healthStore.execute(query)
        }
    }

    private func saveWorkoutToHealthKit(_ workout: WorkoutEntry, externalUUID: String) async throws {
        guard let activeEnergyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) else {
            throw HealthKitWorkoutSyncError.missingActiveEnergyType
        }
        guard let start = parseDate(workout.loggedAt) else { return }

        let durationSeconds = max(workout.durationHours * 3600, 60)
        let end = start.addingTimeInterval(durationSeconds)
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = activityType(for: workout.description)
        configuration.locationType = .unknown

        let metadata: [String: Any] = [
            HKMetadataKeyExternalUUID: externalUUID,
            HKMetadataKeyWasUserEntered: true,
            dailyMacrosSourceMetadataKey: "DailyMacros",
            dailyMacrosWorkoutIdMetadataKey: "\(workout.id)"
        ]

        let builder = HKWorkoutBuilder(
            healthStore: healthStore,
            configuration: configuration,
            device: nil
        )

        try await builder.beginCollection(at: start)
        try await builder.addMetadata(metadata)

        if workout.caloriesBurned > 0 {
            let energy = HKQuantity(unit: .kilocalorie(), doubleValue: workout.caloriesBurned)
            let energySample = HKQuantitySample(
                type: activeEnergyType,
                quantity: energy,
                start: start,
                end: end,
                metadata: metadata
            )
            try await builder.addSamples([energySample])
        }

        try await builder.endCollection(at: end)
        _ = try await finishWorkout(builder)
    }

    private func finishWorkout(_ builder: HKWorkoutBuilder) async throws -> HKWorkout {
        try await withCheckedThrowingContinuation { continuation in
            builder.finishWorkout { workout, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let workout else {
                    continuation.resume(throwing: HealthKitWorkoutSyncError.workoutUnavailable)
                    return
                }
                continuation.resume(returning: workout)
            }
        }
    }

    private func shouldImport(_ workout: HKWorkout) -> Bool {
        guard let externalUUID = workout.metadata?[HKMetadataKeyExternalUUID] as? String else {
            return true
        }
        return !externalUUID.hasPrefix(dailyMacrosExternalPrefix)
    }

    private func shouldExport(_ workout: WorkoutEntry, cutoff: Date) -> Bool {
        guard workout.source != "healthkit",
              let loggedAt = parseDate(workout.loggedAt),
              loggedAt >= cutoff else {
            return false
        }
        return true
    }

    private func activeEnergyCalories(for workout: HKWorkout) -> Double {
        guard let activeEnergyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned),
              let quantity = workout.statistics(for: activeEnergyType)?.sumQuantity() else {
            return 0
        }
        return max(0, quantity.doubleValue(for: .kilocalorie()))
    }

    private func dailyMacrosExternalUUIDs(from workouts: [HKWorkout]) -> Set<String> {
        Set(
            workouts.compactMap { workout in
                guard let value = workout.metadata?[HKMetadataKeyExternalUUID] as? String,
                      value.hasPrefix(dailyMacrosExternalPrefix) else {
                    return nil
                }
                return value
            }
        )
    }

    private func dailyMacrosExternalUUID(for workout: WorkoutEntry) -> String {
        "\(dailyMacrosExternalPrefix)\(workout.id)"
    }

    private func workoutSignature(_ workout: WorkoutEntry) -> String? {
        guard let start = parseDate(workout.loggedAt) else { return nil }
        return workoutSignature(start: start, durationHours: workout.durationHours)
    }

    private func workoutSignature(start: Date, durationHours: Double) -> String {
        let fiveMinuteBucket = Int(start.timeIntervalSince1970 / 300)
        let durationMinutes = Int((durationHours * 60).rounded())
        return "\(fiveMinuteBucket)|\(durationMinutes)"
    }

    private func syncCutoffDate() -> Date {
        Calendar.current.date(byAdding: .day, value: -syncWindowDays, to: Date()) ?? Date()
    }

    private func parseDate(_ value: String) -> Date? {
        fractionalIsoFormatter.date(from: value) ?? isoFormatter.date(from: value)
    }

    private func displayName(for activityType: HKWorkoutActivityType) -> String {
        switch activityType {
        case .running:
            return "Run"
        case .walking:
            return "Walk"
        case .cycling:
            return "Cycling"
        case .swimming:
            return "Swim"
        case .hiking:
            return "Hike"
        case .rowing:
            return "Rowing"
        case .elliptical:
            return "Elliptical"
        case .stairClimbing:
            return "Stair Climbing"
        case .traditionalStrengthTraining:
            return "Strength Training"
        case .functionalStrengthTraining:
            return "Functional Strength Training"
        case .highIntensityIntervalTraining:
            return "HIIT"
        case .coreTraining:
            return "Core Training"
        case .yoga:
            return "Yoga"
        case .pilates:
            return "Pilates"
        case .cardioDance, .socialDance:
            return "Dance"
        case .tennis:
            return "Tennis"
        case .soccer:
            return "Soccer"
        case .basketball:
            return "Basketball"
        default:
            return "Workout"
        }
    }

    private func intensity(for activityType: HKWorkoutActivityType) -> String {
        switch activityType {
        case .highIntensityIntervalTraining, .running, .cycling, .swimming, .rowing, .stairClimbing:
            return "high"
        case .walking, .yoga, .pilates:
            return "low"
        default:
            return "medium"
        }
    }

    private func activityType(for description: String) -> HKWorkoutActivityType {
        let value = description.lowercased()
        if value.contains("hiit") || value.contains("interval") {
            return .highIntensityIntervalTraining
        }
        if value.contains("run") {
            return .running
        }
        if value.contains("walk") {
            return .walking
        }
        if value.contains("cycl") || value.contains("bike") {
            return .cycling
        }
        if value.contains("swim") {
            return .swimming
        }
        if value.contains("hike") {
            return .hiking
        }
        if value.contains("row") {
            return .rowing
        }
        if value.contains("elliptical") {
            return .elliptical
        }
        if value.contains("stair") {
            return .stairClimbing
        }
        if value.contains("functional strength") {
            return .functionalStrengthTraining
        }
        if value.contains("strength") || value.contains("lift") || value.contains("weight") {
            return .traditionalStrengthTraining
        }
        if value.contains("core") {
            return .coreTraining
        }
        if value.contains("yoga") {
            return .yoga
        }
        if value.contains("pilates") {
            return .pilates
        }
        if value.contains("dance") {
            return .cardioDance
        }
        if value.contains("tennis") {
            return .tennis
        }
        if value.contains("soccer") {
            return .soccer
        }
        if value.contains("basketball") {
            return .basketball
        }
        return .other
    }
}
