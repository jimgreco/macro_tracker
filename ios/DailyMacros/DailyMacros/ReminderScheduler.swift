import Foundation
import UserNotifications

@MainActor
final class ReminderScheduler: ObservableObject {
    static let shared = ReminderScheduler()

    private let enabledKey = "daily_log_reminder_enabled"
    private let hourKey = "daily_log_reminder_hour"
    private let minuteKey = "daily_log_reminder_minute"
    private let requestIdentifier = "daily-log-reminder"

    var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: enabledKey)
    }

    var reminderDate: Date {
        var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        components.hour = UserDefaults.standard.object(forKey: hourKey) as? Int ?? 19
        components.minute = UserDefaults.standard.object(forKey: minuteKey) as? Int ?? 30
        return Calendar.current.date(from: components) ?? Date()
    }

    func setEnabled(_ enabled: Bool, at date: Date) async throws {
        saveTime(date)
        UserDefaults.standard.set(enabled, forKey: enabledKey)

        if enabled {
            try await schedule(at: date)
        } else {
            cancel()
        }
    }

    func updateTime(_ date: Date) async throws {
        saveTime(date)
        if isEnabled {
            try await schedule(at: date)
        }
    }

    private func saveTime(_ date: Date) {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        UserDefaults.standard.set(components.hour ?? 19, forKey: hourKey)
        UserDefaults.standard.set(components.minute ?? 30, forKey: minuteKey)
    }

    private func schedule(at date: Date) async throws {
        let center = UNUserNotificationCenter.current()
        let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        guard granted else {
            UserDefaults.standard.set(false, forKey: enabledKey)
            throw APIError.serverError("Notifications are not allowed for DailyMacros.")
        }

        let content = UNMutableNotificationContent()
        content.title = "Log DailyMacros"
        content.body = "Add today's meals, weight, workout, or sleep before the day gets away."
        content.sound = .default

        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
        let request = UNNotificationRequest(identifier: requestIdentifier, content: content, trigger: trigger)

        center.removePendingNotificationRequests(withIdentifiers: [requestIdentifier])
        try await center.add(request)
    }

    private func cancel() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [requestIdentifier])
    }
}
