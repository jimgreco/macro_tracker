import XCTest
@testable import DailyMacros

final class OuraAPIContractTests: XCTestCase {
    func testOuraTimestampFormattingAcceptsFractionalAndWholeSeconds() throws {
        let fractional = "2026-08-09T18:18:20.681Z"
        let whole = "2026-08-09T18:18:20Z"

        XCTAssertNotNil(OuraTimestampFormatting.date(from: fractional))
        XCTAssertNotNil(OuraTimestampFormatting.date(from: whole))
        XCTAssertNotEqual(OuraTimestampFormatting.displayString(for: fractional), fractional)
    }

    func testOuraSleepSummaryCombinesSessionAggregatesWithDailyScore() throws {
        let sleep = OuraDocument(
            dataType: "sleep",
            providerDocumentId: "sleep-2026-08-08",
            day: "2026-08-08",
            recordedAt: "2026-08-09T07:00:00Z",
            data: [
                "bedtimeStart": .string("2026-08-08T23:30:00-04:00"),
                "bedtimeEnd": .string("2026-08-09T07:30:00-04:00"),
                "totalSleepSeconds": .number(27_000),
                "deepSleepSeconds": .number(5_400),
                "remSleepSeconds": .number(7_200),
                "type": .string("long_sleep")
            ],
            syncedAt: "2026-08-09T12:00:00.123Z",
            updatedAt: "2026-08-09T12:00:00.123Z"
        )
        let dailySleep = OuraDocument(
            dataType: "daily_sleep",
            providerDocumentId: "daily-sleep-2026-08-08",
            day: "2026-08-08",
            recordedAt: "2026-08-09T07:30:00Z",
            data: ["score": .number(86)],
            syncedAt: "2026-08-09T12:00:00Z",
            updatedAt: "2026-08-09T12:00:00Z"
        )

        let summary = try XCTUnwrap(
            OuraSleepSummaryBuilder.build(
                sleepDocuments: [sleep],
                dailySleepDocuments: [dailySleep]
            ).first
        )

        XCTAssertEqual(summary.id, "sleep-2026-08-08")
        XCTAssertEqual(summary.durationHours, 7.5, accuracy: 0.001)
        XCTAssertEqual(summary.deepSleepHours ?? 0, 1.5, accuracy: 0.001)
        XCTAssertEqual(summary.remSleepHours ?? 0, 2, accuracy: 0.001)
        XCTAssertEqual(summary.score, 86)
        XCTAssertEqual(summary.type, "long_sleep")
        XCTAssertNotNil(summary.syncedAt)
    }

    func testOuraSleepSummaryRejectsSessionsWithoutUsableTiming() {
        let invalid = OuraDocument(
            dataType: "sleep",
            providerDocumentId: "invalid",
            day: "2026-08-08",
            recordedAt: nil,
            data: ["totalSleepSeconds": .number(0)],
            syncedAt: "2026-08-09T12:00:00Z",
            updatedAt: "2026-08-09T12:00:00Z"
        )

        XCTAssertTrue(
            OuraSleepSummaryBuilder.build(
                sleepDocuments: [invalid],
                dailySleepDocuments: []
            ).isEmpty
        )
    }

    func testSleepTimelineCombinesAppAndOuraSessionsChronologically() throws {
        let appEntry = SleepEntry(
            id: 42,
            durationHours: 1.0,
            wakeUps: 0,
            quality: 4,
            notes: nil,
            loggedAt: "2026-08-08T23:00:00-04:00",
            source: "manual",
            externalId: nil
        )
        let ouraSummary = OuraSleepSummary(
            id: "oura-evening",
            day: "2026-08-08",
            startedAt: try XCTUnwrap(
                ISO8601DateFormatter().date(from: "2026-08-08T21:15:00-04:00")
            ),
            endedAt: nil,
            durationHours: 7.6,
            score: 73,
            deepSleepHours: 1,
            remSleepHours: 1.5,
            type: "long_sleep",
            syncedAt: nil
        )

        let sessions = SleepTimelineBuilder.sessions(
            appEntries: [appEntry],
            ouraSummaries: [ouraSummary]
        )

        XCTAssertEqual(sessions.map(\.id), ["app-42", "oura-oura-evening"])
        XCTAssertFalse(sessions[0].isOura)
        XCTAssertTrue(sessions[1].isOura)
    }

    func testSleepDailyTotalsAggregateMultipleOuraAndAppSessionsOnTheSameDay() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/New_York"))
        let start = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2026-08-07T21:15:00-04:00")
        )
        let nap = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2026-08-07T19:40:00-04:00")
        )
        let summaries = [
            OuraSleepSummary(
                id: "main",
                day: "2026-08-07",
                startedAt: start,
                endedAt: nil,
                durationHours: 7.6,
                score: 73,
                deepSleepHours: 1,
                remSleepHours: 1.5,
                type: "long_sleep",
                syncedAt: nil
            ),
            OuraSleepSummary(
                id: "nap",
                day: "2026-08-07",
                startedAt: nap,
                endedAt: nil,
                durationHours: 0.2,
                score: 73,
                deepSleepHours: nil,
                remSleepHours: nil,
                type: "late_nap",
                syncedAt: nil
            )
        ]

        let totals = SleepTimelineBuilder.dailyTotals(
            appTotals: [
                SleepDailyTotals(
                    day: "2026-08-07",
                    totalHours: 1,
                    targetHours: 8
                )
            ],
            ouraSummaries: summaries,
            calendar: calendar
        )

        XCTAssertEqual(totals.count, 1)
        XCTAssertEqual(totals[0].day, "2026-08-07")
        XCTAssertEqual(totals[0].totalHours, 8.8, accuracy: 0.001)
        XCTAssertEqual(totals[0].targetHours, 8)
    }

    @MainActor
    func testTodayUsesVersionedAPIAndDecodesOuraRecoveryStatus() async throws {
        let defaults = UserDefaults.standard
        let previousBaseURL = defaults.string(forKey: "api_base_url")
        defaults.set("https://dailymacros-unit.test", forKey: "api_base_url")
        URLProtocol.registerClass(OuraURLProtocolStub.self)
        OuraURLProtocolStub.handler = { request in
            guard request.url?.path == "/api/v1/today" else {
                throw URLError(.unsupportedURL)
            }
            guard request.value(forHTTPHeaderField: "Authorization") == "Bearer unit-test-token" else {
                throw URLError(.userAuthenticationRequired)
            }
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: ["Content-Type": "application/json"]
                )
            )
            return (response, Self.todayPayload)
        }

        let client = APIClient()
        client.token = "unit-test-token"
        defer {
            client.token = nil
            OuraURLProtocolStub.handler = nil
            URLProtocol.unregisterClass(OuraURLProtocolStub.self)
            if let previousBaseURL {
                defaults.set(previousBaseURL, forKey: "api_base_url")
            } else {
                defaults.removeObject(forKey: "api_base_url")
            }
        }

        let response = try await client.getToday()
        XCTAssertEqual(response.summary.recovery.ouraStatus, "connected")
        XCTAssertEqual(response.summary.recovery.source, "oura")
        XCTAssertEqual(response.summary.recovery.sourceLabel, "Oura")
        XCTAssertEqual(response.summary.recovery.sleepHours, 7.8)
    }

    private static let todayPayload = Data(
        """
        {
          "generatedAt": "2026-07-29T12:00:00.000Z",
          "summary": {
            "generatedAt": "2026-07-29T12:00:00.000Z",
            "day": "2026-07-29",
            "macros": {
              "totals": {
                "day": "2026-07-29",
                "calories": 0,
                "protein": 0,
                "carbs": 0,
                "fat": 0,
                "completeness": null
              },
              "targets": {
                "calories": 2100,
                "protein": 160,
                "carbs": 220,
                "fat": 70,
                "workouts": 4,
                "workoutCalories": 1400,
                "sleepHours": 8
              },
              "remaining": {
                "calories": 2100,
                "protein": 160,
                "carbs": 220,
                "fat": 70
              },
              "state": "empty"
            },
            "workout": {
              "state": "empty",
              "loggedCount": 0,
              "activeCalories": 0,
              "latestDescription": null,
              "weeklyActiveDays": 0,
              "targetPerWeek": 4
            },
            "weight": {
              "state": "empty",
              "latestWeight": null,
              "lastLoggedAt": null,
              "daysSinceLast": null,
              "cadenceDays": 7,
              "nextDueAt": null,
              "source": null,
              "targetWeight": null,
              "targetDate": null
            },
            "recovery": {
              "state": "current",
              "sleepHours": 7.8,
              "wakeUps": 1,
              "quality": 4,
              "lastLoggedAt": "2026-07-29T11:00:00.000Z",
              "ageHours": 1,
              "source": "oura",
              "sourceLabel": "Oura",
              "ouraStatus": "connected"
            },
            "empty": false
          },
          "context": {
            "dashboard": {
              "currentDayTotals": {
                "day": "2026-07-29",
                "calories": 0,
                "protein": 0,
                "carbs": 0,
                "fat": 0,
                "completeness": null
              },
              "previousDays": [],
              "sevenDayAverage": {
                "daysWithData": 0,
                "calories": 0,
                "protein": 0,
                "carbs": 0,
                "fat": 0
              },
              "entries": [],
              "targets": {
                "calories": 2100,
                "protein": 160,
                "carbs": 220,
                "fat": 70,
                "workouts": 4,
                "workout_calories": 1400,
                "sleep_hours": 8
              },
              "pagination": null
            },
            "workouts": {
              "entries": [],
              "dailyCalories": [],
              "pagination": null
            },
            "weights": {
              "entries": [],
              "pagination": null
            },
            "weightTarget": {
              "targetWeight": null,
              "targetDate": null,
              "effectiveDate": null
            },
            "sleep": {
              "entries": [],
              "dailyTotals": [],
              "pagination": null
            }
          }
        }
        """.utf8
    )
}

private final class OuraURLProtocolStub: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "dailymacros-unit.test"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(
                self,
                didReceive: response,
                cacheStoragePolicy: .notAllowed
            )
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
