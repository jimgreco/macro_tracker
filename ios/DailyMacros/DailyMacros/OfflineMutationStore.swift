import Foundation
import Combine

enum PendingMutationKind: String, Codable {
    case meal
    case quickAdd = "quick_add"
    case weight
    case waist
    case workout
    case sleep
    case sexualActivity = "sexual_activity"
    case dayCompleteness = "day_completeness"
}

struct PendingMutation: Codable, Identifiable {
    let clientMutationId: UUID
    let ownerUserId: String
    let createdAt: Date
    let method: String
    let path: String
    let body: Data?
    let kind: PendingMutationKind

    var reviewReason: String?
    var archivedAt: Date?

    var id: UUID { clientMutationId }
}

private struct PendingMutationFile: Codable {
    let version: Int
    let mutations: [PendingMutation]
}

private struct LegacyPendingMutation: Codable {
    let id: UUID
    let createdAt: Date
    let method: String
    let path: String
    let body: Data?
    let summary: String
}

enum OfflineMutationStoreError: LocalizedError {
    case noActiveAccount
    case accountWasDeleted
    case persistenceFailed(Error)
    case recoveryRequired

    var errorDescription: String? {
        switch self {
        case .noActiveAccount:
            return "Sign in again before saving offline."
        case .accountWasDeleted:
            return "Pending work cannot be saved for a deleted account."
        case .recoveryRequired:
            return "The preserved queue needs review. Its original bytes have not been changed."
        case .persistenceFailed:
            return "Unable to protect this pending log on this device."
        }
    }
}

@MainActor
final class OfflineMutationStore: ObservableObject {
    static let shared = OfflineMutationStore()

    @Published private(set) var mutations: [PendingMutation]
    @Published private(set) var activeOwnerUserId: String?

    private static let storageVersion = 3
    private static let legacyStorageKey = "pending_mutations_v1"

    private let fileManager: FileManager
    private let storageURL: URL
    private var allMutations: [PendingMutation]
    private var deletedOwnerUserIds: Set<String> = []

    private let legacyDefaults: UserDefaults
    private let unreadableStorage: Bool
    private let supersededStorageURL: URL?
    private(set) var accountGeneration = UUID()

    var hasLegacyWork: Bool { legacyDefaults.object(forKey: Self.legacyStorageKey) != nil || supersededStorageURL.map { fileManager.fileExists(atPath: $0.path) } == true }
    var hasUnreadableStorage: Bool { unreadableStorage }
    var reviewCount: Int { mutations.filter { $0.reviewReason != nil }.count }

    init(
        fileManager: FileManager = .default,
        storageURL: URL? = nil,
        previousStorageURL: URL? = nil,
        legacyDefaults: UserDefaults = .standard
    ) {
        self.legacyDefaults = legacyDefaults
        self.fileManager = fileManager
        self.storageURL = storageURL ?? Self.defaultStorageURL(fileManager: fileManager)
        self.supersededStorageURL = previousStorageURL ?? (storageURL == nil ? self.storageURL.deletingLastPathComponent().appendingPathComponent("pending-mutations-v2.json") : nil)
        self.mutations = []
        self.activeOwnerUserId = nil
        var migrationFailed = false
        // Rename preserves exact bytes and removes the old client's replay path.
        // A later v2 file (after a downgrade) stays quarantined, never merged.
        if let oldURL = self.supersededStorageURL,
           !fileManager.fileExists(atPath: self.storageURL.path), fileManager.fileExists(atPath: oldURL.path) {
            do { try fileManager.moveItem(at: oldURL, to: self.storageURL) }
            catch { migrationFailed = true }
        }

        let loaded = Self.loadProtectedMutations(
            fileManager: fileManager,
            storageURL: self.storageURL
        )
        self.unreadableStorage = migrationFailed || (fileManager.fileExists(atPath: self.storageURL.path) && loaded == nil)
        self.allMutations = loaded ?? []
    }

    var pendingCount: Int {
        mutations.count
    }

    func activateAccount(userId: String) {
        let normalizedUserId = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedUserId.isEmpty else {
            deactivateAccount()
            return
        }
        if activeOwnerUserId != normalizedUserId { accountGeneration = UUID() }
        activeOwnerUserId = normalizedUserId
        refreshPublishedMutations()
    }

    /// Ordinary sign-out and sign-out-everywhere preserve protected work for the
    /// same account, but remove it from the active UI and replay surface.
    func deactivateAccount() {
        accountGeneration = UUID()
        activeOwnerUserId = nil
        mutations = []
    }

    func makeMutation(
        ownerUserId: String,
        method: String,
        path: String,
        body: Data?,
        kind: PendingMutationKind
    ) -> PendingMutation {
        PendingMutation(
            clientMutationId: UUID(),
            ownerUserId: ownerUserId,
            createdAt: Date(),
            method: method.uppercased(),
            path: path,
            body: body,
            kind: kind
        )
    }

    func enqueue(_ mutation: PendingMutation) throws {
        let normalizedOwner = mutation.ownerUserId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedOwner.isEmpty else {
            throw OfflineMutationStoreError.noActiveAccount
        }
        guard !deletedOwnerUserIds.contains(normalizedOwner) else {
            throw OfflineMutationStoreError.accountWasDeleted
        }

        if let existing = allMutations.first(where: {
            $0.ownerUserId == normalizedOwner && $0.clientMutationId == mutation.clientMutationId
        }) {
            guard existing.method == mutation.method, existing.path == mutation.path,
                  existing.kind == mutation.kind, Self.canonicalBody(existing.body) == Self.canonicalBody(mutation.body) else {
                throw OfflineMutationStoreError.recoveryRequired
            }
            return
        }

        let previous = allMutations
        allMutations.append(mutation)
        do {
            try persist()
            refreshPublishedMutations()
        } catch {
            allMutations = previous
            refreshPublishedMutations()
            throw OfflineMutationStoreError.persistenceFailed(error)
        }
    }

    func remove(clientMutationId: UUID, ownerUserId: String) throws {
        let previous = allMutations
        allMutations.removeAll {
            $0.ownerUserId == ownerUserId && $0.clientMutationId == clientMutationId && $0.archivedAt == nil && $0.reviewReason == nil
        }
        guard previous.count != allMutations.count else { return }

        do {
            try persist()
            refreshPublishedMutations()
        } catch {
            allMutations = previous
            refreshPublishedMutations()
            throw OfflineMutationStoreError.persistenceFailed(error)
        }
    }

    /// Account deletion is the only sign-out lifecycle that destroys protected
    /// pending work. The in-memory tombstone also rejects a late network callback
    /// that tries to re-enqueue work for the deleted account.
    func discardPendingWorkForDeletedAccount(userId: String) throws {
        let normalizedUserId = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedUserId.isEmpty else { return }

        let previous = allMutations
        allMutations.removeAll { $0.ownerUserId == normalizedUserId }
        deletedOwnerUserIds.insert(normalizedUserId)
        do {
            try persist()
            if activeOwnerUserId == normalizedUserId {
                deactivateAccount()
            } else {
                refreshPublishedMutations()
            }
        } catch {
            allMutations = previous
            deletedOwnerUserIds.remove(normalizedUserId)
            refreshPublishedMutations()
            throw OfflineMutationStoreError.persistenceFailed(error)
        }
    }

    func restoreAccountAfterFailedDeletion(userId: String) {
        let normalizedUserId = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedUserId.isEmpty else { return }
        deletedOwnerUserIds.remove(normalizedUserId)
        activateAccount(userId: normalizedUserId)
    }

    func snapshot(for ownerUserId: String) -> [PendingMutation] {
        guard activeOwnerUserId == ownerUserId else { return [] }
        return allMutations
            .filter { $0.ownerUserId == ownerUserId && $0.reviewReason == nil && $0.archivedAt == nil }
            .sorted {
                if $0.createdAt == $1.createdAt {
                    return $0.clientMutationId.uuidString < $1.clientMutationId.uuidString
                }
                return $0.createdAt < $1.createdAt
            }
    }

    private static func canonicalBody(_ body: Data?) -> Data? {
        guard let body, let object = try? JSONSerialization.jsonObject(with: body),
              let canonical = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return body }
        return canonical
    }

    private func refreshPublishedMutations() {
        guard let activeOwnerUserId else {
            mutations = []
            return
        }
        mutations = allMutations
            .filter { $0.ownerUserId == activeOwnerUserId && $0.archivedAt == nil }
            .sorted {
                if $0.createdAt == $1.createdAt {
                    return $0.clientMutationId.uuidString < $1.clientMutationId.uuidString
                }
                return $0.createdAt < $1.createdAt
            }
    }

    // Recovery actions are fenced by the exact sign-in session, including A → B → A.
    func checkRecoveryAccount(_ owner: String, generation: UUID) throws {
        guard activeOwnerUserId == owner, accountGeneration == generation else {
            throw OfflineMutationStoreError.noActiveAccount
        }
    }

    func reviewItems(owner: String, generation: UUID) throws -> [PendingMutation] {
        try checkRecoveryAccount(owner, generation: generation)
        return allMutations.filter { $0.ownerUserId == owner }
    }

    func hold(_ mutation: PendingMutation, reason: String) throws {
        guard let index = allMutations.firstIndex(where: { $0.id == mutation.id && $0.ownerUserId == mutation.ownerUserId }) else { return }
        guard allMutations[index].archivedAt == nil else { return }
        let previous = allMutations
        allMutations[index].reviewReason = reason
        do { try persist(); refreshPublishedMutations() }
        catch { allMutations = previous; throw error }
    }

    func reviewAction(id: UUID, owner: String, generation: UUID, archive: Bool) throws {
        try checkRecoveryAccount(owner, generation: generation)
        guard let index = allMutations.firstIndex(where: { $0.id == id && $0.ownerUserId == owner }) else { return }
        let previous = allMutations
        allMutations[index].archivedAt = archive ? Date() : nil
        // Retrying retains the same request bytes and server-recognized UUID.
        allMutations[index].reviewReason = archive ? "Set aside on this device; original request retained." : nil
        do { try persist(); refreshPublishedMutations() }
        catch { allMutations = previous; throw error }
    }

    func recoveryExport(owner: String, generation: UUID, includeLegacy: Bool) throws -> String {
        try checkRecoveryAccount(owner, generation: generation)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        var packet: [String: Any] = [
            "format": "macrovana-local-recovery-v1", "account": owner,
            "pending": try JSONSerialization.jsonObject(with: encoder.encode(allMutations.filter { $0.ownerUserId == owner }))
        ]
        if includeLegacy {
            // Unknown ownership stays explicit. Export never adopts or submits it.
            packet["legacyOwnership"] = "unverified; device user requested local review"
            if let data = legacyDefaults.data(forKey: Self.legacyStorageKey) {
                packet["legacyOriginalBase64"] = data.base64EncodedString()
                packet["legacyPreview"] = (try? JSONSerialization.jsonObject(with: data)) ?? "Unreadable; original bytes retained"
            }
            if let supersededStorageURL,
               let retained = Self.loadProtectedMutations(fileManager: fileManager, storageURL: supersededStorageURL) {
                packet["postDowngradePendingForAccount"] = try JSONSerialization.jsonObject(with: encoder.encode(retained.filter { $0.ownerUserId == owner }))
            }
            if unreadableStorage, let data = try? Data(contentsOf: storageURL) {
                packet["unreadableProtectedOriginalBase64"] = data.base64EncodedString()
            }
        }
        return String(decoding: try JSONSerialization.data(withJSONObject: packet, options: [.prettyPrinted, .sortedKeys]), as: UTF8.self)
    }

    private func persist() throws {
        guard !unreadableStorage else { throw OfflineMutationStoreError.recoveryRequired }

        if allMutations.isEmpty {
            if fileManager.fileExists(atPath: storageURL.path) {
                try fileManager.removeItem(at: storageURL)
            }
            return
        }

        let directoryURL = storageURL.deletingLastPathComponent()
        try fileManager.createDirectory(
            at: directoryURL,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete]
        )

        let file = PendingMutationFile(
            version: Self.storageVersion,
            mutations: allMutations
        )
        let data = try JSONEncoder().encode(file)
        try data.write(to: storageURL, options: [.atomic, .completeFileProtection])
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.complete],
            ofItemAtPath: storageURL.path
        )

        var protectedURL = storageURL
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try? protectedURL.setResourceValues(resourceValues)
    }

    private static func defaultStorageURL(fileManager: FileManager) -> URL {
        let applicationSupport = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? fileManager.temporaryDirectory
        return applicationSupport
            .appendingPathComponent("DailyMacros", isDirectory: true)
            .appendingPathComponent("pending-mutations-v3.json", isDirectory: false)
    }

    private static func loadProtectedMutations(
        fileManager: FileManager,
        storageURL: URL
    ) -> [PendingMutation]? {
        guard let data = try? Data(contentsOf: storageURL) else { return nil }
        guard
            let file = try? JSONDecoder().decode(PendingMutationFile.self, from: data),
            [2, storageVersion].contains(file.version)
        else {
            return nil
        }
        return file.mutations
    }

}
