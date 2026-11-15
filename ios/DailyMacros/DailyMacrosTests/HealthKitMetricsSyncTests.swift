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
            ["steps", "active_energy_kcal", "exercise_minutes"]
        )
        XCTAssertEqual(
            HealthDailyMetricGroup.heart.metrics.map(\.rawValue),
            ["resting_heart_rate_bpm", "hrv_sdnn_ms", "vo2max_ml_kg_min"]
        )
        XCTAssertTrue(HealthDailyMetricGroup.activity.metrics.allSatisfy { $0.aggregation == .sum })
        XCTAssertTrue(HealthDailyMetricGroup.heart.metrics.allSatisfy { $0.aggregation == .average })
        XCTAssertEqual(HealthDailyMetric.exerciseMinutes.quantityTypeIdentifier, .appleExerciseTime)
        XCTAssertEqual(HealthDailyMetric.hrvSdnnMs.quantityTypeIdentifier, .heartRateVariabilitySDNN)
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
                HKQuantityType(.appleExerciseTime)
            ])
        )
        XCTAssertEqual(
            HealthKitMetricsSync.readTypes(for: [.heart]),
            Set([
                HKQuantityType(.restingHeartRate),
                HKQuantityType(.heartRateVariabilitySDNN),
                HKQuantityType(.vo2Max)
            ])
        )
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

        let disabled = try JSONDecoder().decode(
            HealthMetricsResponse.self,
            from: Data(#"{ "scope": "month", "enabled": false, "days": [] }"#.utf8)
        )
        XCTAssertFalse(disabled.isEnabled)
        XCTAssertTrue(disabled.days.isEmpty)
        XCTAssertNil(disabled.summary)
    }
}
