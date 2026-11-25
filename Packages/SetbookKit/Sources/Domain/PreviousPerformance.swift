import Foundation

/// The completed sets from the latest finished workout containing an exercise.
public struct PreviousPerformance: Hashable, Sendable {
    public let sessionId: UUID
    public let date: Date
    public let sets: [WorkoutSet]

    public init(sessionId: UUID, date: Date, sets: [WorkoutSet]) {
        self.sessionId = sessionId
        self.date = date
        self.sets = sets.filter(\.isCompleted)
    }

    /// Aligns by set type and ordinal: the 2nd working set today is compared with the 2nd
    /// working set last time. Returns nil rather than guessing when there is no counterpart.
    public func counterpart(forSetAt index: Int, in current: [WorkoutSet]) -> WorkoutSet? {
        guard current.indices.contains(index) else { return nil }
        let type = current[index].type
        let ordinal = current[..<index].count(where: { $0.type == type })
        let candidates = sets.filter { $0.type == type }
        return candidates.indices.contains(ordinal) ? candidates[ordinal] : nil
    }
}
