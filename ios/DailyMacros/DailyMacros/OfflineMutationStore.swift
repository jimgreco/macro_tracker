import Foundation

struct PendingMutation: Codable, Identifiable {
    let id: UUID
    let createdAt: Date
    let method: String
    let path: String
    let body: Data?
    let summary: String
}

@MainActor
final class OfflineMutationStore: ObservableObject {
    static let shared = OfflineMutationStore()

    @Published private(set) var mutations: [PendingMutation]

    private let storageKey = "pending_mutations_v1"

    private init() {
        if let data = UserDefaults.standard.data(forKey: storageKey),
           let decoded = try? JSONDecoder().decode([PendingMutation].self, from: data) {
            mutations = decoded
        } else {
            mutations = []
        }
    }

    var pendingCount: Int {
        mutations.count
    }

    func enqueue(method: String, path: String, body: Data?, summary: String) {
        mutations.append(PendingMutation(
            id: UUID(),
            createdAt: Date(),
            method: method,
            path: path,
            body: body,
            summary: summary
        ))
        persist()
    }

    func remove(id: UUID) {
        mutations.removeAll { $0.id == id }
        persist()
    }

    func removeAll() {
        mutations = []
        persist()
    }

    func snapshot() -> [PendingMutation] {
        mutations
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(mutations) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }
}
