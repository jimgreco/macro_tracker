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
    private var accessPlan = HealthKitAccessPlan.denied
    private var isConfigured = false
    private var isSyncing = false
    private var lastSyncAt: Date?
    private let minimumSyncInterval: TimeInterval = 10 * 60

    func start(
        api: APIClient,
        includeSexualActivity: Bool,
        accessPlan: HealthKitAccessPlan
    ) async {
        guard HKHealthStore.isHealthDataAvailable(), api.token != nil else { return }

        self.api = api
        let effectivePlan = accessPlan.includingSexualActivity(includeSexualActivity)
        if isConfigured,
           self.includeSexualActivity == includeSexualActivity,
           self.accessPlan == effectivePlan {
            await syncAll(reason: "foreground", respectThrottle: true)
            return
        }

        stop()
        self.api = api
        self.includeSexualActivity = includeSexualActivity
        self.accessPlan = effectivePlan

        guard effectivePlan.hasAnyAccess else { return }

        do {
            try await requestAuthorization(accessPlan: effectivePlan)
            try await registerObservers(accessPlan: effectivePlan)
            isConfigured = true
            await syncAll(reason: "startup", respectThrottle: false)
        } catch {
            isConfigured = false
            Diagnostics.shared.record(
                level: "warning",
                category: "healthkit",
                message: "Apple Health access setup failed"
            )
        }
    }

    func stop() {
        for query in observerQueries {
            healthStore.stop(query)
        }
        observerQueries = []
        api = nil
        accessPlan = .denied
        isConfigured = false
        isSyncing = false
    }

    private func requestAuthorization(accessPlan: HealthKitAccessPlan) async throws {
        guard let activeEnergyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned),
              let bodyMassType = HKQuantityType.quantityType(forIdentifier: .bodyMass),
              let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            return
        }

        let workoutType = HKObjectType.workoutType()
        var shareTypes: Set<HKSampleType> = []
        var readTypes: Set<HKObjectType> = []

        if accessPlan.workouts.writeEnabled {
            shareTypes.formUnion([workoutType, activeEnergyType])
        }
        if accessPlan.workouts.readEnabled {
            readTypes.formUnion([workoutType, activeEnergyType])
        }
        if accessPlan.weight.writeEnabled { shareTypes.insert(bodyMassType) }
        if accessPlan.weight.readEnabled { readTypes.insert(bodyMassType) }
        if accessPlan.sleep.writeEnabled { shareTypes.insert(sleepType) }
        if accessPlan.sleep.readEnabled { readTypes.insert(sleepType) }

        if (accessPlan.sexualActivity.readEnabled || accessPlan.sexualActivity.writeEnabled),
           let sexualActivityType = HKCategoryType.categoryType(forIdentifier: .sexualActivity) {
            if accessPlan.sexualActivity.writeEnabled { shareTypes.insert(sexualActivityType) }
            if accessPlan.sexualActivity.readEnabled { readTypes.insert(sexualActivityType) }
        }

        try await healthStore.requestAuthorization(toShare: shareTypes, read: readTypes)
    }

    private func registerObservers(accessPlan: HealthKitAccessPlan) async throws {
        var sampleTypes: [HKSampleType] = []

        if accessPlan.workouts.readEnabled {
            sampleTypes.append(HKObjectType.workoutType())
        }
        if accessPlan.weight.readEnabled,
           let bodyMassType = HKQuantityType.quantityType(forIdentifier: .bodyMass) {
            sampleTypes.append(bodyMassType)
        }
        if accessPlan.sleep.readEnabled,
           let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) {
            sampleTypes.append(sleepType)
        }
        if accessPlan.sexualActivity.readEnabled,
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

        if accessPlan.workouts.readEnabled {
            _ = try? await workoutSync.syncRecentWorkouts(api: api, access: accessPlan.workouts)
        }
        if accessPlan.weight.readEnabled {
            _ = try? await wellnessSync.syncRecentWeight(api: api, access: accessPlan.weight)
        }
        if accessPlan.sleep.readEnabled {
            _ = try? await wellnessSync.syncRecentSleep(api: api, access: accessPlan.sleep)
        }
        if includeSexualActivity, accessPlan.sexualActivity.readEnabled {
            _ = try? await wellnessSync.syncRecentSexualActivity(
                api: api,
                access: accessPlan.sexualActivity
            )
        }
    }
}
