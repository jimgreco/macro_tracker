import HealthKit
import XCTest
@testable import DailyMacros

final class HealthKitMetricsSyncTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }

    private func dayStart(_ day: String) -> Date {
        let formatter = HealthDailyMetricsMapper.dayFormatter(calendar: calendar)
        return calendar.startOfDay(for: formatter.date(from: day)!)
    }

    func testMetricIdsGroupsAndAggregationsMatchTheServerContract() {
        XCTAssertEqual(
            HealthDailyMetricGroup.activity.metrics.map(\.rawValue),
            ["steps", "active_energy_kcal", "exercise_minutes", "walking_running_distance_m",
             "flights_climbed", "walking_speed_mps", "walking_step_length_m"]
        )
        XCTAssertEqual(
            HealthDailyMetricGroup.heart.metrics.map(\.rawValue),
            ["resting_heart_rate_bpm", "hrv_sdnn_ms", "vo2max_ml_kg_min", "heart_rate_avg_bpm",
             "heart_rate_min_bpm", "respiratory_rate_brpm", "oxygen_saturation_pct"]
        )
        let sums: [HealthDailyMetric] = [.steps, .activeEnergyKcal, .exerciseMinutes, .walkingRunningDistanceM, .flightsClimbed]
        XCTAssertEqual(HealthDailyMetric.allCases.filter { $0.aggregation == .sum }, sums)
        XCTAssertEqual(HealthDailyMetric.allCases.filter { $0.aggregation == .minimum }, [.heartRateMinBpm])
        XCTAssertEqual(HealthDailyMetric.walkingSpeedMps.aggregation, .average)
        XCTAssertEqual(HealthDailyMetric.walkingStepLengthM.aggregation, .average)
        XCTAssertEqual(HealthDailyMetric.heartRateAvgBpm.aggregation, .average)
        XCTAssertEqual(HealthDailyMetric.exerciseMinutes.quantityTypeIdentifier, .appleExerciseTime)
        XCTAssertEqual(HealthDailyMetric.hrvSdnnMs.quantityTypeIdentifier, .heartRateVariabilitySDNN)
        XCTAssertEqual(HealthDailyMetric.walkingRunningDistanceM.quantityTypeIdentifier, .distanceWalkingRunning)
        XCTAssertEqual(HealthDailyMetric.flightsClimbed.quantityTypeIdentifier, .flightsClimbed)
        XCTAssertEqual(HealthDailyMetric.walkingSpeedMps.quantityTypeIdentifier, .walkingSpeed)
        XCTAssertEqual(HealthDailyMetric.walkingStepLengthM.quantityTypeIdentifier, .walkingStepLength)
        XCTAssertEqual(HealthDailyMetric.heartRateAvgBpm.quantityTypeIdentifier, .heartRate)
        XCTAssertEqual(HealthDailyMetric.heartRateMinBpm.quantityTypeIdentifier, .heartRate)
        XCTAssertEqual(HealthDailyMetric.respiratoryRateBrpm.quantityTypeIdentifier, .respiratoryRate)
        XCTAssertEqual(HealthDailyMetric.oxygenSaturationPct.quantityTypeIdentifier, .oxygenSaturation)
        // Statistics options per aggregation.
        XCTAssertEqual(HealthDailyMetric.flightsClimbed.statisticsOptions, [.cumulativeSum, .separateBySource])
        XCTAssertEqual(HealthDailyMetric.heartRateAvgBpm.statisticsOptions, [.discreteAverage])
        XCTAssertEqual(HealthDailyMetric.heartRateMinBpm.statisticsOptions, [.discreteMin])
        XCTAssertEqual(HealthDailyMetric.original.map(\.rawValue), ["steps", "active_energy_kcal", "exercise_minutes",
            "resting_heart_rate_bpm", "hrv_sdnn_ms", "vo2max_ml_kg_min"])
        // Every read type is a quantity type HealthKit knows.
        XCTAssertTrue(HealthDailyMetric.allCases.allSatisfy { $0.quantityType != nil })
    }

    func testReadTypesAreRequestedOnlyForEnabledGroups() {
        let activityOnly = HealthKitMetricsSync.enabledGroups(
            activity: .init(readEnabled: true, writeEnabled: false),
            heart: .init(readEnabled: false, writeEnabled: true)
        )
        XCTAssertEqual(activityOnly, [.activity])
        XCTAssertEqual(
            HealthKitMetricsSync.readTypes(for: activityOnly),
            Set([
                HKQuantityType(.stepCount),
                HKQuantityType(.activeEnergyBurned),
                HKQuantityType(.appleExerciseTime),
                HKQuantityType(.distanceWalkingRunning),
                HKQuantityType(.flightsClimbed),
                HKQuantityType(.walkingSpeed),
                HKQuantityType(.walkingStepLength)
            ])
        )
        // Heart rate backs two metrics but is requested once.
        XCTAssertEqual(
            HealthKitMetricsSync.readTypes(for: [.heart]),
            Set([
                HKQuantityType(.restingHeartRate),
                HKQuantityType(.heartRateVariabilitySDNN),
                HKQuantityType(.vo2Max),
                HKQuantityType(.heartRate),
                HKQuantityType(.respiratoryRate),
                HKQuantityType(.oxygenSaturation)
            ])
        )
        XCTAssertEqual(HealthKitMetricsSync.readTypes(for: [.heart]).count, 6)
        XCTAssertTrue(HealthKitMetricsSync.enabledGroups(activity: .denied, heart: .denied).isEmpty)
    }

    func testPayloadsConvertUnits() {
        let day = dayStart("2026-06-17")
        func value(_ metric: HealthDailyMetric, _ quantity: HKQuantity) -> Double? {
            HealthDailyMetricsMapper.payloads(
                metric: metric,
                statistics: [.init(dayStart: day, quantity: quantity, sampleCount: 3)],
                calendar: calendar
            ).first?.value
        }

        XCTAssertEqual(value(.steps, HKQuantity(unit: .count(), doubleValue: 8_412.6)), 8_413)
        XCTAssertEqual(value(.activeEnergyKcal, HKQuantity(unit: .jouleUnit(with: .kilo), doubleValue: 2_092)), 500)
        XCTAssertEqual(value(.exerciseMinutes, HKQuantity(unit: .second(), doubleValue: 2_700)), 45)
        XCTAssertEqual(
            value(.restingHeartRateBpm, HKQuantity(unit: .count().unitDivided(by: .second()), doubleValue: 1)),
            60
        )
        XCTAssertEqual(value(.hrvSdnnMs, HKQuantity(unit: .second(), doubleValue: 0.0523)), 52.3)
        let vo2Unit = HKUnit.literUnit(with: .milli)
            .unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: .minute()))
        XCTAssertEqual(value(.vo2MaxMlKgMin, HKQuantity(unit: vo2Unit, doubleValue: 44.567)), 44.57)
    }

    func testNewMetricPayloadsConvertUnitsAndRound() {
        let day = dayStart("2026-06-17")
        func value(_ metric: HealthDailyMetric, _ quantity: HKQuantity) -> Double? {
            HealthDailyMetricsMapper.payloads(
                metric: metric,
                statistics: [.init(dayStart: day, quantity: quantity, sampleCount: 3)],
                calendar: calendar
            ).first?.value
        }
        let perMinute = HKUnit.count().unitDivided(by: .minute())
        // Distance arrives in any length unit and is stored in meters.
        XCTAssertEqual(value(.walkingRunningDistanceM, HKQuantity(unit: .mile(), doubleValue: 4)), 6_437.4)
        XCTAssertEqual(value(.walkingRunningDistanceM, HKQuantity(unit: .meterUnit(with: .kilo), doubleValue: 5.25)), 5_250)
        XCTAssertEqual(value(.flightsClimbed, HKQuantity(unit: .count(), doubleValue: 11.6)), 12)
        XCTAssertEqual(
            value(.walkingSpeedMps, HKQuantity(unit: HKUnit.mile().unitDivided(by: .hour()), doubleValue: 3)),
            1.34
        )
        XCTAssertEqual(value(.walkingStepLengthM, HKQuantity(unit: .inch(), doubleValue: 29)), 0.74)
        XCTAssertEqual(value(.heartRateAvgBpm, HKQuantity(unit: perMinute, doubleValue: 68.44)), 68.4)
        XCTAssertEqual(value(.heartRateMinBpm, HKQuantity(unit: perMinute, doubleValue: 47)), 47)
        XCTAssertEqual(value(.respiratoryRateBrpm, HKQuantity(unit: perMinute, doubleValue: 14.26)), 14.3)
        // Oxygen saturation: HealthKit gives a 0-1 fraction; the server stores percent.
        XCTAssertEqual(value(.oxygenSaturationPct, HKQuantity(unit: .percent(), doubleValue: 0.9654)), 96.5)
        // Values outside the server's bounds are never sent.
        XCTAssertNil(value(.oxygenSaturationPct, HKQuantity(unit: .percent(), doubleValue: 0.45)))
        XCTAssertNil(value(.heartRateMinBpm, HKQuantity(unit: perMinute, doubleValue: 12)))
        XCTAssertNil(value(.walkingSpeedMps, HKQuantity(unit: HKUnit.meter().unitDivided(by: .second()), doubleValue: 6)))
        XCTAssertNil(value(.respiratoryRateBrpm, HKQuantity(unit: perMinute, doubleValue: 2)))
        // A heart-rate quantity is never accepted as a distance.
        XCTAssertNil(value(.walkingRunningDistanceM, HKQuantity(unit: perMinute, doubleValue: 60)))
    }

    func testBackfillKeyIsVersionedPerGroupAndAccount() {
        XCTAssertEqual(
            HealthKitMetricsSync.backfillKey(group: .activity, owner: "user-1"),
            "healthkit-daily-metrics-backfill-v2-activity-user-1"
        )
        XCTAssertEqual(
            HealthKitMetricsSync.backfillKey(group: .heart, owner: "user-1"),
            "healthkit-daily-metrics-backfill-v2-heart-user-1"
        )
    }

    func testUploadReportsUnsupportedMetricsFromTheServer() async throws {
        let payloads = [
            HealthMetricDayPayload(date: "2026-06-17", metric: "steps", value: 9_000, sampleCount: 1),
            HealthMetricDayPayload(date: "2026-06-17", metric: "heart_rate_avg_bpm", value: 68, sampleCount: 10)
        ]
        var sent: [[String]] = []
        let outcome = try await HealthDailyMetricsUploader.upload(payloads) { batch in
            sent.append(batch.map(\.metric))
            return HealthMetricsUploadResponse(upserted: 1, skipped: 1, unsupportedMetrics: ["heart_rate_avg_bpm"])
        }
        XCTAssertEqual(sent, [["steps", "heart_rate_avg_bpm"]])
        XCTAssertEqual(outcome, HealthDailyMetricsUploadOutcome(upserted: 1, skipped: 1, unsupportedMetrics: ["heart_rate_avg_bpm"]))
    }

    func testUploadFallsBackToOriginalMetricsWhenAnOlderServerRejectsNewIds() async throws {
        let payloads = [
            HealthMetricDayPayload(date: "2026-06-17", metric: "steps", value: 9_000, sampleCount: 1),
            HealthMetricDayPayload(date: "2026-06-17", metric: "walking_running_distance_m", value: 6_437, sampleCount: 1),
            HealthMetricDayPayload(date: "2026-06-17", metric: "flights_climbed", value: 9, sampleCount: 1)
        ]
        var sent: [[String]] = []
        let outcome = try await HealthDailyMetricsUploader.upload(payloads) { batch in
            sent.append(batch.map(\.metric))
            if batch.contains(where: { !HealthDailyMetric.original.map(\.rawValue).contains($0.metric) }) {
                throw APIError.httpError(status: 400, message: "days[1].metric is not a supported metric.")
            }
            return HealthMetricsUploadResponse(upserted: batch.count, skipped: 0)
        }
        XCTAssertEqual(sent, [["steps", "walking_running_distance_m", "flights_climbed"], ["steps"]])
        XCTAssertEqual(outcome.upserted, 1)
        XCTAssertEqual(outcome.skipped, 2)
        XCTAssertEqual(outcome.unsupportedMetrics, ["walking_running_distance_m", "flights_climbed"])

        // A 400 for a batch of only original metrics is a real error.
        do {
            _ = try await HealthDailyMetricsUploader.upload([payloads[0]]) { _ in
                throw APIError.httpError(status: 400, message: "bad")
            }
            XCTFail("expected the 400 to propagate")
        } catch APIError.httpError(let status, _) {
            XCTAssertEqual(status, 400)
        }
    }

    func testPayloadsUseLocalDayKeysAndSkipDaysWithoutData() {
        let statistics: [HealthDailyMetricStatistic] = [
            .init(dayStart: dayStart("2026-06-15"), quantity: HKQuantity(unit: .count(), doubleValue: 9_000), sampleCount: 2),
            .init(dayStart: dayStart("2026-06-16"), quantity: nil, sampleCount: 0),
            .init(dayStart: dayStart("2026-06-17"), quantity: HKQuantity(unit: .count(), doubleValue: 0), sampleCount: 0),
            // Incompatible unit is never sent.
            .init(dayStart: dayStart("2026-06-18"), quantity: HKQuantity(unit: .kilocalorie(), doubleValue: 1), sampleCount: 1)
        ]

        let payloads = HealthDailyMetricsMapper.payloads(
            metric: .steps,
            statistics: statistics,
            calendar: calendar
        )

        XCTAssertEqual(payloads, [
            HealthMetricDayPayload(date: "2026-06-15", metric: "steps", value: 9_000, sampleCount: 2),
            HealthMetricDayPayload(date: "2026-06-17", metric: "steps", value: 0, sampleCount: 1)
        ])
    }

    func testDayKeyFollowsTheCalendarTimeZoneNotUTC() {
        // 23:30 local on June 17 in New York is already June 18 in UTC.
        let lateEvening = dayStart("2026-06-17").addingTimeInterval(23.5 * 3600)
        let payloads = HealthDailyMetricsMapper.payloads(
            metric: .restingHeartRateBpm,
            statistics: [.init(
                dayStart: calendar.startOfDay(for: lateEvening),
                quantity: HKQuantity(unit: .count().unitDivided(by: .minute()), doubleValue: 55.04),
                sampleCount: 1
            )],
            calendar: calendar
        )
        XCTAssertEqual(payloads.map(\.date), ["2026-06-17"])
        XCTAssertEqual(payloads.first?.value, 55)
    }

    func testPayloadEncodingMatchesTheUploadContract() throws {
        let upload = HealthMetricsUpload(
            source: "healthkit",
            days: [HealthMetricDayPayload(date: "2026-06-17", metric: "hrv_sdnn_ms", value: 48.5, sampleCount: 6)]
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(upload)) as? [String: Any]
        )
        XCTAssertEqual(object["source"] as? String, "healthkit")
        let day = try XCTUnwrap((object["days"] as? [[String: Any]])?.first)
        XCTAssertEqual(Set(day.keys), ["date", "metric", "value", "sampleCount"])
        XCTAssertEqual(day["sampleCount"] as? Int, 6)
    }

    func testBatchesNeverExceedOneThousandItems() {
        let payloads = (0..<2_345).map {
            HealthMetricDayPayload(date: "2026-01-01", metric: "steps", value: Double($0), sampleCount: 1)
        }
        let batches = HealthDailyMetricsMapper.batches(payloads)
        XCTAssertEqual(batches.map(\.count), [1_000, 1_000, 345])
        XCTAssertEqual(batches.flatMap { $0 }, payloads)
        XCTAssertEqual(HealthDailyMetricsMapper.batches(payloads, size: 5_000).map(\.count), [1_000, 1_000, 345])
        XCTAssertTrue(HealthDailyMetricsMapper.batches([]).isEmpty)
    }

    func testMetricsResponseDecodesFullAndNotMigratedPayloads() throws {
        let full = Data(
            """
            {
              "scope": "week",
              "days": [
                { "day": "2026-06-17", "steps": 9012, "activeEnergyKcal": 512.5, "exerciseMinutes": 41,
                  "restingHeartRate": 55, "hrvMs": 48.2, "vo2max": null }
              ],
              "summary": {
                "current": { "daysWithData": 1, "avgSteps": 9012, "avgActiveEnergyKcal": 512.5,
                  "avgExerciseMinutes": 41, "avgRestingHeartRate": 55, "avgHrvMs": 48.2, "latestVo2Max": 44.1 },
                "previous": { "daysWithData": 0, "avgSteps": null, "avgActiveEnergyKcal": null,
                  "avgExerciseMinutes": null, "avgRestingHeartRate": null, "avgHrvMs": null, "latestVo2Max": null }
              }
            }
            """.utf8
        )
        let response = try JSONDecoder().decode(HealthMetricsResponse.self, from: full)
        XCTAssertTrue(response.isEnabled)
        XCTAssertEqual(response.days.first?.steps, 9012)
        XCTAssertNil(response.days.first?.vo2max)
        XCTAssertEqual(response.summary?.current?.latestVo2Max, 44.1)
        XCTAssertNil(response.summary?.previous?.avgSteps)
        // An older server omits the newer fields entirely.
        XCTAssertNil(response.days.first?.walkingRunningDistanceM)
        XCTAssertNil(response.days.first?.heartRateAvgBpm)
        XCTAssertNil(response.summary?.current?.avgOxygenSaturationPct)
        XCTAssertNil(response.summary?.current?.avgWalkingRunningDistanceMiles)
        XCTAssertNil(try JSONDecoder().decode(HealthMetricsUploadResponse.self, from: Data(#"{"upserted":1,"skipped":0}"#.utf8)).unsupportedMetrics)

        let disabled = try JSONDecoder().decode(
            HealthMetricsResponse.self,
            from: Data(#"{ "scope": "month", "enabled": false, "days": [] }"#.utf8)
        )
        XCTAssertFalse(disabled.isEnabled)
        XCTAssertTrue(disabled.days.isEmpty)
        XCTAssertNil(disabled.summary)
    }

    func testMetricsResponseDecodesNewFieldsAndUSUnits() throws {
        let json = Data(
            """
            {
              "scope": "week",
              "enabled": true,
              "days": [
                { "day": "2026-11-14", "steps": 8123, "activeEnergyKcal": null, "exerciseMinutes": null,
                  "restingHeartRate": null, "hrvMs": null, "vo2max": null,
                  "walkingRunningDistanceM": 6437.4, "flightsClimbed": 9, "walkingSpeedMps": 1.34,
                  "walkingStepLengthM": 0.74, "heartRateAvgBpm": 68.2, "heartRateMinBpm": 47,
                  "respiratoryRateBrpm": 14.2, "oxygenSaturationPct": 96.4 }
              ],
              "summary": {
                "current": { "daysWithData": 1, "avgSteps": 8123, "avgActiveEnergyKcal": null,
                  "avgExerciseMinutes": null, "avgRestingHeartRate": null, "avgHrvMs": null, "latestVo2Max": null,
                  "avgWalkingRunningDistanceM": 6437.4, "avgFlightsClimbed": 9, "avgWalkingSpeedMps": 1.34,
                  "avgWalkingStepLengthM": 0.74, "avgHeartRateAvgBpm": 68.2, "avgHeartRateMinBpm": 47,
                  "lowestHeartRateMinBpm": 46, "avgRespiratoryRateBrpm": 14.2, "avgOxygenSaturationPct": 96.4 },
                "previous": null
              }
            }
            """.utf8
        )
        let response = try JSONDecoder().decode(HealthMetricsResponse.self, from: json)
        let day = try XCTUnwrap(response.days.first)
        XCTAssertEqual(day.flightsClimbed, 9)
        XCTAssertEqual(day.oxygenSaturationPct, 96.4)
        XCTAssertEqual(try XCTUnwrap(day.walkingRunningDistanceMiles), 4.0, accuracy: 0.001)
        let current = try XCTUnwrap(response.summary?.current)
        XCTAssertEqual(current.lowestHeartRateMinBpm, 46)
        XCTAssertEqual(try XCTUnwrap(current.avgWalkingRunningDistanceMiles), 4.0, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(current.avgWalkingSpeedMph), 3.0, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(current.avgWalkingStepLengthInches), 29.13, accuracy: 0.01)
        let upload = try JSONDecoder().decode(
            HealthMetricsUploadResponse.self,
            from: Data(#"{"upserted":1,"skipped":2,"unsupportedMetrics":["flights_climbed"]}"#.utf8)
        )
        XCTAssertEqual(upload.unsupportedMetrics, ["flights_climbed"])
    }
}

final class ActivityMetricVisibilityTests: XCTestCase {
    private func day(
        _ day: String,
        steps: Double? = nil,
        energy: Double? = nil,
        exercise: Double? = nil,
        rhr: Double? = nil,
        hrv: Double? = nil,
        vo2: Double? = nil
    ) -> HealthMetricsDay {
        HealthMetricsDay(
            day: day,
            steps: steps,
            activeEnergyKcal: energy,
            exerciseMinutes: exercise,
            restingHeartRate: rhr,
            hrvMs: hrv,
            vo2max: vo2
        )
    }

    private func summary(
        steps: Double? = nil,
        energy: Double? = nil,
        exercise: Double? = nil,
        rhr: Double? = nil,
        hrv: Double? = nil,
        vo2: Double? = nil
    ) -> HealthMetricsPeriodSummary {
        HealthMetricsPeriodSummary(
            daysWithData: nil,
            avgSteps: steps,
            avgActiveEnergyKcal: energy,
            avgExerciseMinutes: exercise,
            avgRestingHeartRate: rhr,
            avgHrvMs: hrv,
            latestVo2Max: vo2
        )
    }

    private func response(
        days: [HealthMetricsDay],
        current: HealthMetricsPeriodSummary? = nil,
        previous: HealthMetricsPeriodSummary? = nil
    ) -> HealthMetricsResponse {
        HealthMetricsResponse(
            scope: "week",
            enabled: true,
            days: days,
            summary: HealthMetricsSummary(current: current ?? summary(), previous: previous ?? summary())
        )
    }

    func testOnlyStepsAndEnergyPresentHidesWatchMetrics() {
        let loaded = response(
            days: [
                day("2026-11-13", steps: 8_000, energy: 400),
                day("2026-11-14", steps: 9_000, energy: 450)
            ],
            current: summary(steps: 8_500, energy: 425),
            previous: summary(steps: 7_900, energy: 390)
        )
        XCTAssertEqual(ActivityMetricVisibility.visibleMetrics(for: loaded), [.steps, .activeEnergy])
    }

    func testNothingPresentShowsNoMetrics() {
        XCTAssertEqual(ActivityMetricVisibility.visibleMetrics(for: nil), [])
        XCTAssertEqual(ActivityMetricVisibility.visibleMetrics(for: response(days: [])), [])
        let nullDays = response(days: [day("2026-11-14")])
        XCTAssertEqual(ActivityMetricVisibility.visibleMetrics(for: nullDays), [])
        let noSummary = HealthMetricsResponse(scope: "week", enabled: true, days: [], summary: nil)
        XCTAssertEqual(ActivityMetricVisibility.visibleMetrics(for: noSummary), [])
    }

    func testMetricPresentOnlyInPreviousPeriodIsShown() {
        let loaded = response(
            days: [day("2026-11-14", steps: 8_000)],
            current: summary(steps: 8_000),
            previous: summary(steps: 7_000, rhr: 57.2)
        )
        XCTAssertEqual(ActivityMetricVisibility.visibleMetrics(for: loaded), [.steps, .restingHeartRate])
    }

    func testVo2MaxPresentOnOneDayIsShown() {
        let loaded = response(
            days: [
                day("2026-11-12", steps: 8_000),
                day("2026-11-13", steps: 8_500, vo2: 41.3),
                day("2026-11-14", steps: 9_000)
            ],
            current: summary(steps: 8_500)
        )
        XCTAssertEqual(ActivityMetricVisibility.visibleMetrics(for: loaded), [.steps, .vo2Max])
    }

    func testAllMetricsPresentKeepDisplayOrder() {
        var full = day("2026-11-14", steps: 1, energy: 1, exercise: 1, rhr: 1, hrv: 1, vo2: 1)
        full.walkingRunningDistanceM = 1
        full.flightsClimbed = 1
        full.walkingSpeedMps = 1
        full.walkingStepLengthM = 1
        full.heartRateAvgBpm = 60
        full.heartRateMinBpm = 50
        full.respiratoryRateBrpm = 14
        full.oxygenSaturationPct = 97
        XCTAssertEqual(ActivityMetricVisibility.visibleMetrics(for: response(days: [full])), ActivityMetric.allCases)
        XCTAssertEqual(ActivityMetric.allCases, [
            .steps, .distance, .flightsClimbed, .activeEnergy, .exercise, .walkingSpeed, .stepLength,
            .heartRate, .lowestHeartRate, .restingHeartRate, .hrv, .respiratoryRate, .bloodOxygen, .vo2Max
        ])
    }

    func testIPhoneAndOuraAppDataShowsOnlyThoseMetrics() {
        // No Apple Watch: iPhone motion metrics plus Oura-app heart rate.
        var phone = day("2026-11-14", steps: 8_000, energy: 300)
        phone.walkingRunningDistanceM = 6_000
        phone.flightsClimbed = 7
        phone.walkingSpeedMps = 1.3
        phone.walkingStepLengthM = 0.7
        phone.heartRateAvgBpm = 66
        phone.heartRateMinBpm = 49
        XCTAssertEqual(ActivityMetricVisibility.visibleMetrics(for: response(days: [phone])), [
            .steps, .distance, .flightsClimbed, .activeEnergy, .walkingSpeed, .stepLength, .heartRate, .lowestHeartRate
        ])
    }

    func testNewMetricsPresentOnlyInSummaryAreShown() {
        var previous = summary(steps: 7_000)
        previous.avgOxygenSaturationPct = 96.5
        var current = summary(steps: 8_000)
        current.avgRespiratoryRateBrpm = 14.2
        let loaded = response(days: [day("2026-11-14", steps: 8_000)], current: current, previous: previous)
        XCTAssertEqual(ActivityMetricVisibility.visibleMetrics(for: loaded), [.steps, .respiratoryRate, .bloodOxygen])
    }

    // MARK: - Manual sync outcome

    func testManualSyncWithImportsIsQuietSuccess() {
        let outcome = ManualSyncOutcome.classify([
            .synced(message: "Apple Health: imported 3, wrote 0.", foundData: true),
            .synced(message: "Oura: refreshed 0 sleep sessions and 0 daily scores.", foundData: false),
        ])
        XCTAssertEqual(outcome, .quietSuccess(noNewData: false))
    }

    func testManualSyncWithNothingFoundIsQuietNoNewData() {
        let outcome = ManualSyncOutcome.classify([
            .synced(message: "Apple Health: no new sleep entries from the last 30 days.", foundData: false),
        ])
        XCTAssertEqual(outcome, .quietSuccess(noNewData: true))
    }

    func testManualSyncErrorKeepsAlertWording() {
        let outcome = ManualSyncOutcome.classify([
            .failed(message: "Apple Health: The request timed out."),
        ])
        XCTAssertEqual(outcome, .alert("Apple Health: The request timed out."))
    }

    func testManualSyncPartialFailureAlertsWithEverySourceLine() {
        let outcome = ManualSyncOutcome.classify([
            .synced(message: "Apple Health: imported 2, wrote 1.", foundData: true),
            .failed(message: "Oura: Not connected."),
        ])
        XCTAssertEqual(outcome, .alert("Apple Health: imported 2, wrote 1.\nOura: Not connected."))
    }

    func testManualSyncStatusLabelUsesRelativeTimeWithoutCounts() {
        let syncedAt = Date(timeIntervalSince1970: 1_800_000_000)
        let locale = Locale(identifier: "en_US")
        let status = ManualSyncStatus(syncedAt: syncedAt, noNewData: false)
        XCTAssertEqual(status.label(now: syncedAt.addingTimeInterval(20), locale: locale), "Synced just now")
        XCTAssertEqual(status.label(now: syncedAt.addingTimeInterval(5 * 60), locale: locale), "Synced 5 minutes ago")

        let empty = ManualSyncStatus(syncedAt: syncedAt, noNewData: true)
        XCTAssertEqual(
            empty.label(now: syncedAt, locale: locale),
            "Synced just now · no new data"
        )
    }
}
