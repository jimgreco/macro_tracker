import Foundation
import OSLog

struct DiagnosticEvent: Codable, Identifiable {
    let id: UUID
    let createdAt: Date
    let level: String
    let category: String
    let message: String
    let details: [String: String]
}

@MainActor
final class Diagnostics: ObservableObject {
    static let shared = Diagnostics()

    @Published private(set) var events: [DiagnosticEvent]

    private let storageKey = "diagnostic_events_v1"
    private let maxEvents = 200
    private let logger = Logger(subsystem: "com.dailymacros.app", category: "Diagnostics")

    private init() {
        if let data = UserDefaults.standard.data(forKey: storageKey),
           let decoded = try? JSONDecoder().decode([DiagnosticEvent].self, from: data) {
            events = decoded
        } else {
            events = []
        }
    }

    func record(
        level: String = "info",
        category: String,
        message: String,
        details: [String: String] = [:]
    ) {
        let event = DiagnosticEvent(
            id: UUID(),
            createdAt: Date(),
            level: level,
            category: category,
            message: message,
            details: details
        )
        events.append(event)
        if events.count > maxEvents {
            events.removeFirst(events.count - maxEvents)
        }
        persist()

        switch level {
        case "error":
            logger.error("\(category, privacy: .public): \(message, privacy: .public)")
        case "warning":
            logger.warning("\(category, privacy: .public): \(message, privacy: .public)")
        default:
            logger.info("\(category, privacy: .public): \(message, privacy: .public)")
        }
    }

    func exportText() -> String {
        let encoder = ISO8601DateFormatter()
        let lines = events.map { event in
            let detailText = event.details
                .sorted { $0.key < $1.key }
                .map { "\($0.key)=\($0.value)" }
                .joined(separator: " ")
            return [
                encoder.string(from: event.createdAt),
                event.level.uppercased(),
                event.category,
                event.message,
                detailText
            ]
            .filter { !$0.isEmpty }
            .joined(separator: " | ")
        }
        return (["DailyMacros Diagnostics"] + lines).joined(separator: "\n")
    }

    func clear() {
        events = []
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(events) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }
}
