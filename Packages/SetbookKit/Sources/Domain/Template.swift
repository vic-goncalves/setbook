import Foundation

public struct TemplateSet: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var type: SetType
    public var targetReps: RepTarget?
    public var targetLoad: RecordedMass?

    public init(id: UUID = UUID(), type: SetType = .working, targetReps: RepTarget? = nil, targetLoad: RecordedMass? = nil) {
        self.id = id
        self.type = type
        self.targetReps = targetReps
        self.targetLoad = targetLoad
    }
}

public struct TemplateExercise: Identifiable, Hashable, Codable, Sendable {
    public static let defaultRestSeconds = 90

    public var id: UUID
    public var exerciseId: UUID
    public var notes: String?
    /// Nil means the rest timer is off for this exercise.
    public var restSeconds: Int?
    public var sets: [TemplateSet]

    public init(
        id: UUID = UUID(),
        exerciseId: UUID,
        notes: String? = nil,
        restSeconds: Int? = TemplateExercise.defaultRestSeconds,
        sets: [TemplateSet] = [TemplateSet()]
    ) {
        self.id = id
        self.exerciseId = exerciseId
        self.notes = notes
        self.restSeconds = restSeconds
        self.sets = sets
    }
}

public struct WorkoutTemplate: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var name: String
    public var notes: String?
    /// Incremented on every saved edit. Sessions record the revision they started from.
    public var revision: Int
    public var exercises: [TemplateExercise]
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        name: String,
        notes: String? = nil,
        revision: Int = 1,
        exercises: [TemplateExercise] = [],
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.notes = notes
        self.revision = revision
        self.exercises = exercises
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// A copy with fresh IDs throughout, so the duplicate shares no identity with the original.
    public func duplicated(now: Date = Date()) -> WorkoutTemplate {
        WorkoutTemplate(
            name: "\(name) copy",
            notes: notes,
            exercises: exercises.map { exercise in
                TemplateExercise(
                    exerciseId: exercise.exerciseId,
                    notes: exercise.notes,
                    restSeconds: exercise.restSeconds,
                    sets: exercise.sets.map { TemplateSet(type: $0.type, targetReps: $0.targetReps, targetLoad: $0.targetLoad) }
                )
            },
            createdAt: now,
            updatedAt: now
        )
    }

    /// Builds a template from a performed workout's structure and prescriptions.
    public init(savingFrom session: WorkoutSession, name: String? = nil, now: Date = Date()) {
        self.init(
            name: name ?? session.name,
            notes: session.notes,
            exercises: session.exercises.map { exercise in
                TemplateExercise(
                    exerciseId: exercise.exerciseId,
                    notes: exercise.notes,
                    restSeconds: exercise.restSeconds,
                    sets: exercise.sets.map { TemplateSet(type: $0.type, targetReps: $0.targetReps, targetLoad: $0.targetLoad) }
                )
            },
            createdAt: now,
            updatedAt: now
        )
    }

    public var exerciseCount: Int { exercises.count }
}
