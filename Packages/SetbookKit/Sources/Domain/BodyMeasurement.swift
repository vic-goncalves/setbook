import Foundation

public enum BodyMeasurementKind: String, Codable, Sendable {
    case bodyWeight = "body_weight"
}

public enum MeasurementSource: String, Codable, Sendable {
    case manual
}

public struct BodyMeasurement: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var kind: BodyMeasurementKind
    public var mass: RecordedMass
    public var measuredAt: Date
    public var timeZoneIdentifier: String
    public var source: MeasurementSource
    public var note: String?
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        kind: BodyMeasurementKind = .bodyWeight,
        mass: RecordedMass,
        measuredAt: Date,
        timeZoneIdentifier: String = TimeZone.current.identifier,
        source: MeasurementSource = .manual,
        note: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.kind = kind
        self.mass = mass
        self.measuredAt = measuredAt
        self.timeZoneIdentifier = timeZoneIdentifier
        self.source = source
        self.note = note
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public var isValid: Bool { mass.value > 0 }

    public var timeZone: TimeZone { TimeZone(identifier: timeZoneIdentifier) ?? .current }
}

/// Reserved for future analysis; no entry UI in version one. Effective dates keep later
/// goal changes from rewriting the context of past training.
public struct TrainingGoal: Identifiable, Hashable, Codable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case bodyWeight = "body_weight"
        case exerciseLoad = "exercise_load"
        case exerciseReps = "exercise_reps"
        case consistency
    }

    public var id: UUID
    public var kind: Kind
    public var target: Double
    public var unit: String?
    public var exerciseId: UUID?
    public var startsOn: Date
    public var endsOn: Date?
}
