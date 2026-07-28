import Foundation

enum PendingMutationKind: String, Codable {
    case meal
    case quickAdd = "quick_add"
    case weight
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

    var errorDescription: String? {
        switch self {
        case .noActiveAccount:
            return "Sign in again before saving offline."
        case .accountWasDeleted:
            return "Pending work cannot be saved for a deleted account."
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

    private static let storageVersion = 2
    private static let legacyStorageKey = "pending_mutations_v1"

    private let fileManager: FileManager
    private let storageURL: URL
    private var allMutations: [PendingMutation]
    private var deletedOwnerUserIds: Set<String> = []

    private(set) var legacyDiscardedCount: Int

    init(
        fileManager: FileManager = .default,
        storageURL: URL? = nil,
        legacyDefaults: UserDefaults = .standard
    ) {
        self.fileManager = fileManager
        self.storageURL = storageURL ?? Self.defaultStorageURL(fileManager: fileManager)
        self.mutations = []
        self.activeOwnerUserId = nil

        let loaded = Self.loadProtectedMutations(
            fileManager: fileManager,
            storageURL: self.storageURL
        )
        self.allMutations = loaded.filter { !$0.ownerUserId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        self.legacyDiscardedCount = Self.discardLegacyUnownedMutations(defaults: legacyDefaults)

        if self.allMutations.count != loaded.count {
            try? persist()
        }
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
        activeOwnerUserId = normalizedUserId
        refreshPublishedMutations()
    }

    /// Ordinary sign-out and sign-out-everywhere preserve protected work for the
    /// same account, but remove it from the active UI and replay surface.
    func deactivateAccount() {
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

        if allMutations.contains(where: {
            $0.ownerUserId == normalizedOwner && $0.clientMutationId == mutation.clientMutationId
        }) {
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
            $0.ownerUserId == ownerUserId && $0.clientMutationId == clientMutationId
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
            .filter { $0.ownerUserId == ownerUserId }
            .sorted {
                if $0.createdAt == $1.createdAt {
                    return $0.clientMutationId.uuidString < $1.clientMutationId.uuidString
                }
                return $0.createdAt < $1.createdAt
            }
    }

    private func refreshPublishedMutations() {
        guard let activeOwnerUserId else {
            mutations = []
            return
        }
        mutations = allMutations
            .filter { $0.ownerUserId == activeOwnerUserId }
            .sorted {
                if $0.createdAt == $1.createdAt {
                    return $0.clientMutationId.uuidString < $1.clientMutationId.uuidString
                }
                return $0.createdAt < $1.createdAt
            }
    }

    private func persist() throws {
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
            .appendingPathComponent("pending-mutations-v2.json", isDirectory: false)
    }

    private static func loadProtectedMutations(
        fileManager: FileManager,
        storageURL: URL
    ) -> [PendingMutation] {
        guard let data = try? Data(contentsOf: storageURL) else { return [] }
        guard
            let file = try? JSONDecoder().decode(PendingMutationFile.self, from: data),
            file.version == storageVersion
        else {
            try? fileManager.removeItem(at: storageURL)
            return []
        }
        return file.mutations
    }

    private static func discardLegacyUnownedMutations(defaults: UserDefaults) -> Int {
        guard let data = defaults.data(forKey: legacyStorageKey) else { return 0 }
        let count = (try? JSONDecoder().decode([LegacyPendingMutation].self, from: data).count) ?? 1
        defaults.removeObject(forKey: legacyStorageKey)
        return count
    }
}
