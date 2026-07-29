import XCTest
@testable import DailyMacros

final class OfflineMutationStoreTests: XCTestCase {
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
