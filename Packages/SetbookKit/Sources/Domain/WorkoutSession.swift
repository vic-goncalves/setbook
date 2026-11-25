import Foundation

public enum SessionState: String, Codable, Sendable {
    case active
    case completed
}

public struct TemplateReference: Hashable, Codable, Sendable {
    public var templateId: UUID
    public var revision: Int

    public init(templateId: UUID, revision: Int) {
        self.templateId = templateId
        self.revision = revision
    }
}

public struct WorkoutExercise: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var exerciseId: UUID
    /// Snapshots taken when the exercise was added, so renaming or editing the exercise
    /// never changes what this historical record says.
    public var exerciseName: String
    public var measurement: ExerciseMeasurement
    public var notes: String?
    public var restSeconds: Int?
    public var sets: [WorkoutSet]

    public init(
        id: UUID = UUID(),
        exerciseId: UUID,
        exerciseName: String,
        measurement: ExerciseMeasurement,
        notes: String? = nil,
        restSeconds: Int? = TemplateExercise.defaultRestSeconds,
        sets: [WorkoutSet] = []
    ) {
        self.id = id
        self.exerciseId = exerciseId
        self.exerciseName = exerciseName
        self.measurement = measurement
        self.notes = notes
        self.restSeconds = restSeconds
        self.sets = sets
    }

    public init(adding exercise: Exercise, restSeconds: Int? = TemplateExercise.defaultRestSeconds) {
        self.init(
            exerciseId: exercise.id,
            exerciseName: exercise.name,
            measurement: exercise.measurement,
            restSeconds: restSeconds,
            sets: [WorkoutSet()]
        )
    }

    public var completedSets: [WorkoutSet] { sets.filter(\.isCompleted) }

    /// New sets inherit the prescription of the last set so "add set" continues the pattern.
    public mutating func addSet() {
        sets.append(sets.last?.copyingPrescription() ?? WorkoutSet())
    }
}

public struct WorkoutSession: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var name: String
    public var state: SessionState
    public var sourceTemplate: TemplateReference?
    public var startedAt: Date
    public var finishedAt: Date?
    public var timeZoneIdentifier: String
    public var notes: String?
    public var exercises: [WorkoutExercise]
    public var createdAt: Date
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        name: String,
        state: SessionState = .active,
        sourceTemplate: TemplateReference? = nil,
        startedAt: Date = Date(),
        finishedAt: Date? = nil,
        timeZoneIdentifier: String = TimeZone.current.identifier,
        notes: String? = nil,
        exercises: [WorkoutExercise] = [],
        createdAt: Date? = nil,
        updatedAt: Date? = nil
    ) {
        self.id = id
        self.name = name
        self.state = state
        self.sourceTemplate = sourceTemplate
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.timeZoneIdentifier = timeZoneIdentifier
        self.notes = notes
        self.exercises = exercises
        self.createdAt = createdAt ?? startedAt
        self.updatedAt = updatedAt ?? startedAt
    }

    public static func empty(now: Date = Date(), timeZone: TimeZone = .current) -> WorkoutSession {
        WorkoutSession(name: "Workout", startedAt: now, timeZoneIdentifier: timeZone.identifier)
    }

    /// Snapshots a template into an independent session. Later template edits cannot reach it.
    public static func starting(
        from template: WorkoutTemplate,
        exercises catalog: [UUID: Exercise],
        now: Date = Date(),
        timeZone: TimeZone = .current
    ) -> WorkoutSession {
        WorkoutSession(
            name: template.name,
            sourceTemplate: TemplateReference(templateId: template.id, revision: template.revision),
            startedAt: now,
            timeZoneIdentifier: timeZone.identifier,
            notes: nil,
            exercises: template.exercises.compactMap { templateExercise in
                guard let exercise = catalog[templateExercise.exerciseId] else { return nil }
                return WorkoutExercise(
                    exerciseId: exercise.id,
                    exerciseName: exercise.name,
                    measurement: exercise.measurement,
                    notes: templateExercise.notes,
                    restSeconds: templateExercise.restSeconds,
                    sets: templateExercise.sets.map {
                        WorkoutSet(type: $0.type, targetReps: $0.targetReps, targetLoad: $0.targetLoad)
                    }
                )
            }
        )
    }

    /// Starts a new session whose prescriptions are the logged values of a past one.
    /// Only completed sets carry over, and every new set starts incomplete.
    public static func repeating(
        _ past: WorkoutSession,
        exercises catalog: [UUID: Exercise],
        now: Date = Date(),
        timeZone: TimeZone = .current
    ) -> WorkoutSession {
        WorkoutSession(
            name: past.name,
            sourceTemplate: past.sourceTemplate,
            startedAt: now,
            timeZoneIdentifier: timeZone.identifier,
            exercises: past.exercises.compactMap { pastExercise in
                let sets = pastExercise.completedSets.map { set in
                    WorkoutSet(type: set.type, targetReps: set.reps.flatMap(RepTarget.exactly), targetLoad: set.load)
                }
                guard !sets.isEmpty else { return nil }
                let current = catalog[pastExercise.exerciseId]
                return WorkoutExercise(
                    exerciseId: pastExercise.exerciseId,
                    exerciseName: current?.name ?? pastExercise.exerciseName,
                    measurement: current?.measurement ?? pastExercise.measurement,
                    notes: pastExercise.notes,
                    restSeconds: pastExercise.restSeconds,
                    sets: sets
                )
            }
        )
    }

    public var completedSetCount: Int { exercises.reduce(0) { $0 + $1.completedSets.count } }

    public var completedWorkingSetCount: Int {
        exercises.reduce(0) { $0 + $1.completedSets.filter { $0.type == .working }.count }
    }

    public var incompleteSetCount: Int {
        exercises.reduce(0) { $0 + $1.sets.count(where: { !$0.isCompleted }) }
    }

    public var duration: TimeInterval? { finishedAt.map { $0.timeIntervalSince(startedAt) } }

    /// The completed form of this session: incomplete sets and emptied exercises are dropped.
    /// Returns nil when nothing was completed, because such a workout cannot be saved as done.
    public func finished(at now: Date = Date()) -> WorkoutSession? {
        guard completedSetCount > 0 else { return nil }
        var result = self
        result.exercises = exercises.compactMap { exercise in
            var exercise = exercise
            exercise.sets = exercise.completedSets
            return exercise.sets.isEmpty ? nil : exercise
        }
        result.state = .completed
        result.finishedAt = max(now, startedAt)
        result.updatedAt = now
        return result
    }
}
