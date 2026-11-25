import Domain
import Foundation

/// A calendar day in the time zone where a measurement was taken.
public struct LocalDay: Hashable, Comparable, Sendable {
    public let year: Int
    public let month: Int
    public let day: Int

    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }()

    public init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    public init(_ date: Date, in timeZone: TimeZone) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        self.init(year: parts.year ?? 0, month: parts.month ?? 0, day: parts.day ?? 0)
    }

    /// Noon UTC on this day: a stable instant for charting and day arithmetic.
    public var date: Date {
        Self.utc.date(from: DateComponents(year: year, month: month, day: day, hour: 12)) ?? .distantPast
    }

    public func days(since other: LocalDay) -> Int {
        Int(((date.timeIntervalSince(other.date)) / 86_400).rounded())
    }

    public static func < (a: LocalDay, b: LocalDay) -> Bool {
        (a.year, a.month, a.day) < (b.year, b.month, b.day)
    }
}

public struct DailyWeight: Hashable, Sendable {
    public let day: LocalDay
    public let meanKilograms: Double
    public let count: Int
}

public struct AveragePoint: Hashable, Sendable {
    public let day: LocalDay
    public let kilograms: Double
    /// How many observed days contributed (1...7). Fewer means a less reliable average.
    public let observedDays: Int
}

public struct WeightChange: Hashable, Sendable {
    public let from: LocalDay
    public let to: LocalDay
    public let kilograms: Double
}

public struct BodyWeightSummary: Hashable, Sendable {
    public let latest: BodyMeasurement?
    public let daily: [DailyWeight]
    /// Empty when the range has fewer than two observed days; no trend claim is made then.
    public let rollingAverage: [AveragePoint]
    /// Last observed day's mean minus the first observed day's mean in the range.
    public let change: WeightChange?
}

public enum BodyWeightTrend {
    public static let averageWindowDays = 7
    public static let definitionVersion = 1

    /// Each day's mean, so a day with three weigh-ins counts once.
    public static func dailyMeans(_ measurements: [BodyMeasurement]) -> [DailyWeight] {
        let grouped = Dictionary(grouping: measurements.filter(\.isValid)) { LocalDay($0.measuredAt, in: $0.timeZone) }
        return grouped.map { day, entries in
            DailyWeight(day: day, meanKilograms: entries.map(\.mass.kilograms).reduce(0, +) / Double(entries.count), count: entries.count)
        }
        .sorted { $0.day < $1.day }
    }

    /// For each observed day D, the mean of observed daily means in D-6...D.
    /// Missing days are skipped, never filled.
    public static func rollingAverage(_ daily: [DailyWeight]) -> [AveragePoint] {
        daily.map { current in
            let window = daily.filter {
                let offset = current.day.days(since: $0.day)
                return offset >= 0 && offset < averageWindowDays
            }
            return AveragePoint(
                day: current.day,
                kilograms: window.map(\.meanKilograms).reduce(0, +) / Double(window.count),
                observedDays: window.count
            )
        }
    }

    public static func summary(_ measurements: [BodyMeasurement], range: ChartRange, now: Date = Date()) -> BodyWeightSummary {
        let all = dailyMeans(measurements)
        let rangeStart = range.start(endingAt: now).map { LocalDay($0, in: .current) }
        let inRange = all.filter { day in rangeStart.map { day.day >= $0 } ?? true }
        // The average is computed over all history so the first points of a range still
        // reflect the preceding days, then clipped to the range.
        let average = inRange.count >= 2
            ? rollingAverage(all).filter { point in rangeStart.map { point.day >= $0 } ?? true }
            : []
        let change: WeightChange? = if inRange.count >= 2, let first = inRange.first, let last = inRange.last {
            WeightChange(from: first.day, to: last.day, kilograms: last.meanKilograms - first.meanKilograms)
        } else {
            nil
        }
        return BodyWeightSummary(
            latest: measurements.filter(\.isValid).max { $0.measuredAt < $1.measuredAt },
            daily: inRange,
            rollingAverage: average,
            change: change
        )
    }
}
