import Foundation

public enum MuscleGroup: String, Codable, Sendable, CaseIterable {
    case chest, back, shoulders, biceps, triceps, forearms
    case quads, hamstrings, glutes, calves, core, fullBody = "full_body"

    public var displayName: String {
        switch self {
        case .fullBody: "Full body"
        default: rawValue.capitalized
        }
    }
}

public enum Equipment: String, Codable, Sendable, CaseIterable {
    case barbell, dumbbell, machine, cable, bodyweight, kettlebell
    case smithMachine = "smith_machine"
    case ezBar = "ez_bar"
    case band, other

    public var displayName: String {
        switch self {
        case .smithMachine: "Smith machine"
        case .ezBar: "EZ bar"
        default: rawValue.capitalized
        }
    }
}

public enum MeasurementType: String, Codable, Sendable, CaseIterable {
    case externalLoadReps = "external_load_reps"
    case bodyweightReps = "bodyweight_reps"
    case weightedBodyweightReps = "weighted_bodyweight_reps"
    case assistedBodyweightReps = "assisted_bodyweight_reps"
}

public enum LoadConvention: String, Codable, Sendable {
    case total
    case perHand = "per_hand"
    case added
    case assistance
}

/// How an exercise is measured. Pairs measurement type and load convention so that
/// impossible combinations (e.g. bodyweight reps with per-hand load) cannot exist.
public enum ExerciseMeasurement: Hashable, Sendable {
    case externalLoad(LoadConvention.ExternalLoad)
    case bodyweight
    case weightedBodyweight
    case assistedBodyweight

    public var type: MeasurementType {
        switch self {
        case .externalLoad: .externalLoadReps
        case .bodyweight: .bodyweightReps
        case .weightedBodyweight: .weightedBodyweightReps
        case .assistedBodyweight: .assistedBodyweightReps
        }
    }

    public var loadConvention: LoadConvention? {
        switch self {
        case .externalLoad(.total): .total
        case .externalLoad(.perHand): .perHand
        case .bodyweight: nil
        case .weightedBodyweight: .added
        case .assistedBodyweight: .assistance
        }
    }

    public var tracksLoad: Bool { loadConvention != nil }

    public init?(type: MeasurementType, loadConvention: LoadConvention?) {
        switch (type, loadConvention) {
        case (.externalLoadReps, .total): self = .externalLoad(.total)
        case (.externalLoadReps, .perHand): self = .externalLoad(.perHand)
        case (.bodyweightReps, nil): self = .bodyweight
        case (.weightedBodyweightReps, .added): self = .weightedBodyweight
        case (.assistedBodyweightReps, .assistance): self = .assistedBodyweight
        default: return nil
        }
    }

    /// Short label shown next to load entry so the user knows what number to type.
    public var loadLabel: String? {
        switch self {
        case .externalLoad(.total): "Total load"
        case .externalLoad(.perHand): "Per hand"
        case .bodyweight: nil
        case .weightedBodyweight: "Added"
        case .assistedBodyweight: "Assistance"
        }
    }

    public var loadExplanation: String? {
        switch self {
        case .externalLoad(.total): "Enter the full weight moved, including the bar."
        case .externalLoad(.perHand): "Enter the weight of one dumbbell or handle."
        case .bodyweight: nil
        case .weightedBodyweight: "Enter only the weight added to your body, such as a belt or vest. Zero is allowed."
        case .assistedBodyweight: "Enter the assistance from the machine or band. Less assistance at similar reps can mean progress."
        }
    }
}

extension LoadConvention {
    public enum ExternalLoad: String, Hashable, Sendable {
        case total
        case perHand = "per_hand"
    }
}

extension ExerciseMeasurement: Codable {
    private enum CodingKeys: String, CodingKey { case type, loadConvention }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(MeasurementType.self, forKey: .type)
        let convention = try container.decodeIfPresent(LoadConvention.self, forKey: .loadConvention)
        guard let measurement = ExerciseMeasurement(type: type, loadConvention: convention) else {
            throw DecodingError.dataCorruptedError(
                forKey: .loadConvention, in: container,
                debugDescription: "Invalid load convention \(String(describing: convention)) for \(type)"
            )
        }
        self = measurement
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
        try container.encodeIfPresent(loadConvention, forKey: .loadConvention)
    }
}

public struct Exercise: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var name: String
    public var primaryMuscle: MuscleGroup
    public var secondaryMuscles: [MuscleGroup]
    public var equipment: Equipment
    public var measurement: ExerciseMeasurement
    public var isBuiltIn: Bool
    public var archivedAt: Date?
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        name: String,
        primaryMuscle: MuscleGroup,
        secondaryMuscles: [MuscleGroup] = [],
        equipment: Equipment,
        measurement: ExerciseMeasurement,
        isBuiltIn: Bool = false,
        archivedAt: Date? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.primaryMuscle = primaryMuscle
        self.secondaryMuscles = secondaryMuscles
        self.equipment = equipment
        self.measurement = measurement
        self.isBuiltIn = isBuiltIn
        self.archivedAt = archivedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public var isArchived: Bool { archivedAt != nil }

    public func matches(search: String) -> Bool {
        let query = search.trimmingCharacters(in: .whitespaces)
        if query.isEmpty { return true }
        return query.split(separator: " ").allSatisfy { term in
            name.localizedCaseInsensitiveContains(term)
                || equipment.displayName.localizedCaseInsensitiveContains(term)
                || primaryMuscle.displayName.localizedCaseInsensitiveContains(term)
        }
    }
}
