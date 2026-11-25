import Foundation

public enum ChartRange: String, CaseIterable, Sendable, Identifiable {
    case oneMonth = "1M"
    case threeMonths = "3M"
    case sixMonths = "6M"
    case oneYear = "1Y"
    case all = "All"

    public var id: String { rawValue }

    /// Inclusive lower bound, or nil for all time.
    public func start(endingAt now: Date, calendar: Calendar = .current) -> Date? {
        let months: Int
        switch self {
        case .oneMonth: months = 1
        case .threeMonths: months = 3
        case .sixMonths: months = 6
        case .oneYear: months = 12
        case .all: return nil
        }
        return calendar.date(byAdding: .month, value: -months, to: now)
    }

    public func contains(_ date: Date, now: Date, calendar: Calendar = .current) -> Bool {
        guard let start = start(endingAt: now, calendar: calendar) else { return true }
        return date >= start
    }
}
