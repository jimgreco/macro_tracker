import XCTest
@testable import DailyMacros

final class OfflineMutationStoreTests: XCTestCase {
    @MainActor
    func testCombinedCheckinKeepsItsIdentityAndRawWaistReadingsWhenQueued() throws {
        let fixture = try makeFixture()
        defer { fixture.cleanup() }
        let store = OfflineMutationStore(storageURL: fixture.storageURL, legacyDefaults: fixture.defaults)
        store.activateAccount(userId: "account-a")
        let createID = UUID().uuidString
        let body = try JSONSerialization.data(withJSONObject: [
            "createId": createID, "day": "2026-09-19", "notes": "Check-in", "tz": "America/New_York",
            "waist": ["readings": [33, 33.4], "unit": "in", "method": "navel_relaxed", "time": "08:30", "notes": "Relaxed"]
        ])
        let mutation = store.makeMutation(ownerUserId: "account-a", method: "POST", path: "/checkins", body: body, kind: .waist)
        try store.enqueue(mutation)
        let reloaded = OfflineMutationStore(storageURL: fixture.storageURL, legacyDefaults: fixture.defaults)
        reloaded.activateAccount(userId: "account-a")
        let pending = try XCTUnwrap(reloaded.snapshot(for: "account-a").first)
        XCTAssertEqual(pending.clientMutationId, mutation.clientMutationId)
        XCTAssertEqual(pending.path, "/checkins")
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(pending.body)) as? [String: Any])
        XCTAssertEqual(payload["createId"] as? String, createID)
        XCTAssertEqual((payload["waist"] as? [String: Any])?["readings"] as? [Double], [33, 33.4])
    }

    @MainActor
    func testPendingMutationIdentityAndAccountScopeSurviveReload() throws {
        let fixture = try makeFixture()
        defer { fixture.cleanup() }

        let store = OfflineMutationStore(
            storageURL: fixture.storageURL,
            legacyDefaults: fixture.defaults
        )
        store.activateAccount(userId: "account-a")
        let mutation = store.makeMutation(
            ownerUserId: "account-a",
            method: "post",
            path: "/entries/bulk",
            body: Data(#"{"items":[]}"#.utf8),
            kind: .meal
        )

        try store.enqueue(mutation)
        try store.enqueue(mutation)
        XCTAssertEqual(store.pendingCount, 1, "replaying the same local mutation must be idempotent")
        XCTAssertEqual(store.snapshot(for: "account-a").first?.clientMutationId, mutation.clientMutationId)

        store.activateAccount(userId: "account-b")
        XCTAssertEqual(store.pendingCount, 0)
        XCTAssertTrue(store.snapshot(for: "account-a").isEmpty)

        let reloaded = OfflineMutationStore(
            storageURL: fixture.storageURL,
            legacyDefaults: fixture.defaults
        )
        reloaded.activateAccount(userId: "account-a")
        XCTAssertEqual(reloaded.pendingCount, 1)
        XCTAssertEqual(
            reloaded.snapshot(for: "account-a").first?.clientMutationId,
            mutation.clientMutationId,
            "the server-recognized mutation id must not change across an offline retry"
        )
        XCTAssertEqual(reloaded.snapshot(for: "account-a").first?.method, "POST")
    }

    @MainActor
    func testSignOutPreservesPendingWorkButAccountDeletionDestroysIt() throws {
        let fixture = try makeFixture()
        defer { fixture.cleanup() }

        let store = OfflineMutationStore(
            storageURL: fixture.storageURL,
            legacyDefaults: fixture.defaults
        )
        store.activateAccount(userId: "account-a")
        let mutation = store.makeMutation(
            ownerUserId: "account-a",
            method: "DELETE",
            path: "/entries/42",
            body: nil,
            kind: .meal
        )
        try store.enqueue(mutation)

        store.deactivateAccount()
        XCTAssertEqual(store.pendingCount, 0)
        store.activateAccount(userId: "account-a")
        XCTAssertEqual(store.pendingCount, 1, "ordinary sign-out must preserve protected work")

        try store.discardPendingWorkForDeletedAccount(userId: "account-a")
        XCTAssertEqual(store.pendingCount, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.storageURL.path))
        XCTAssertThrowsError(try store.enqueue(mutation)) { error in
            guard case OfflineMutationStoreError.accountWasDeleted = error else {
                return XCTFail("unexpected error: \(error)")
            }
        }
    }

    @MainActor
    func testLegacyAndUnreadableFilesArePreservedWithoutAdoption() throws {
        let fixture = try makeFixture(); defer { fixture.cleanup() }
        let legacy = Data(#"[{"id":"unknown-owner","body":"not-decodable"}]"#.utf8)
        fixture.defaults.set(legacy, forKey: "pending_mutations_v1")
        let damaged = Data("original truncated protected bytes".utf8)
        try damaged.write(to: fixture.storageURL)
        let store = OfflineMutationStore(storageURL: fixture.storageURL, legacyDefaults: fixture.defaults)
        store.activateAccount(userId: "A")
        XCTAssertTrue(store.hasLegacyWork)
        XCTAssertTrue(store.hasUnreadableStorage)
        XCTAssertTrue(store.snapshot(for: "A").isEmpty)
        XCTAssertEqual(fixture.defaults.data(forKey: "pending_mutations_v1"), legacy)
        let mutation = store.makeMutation(ownerUserId: "A", method: "POST", path: "/weight", body: nil, kind: .weight)
        XCTAssertThrowsError(try store.enqueue(mutation))
        XCTAssertEqual(try Data(contentsOf: fixture.storageURL), damaged)
        let packet = try store.recoveryExport(owner: "A", generation: store.accountGeneration, includeLegacy: true)
        XCTAssertTrue(packet.contains(legacy.base64EncodedString()))
        XCTAssertTrue(packet.contains(damaged.base64EncodedString()))
    }

    @MainActor
    func testReviewArchiveAndRetryKeepOriginalIdentityAndFenceAccountChanges() throws {
        let fixture = try makeFixture(); defer { fixture.cleanup() }
        let store = OfflineMutationStore(storageURL: fixture.storageURL, legacyDefaults: fixture.defaults)
        store.activateAccount(userId: "A")
        let generation = store.accountGeneration
        let mutation = store.makeMutation(ownerUserId: "A", method: "POST", path: "/entries/bulk", body: Data("{}".utf8), kind: .meal)
        try store.enqueue(mutation)
        try store.hold(mutation, reason: "Ambiguous receipt")
        XCTAssertTrue(store.snapshot(for: "A").isEmpty)
        XCTAssertEqual(store.reviewCount, 1)
        try store.reviewAction(id: mutation.id, owner: "A", generation: generation, archive: true)
        try store.remove(clientMutationId: mutation.id, ownerUserId: "A") // late success cannot destroy set-aside source
        XCTAssertEqual(try store.reviewItems(owner: "A", generation: generation).count, 1)
        XCTAssertEqual(store.pendingCount, 0)
        store.activateAccount(userId: "B")
        XCTAssertThrowsError(try store.recoveryExport(owner: "A", generation: generation, includeLegacy: false))
        store.activateAccount(userId: "A")
        XCTAssertThrowsError(try store.reviewAction(id: mutation.id, owner: "A", generation: generation, archive: false))
        try store.reviewAction(id: mutation.id, owner: "A", generation: store.accountGeneration, archive: false)
        try store.enqueue(mutation)
        XCTAssertEqual(store.snapshot(for: "A").map(\.id), [mutation.id])
        XCTAssertEqual(store.snapshot(for: "A").first?.body, mutation.body)
        let reload = OfflineMutationStore(storageURL: fixture.storageURL, legacyDefaults: fixture.defaults)
        reload.activateAccount(userId: "A")
        XCTAssertEqual(reload.snapshot(for: "A").map(\.id), [mutation.id])
    }

    @MainActor
    func testRealAPIJournalsBeforeSendAndRetainsAmbiguousReceiptAcrossAccountChanges() async throws {
        let fixture = try makeFixture(); defer { fixture.cleanup() }
        let store = OfflineMutationStore(storageURL: fixture.storageURL, legacyDefaults: fixture.defaults)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RecoveryURLProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel(); RecoveryURLProtocol.reset() }
        let api = APIClient(session: session, offlineStore: store)
        api.token = "synthetic-recovery-A"
        api.activateAuthenticatedAccount(userId: "A")
        defer { api.token = nil }
        let firstRequest = expectation(description: "initial mutation journaled before send")
        RecoveryURLProtocol.onRequest = { firstRequest.fulfill() }
        let initial = Task { try await api.addWeight(180, loggedAt: "2026-10-07T12:00:00Z") }
        await fulfillment(of: [firstRequest], timeout: 3)
        let original = try XCTUnwrap(store.snapshot(for: "A").first)
        let firstID = RecoveryURLProtocol.lastRequest?.value(forHTTPHeaderField: "X-Client-Mutation-Id")
        XCTAssertEqual(firstID, original.id.uuidString.lowercased())
        api.token = "synthetic-recovery-B"; api.activateAuthenticatedAccount(userId: "B")
        api.token = "synthetic-recovery-A-new"; api.activateAuthenticatedAccount(userId: "A")
        RecoveryURLProtocol.finish(status: 401, body: #"{"error":"late unauthorized"}"#)
        do { _ = try await initial.value; XCTFail("Late response crossed sessions") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(api.token, "synthetic-recovery-A-new")
        XCTAssertEqual(store.snapshot(for: "A").map(\.id), [original.id])

        let retryRequest = expectation(description: "same mutation retry")
        RecoveryURLProtocol.onRequest = { retryRequest.fulfill() }
        let retry = Task { try await api.flushPendingMutations() }
        await fulfillment(of: [retryRequest], timeout: 3)
        XCTAssertEqual(RecoveryURLProtocol.lastRequest?.value(forHTTPHeaderField: "X-Client-Mutation-Id"), firstID)
        RecoveryURLProtocol.finish(status: 409, body: #"{"error":"Mutation is still processing; recovery required","code":"MUTATION_RECOVERY_REQUIRED"}"#)
        try await retry.value
        XCTAssertEqual(store.reviewCount, 1)
        XCTAssertTrue(store.snapshot(for: "A").isEmpty)
        // Automatic retries cannot replay a held receipt.
        let heldRequest = RecoveryURLProtocol.lastRequest
        try await api.flushPendingMutations()
        XCTAssertEqual(RecoveryURLProtocol.lastRequest, heldRequest)
        try store.reviewAction(id: original.id, owner: "A", generation: store.accountGeneration, archive: false)
        let confirmedRequest = expectation(description: "explicit same-ID retry")
        RecoveryURLProtocol.onRequest = { confirmedRequest.fulfill() }
        let confirmed = Task { try await api.flushPendingMutations() }
        await fulfillment(of: [confirmedRequest], timeout: 3)
        XCTAssertEqual(RecoveryURLProtocol.lastRequest?.value(forHTTPHeaderField: "X-Client-Mutation-Id"), firstID)
        RecoveryURLProtocol.finish(status: 200, body: "{}")
        try await confirmed.value
        XCTAssertEqual(store.pendingCount, 0)
    }

    @MainActor
    func testUpgradeMovesOwnedQueueAwayFromOlderReplayPathWithoutChangingBytes() throws {
        let fixture = try makeFixture(); defer { fixture.cleanup() }
        let oldURL = fixture.storageURL.deletingLastPathComponent().appendingPathComponent("old-v2.json")
        let oldStore = OfflineMutationStore(storageURL: oldURL, legacyDefaults: fixture.defaults)
        oldStore.activateAccount(userId: "A")
        let mutation = oldStore.makeMutation(ownerUserId: "A", method: "POST", path: "/weights", body: Data("{}".utf8), kind: .weight)
        try oldStore.enqueue(mutation)
        var legacyFile = try JSONSerialization.jsonObject(with: Data(contentsOf: oldURL)) as! [String: Any]
        legacyFile["version"] = 2
        try JSONSerialization.data(withJSONObject: legacyFile).write(to: oldURL)
        let before = try Data(contentsOf: oldURL)
        let upgraded = OfflineMutationStore(storageURL: fixture.storageURL, previousStorageURL: oldURL, legacyDefaults: fixture.defaults)
        upgraded.activateAccount(userId: "A")
        XCTAssertFalse(FileManager.default.fileExists(atPath: oldURL.path))
        XCTAssertEqual(try Data(contentsOf: fixture.storageURL), before)
        XCTAssertEqual(upgraded.snapshot(for: "A").map(\.id), [mutation.id])
        try upgraded.hold(mutation, reason: "Needs review")
        // A later queue from a downgraded app is not merged or replayed.
        try before.write(to: oldURL)
        let reloaded = OfflineMutationStore(storageURL: fixture.storageURL, previousStorageURL: oldURL, legacyDefaults: fixture.defaults)
        reloaded.activateAccount(userId: "A")
        XCTAssertTrue(reloaded.hasLegacyWork)
        XCTAssertTrue(reloaded.snapshot(for: "A").isEmpty)
        XCTAssertEqual(reloaded.reviewCount, 1)
        XCTAssertEqual(try Data(contentsOf: oldURL), before)
    }

    @MainActor
    func testSetAsideDuringFlushPreventsSendingLaterSnapshotItem() async throws {
        let fixture = try makeFixture(); defer { fixture.cleanup() }
        let store = OfflineMutationStore(storageURL: fixture.storageURL, legacyDefaults: fixture.defaults)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [RecoveryURLProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel(); RecoveryURLProtocol.reset() }
        let api = APIClient(session: session, offlineStore: store)
        api.token = "synthetic-archive"; api.activateAuthenticatedAccount(userId: "A")
        defer { api.token = nil }
        let first = store.makeMutation(ownerUserId: "A", method: "POST", path: "/weights", body: Data("{}".utf8), kind: .weight)
        let second = store.makeMutation(ownerUserId: "A", method: "POST", path: "/weights", body: Data("{}".utf8), kind: .weight)
        try store.enqueue(first); try store.enqueue(second)
        let started = expectation(description: "first request")
        RecoveryURLProtocol.onRequest = {
            if RecoveryURLProtocol.requestCount == 1 { started.fulfill() }
            else { RecoveryURLProtocol.finish(status: 200, body: "{}") }
        }
        let flush = Task { try await api.flushPendingMutations() }
        await fulfillment(of: [started], timeout: 3)
        let snapshot = store.snapshot(for: "A")
        let sentID = RecoveryURLProtocol.lastRequest?.value(forHTTPHeaderField: "X-Client-Mutation-Id")
        let unsent = try XCTUnwrap(snapshot.first { $0.id.uuidString.lowercased() != sentID })
        try store.reviewAction(id: unsent.id, owner: "A", generation: store.accountGeneration, archive: true)
        RecoveryURLProtocol.finish(status: 200, body: "{}")
        try await flush.value
        XCTAssertEqual(RecoveryURLProtocol.requestCount, 1)
        XCTAssertEqual(store.pendingCount, 0)
        XCTAssertEqual(try store.reviewItems(owner: "A", generation: store.accountGeneration).map(\.id), [unsent.id])
    }

    @MainActor
    func testSameReceiptCannotReplaceOriginalRequestButJSONKeyOrderIsIrrelevant() throws {
        let fixture = try makeFixture(); defer { fixture.cleanup() }
        let store = OfflineMutationStore(storageURL: fixture.storageURL, legacyDefaults: fixture.defaults)
        store.activateAccount(userId: "A")
        let mutation = store.makeMutation(ownerUserId: "A", method: "POST", path: "/weights", body: Data(#"{"weight":180,"loggedAt":"synthetic"}"#.utf8), kind: .weight)
        try store.enqueue(mutation)
        let same = PendingMutation(clientMutationId: mutation.id, ownerUserId: "A", createdAt: Date(), method: "POST", path: "/weights", body: Data(#"{"loggedAt":"synthetic","weight":180}"#.utf8), kind: .weight)
        try store.enqueue(same)
        let different = PendingMutation(clientMutationId: mutation.id, ownerUserId: "A", createdAt: Date(), method: "POST", path: "/weights", body: Data(#"{"weight":190}"#.utf8), kind: .weight)
        XCTAssertThrowsError(try store.enqueue(different))
        XCTAssertEqual(store.snapshot(for: "A").first?.body, mutation.body)
    }

    @MainActor
    func testCheckinJournalsItsSuppliedIdentityBeforeSendAndHoldsRejection() async throws {
        let fixture = try makeFixture(); defer { fixture.cleanup() }
        let store = OfflineMutationStore(storageURL: fixture.storageURL, legacyDefaults: fixture.defaults)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [RecoveryURLProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel(); RecoveryURLProtocol.reset() }
        let api = APIClient(session: session, offlineStore: store)
        api.token = "synthetic-checkin"; api.activateAuthenticatedAccount(userId: "A")
        defer { api.token = nil }
        let started = expectation(description: "check-in sent")
        RecoveryURLProtocol.onRequest = { started.fulfill() }
        let mutationID = UUID()
        let save = Task { try await api.saveCheckin(id: nil, createID: "synthetic-checkin", day: "2026-10-07", notes: "Synthetic", waist: nil, mutationID: mutationID) }
        await fulfillment(of: [started], timeout: 3)
        XCTAssertEqual(store.snapshot(for: "A").map(\.id), [mutationID])
        RecoveryURLProtocol.finish(status: 409, body: #"{"error":"Recovery required"}"#)
        do { _ = try await save.value; XCTFail("Rejected check-in succeeded") } catch {}
        XCTAssertTrue(store.snapshot(for: "A").isEmpty)
        XCTAssertEqual(try store.reviewItems(owner: "A", generation: store.accountGeneration).map(\.id), [mutationID])
    }

    @MainActor
    func testCancelledOldAccountDeletionCannotReactivateItsQueueInTheNewAccount() async throws {
        let fixture = try makeFixture(); defer { fixture.cleanup() }
        let store = OfflineMutationStore(storageURL: fixture.storageURL, legacyDefaults: fixture.defaults)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [RecoveryURLProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel(); RecoveryURLProtocol.reset() }
        let api = APIClient(session: session, offlineStore: store)
        api.token = "synthetic-delete-A"; api.activateAuthenticatedAccount(userId: "A")
        defer { api.token = nil }
        let started = expectation(description: "synthetic deletion intercepted")
        RecoveryURLProtocol.onRequest = { started.fulfill() }
        let deleting = Task { try await api.deleteAccount() }
        await fulfillment(of: [started], timeout: 3)
        api.token = "synthetic-delete-B"; api.activateAuthenticatedAccount(userId: "B")
        RecoveryURLProtocol.finish(status: 500, body: #"{"error":"synthetic failure"}"#)
        do { try await deleting.value; XCTFail("Old account request succeeded") } catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(api.authenticatedUserId, "B")
        XCTAssertEqual(store.activeOwnerUserId, "B")
        XCTAssertEqual(api.token, "synthetic-delete-B")
    }

    private func makeFixture() throws -> (
        storageURL: URL,
        defaults: UserDefaults,
        cleanup: () -> Void
    ) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("DailyMacrosTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true
        )
        let suiteName = "DailyMacrosTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let storageURL = root.appendingPathComponent("pending-mutations-v2.json")

        return (
            storageURL,
            defaults,
            {
                defaults.removePersistentDomain(forName: suiteName)
                try? FileManager.default.removeItem(at: root)
            }
        )
    }
}


private final class RecoveryURLProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) static var onRequest: (() -> Void)?
    nonisolated(unsafe) static var lastRequest: URLRequest?
    nonisolated(unsafe) static var requestCount = 0
    nonisolated(unsafe) private static var pending: RecoveryURLProtocol?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.pending = self; Self.lastRequest = request; Self.requestCount += 1
        let callback = Self.onRequest; Self.lock.unlock()
        callback?()
    }
    override func stopLoading() {}
    static func finish(status: Int, body: String) {
        lock.lock(); let item = pending; pending = nil; lock.unlock()
        guard let item else { return }
        let response = HTTPURLResponse(url: item.request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        item.client?.urlProtocol(item, didReceive: response, cacheStoragePolicy: .notAllowed)
        item.client?.urlProtocol(item, didLoad: Data(body.utf8))
        item.client?.urlProtocolDidFinishLoading(item)
    }
    static func reset() { lock.lock(); pending = nil; lastRequest = nil; onRequest = nil; requestCount = 0; lock.unlock() }
}
