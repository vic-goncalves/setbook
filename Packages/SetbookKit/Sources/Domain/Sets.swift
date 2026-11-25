import Foundation

public enum SetType: String, Codable, Sendable, CaseIterable {
    case warmup
    case working
}

/// A rep prescription: either an exact count (min == max) or a range.
public struct RepTarget: Hashable, Codable, Sendable {
    public let min: Int
    public let max: Int

    public init?(min: Int, max: Int) {
        guard min >= 1, max >= min else { return nil }
        self.min = min
        self.max = max
    }

    public static func exactly(_ reps: Int) -> RepTarget? { RepTarget(min: reps, max: reps) }

    public var isExact: Bool { min == max }

    public var displayText: String { isExact ? "\(min)" : "\(min)-\(max)" }
}

public enum SetValidationError: Error, Equatable, Sendable {
    case missingReps
    case nonPositiveReps
    case missingLoad
    case negativeLoad
    case unexpectedLoad
    case negativeRIR
}

public struct WorkoutSet: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var type: SetType
    public var targetReps: RepTarget?
    public var targetLoad: RecordedMass?
    public var load: RecordedMass?
    public var reps: Int?
    public var completedAt: Date?
    /// Reps in reserve. Nil means unknown, never "zero effort left".
    public var rir: Int?

    public init(
        id: UUID = UUID(),
        type: SetType = .working,
        targetReps: RepTarget? = nil,
        targetLoad: RecordedMass? = nil,
        load: RecordedMass? = nil,
        reps: Int? = nil,
        completedAt: Date? = nil,
        rir: Int? = nil
    ) {
        self.id = id
        self.type = type
        self.targetReps = targetReps
        self.targetLoad = targetLoad
        self.load = load
        self.reps = reps
        self.completedAt = completedAt
        self.rir = rir
    }

    public var isCompleted: Bool { completedAt != nil }

    /// Checks the actual values are recordable for this measurement. Zero added load is legitimate.
    public func validate(for measurement: ExerciseMeasurement) -> SetValidationError? {
        guard let reps else { return .missingReps }
        guard reps >= 1 else { return .nonPositiveReps }
        if let rir, rir < 0 { return .negativeRIR }
        if measurement.tracksLoad {
            guard let load else { return .missingLoad }
            if load.value < 0 { return .negativeLoad }
        } else if load != nil {
            return .unexpectedLoad
        }
        return nil
    }

    /// A fresh, incomplete set carrying the same prescription.
    public func copyingPrescription() -> WorkoutSet {
        WorkoutSet(type: type, targetReps: targetReps, targetLoad: targetLoad)
    }
}
