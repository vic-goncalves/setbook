import Domain
import Foundation
import Persistence
import Testing
@testable import Workflow

private let benchID = ExerciseCatalog.builtInID(slug: "barbell-bench-press")
private let pullUpID = ExerciseCatalog.builtInID(slug: "pull-up")

private func pushTemplate() -> WorkoutTemplate {
    WorkoutTemplate(name: "Push", exercises: [
        TemplateExercise(exerciseId: benchID, restSeconds: 120, sets: [
            TemplateSet(type: .warmup, targetReps: .exactly(10), targetLoad: RecordedMass(95, .pounds)),
            TemplateSet(targetReps: RepTarget(min: 6, max: 8), targetLoad: RecordedMass(185, .pounds)),
            TemplateSet(targetReps: RepTarget(min: 6, max: 8), targetLoad: RecordedMass(185, .pounds)),
        ]),
        TemplateExercise(exerciseId: pullUpID, restSeconds: nil, sets: [TemplateSet(targetReps: .exactly(8))]),
    ])
}

@MainActor
private func startedController(_ db: AppDatabase, template: WorkoutTemplate, host: RestTimerHost = InMemoryRestTimerHost(), now: Date = Date()) throws -> WorkoutController {
    let session = try db.write { db in
        try TemplateStore.save(template, db)
        let session = WorkoutSession.starting(from: template, exercises: try ExerciseStore.catalog(db), now: now)
        try SessionStore.start(session, db)
        return session
    }
    return WorkoutController(session: session, mode: .active, database: db, timerHost: host)
}

@MainActor
@Suite struct WorkoutControllerTests {
    @Test func suggestionsAreNeverCompletedUntilConfirmed() throws {
        let db = try AppDatabase.inMemory()
        let template = pushTemplate()
        let first = try startedController(db, template: template, now: Date(timeIntervalSince1970: 1_000))
        first.setLoad(RecordedMass(190, .pounds), exercise: 0, set: 1)
        first.setReps(7, exercise: 0, set: 1)
        #expect(first.toggleComplete(exercise: 0, set: 1))
        let plan = try #require(first.finishPlan())
        #expect(first.finish(plan, updateTemplate: false))

        let second = try db.write { db -> WorkoutSession in
            let session = WorkoutSession.starting(from: template, exercises: try ExerciseStore.catalog(db))
            try SessionStore.start(session, db)
            return session
        }
        let controller = WorkoutController(session: second, mode: .active, database: db, timerHost: InMemoryRestTimerHost())

        #expect(controller.suggestion(exercise: 0, set: 1)?.reps == 7)
        #expect(controller.suggestion(exercise: 0, set: 0) == nil, "no warm-up was completed last time")
        #expect(controller.suggestion(exercise: 0, set: 2) == nil, "only one working set was completed last time")
        #expect(controller.session.completedSetCount == 0)

        let placeholder = controller.placeholder(exercise: 0, set: 1)
        #expect(placeholder.load == RecordedMass(190, .pounds), "previous performance wins over the target")
        #expect(placeholder.reps == 7)
        #expect(controller.placeholder(exercise: 0, set: 2).load == RecordedMass(185, .pounds), "falls back to the target")

        #expect(controller.toggleComplete(exercise: 0, set: 1))
        let completed = controller.session.exercises[0].sets[1]
        #expect(completed.isCompleted)
        #expect(completed.load == RecordedMass(190, .pounds))
        #expect(completed.reps == 7)
    }

    @Test func refusesToCompleteWithoutRecordableValues() throws {
        let db = try AppDatabase.inMemory()
        let template = WorkoutTemplate(name: "Bare", exercises: [TemplateExercise(exerciseId: benchID, sets: [TemplateSet()])])
        let controller = try startedController(db, template: template)
        #expect(!controller.toggleComplete(exercise: 0, set: 0))
        #expect(!controller.session.exercises[0].sets[0].isCompleted)

        controller.setReps(5, exercise: 0, set: 0)
        #expect(!controller.toggleComplete(exercise: 0, set: 0), "load is required for a barbell exercise")
        controller.setLoad(RecordedMass(135, .pounds), exercise: 0, set: 0)
        #expect(controller.toggleComplete(exercise: 0, set: 0))
    }

    @Test func bodyweightSetsIgnoreLoad() throws {
        let db = try AppDatabase.inMemory()
        let controller = try startedController(db, template: pushTemplate())
        controller.setLoad(RecordedMass(25, .pounds), exercise: 1, set: 0)
        #expect(controller.toggleComplete(exercise: 1, set: 0))
        #expect(controller.session.exercises[1].sets[0].load == nil)
        #expect(controller.session.exercises[1].sets[0].reps == 8)
    }

    @Test func restTimerUsesExerciseSettingAndSurvivesRelaunch() throws {
        let db = try AppDatabase.inMemory()
        let host = InMemoryRestTimerHost()
        let controller = try startedController(db, template: pushTemplate(), host: host)
        let now = Date(timeIntervalSince1970: 50_000)

        controller.toggleComplete(exercise: 0, set: 0, now: now)
        #expect(controller.restTimer == RestTimer(endsAt: now.addingTimeInterval(120), duration: 120))
        #expect(controller.restTimer?.remaining(at: now.addingTimeInterval(45)) == 75)

        controller.adjustRest(by: 15)
        #expect(host.stored?.endsAt == now.addingTimeInterval(135))

        let relaunched = WorkoutController(session: controller.session, mode: .active, database: db, timerHost: host)
        #expect(relaunched.restTimer == host.stored)

        relaunched.skipRest()
        relaunched.toggleComplete(exercise: 1, set: 0, now: now)
        #expect(relaunched.restTimer == nil, "rest is off for this exercise")
    }

    @Test func everyEditIsPersistedImmediately() throws {
        let db = try AppDatabase.inMemory()
        let controller = try startedController(db, template: pushTemplate())
        controller.setLoad(RecordedMass(185, .pounds), exercise: 0, set: 1)
        controller.setReps(8, exercise: 0, set: 1)
        controller.toggleComplete(exercise: 0, set: 1)
        controller.addSet(exercise: 0)
        controller.removeExercise(at: 1)
        controller.setWorkoutNotes("Felt strong")

        let stored = try #require(try db.read { try SessionStore.fetchActive($0) })
        #expect(stored.exercises.map(\.id) == controller.session.exercises.map(\.id))
        #expect(stored.exercises[0].sets.count == 4)
        #expect(stored.exercises[0].sets[1].isCompleted)
        #expect(stored.notes == "Felt strong")
    }

    @Test func finishingRespectsTheTemplateChoice() throws {
        let db = try AppDatabase.inMemory()
        let template = pushTemplate()
        let pullUp = try #require(try db.read { try ExerciseStore.fetch(pullUpID, $0) })

        let keep = try startedController(db, template: template)
        keep.addSet(exercise: 0)
        keep.toggleComplete(exercise: 0, set: 1)
        let keepPlan = try #require(keep.finishPlan())
        #expect(keepPlan.templateProposal?.changes == [.setCount(exercise: "Bench Press (Barbell)", from: 3, to: 4)])
        #expect(keep.finish(keepPlan, updateTemplate: false))
        #expect(try db.read { try TemplateStore.fetch(template.id, $0) }?.revision == 1)

        let keepId = keep.session.id
        let stored = try #require(try db.read { try SessionStore.fetch(keepId, $0) })
        #expect(stored.state == .completed)
        #expect(stored.completedSetCount == 1, "unfinished sets are excluded")

        let update = WorkoutController(
            session: try db.write { db in
                let session = WorkoutSession.starting(from: try #require(try TemplateStore.fetch(template.id, db)), exercises: try ExerciseStore.catalog(db))
                try SessionStore.start(session, db)
                return session
            },
            mode: .active, database: db, timerHost: InMemoryRestTimerHost()
        )
        update.addExercises([pullUp], restSeconds: 60)
        update.toggleComplete(exercise: 0, set: 1)
        let updatePlan = try #require(update.finishPlan())
        #expect(update.finish(updatePlan, updateTemplate: true))
        let updated = try #require(try db.read { try TemplateStore.fetch(template.id, $0) })
        #expect(updated.revision == 2)
        #expect(updated.exercises.map(\.exerciseId) == [benchID, pullUpID, pullUpID])
    }

    @Test func nothingCompletedCannotFinishAndDiscardDeletes() throws {
        let db = try AppDatabase.inMemory()
        let controller = try startedController(db, template: pushTemplate())
        #expect(controller.finishPlan() == nil)
        controller.discard()
        #expect(try db.read { try SessionStore.fetchActive($0) } == nil)
    }

    @Test func historyEditsOnlyLandOnSave() throws {
        let db = try AppDatabase.inMemory()
        let active = try startedController(db, template: pushTemplate())
        active.toggleComplete(exercise: 0, set: 1)
        let plan = try #require(active.finishPlan())
        #expect(active.finish(plan, updateTemplate: false))

        let id = active.session.id
        let stored = try #require(try db.read { try SessionStore.fetch(id, $0) })
        let editor = WorkoutController(session: stored, mode: .editingCompleted, database: db, timerHost: InMemoryRestTimerHost())
        editor.setReps(12, exercise: 0, set: 0)
        #expect(try db.read { try SessionStore.fetch(id, $0) }?.exercises[0].sets[0].reps == 6)
        #expect(editor.saveCompletedEdit())
        #expect(try db.read { try SessionStore.fetch(id, $0) }?.exercises[0].sets[0].reps == 12)

        editor.toggleComplete(exercise: 0, set: 0)
        #expect(!editor.saveCompletedEdit(), "a finished workout must keep at least one completed set")
        #expect(editor.saveError != nil)
    }
}
