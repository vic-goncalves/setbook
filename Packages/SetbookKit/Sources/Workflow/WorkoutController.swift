import Domain
import Foundation
import Observation
import Persistence

/// Owns one workout being logged or edited. Every mutation is written to the local store
/// immediately, so a force-quit loses nothing.
@MainActor
@Observable
public final class WorkoutController {
    public enum Mode: Equatable, Sendable {
        case active
        /// Editing a finished workout from history; no rest timer, saved as completed.
        case editingCompleted
    }

    public let mode: Mode
    public private(set) var session: WorkoutSession
    public private(set) var previous: [UUID: PreviousPerformance] = [:]
    public private(set) var restTimer: RestTimer?
    public var saveError: String?

    private let database: AppDatabase
    private let timerHost: RestTimerHost
    private let describe: (Error) -> String

    public init(
        session: WorkoutSession,
        mode: Mode,
        database: AppDatabase,
        timerHost: RestTimerHost,
        describeError: @escaping (Error) -> String = { String(describing: $0) }
    ) {
        self.session = session
        self.mode = mode
        self.database = database
        self.timerHost = timerHost
        self.describe = describeError
        if mode == .active { restTimer = timerHost.restore() }
        loadPrevious()
    }

    // MARK: Reading

    public func suggestion(exercise: Int, set: Int) -> WorkoutSet? {
        let workoutExercise = session.exercises[exercise]
        return previous[workoutExercise.id]?.counterpart(forSetAt: set, in: workoutExercise.sets)
    }

    /// The values a completion would record if the user hasn't typed anything: the previous
    /// counterpart, else the prescription. Shown greyed until confirmed.
    public func placeholder(exercise: Int, set: Int) -> (load: RecordedMass?, reps: Int?) {
        let target = session.exercises[exercise].sets[set]
        let prior = suggestion(exercise: exercise, set: set)
        return (prior?.load ?? target.targetLoad, prior?.reps ?? target.targetReps?.min)
    }

    // MARK: Editing sets

    public func setLoad(_ load: RecordedMass?, exercise: Int, set: Int) {
        mutate { $0.exercises[exercise].sets[set].load = load }
    }

    public func setReps(_ reps: Int?, exercise: Int, set: Int) {
        mutate { $0.exercises[exercise].sets[set].reps = reps }
    }

    public func toggleType(exercise: Int, set: Int) {
        mutate { session in
            let current = session.exercises[exercise].sets[set].type
            session.exercises[exercise].sets[set].type = current == .warmup ? .working : .warmup
        }
    }

    /// Completes a set, accepting displayed placeholders as the user's confirmation.
    /// Returns false (and leaves the set incomplete) when the values aren't recordable.
    @discardableResult
    public func toggleComplete(exercise: Int, set: Int, now: Date = Date()) -> Bool {
        var candidate = session.exercises[exercise].sets[set]
        if candidate.isCompleted {
            mutate { $0.exercises[exercise].sets[set].completedAt = nil }
            return true
        }
        let measurement = session.exercises[exercise].measurement
        let placeholder = placeholder(exercise: exercise, set: set)
        if candidate.reps == nil { candidate.reps = placeholder.reps }
        if measurement.tracksLoad, candidate.load == nil { candidate.load = placeholder.load }
        if !measurement.tracksLoad { candidate.load = nil }
        guard candidate.validate(for: measurement) == nil else { return false }
        candidate.completedAt = now
        mutate { $0.exercises[exercise].sets[set] = candidate }

        if mode == .active, let rest = session.exercises[exercise].restSeconds {
            startRest(seconds: rest, now: now)
        }
        return true
    }

    public func addSet(exercise: Int) {
        mutate { $0.exercises[exercise].addSet() }
    }

    public func removeSet(exercise: Int, set: Int) {
        mutate { $0.exercises[exercise].sets.remove(at: set) }
    }

    // MARK: Editing exercises

    public func addExercises(_ exercises: [Exercise], restSeconds: Int?) {
        mutate { session in
            for exercise in exercises {
                session.exercises.append(WorkoutExercise(adding: exercise, restSeconds: restSeconds))
            }
        }
        loadPrevious()
    }

    public func removeExercise(at index: Int) {
        mutate { $0.exercises.remove(at: index) }
        loadPrevious()
    }

    public func reorderExercises(_ ids: [UUID]) {
        mutate { session in
            session.exercises.sort { (ids.firstIndex(of: $0.id) ?? .max) < (ids.firstIndex(of: $1.id) ?? .max) }
        }
        loadPrevious()
    }

    public func setExerciseNotes(_ notes: String, exercise: Int) {
        mutate { $0.exercises[exercise].notes = notes.isEmpty ? nil : notes }
    }

    public func setRest(_ seconds: Int?, exercise: Int) {
        mutate { $0.exercises[exercise].restSeconds = seconds }
    }

    public func setWorkoutNotes(_ notes: String) {
        mutate { $0.notes = notes.isEmpty ? nil : notes }
    }

    public func rename(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        mutate { $0.name = trimmed }
    }

    public func setStart(_ date: Date) {
        mutate { session in
            session.startedAt = date
            if let finished = session.finishedAt, finished < date { session.finishedAt = date }
        }
    }

    public func setFinish(_ date: Date) {
        mutate { $0.finishedAt = max(date, $0.startedAt) }
    }

    // MARK: Rest timer

    public func startRest(seconds: Int, now: Date = Date()) {
        restTimer = RestTimer(endsAt: now.addingTimeInterval(TimeInterval(seconds)), duration: seconds)
        timerHost.persist(restTimer)
    }

    public func adjustRest(by seconds: Int) {
        guard var timer = restTimer else { return }
        timer.endsAt.addTimeInterval(TimeInterval(seconds))
        timer.duration = max(1, timer.duration + seconds)
        restTimer = timer
        timerHost.persist(timer)
    }

    public func skipRest() {
        restTimer = nil
        timerHost.persist(nil)
    }

    // MARK: Finishing

    public struct FinishPlan: Sendable {
        public let finished: WorkoutSession
        public let templateProposal: TemplateUpdateProposal?
    }

    /// Nil when nothing is completed, since such a workout can't be saved as done.
    public func finishPlan(now: Date = Date()) -> FinishPlan? {
        guard let finished = session.finished(at: now) else { return nil }
        let proposal: TemplateUpdateProposal? = try? database.read { [session] db in
            guard let reference = session.sourceTemplate,
                  let template = try TemplateStore.fetch(reference.templateId, db) else { return nil }
            let catalog = try ExerciseStore.catalog(db)
            return TemplateUpdateProposal(template: template, session: session, exerciseName: { catalog[$0]?.name ?? "Exercise" })
        }
        return FinishPlan(finished: finished, templateProposal: proposal)
    }

    /// Saves the finished workout and, only if the user chose it, the updated template, together.
    public func finish(_ plan: FinishPlan, updateTemplate: Bool) -> Bool {
        do {
            try database.write { db in
                try SessionStore.save(plan.finished, db)
                if updateTemplate, let template = plan.templateProposal?.updatedTemplate {
                    try TemplateStore.save(template, db)
                }
            }
            // The on-screen session is deliberately left as is: the screen is about to close,
            // and swapping in the stripped copy would visibly rearrange it mid-dismiss.
            skipRest()
            return true
        } catch {
            saveError = describe(error)
            return false
        }
    }

    /// For history edits: saves as completed, keeping only completed sets.
    public func saveCompletedEdit() -> Bool {
        guard let finished = session.finished(at: session.finishedAt ?? Date()) else {
            saveError = "A finished workout needs at least one completed set. Delete it from History instead."
            return false
        }
        var result = finished
        result.finishedAt = session.finishedAt ?? finished.finishedAt
        do {
            try database.write { [result] in try SessionStore.save(result, $0) }
            return true
        } catch {
            saveError = describe(error)
            return false
        }
    }

    public func discard() {
        let id = session.id
        try? database.write { try SessionStore.delete(id, $0) }
        skipRest()
    }

    // MARK: Internals

    private func mutate(_ change: (inout WorkoutSession) -> Void) {
        var updated = session
        change(&updated)
        updated.updatedAt = Date()
        session = updated
        // A completed workout being edited is only written on explicit Save, so a half-made
        // edit can't silently replace history.
        guard mode == .active else { return }
        do {
            try database.write { [updated] in try SessionStore.save(updated, $0) }
            saveError = nil
        } catch {
            saveError = describe(error)
        }
    }

    private func loadPrevious() {
        let exercises = session.exercises
        let sessionId = session.id
        previous = (try? database.read { db in
            var result: [UUID: PreviousPerformance] = [:]
            var seen: [UUID: Int] = [:]
            for exercise in exercises {
                let occurrence = seen[exercise.exerciseId, default: 0]
                seen[exercise.exerciseId] = occurrence + 1
                if let found = try SessionStore.previousPerformance(exerciseId: exercise.exerciseId, excluding: sessionId, occurrence: occurrence, db) {
                    result[exercise.id] = found
                }
            }
            return result
        }) ?? [:]
    }
}
