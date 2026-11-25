import Domain
import SwiftUI

/// User preferences. Stored in UserDefaults because they are device-local display choices,
/// not training records; changing the unit never rewrites stored measurements.
enum SettingsKey {
    static let massUnit = "massUnit"
    static let defaultRestSeconds = "defaultRestSeconds"
    static let restAlertsEnabled = "restAlertsEnabled"
}

extension MassUnit {
    static var localeDefault: MassUnit {
        Locale.current.measurementSystem == .metric ? .kilograms : .pounds
    }
}
