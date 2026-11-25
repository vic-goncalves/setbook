import Domain
import Foundation
import Testing
@testable import Persistence

@Suite struct BackupTests {
    func populated() throws -> AppDatabase {
        let db = try AppDatabase.inMemory()
        let custom = Exercise(name: "Landmine Press, \"single\"", primaryMuscle: .shoulders, equipment: .barbell, measurement: .externalLoad(.total))
        var template = pushTemplate()
        template.exercises.append(TemplateExercise(exerciseId: custom.id))
        try db.write { [template] db in
            try ExerciseStore.saveCustom(custom, db)
            try TemplateStore.save(template, db)
            try TemplateStore.save(template, db)
            try MeasurementStore.save(BodyMeasurement(mass: RecordedMass(180.4, .pounds), measuredAt: Date(timeIntervalSince1970: 100), note: "after, coffee"), db)
        }
        let templateId = template.id
        let stored = try #require(try db.read { try TemplateStore.fetch(templateId, $0) })
        _ = try completeBench(db, template: stored, lb: 185, reps: 8, at: Date(timeIntervalSince1970: 1_000))
        return db
    }

    @Test func roundTripsIntoAFreshInstall() throws {
        let source = try populated()
        let data = try Backup.encode(try source.read { try Backup.document($0) })

        let target = try AppDatabase.inMemory()
        let summary = try target.write { db in try Backup.restore(try Backup.decode(data), db) }
        #expect(summary == ImportSummary(exercises: 1, templates: 1, sessions: 1, bodyMeasurements: 1))

        let original = try source.read { try Backup.document($0, now: Date(timeIntervalSince1970: 0)) }
        let restored = try target.read { try Backup.document($0, now: Date(timeIntervalSince1970: 0)) }
        #expect(restored.customExercises.map(\.id) == original.customExercises.map(\.id))
        #expect(restored.templates.map(\.exercises) == original.templates.map(\.exercises))
        #expect(restored.templates.first?.revision == 2, "revision is preserved, not bumped")
        #expect(restored.sessions.map(\.exercises) == original.sessions.map(\.exercises))
        #expect(restored.sessions.first?.sourceTemplate == original.sessions.first?.sourceTemplate)
        #expect(restored.bodyMeasurements.map(\.mass) == [RecordedMass(180.4, .pounds)])
    }

    @Test func importingTwiceDoesNotDuplicate() throws {
        let db = try populated()
        let document = try db.read { try Backup.document($0) }
        try db.write { _ = try Backup.restore(document, $0) }
        try db.write { _ = try Backup.restore(document, $0) }
        #expect(try db.read { try SessionStore.fetchCompletedSummaries($0) }.count == 1)
        #expect(try db.read { try TemplateStore.fetchAll($0) }.count == 1)
        #expect(try db.read { try MeasurementStore.fetchAll(.bodyWeight, $0) }.count == 1)
    }

    @Test func invalidFileRollsBackEverything() throws {
        let db = try AppDatabase.inMemory()
        var document = try populated().read { try Backup.document($0) }
        document.customExercises = []
        let broken = document
        #expect(throws: (any Error).self) { try db.write { _ = try Backup.restore(broken, $0) } }
        #expect(try db.read { try TemplateStore.fetchAll($0) }.isEmpty)
        #expect(throws: BackupError.self) { try Backup.decode(Data("{}".utf8)) }
        document.formatVersion = 99
        let future = try Backup.encode(document)
        #expect(throws: BackupError.unsupportedVersion(99)) { try Backup.decode(future) }
    }

    @Test func activeWorkoutIsNotDuplicated() throws {
        let source = try AppDatabase.inMemory()
        try source.write { try SessionStore.start(.empty(), $0) }
        let document = try source.read { try Backup.document($0) }

        let target = try AppDatabase.inMemory()
        try target.write { try SessionStore.start(.empty(), $0) }
        let summary = try target.write { try Backup.restore(document, $0) }
        #expect(summary.skippedActiveWorkout)
        #expect(summary.sessions == 0)
    }

    @Test func csvQuotesAndKeepsEnteredUnits() throws {
        let db = try populated()
        let sets = try db.read { try CSVExport.sets($0) }.split(separator: "\n")
        #expect(sets.count == 2)
        #expect(sets[1].contains(",Bench Press (Barbell),total,1,1,working,185,lb,8,,"))
        let weights = try db.read { try CSVExport.bodyWeight($0) }
        #expect(weights.contains(",180.4,lb,\"after, coffee\""))
        #expect(CSVExport.field("say \"hi\"") == "\"say \"\"hi\"\"\"")
    }

    @Test func eraseKeepsOnlyTheCatalog() throws {
        let db = try populated()
        try db.write { try Backup.eraseAll($0) }
        let document = try db.read { try Backup.document($0) }
        #expect(document.customExercises.isEmpty && document.templates.isEmpty && document.sessions.isEmpty && document.bodyMeasurements.isEmpty)
        #expect(try db.read { try ExerciseStore.fetchAll($0) }.count == ExerciseCatalog.all.count)
    }
}
