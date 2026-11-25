import Foundation

public enum TemplateChange: Hashable, Sendable {
    case added(exercise: String)
    case removed(exercise: String)
    case reordered
    case setCount(exercise: String, from: Int, to: Int)
    case prescription(exercise: String)

    public var description: String {
        switch self {
        case .added(let name): "Add \(name)"
        case .removed(let name): "Remove \(name)"
        case .reordered: "Reorder exercises"
        case .setCount(let name, let from, let to): "\(name): \(from) -> \(to) sets"
        case .prescription(let name): "\(name): update set types or targets"
        }
    }
}

/// Compares a session's planned structure to the template it came from and proposes an update.
/// Only structure and prescriptions are compared; actual performance never rewrites targets.
public struct TemplateUpdateProposal: Sendable {
    public let changes: [TemplateChange]
    public let updatedTemplate: WorkoutTemplate

    /// - Parameter session: the session as planned, before incomplete sets are stripped.
    public init?(template: WorkoutTemplate, session: WorkoutSession, exerciseName: (UUID) -> String, now: Date = Date()) {
        let matches = Self.match(template: template.exercises, session: session.exercises)
        var changes: [TemplateChange] = []

        let matchedTemplateIds = Set(matches.compactMap { $0.template?.id })
        for templateExercise in template.exercises where !matchedTemplateIds.contains(templateExercise.id) {
            changes.append(.removed(exercise: exerciseName(templateExercise.exerciseId)))
        }

        var updatedExercises: [TemplateExercise] = []
        for match in matches {
            let planned = match.session.sets.map {
                TemplateSet(type: $0.type, targetReps: $0.targetReps, targetLoad: $0.targetLoad)
            }
            guard let original = match.template else {
                changes.append(.added(exercise: match.session.exerciseName))
                updatedExercises.append(TemplateExercise(
                    exerciseId: match.session.exerciseId,
                    notes: match.session.notes,
                    restSeconds: match.session.restSeconds,
                    sets: planned
                ))
                continue
            }
            if original.sets.count != planned.count {
                changes.append(.setCount(exercise: match.session.exerciseName, from: original.sets.count, to: planned.count))
            } else if !zip(original.sets, planned).allSatisfy(Self.samePrescription) {
                changes.append(.prescription(exercise: match.session.exerciseName))
            }
            var updated = original
            updated.sets = zip(planned.indices, planned).map { index, set in
                var set = set
                if index < original.sets.count { set.id = original.sets[index].id }
                return set
            }
            updatedExercises.append(updated)
        }

        let keptTemplateOrder = template.exercises.map(\.id).filter(matchedTemplateIds.contains)
        let keptSessionOrder = matches.compactMap { $0.template?.id }
        if keptTemplateOrder != keptSessionOrder {
            changes.append(.reordered)
        }

        guard !changes.isEmpty else { return nil }
        var updated = template
        updated.exercises = updatedExercises
        updated.revision += 1
        updated.updatedAt = now
        self.changes = changes
        self.updatedTemplate = updated
    }

    private static func samePrescription(_ a: TemplateSet, _ b: TemplateSet) -> Bool {
        guard a.type == b.type, a.targetReps == b.targetReps else { return false }
        switch (a.targetLoad, b.targetLoad) {
        case (nil, nil): return true
        case let (x?, y?): return x.isSameLoad(as: y)
        default: return false
        }
    }

    /// Pairs the k-th occurrence of an exercise in the session with its k-th occurrence in the template.
    private static func match(
        template: [TemplateExercise],
        session: [WorkoutExercise]
    ) -> [(session: WorkoutExercise, template: TemplateExercise?)] {
        var remaining = Dictionary(grouping: template, by: \.exerciseId)
        return session.map { exercise in
            guard var candidates = remaining[exercise.exerciseId], !candidates.isEmpty else {
                return (exercise, nil)
            }
            let first = candidates.removeFirst()
            remaining[exercise.exerciseId] = candidates
            return (exercise, first)
        }
    }
}
