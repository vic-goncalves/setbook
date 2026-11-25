import Domain
import Foundation

enum Format {
    /// Trims trailing zeros: 135 -> "135", 61.25 -> "61.25", 61.2349 -> "61.23".
    static func number(_ value: Double, maxFractionDigits: Int = 2) -> String {
        value.formatted(.number.precision(.fractionLength(0...maxFractionDigits)).grouping(.never))
    }

    static func mass(_ mass: RecordedMass, in unit: MassUnit, withUnit: Bool = true) -> String {
        let text = number(mass.value(in: unit))
        return withUnit ? "\(text) \(unit.symbol)" : text
    }

    static func kilograms(_ kilograms: Double, in unit: MassUnit, withUnit: Bool = true) -> String {
        let text = number(unit.fromKilograms(kilograms), maxFractionDigits: 1)
        return withUnit ? "\(text) \(unit.symbol)" : text
    }

    /// "135 x 8", "x 12" for bodyweight, or "-" when nothing usable was logged.
    static func set(_ set: WorkoutSet, unit: MassUnit) -> String {
        switch (set.load, set.reps) {
        case let (load?, reps?): "\(mass(load, in: unit, withUnit: false)) x \(reps)"
        case let (nil, reps?): "x \(reps)"
        default: "-"
        }
    }

    /// "+1.2" or "-0.8"; zero shows as "0".
    static func signed(_ value: Double, maxFractionDigits: Int = 1) -> String {
        let text = number(abs(value), maxFractionDigits: maxFractionDigits)
        if text == "0" { return "0" }
        return (value > 0 ? "+" : "-") + text
    }

    static func duration(_ interval: TimeInterval) -> String {
        let minutes = Int(interval / 60)
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }

    /// "12:05" under an hour, "1:02:05" over.
    static func stopwatch(_ interval: TimeInterval) -> String {
        let total = max(0, Int(interval))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, seconds) : String(format: "%d:%02d", minutes, seconds)
    }

    static func clock(_ seconds: Int) -> String {
        String(format: "%d:%02d", max(0, seconds) / 60, max(0, seconds) % 60)
    }

    static func day(_ date: Date, timeZone: TimeZone = .current) -> String {
        var style = Date.FormatStyle(date: .abbreviated, time: .omitted)
        style.timeZone = timeZone
        return date.formatted(style)
    }

    /// "Today", "Yesterday", "3 days ago", or a date. Pass `midSentence` for lowercase.
    static func relativeDay(_ date: Date, now: Date = Date(), midSentence: Bool = false) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return midSentence ? "today" : "Today" }
        if calendar.isDateInYesterday(date) { return midSentence ? "yesterday" : "Yesterday" }
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 0
        if days < 7 { return "\(days) days ago" }
        return day(date)
    }
}
