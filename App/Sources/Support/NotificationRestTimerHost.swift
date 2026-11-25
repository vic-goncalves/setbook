import Foundation
import UserNotifications
import Workflow

/// Remembers the rest timer across relaunches and, if the user opted in, schedules a local
/// notification for when rest ends. Notification failures are ignored on purpose.
@MainActor
final class NotificationRestTimerHost: RestTimerHost {
    private let defaults: UserDefaults
    private static let storageKey = "activeRestTimer"
    private static let notificationId = "rest-timer"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func restore() -> RestTimer? {
        defaults.data(forKey: Self.storageKey).flatMap { try? JSONDecoder().decode(RestTimer.self, from: $0) }
    }

    func persist(_ timer: RestTimer?) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [Self.notificationId])
        guard let timer else {
            defaults.removeObject(forKey: Self.storageKey)
            return
        }
        defaults.set(try? JSONEncoder().encode(timer), forKey: Self.storageKey)
        guard defaults.bool(forKey: SettingsKey.restAlertsEnabled), timer.endsAt > Date() else { return }
        let content = UNMutableNotificationContent()
        content.title = "Rest is over"
        content.body = "Time for your next set."
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: timer.endsAt.timeIntervalSinceNow, repeats: false)
        center.add(UNNotificationRequest(identifier: Self.notificationId, content: content, trigger: trigger)) { _ in }
    }

    /// Only asked when the user turns alerts on, never at launch.
    static func requestAuthorization() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
    }
}
