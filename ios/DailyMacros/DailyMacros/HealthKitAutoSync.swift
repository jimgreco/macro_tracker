import Foundation
import HealthKit
import Combine

@MainActor
final class HealthKitAutoSync: ObservableObject {
    private let healthStore = HKHealthStore()
    private let workoutSync = HealthKitWorkoutSync()
    private let wellnessSync = HealthKitWellnessSync()
    private var observerQueries: [HKObserverQuery] = []
    private var api: APIClient?
    private var includeSexualActivity = false
    private var isConfigured = false
    private var isSyncing = false
    private var lastSyncAt: Date?
    private let minimumSyncInterval: TimeInterval = 10 * 60

    func start(api: APIClient, includeSexualActivity: Bool) async {
        guard HKHealthStore.isHealthDataAvailable(), api.token != nil else { return }

        self.api = api
        if isConfigured, self.includeSexualActivity == includeSexualActivity {
            await syncAll(reason: "foreground", respectThrottle: true)
            return
        }

        stop()
        self.api = api
        self.includeSexualActivity = includeSexualActivity

        do {
            try await requestAuthorization(includeSexualActivity: includeSexualActivity)
            try await registerObservers(includeSexualActivity: includeSexualActivity)
            isConfigured = true
            await syncAll(reason: "startup", respectThrottle: true)
        } catch {
            isConfigured = false
        }
    }

    func stop() {
        for query in observerQueries {
            healthStore.stop(query)
        }
        observerQueries = []
        api = nil
        isConfigured = false
        isSyncing = false
    }

    private func requestAuthorization(includeSexualActivity: Bool) async throws {
        guard let activeEnergyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned),
              let bodyMassType = HKQuantityType.quantityType(forIdentifier: .bodyMass),
              let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            return
        }

        let workoutType = HKObjectType.workoutType()
        var shareTypes: Set<HKSampleType> = [workoutType, activeEnergyType, bodyMassType, sleepType]
        var readTypes: Set<HKObjectType> = [workoutType, activeEnergyType, bodyMassType, sleepType]

        if includeSexualActivity,
           let sexualActivityType = HKCategoryType.categoryType(forIdentifier: .sexualActivity) {
            shareTypes.insert(sexualActivityType)
            readTypes.insert(sexualActivityType)
        }

        try await healthStore.requestAuthorization(toShare: shareTypes, read: readTypes)
    }

    private func registerObservers(includeSexualActivity: Bool) async throws {
        var sampleTypes: [HKSampleType] = [HKObjectType.workoutType()]

        if let bodyMassType = HKQuantityType.quantityType(forIdentifier: .bodyMass) {
            sampleTypes.append(bodyMassType)
        }
        if let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) {
            sampleTypes.append(sleepType)
        }
        if includeSexualActivity,
           let sexualActivityType = HKCategoryType.categoryType(forIdentifier: .sexualActivity) {
            sampleTypes.append(sexualActivityType)
        }

        for sampleType in sampleTypes {
            let query = HKObserverQuery(sampleType: sampleType, predicate: nil) { [weak self] _, completion, error in
                guard error == nil else {
                    completion()
                    return
                }

                Task { [weak self] in
                    await self?.syncAll(reason: "observer", respectThrottle: false)
                    completion()
                }
            }
            healthStore.execute(query)
            observerQueries.append(query)
            try await enableBackgroundDelivery(for: sampleType)
        }
    }

    private func enableBackgroundDelivery(for sampleType: HKSampleType) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            healthStore.enableBackgroundDelivery(for: sampleType, frequency: .hourly) { success, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard success else {
                    continuation.resume(returning: ())
                    return
                }
                continuation.resume(returning: ())
            }
        }
    }

    private func syncAll(reason _: String, respectThrottle: Bool) async {
        guard !isSyncing, let api, api.token != nil else { return }
        if respectThrottle,
           let lastSyncAt,
           Date().timeIntervalSince(lastSyncAt) < minimumSyncInterval {
            return
        }

        isSyncing = true
        defer {
            isSyncing = false
            lastSyncAt = Date()
        }

        _ = try? await workoutSync.syncRecentWorkouts(api: api)
        _ = try? await wellnessSync.syncRecentWeight(api: api)
        _ = try? await wellnessSync.syncRecentSleep(api: api)
        if includeSexualActivity {
            _ = try? await wellnessSync.syncRecentSexualActivity(api: api)
        }
    }
}
