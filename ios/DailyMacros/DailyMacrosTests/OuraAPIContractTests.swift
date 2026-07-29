import XCTest
@testable import DailyMacros

final class OuraAPIContractTests: XCTestCase {
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
