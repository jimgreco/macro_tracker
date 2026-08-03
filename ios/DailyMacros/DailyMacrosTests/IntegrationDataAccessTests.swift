import XCTest
@testable import DailyMacros

final class IntegrationDataAccessTests: XCTestCase {
    func testManifestDecodesMissingAndExplicitDeniedSelectionsSeparately() throws {
        let payload = Data(
            """
            {
              "sources": [{
                "id": "future_source",
                "displayName": "Future Source",
                "connected": true,
                "available": true,
                "configurationRequired": true,
                "dataTypes": [
                  {
                    "id": "sleep",
                    "displayName": "Sleep",
                    "detail": "Nightly sleep",
                    "read": { "supported": true },
                    "write": {
                      "supported": false,
                      "disabledReason": "Future Source is read-only."
                    }
                  },
                  {
                    "id": "weight",
                    "displayName": "Weight",
                    "detail": "Body mass",
                    "read": { "supported": true },
                    "write": { "supported": true },
                    "selection": {
                      "readEnabled": false,
                      "writeEnabled": false
                    }
                  }
                ]
              }]
            }
            """.utf8
        )

        let response = try JSONDecoder().decode(IntegrationDataAccessResponse.self, from: payload)
        let source = try XCTUnwrap(response.sources.first)

        XCTAssertNil(source.dataTypes[0].selection)
        XCTAssertEqual(source.dataTypes[1].selection, .denied)
        XCTAssertEqual(source.dataTypes[0].write.disabledReason, "Future Source is read-only.")
    }

    @MainActor
    func testStoreRequiresMissingSelectionButAcceptsExplicitNoAccess() {
        let store = IntegrationDataAccessStore()
        let unreviewed = makeSource(
            id: "future_source",
            configurationRequired: true,
            selection: nil
        )
        store.apply(
            IntegrationDataAccessResponse(sources: [unreviewed]),
            userID: "user-1"
        )
        XCTAssertEqual(store.requiredSource?.id, "future_source")

        let reviewed = makeSource(
            id: "future_source",
            configurationRequired: false,
            selection: .denied
        )
        store.apply(
            IntegrationDataAccessResponse(sources: [reviewed]),
            userID: "user-1"
        )
        XCTAssertNil(store.requiredSource)
    }

    @MainActor
    func testExplicitPresentationTemporarilySuppressesTheRootGate() {
        let store = IntegrationDataAccessStore()
        store.apply(
            IntegrationDataAccessResponse(sources: [
                makeSource(
                    id: "oura",
                    configurationRequired: true,
                    selection: nil
                )
            ]),
            userID: "user-1"
        )

        XCTAssertEqual(store.requiredSource?.id, "oura")
        store.beginPresentation(for: "oura")
        XCTAssertNil(store.requiredSource)
        XCTAssertEqual(store.presentedSourceID, "oura")

        store.endPresentation(for: "oura")
        XCTAssertEqual(store.requiredSource?.id, "oura")
        XCTAssertNil(store.presentedSourceID)
    }

    @MainActor
    func testHealthKitAccessPlanIsSanitizedAndRevisioned() {
        let store = IntegrationDataAccessStore()
        let supported = IntegrationDirectionCapability(supported: true, disabledReason: nil)
        let unsupportedWrite = IntegrationDirectionCapability(
            supported: false,
            disabledReason: "Read-only"
        )
        let source = IntegrationDataSource(
            id: "apple_health",
            displayName: "Apple Health",
            connected: true,
            available: true,
            unavailableReason: nil,
            configurationRequired: false,
            dataTypes: [
                IntegrationDataType(
                    id: "workouts",
                    displayName: "Workouts",
                    detail: nil,
                    read: supported,
                    write: supported,
                    selection: .init(readEnabled: true, writeEnabled: false)
                ),
                IntegrationDataType(
                    id: "weight",
                    displayName: "Weight",
                    detail: nil,
                    read: supported,
                    write: unsupportedWrite,
                    selection: .init(readEnabled: false, writeEnabled: true)
                ),
                IntegrationDataType(
                    id: "sleep",
                    displayName: "Sleep",
                    detail: nil,
                    read: supported,
                    write: supported,
                    selection: .init(readEnabled: false, writeEnabled: true)
                ),
                IntegrationDataType(
                    id: "sexual_activity",
                    displayName: "Sexual Activity",
                    detail: nil,
                    read: supported,
                    write: supported,
                    selection: .init(readEnabled: true, writeEnabled: true)
                )
            ]
        )
        store.apply(
            IntegrationDataAccessResponse(sources: [source]),
            userID: "user-1"
        )

        let complete = store.healthKitAccessPlan(includeSexualActivity: true)
        XCTAssertEqual(complete.workouts, .init(readEnabled: true, writeEnabled: false))
        XCTAssertEqual(complete.weight, .denied)
        XCTAssertEqual(complete.sleep, .init(readEnabled: false, writeEnabled: true))
        XCTAssertEqual(complete.sexualActivity, .init(readEnabled: true, writeEnabled: true))
        XCTAssertTrue(complete.hasAnyAccess)
        XCTAssertEqual(complete.revisionKey, store.revision)

        let hidden = complete.includingSexualActivity(false)
        XCTAssertEqual(hidden.sexualActivity, .denied)
        XCTAssertEqual(hidden.revisionKey, complete.revisionKey)
    }

    @MainActor
    func testUnreviewedHealthKitManifestFailsClosed() {
        let store = IntegrationDataAccessStore()
        store.apply(
            IntegrationDataAccessResponse(sources: [
                makeSource(
                    id: "healthkit",
                    configurationRequired: true,
                    selection: nil
                )
            ]),
            userID: "user-1"
        )

        let plan = store.healthKitAccessPlan(includeSexualActivity: true)
        XCTAssertFalse(plan.hasAnyAccess)
        XCTAssertEqual(plan.workouts, .denied)
        XCTAssertEqual(plan.revisionKey, store.revision)
    }

    @MainActor
    func testAPIUsesVersionedManifestAndExactUpdateContract() async throws {
        let defaults = UserDefaults.standard
        let previousBaseURL = defaults.string(forKey: "api_base_url")
        defaults.set("https://integration-access-unit.test", forKey: "api_base_url")
        URLProtocol.registerClass(IntegrationAccessURLProtocolStub.self)

        let source = makeSource(
            id: "future_source",
            configurationRequired: false,
            selection: .denied
        )
        var requestCount = 0
        IntegrationAccessURLProtocolStub.handler = { request in
            guard request.value(forHTTPHeaderField: "Authorization") == "Bearer unit-test-token" else {
                let response = try XCTUnwrap(HTTPURLResponse(
                    url: request.url!,
                    statusCode: 401,
                    httpVersion: "HTTP/1.1",
                    headerFields: ["Content-Type": "application/json"]
                ))
                return (response, Data(#"{"error":"Not this test's request."}"#.utf8))
            }

            requestCount += 1

            let response = try XCTUnwrap(HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            ))
            if request.httpMethod == "GET" {
                XCTAssertEqual(request.url?.path, "/api/v1/integrations/access")
                return (
                    response,
                    try JSONEncoder().encode(IntegrationDataAccessResponse(sources: [source]))
                )
            }

            XCTAssertEqual(request.httpMethod, "PUT")
            XCTAssertEqual(request.url?.path, "/api/v1/integrations/future_source/access")
            let update = try JSONDecoder().decode(
                IntegrationDataAccessUpdate.self,
                from: try XCTUnwrap(request.integrationAccessBody)
            )
            XCTAssertEqual(update.dataTypes, [
                IntegrationDataTypeUpdate(
                    id: "sleep",
                    readEnabled: false,
                    writeEnabled: false
                )
            ])
            return (response, try JSONEncoder().encode(source))
        }

        let client = APIClient()
        client.token = "unit-test-token"
        defer {
            client.token = nil
            IntegrationAccessURLProtocolStub.handler = nil
            URLProtocol.unregisterClass(IntegrationAccessURLProtocolStub.self)
            if let previousBaseURL {
                defaults.set(previousBaseURL, forKey: "api_base_url")
            } else {
                defaults.removeObject(forKey: "api_base_url")
            }
        }

        let manifest = try await client.getIntegrationDataAccess()
        XCTAssertEqual(manifest.sources, [source])
        let updated = try await client.updateIntegrationDataAccess(
            sourceID: "future_source",
            dataTypes: [
                IntegrationDataTypeUpdate(
                    id: "sleep",
                    readEnabled: false,
                    writeEnabled: false
                )
            ]
        )
        XCTAssertEqual(updated, source)
        XCTAssertEqual(requestCount, 2)
    }

    private func makeSource(
        id: String,
        configurationRequired: Bool,
        selection: IntegrationDirectionSelection?
    ) -> IntegrationDataSource {
        IntegrationDataSource(
            id: id,
            displayName: "Future Source",
            connected: true,
            available: true,
            unavailableReason: nil,
            configurationRequired: configurationRequired,
            dataTypes: [
                IntegrationDataType(
                    id: "sleep",
                    displayName: "Sleep",
                    detail: "Nightly sleep",
                    read: .init(supported: true, disabledReason: nil),
                    write: .init(supported: true, disabledReason: nil),
                    selection: selection
                )
            ]
        )
    }
}

private final class IntegrationAccessURLProtocolStub: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "integration-access-unit.test"
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
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private extension URLRequest {
    var integrationAccessBody: Data? {
        if let httpBody { return httpBody }
        guard let httpBodyStream else { return nil }

        httpBodyStream.open()
        defer { httpBodyStream.close() }

        var body = Data()
        let bufferSize = 4_096
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }

        while httpBodyStream.hasBytesAvailable {
            let count = httpBodyStream.read(buffer, maxLength: bufferSize)
            guard count > 0 else { break }
            body.append(buffer, count: count)
        }
        return body
    }
}
