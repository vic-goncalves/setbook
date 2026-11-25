import Domain
import Foundation
import GRDB
import Metrics
import Testing
@testable import Persistence

let benchID = ExerciseCatalog.builtInID(slug: "barbell-bench-press")
let dipID = ExerciseCatalog.builtInID(slug: "chest-dip")

func done(_ lb: Double, _ reps: Int, type: SetType = .working) -> WorkoutSet {
    WorkoutSet(type: type, load: RecordedMass(lb, .pounds), reps: reps, completedAt: Date())
}

func pushTemplate() -> WorkoutTemplate {
    WorkoutTemplate(name: "Push", exercises: [
        TemplateExercise(exerciseId: benchID, sets: [
            TemplateSet(type: .warmup, targetReps: .exactly(10), targetLoad: RecordedMass(95, .pounds)),
            TemplateSet(targetReps: RepTarget(min: 6, max: 8), targetLoad: RecordedMass(185, .pounds)),
        ]),
        TemplateExercise(exerciseId: dipID, restSeconds: nil, sets: [TemplateSet(targetReps: .exactly(10))]),
    ])
}

/// Completes the first working bench set and finishes the session.
func completeBench(_ db: AppDatabase, template: WorkoutTemplate, lb: Double, reps: Int, at start: Date) throws -> WorkoutSession {
    try db.write { db in
        var session = WorkoutSession.starting(from: template, exercises: try ExerciseStore.catalog(db), now: start)
        try SessionStore.start(session, db)
        session.exercises[0].sets[1].load = RecordedMass(lb, .pounds)
        session.exercises[0].sets[1].reps = reps
        session.exercises[0].sets[1].completedAt = start
        guard let finished = session.finished(at: start.addingTimeInterval(3600)) else { throw StoreError.notFound }
        try SessionStore.save(finished, db)
        return finished
    }
}

@Suite struct ExercisePersistenceTests {
    @Test func seedsCatalogIdempotently() throws {
        let db = try AppDatabase.inMemory()
        try db.write { try AppDatabase.seedCatalog($0) }
        let count = try db.read { try ExerciseStore.fetchAll($0).count }
        #expect(count == ExerciseCatalog.all.count)
    }

    @Test func customExerciseIsArchivedWhenReferencedAndMeasurementLocked() throws {
        let db = try AppDatabase.inMemory()
        let custom = Exercise(name: "Landmine Press", primaryMuscle: .shoulders, equipment: .barbell, measurement: .externalLoad(.total))
        let template = WorkoutTemplate(name: "T", exercises: [TemplateExercise(exerciseId: custom.id)])
        try db.write { db in
            try ExerciseStore.saveCustom(custom, db)
            try TemplateStore.save(template, db)
            var session = WorkoutSession.starting(from: template, exercises: try ExerciseStore.catalog(db))
            session.exercises[0].sets[0] = done(65, 10)
            try SessionStore.start(session, db)
        }
        var renamed = custom
        renamed.name = "Landmine Press (Single Arm)"
        renamed.measurement = .externalLoad(.perHand)
        let renamedCopy = renamed
        #expect(throws: StoreError.self) { try db.write { try ExerciseStore.saveCustom(renamedCopy, $0) } }

        renamed.measurement = custom.measurement
        try db.write { [renamed] in try ExerciseStore.saveCustom(renamed, $0) }
        try db.write { try ExerciseStore.remove(custom.id, $0) }

        let stored = try db.read { try ExerciseStore.fetch(custom.id, $0) }
        #expect(stored?.isArchived == true)
        #expect(stored?.name == "Landmine Press (Single Arm)")
        #expect(try db.read { try ExerciseStore.fetchAll($0) }.contains { $0.id == custom.id } == false)
    }

    @Test func builtInsAreReadOnly() throws {
        let db = try AppDatabase.inMemory()
        var bench = try #require(try db.read { try ExerciseStore.fetch(benchID, $0) })
        bench.name = "Mine now"
        let benchCopy = bench
        #expect(throws: StoreError.self) { try db.write { try ExerciseStore.saveCustom(benchCopy, $0) } }
    }
}

@Suite struct TemplatePersistenceTests {
    @Test func roundTripsAndBumpsRevision() throws {
        let db = try AppDatabase.inMemory()
        let template = pushTemplate()
        let saved = try db.write { try TemplateStore.save(template, $0) }
        let fetched = try #require(try db.read { try TemplateStore.fetch(template.id, $0) })
        #expect(fetched.exercises == template.exercises)
        #expect(fetched.revision == 1)

        var edited = saved
        edited.exercises[0].sets.append(TemplateSet(targetReps: .exactly(5)))
        let resaved = try db.write { [edited] in try TemplateStore.save(edited, $0) }
        #expect(resaved.revision == 2)
    }

    @Test func templateEditsAndDeletionLeaveSessionsUnchanged() throws {
        let db = try AppDatabase.inMemory()
        let template = try db.write { try TemplateStore.save(pushTemplate(), $0) }
        let active = try db.write { db in
            let session = WorkoutSession.starting(from: template, exercises: try ExerciseStore.catalog(db))
            try SessionStore.start(session, db)
            return session
        }

        var edited = template
        edited.name = "Push v2"
        edited.exercises.removeAll()
        try db.write { [edited] in try TemplateStore.save(edited, $0) }
        try db.write { try TemplateStore.delete(template.id, $0) }

        let reloaded = try #require(try db.read { try SessionStore.fetchActive($0) })
        #expect(reloaded.exercises == active.exercises)
        #expect(reloaded.name == "Push")
        #expect(reloaded.sourceTemplate == TemplateReference(templateId: template.id, revision: 1))
        #expect(reloaded.exercises.count == 2)
    }

    @Test func summariesShowLastPerformedAndOrder() throws {
        let db = try AppDatabase.inMemory()
        let a = try db.write { try TemplateStore.save(pushTemplate(), $0) }
        let b = try db.write { try TemplateStore.save(WorkoutTemplate(name: "Pull"), $0) }
        let start = Date(timeIntervalSince1970: 1_000_000)
        _ = try completeBench(db, template: a, lb: 185, reps: 8, at: start)
        try db.write { try TemplateStore.reorder([b.id, a.id], $0) }

        let summaries = try db.read { try TemplateStore.fetchSummaries($0) }
        #expect(summaries.map(\.template.name) == ["Pull", "Push"])
        #expect(summaries[1].lastPerformedAt == start)
        #expect(summaries[0].lastPerformedAt == nil)
    }
}

@Suite struct SessionPersistenceTests {
    @Test func onlyOneActiveSession() throws {
        let db = try AppDatabase.inMemory()
        try db.write { try SessionStore.start(.empty(), $0) }
        #expect(throws: StoreError.activeWorkoutExists) { try db.write { try SessionStore.start(.empty(), $0) } }
    }

    @Test func rejectsCompletedSessionWithoutCompletedSets() throws {
        let db = try AppDatabase.inMemory()
        var session = WorkoutSession.empty()
        session.state = .completed
        let sessionCopy = session
        #expect(throws: StoreError.self) { try db.write { try SessionStore.save(sessionCopy, $0) } }
    }

    @Test func activeWorkoutSurvivesReopeningTheStore() throws {
        let url = URL.temporaryDirectory.appending(path: "setbook-\(UUID().uuidString)/db.sqlite")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let template = pushTemplate()
        var session: WorkoutSession
        do {
            let db = try AppDatabase.onDisk(at: url)
            try db.write { try TemplateStore.save(template, $0) }
            session = try db.write { db in
                var s = WorkoutSession.starting(from: template, exercises: try ExerciseStore.catalog(db))
                try SessionStore.start(s, db)
                s.exercises[0].sets[0] = WorkoutSet(id: s.exercises[0].sets[0].id, type: .warmup, targetReps: .exactly(10),
                                                    targetLoad: RecordedMass(95, .pounds), load: RecordedMass(95, .pounds),
                                                    reps: 10, completedAt: Date(timeIntervalSince1970: 5))
                s.exercises[0].sets[1].load = RecordedMass(185, .pounds)
                try SessionStore.save(s, db)
                return s
            }
        }
        let reopened = try AppDatabase.onDisk(at: url)
        let restored = try #require(try reopened.read { try SessionStore.fetchActive($0) })
        #expect(restored.exercises == session.exercises)
        #expect(restored.exercises[0].sets[0].isCompleted)
        #expect(restored.exercises[0].sets[1].load == RecordedMass(185, .pounds))
        #expect(!restored.exercises[0].sets[1].isCompleted, "an entered value is not a completed set")
    }

    @Test func previousPerformanceIsLatestCompletedExcludingCurrentAndActive() throws {
        let db = try AppDatabase.inMemory()
        let template = pushTemplate()
        let older = try completeBench(db, template: template, lb: 175, reps: 8, at: Date(timeIntervalSince1970: 1_000))
        let newer = try completeBench(db, template: template, lb: 185, reps: 7, at: Date(timeIntervalSince1970: 2_000))

        let active = WorkoutSession.starting(from: template, exercises: try db.read { try ExerciseStore.catalog($0) })
        try db.write { try SessionStore.start(active, $0) }

        let previous = try #require(try db.read { try SessionStore.previousPerformance(exerciseId: benchID, excluding: active.id, $0) })
        #expect(previous.sessionId == newer.id)
        #expect(previous.sets.map(\.reps) == [7])

        let whenEditingNewer = try db.read { try SessionStore.previousPerformance(exerciseId: benchID, excluding: newer.id, $0) }
        #expect(whenEditingNewer?.sessionId == older.id)
        #expect(try db.read { try SessionStore.previousPerformance(exerciseId: dipID, excluding: nil, $0) } == nil)
    }

    @Test func recordsFollowEditsAndDeletes() throws {
        let db = try AppDatabase.inMemory()
        let template = pushTemplate()
        var first = try completeBench(db, template: template, lb: 185, reps: 8, at: Date(timeIntervalSince1970: 1_000))
        let second = try completeBench(db, template: template, lb: 195, reps: 5, at: Date(timeIntervalSince1970: 2_000))
        let measurement = ExerciseMeasurement.externalLoad(.total)

        func heaviest() throws -> [Double] {
            let records = try db.read { try SessionStore.exerciseRecords(benchID, $0) }
            return ExerciseMetrics.series(.heaviestSet, records: records, measurement: measurement)
                .map { ($0.value / 0.45359237 * 10).rounded() / 10 }
        }
        #expect(try heaviest() == [185, 195])

        first.exercises[0].sets[0].load = RecordedMass(205, .pounds)
        try db.write { [first] in try SessionStore.save(first, $0) }
        #expect(try heaviest() == [205, 195])

        try db.write { try SessionStore.delete(second.id, $0) }
        #expect(try heaviest() == [205])
        #expect(try db.read { try SessionStore.fetchCompletedSummaries($0) }.map(\.workingSetCount) == [1])
    }
}

@Suite struct LoggedExerciseTests {
    @Test func listsOnlyCompletedExercisesMostRecentFirst() throws {
        let db = try AppDatabase.inMemory()
        let template = pushTemplate()
        _ = try completeBench(db, template: template, lb: 185, reps: 8, at: Date(timeIntervalSince1970: 1_000))
        _ = try completeBench(db, template: template, lb: 185, reps: 8, at: Date(timeIntervalSince1970: 2_000))
        let active = WorkoutSession.starting(from: template, exercises: try db.read { try ExerciseStore.catalog($0) })
        try db.write { try SessionStore.start(active, $0) }

        let logged = try db.read { try SessionStore.loggedExercises($0) }
        #expect(logged.map(\.id) == [benchID], "dip was never completed; the active session doesn't count")
        #expect(logged.first?.sessionCount == 2)
        #expect(logged.first?.lastPerformedAt == Date(timeIntervalSince1970: 2_000))
    }
}

@Suite struct MeasurementPersistenceTests {
    @Test func saveEditDeleteKeepsOriginalUnit() throws {
        let db = try AppDatabase.inMemory()
        var entry = BodyMeasurement(mass: RecordedMass(180.4, .pounds), measuredAt: Date(timeIntervalSince1970: 0), note: "AM")
        let second = BodyMeasurement(mass: RecordedMass(81, .kilograms), measuredAt: Date(timeIntervalSince1970: 3600))
        try db.write { [entry] db in
            try MeasurementStore.save(entry, db)
            try MeasurementStore.save(second, db)
        }
        entry.mass = RecordedMass(180.2, .pounds)
        try db.write { [entry] in try MeasurementStore.save(entry, $0) }

        let all = try db.read { try MeasurementStore.fetchAll(.bodyWeight, $0) }
        #expect(all.count == 2)
        #expect(all.first { $0.id == entry.id }?.mass == RecordedMass(180.2, .pounds))

        try db.write { try MeasurementStore.delete(second.id, $0) }
        #expect(try db.read { try MeasurementStore.fetchAll(.bodyWeight, $0) }.map(\.id) == [entry.id])

        let invalid = BodyMeasurement(mass: RecordedMass(0, .kilograms), measuredAt: Date())
        #expect(throws: StoreError.self) { try db.write { try MeasurementStore.save(invalid, $0) } }
    }
}
