import Foundation

/// Rest countdown stored as an end timestamp, so the displayed time stays correct after
/// backgrounding or relaunch.
public struct RestTimer: Codable, Equatable, Sendable {
    public var endsAt: Date
    public var duration: Int

    public init(endsAt: Date, duration: Int) {
        self.endsAt = endsAt
        self.duration = duration
    }

    public func remaining(at now: Date) -> Int { max(0, Int(endsAt.timeIntervalSince(now).rounded(.up))) }

    public func isFinished(at now: Date) -> Bool { now >= endsAt }
}

/// Where the timer is remembered and how the user is alerted. Implementations must never
/// throw into logging: a failed alert is not allowed to block a set.
@MainActor
public protocol RestTimerHost: AnyObject {
    func restore() -> RestTimer?
    func persist(_ timer: RestTimer?)
}

/// Keeps the timer in memory only. Used in tests and previews.
@MainActor
public final class InMemoryRestTimerHost: RestTimerHost {
    public private(set) var stored: RestTimer?

    public init(_ stored: RestTimer? = nil) { self.stored = stored }

    public func restore() -> RestTimer? { stored }

    public func persist(_ timer: RestTimer?) { stored = timer }
}
