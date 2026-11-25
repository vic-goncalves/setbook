import Domain
import Foundation
import Persistence
import Testing
@testable import Sync

private let bench = ExerciseCatalog.builtInID(slug: "barbell-bench-press")

private func device(_ server: InMemoryServer) throws -> (db: AppDatabase, engine: SyncEngine, transport: TestTransport) {
    let db = try AppDatabase.inMemory()
    let transport = TestTransport(server)
    return (db, SyncEngine(database: db, transport: transport), transport)
}

private func pushTemplate(name: String = "Push") -> WorkoutTemplate {
    WorkoutTemplate(name: name, exercises: [TemplateExercise(exerciseId: bench, sets: [TemplateSet(targetReps: .exactly(5))])])
}

private func finishedWorkout(lb: Double) -> WorkoutSession {
    var session = WorkoutSession(name: "Push", state: .completed, startedAt: Date(timeIntervalSince1970: 1_000), finishedAt: Date(timeIntervalSince1970: 4_000))
    session.exercises = [WorkoutExercise(exerciseId: bench, exerciseName: "Bench Press (Barbell)", measurement: .externalLoad(.total),
                                         sets: [WorkoutSet(load: RecordedMass(lb, .pounds), reps: 5, completedAt: Date(timeIntervalSince1970: 2_000))])]
    return session
}

@Suite struct SyncEngineTests {
    @Test func everyLocalWriteIsQueuedOncePerRecord() throws {
        let db = try AppDatabase.inMemory()
        #expect(try db.read { try SyncStore.pendingCount($0) } == 0, "seeding the built-in catalog queues nothing")
        let template = pushTemplate()
        try db.write { db in
            try TemplateStore.save(template, db)
            try TemplateStore.save(template, db)
            try MeasurementStore.save(BodyMeasurement(mass: RecordedMass(180, .pounds), measuredAt: Date()), db)
        }
        #expect(try db.read { try SyncStore.pendingCount($0) } == 2)
    }

    @Test func changesFlowBetweenDevices() async throws {
        let server = InMemoryServer()
        let phone = try device(server)
        let other = try device(server)
        let template = pushTemplate()
        let workout = finishedWorkout(lb: 185)
        let weight = BodyMeasurement(mass: RecordedMass(180.4, .pounds), measuredAt: Date(timeIntervalSince1970: 5_000))
        try phone.db.write { db in
            try TemplateStore.save(template, db)
            try SessionStore.save(workout, db)
            try MeasurementStore.save(weight, db)
        }
        let first = try await phone.engine.sync()
        #expect(first.pushed == 3 && first.pending == 0)

        let received = try await other.engine.sync()
        #expect(received.pulled == 3)
        let otherTemplate = try other.db.read { try TemplateStore.fetch(template.id, $0) }
        #expect(otherTemplate?.exercises == template.exercises)
        #expect(try other.db.read { try SessionStore.fetch(workout.id, $0) }?.exercises == workout.exercises)
        #expect(try other.db.read { try MeasurementStore.fetchAll(.bodyWeight, $0) }.map(\.mass) == [RecordedMass(180.4, .pounds)])
        #expect(try other.db.read { try SyncStore.pendingCount($0) } == 0, "pulled records are not echoed back")

        // An edit on the second device reaches the first.
        var edited = try #require(otherTemplate)
        edited.name = "Push (heavy)"
        try other.db.write { [edited] in try TemplateStore.save(edited, $0) }
        try await other.engine.sync()
        try await phone.engine.sync()
        #expect(try phone.db.read { try TemplateStore.fetch(template.id, $0) }?.name == "Push (heavy)")

        // So does a deletion.
        try phone.db.write { try MeasurementStore.delete(weight.id, $0) }
        try await phone.engine.sync()
        try await other.engine.sync()
        #expect(try other.db.read { try MeasurementStore.fetchAll(.bodyWeight, $0) }.isEmpty)
    }

    @Test func lostResponsesAreRetriedWithoutDuplicates() async throws {
        let server = InMemoryServer()
        let phone = try device(server)
        try phone.db.write { try SessionStore.save(finishedWorkout(lb: 185), $0) }
        phone.transport.dropNextPushResponse = true
        await #expect(throws: URLError.self) { try await phone.engine.sync() }
        #expect(try phone.db.read { try SyncStore.pendingCount($0) } == 1, "still pending after the lost response")

        let report = try await phone.engine.sync()
        #expect(report.pending == 0 && report.conflicts == 0)
        #expect(await server.records.count == 1)
        #expect(await server.records.values.first?.revision == 1, "the retry was recognised, not applied twice")
    }

    @Test func offlineWritesSurviveRestartAndSyncLater() async throws {
        let server = InMemoryServer()
        let url = URL.temporaryDirectory.appending(path: "sync-\(UUID().uuidString)/db.sqlite")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        do {
            let db = try AppDatabase.onDisk(at: url)
            let transport = TestTransport(server)
            transport.offline = true
            try db.write { try SessionStore.save(finishedWorkout(lb: 200), $0) }
            await #expect(throws: URLError.self) { try await SyncEngine(database: db, transport: transport).sync() }
        }
        let reopened = try AppDatabase.onDisk(at: url)
        #expect(try reopened.read { try SyncStore.pendingCount($0) } == 1)
        try await SyncEngine(database: reopened, transport: TestTransport(server)).sync()
        #expect(await server.records.count == 1)
    }

    @Test func concurrentEditsBecomeAConflictAndNothingIsOverwritten() async throws {
        let server = InMemoryServer()
        let a = try device(server)
        let b = try device(server)
        let workout = finishedWorkout(lb: 185)
        try a.db.write { try SessionStore.save(workout, $0) }
        try await a.engine.sync()
        try await b.engine.sync()

        var fromA = workout
        fromA.exercises[0].sets[0].reps = 6
        var fromB = workout
        fromB.exercises[0].sets[0].reps = 9
        try a.db.write { [fromA] in try SessionStore.save(fromA, $0) }
        try b.db.write { [fromB] in try SessionStore.save(fromB, $0) }
        try await a.engine.sync()
        let report = try await b.engine.sync()

        #expect(report.conflicts == 1)
        #expect(try b.db.read { try SessionStore.fetch(workout.id, $0) }?.exercises[0].sets[0].reps == 9, "local version kept")
        let conflicts = try b.db.read { try SyncStore.conflicts($0) }
        #expect(conflicts.map(\.reason) == ["stale"])
        #expect(conflicts.first?.title == "Workout: Push")

        // Later pulls don't overwrite the conflicted record either.
        try await b.engine.sync()
        #expect(try b.db.read { try SessionStore.fetch(workout.id, $0) }?.exercises[0].sets[0].reps == 9)
    }

    @Test func keepLocalOverwritesTheServer() async throws {
        let (a, b, workout) = try await conflicted()
        try b.db.write { try SyncStore.keepLocal(.session, workout.id.uuidString, $0) }
        let report = try await b.engine.sync()
        #expect(report.conflicts == 0 && report.pending == 0)
        try await a.engine.sync()
        #expect(try a.db.read { try SessionStore.fetch(workout.id, $0) }?.exercises[0].sets[0].reps == 9)
    }

    @Test func useServerReplacesTheLocalCopy() async throws {
        let (_, b, workout) = try await conflicted()
        try b.db.write { try SyncStore.useServer(.session, workout.id.uuidString, $0) }
        #expect(try b.db.read { try SessionStore.fetch(workout.id, $0) }?.exercises[0].sets[0].reps == 6)
        let report = try await b.engine.sync()
        #expect(report.conflicts == 0 && report.pending == 0)
    }

    @Test func adoptsDataCreatedBeforeSignIn() async throws {
        let server = InMemoryServer()
        let phone = try device(server)
        try phone.db.write { db in
            try TemplateStore.save(pushTemplate(), db)
            try db.execute(sql: "DELETE FROM outbox")
            try SyncStore.enqueueAll(db)
        }
        try await phone.engine.sync()
        #expect(await server.records.count == 1)
    }

    private func conflicted() async throws -> (a: (db: AppDatabase, engine: SyncEngine, transport: TestTransport), b: (db: AppDatabase, engine: SyncEngine, transport: TestTransport), workout: WorkoutSession) {
        let server = InMemoryServer()
        let a = try device(server)
        let b = try device(server)
        let workout = finishedWorkout(lb: 185)
        try a.db.write { try SessionStore.save(workout, $0) }
        try await a.engine.sync()
        try await b.engine.sync()
        var fromA = workout
        fromA.exercises[0].sets[0].reps = 6
        var fromB = workout
        fromB.exercises[0].sets[0].reps = 9
        try a.db.write { [fromA] in try SessionStore.save(fromA, $0) }
        try b.db.write { [fromB] in try SessionStore.save(fromB, $0) }
        try await a.engine.sync()
        try await b.engine.sync()
        return (a, b, workout)
    }
}
