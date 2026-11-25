import Domain
import Foundation
import Metrics
import Testing
@testable import Persistence

/// Keeps `contracts/` in step with the Swift models. Run with SETBOOK_WRITE_CONTRACTS=1 to
/// regenerate after an intentional change; otherwise any drift fails the test.
@Suite struct ContractTests {
    static let contracts = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "contracts")

    static var writing: Bool { ProcessInfo.processInfo.environment["SETBOOK_WRITE_CONTRACTS"] == "1" }

    static func check(_ data: Data, _ name: String) throws {
        let url = contracts.appending(path: name)
        if writing {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url)
        }
        let stored = try Data(contentsOf: url)
        #expect(stored == data, "\(name) is out of date; rerun with SETBOOK_WRITE_CONTRACTS=1")
    }

    static func json(_ value: some Encodable) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601WithFractionalSeconds
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(value)
    }

    @Test func catalog() throws {
        struct Entry: Encodable { let id: String; let name: String; let measurement: ExerciseMeasurement; let primaryMuscle: MuscleGroup; let equipment: Equipment }
        let entries = ExerciseCatalog.all.map { Entry(id: $0.id.uuidString, name: $0.name, measurement: $0.measurement, primaryMuscle: $0.primaryMuscle, equipment: $0.equipment) }
        try Self.check(try Self.json(entries), "catalog.json")
    }

    /// A small but complete backup plus the metric values Swift computes from it. The web
    /// app's TypeScript metrics must reproduce these numbers exactly.
    @Test func backupAndMetricsFixture() throws {
        let db = try AppDatabase.inMemory()
        let base = Date(timeIntervalSince1970: 1_767_225_600) // 2026-01-01T00:00:00Z
        let bench = ExerciseCatalog.builtInID(slug: "barbell-bench-press")
        let assisted = ExerciseCatalog.builtInID(slug: "assisted-pull-up")
        let custom = Exercise(
            id: UUID(uuidString: "11111111-1111-4111-8111-111111111111") ?? UUID(),
            name: "Landmine Press", primaryMuscle: .shoulders, equipment: .barbell,
            measurement: .externalLoad(.perHand), createdAt: base, updatedAt: base
        )
        let template = WorkoutTemplate(
            id: UUID(uuidString: "22222222-2222-4222-8222-222222222222") ?? UUID(),
            name: "Push", exercises: [
                TemplateExercise(id: UUID(uuidString: "22222222-2222-4222-8222-000000000001") ?? UUID(), exerciseId: bench, sets: [
                    TemplateSet(id: UUID(uuidString: "22222222-2222-4222-8222-000000000011") ?? UUID(), type: .warmup, targetReps: .exactly(10)),
                    TemplateSet(id: UUID(uuidString: "22222222-2222-4222-8222-000000000012") ?? UUID(), targetReps: RepTarget(min: 5, max: 8), targetLoad: RecordedMass(100, .kilograms)),
                ]),
            ], createdAt: base, updatedAt: base
        )
        func set(_ n: Int, _ type: SetType, _ load: Double?, _ unit: MassUnit, _ reps: Int, done: Bool = true) -> WorkoutSet {
            WorkoutSet(id: UUID(uuidString: String(format: "33333333-3333-4333-8333-%012d", n)) ?? UUID(), type: type,
                       load: load.map { RecordedMass($0, unit) }, reps: reps, completedAt: done ? base.addingTimeInterval(Double(n)) : nil)
        }
        func session(_ n: Int, day: Double, _ exercises: [WorkoutExercise]) -> WorkoutSession {
            WorkoutSession(id: UUID(uuidString: String(format: "44444444-4444-4444-8444-%012d", n)) ?? UUID(), name: "Push", state: .completed,
                           sourceTemplate: TemplateReference(templateId: template.id, revision: 1),
                           startedAt: base.addingTimeInterval(day * 86_400), finishedAt: base.addingTimeInterval(day * 86_400 + 3600),
                           timeZoneIdentifier: "America/New_York", exercises: exercises)
        }
        func benchExercise(_ n: Int, _ sets: [WorkoutSet]) -> WorkoutExercise {
            WorkoutExercise(id: UUID(uuidString: String(format: "55555555-5555-4555-8555-%012d", n)) ?? UUID(), exerciseId: bench,
                            exerciseName: "Bench Press (Barbell)", measurement: .externalLoad(.total), sets: sets)
        }
        let sessions = [
            session(1, day: 1, [benchExercise(1, [set(1, .warmup, 60, .kilograms, 10), set(2, .working, 100, .kilograms, 6), set(3, .working, 100, .kilograms, 5)])]),
            session(2, day: 1.5, [benchExercise(2, [set(4, .working, 225, .pounds, 3), set(5, .working, 220.462262, .pounds, 7), set(6, .working, 240, .pounds, 1, done: false)])]),
            session(3, day: 8, [
                benchExercise(3, [set(7, .working, 105, .kilograms, 5)]),
                WorkoutExercise(id: UUID(uuidString: "55555555-5555-4555-8555-000000000004") ?? UUID(), exerciseId: assisted,
                                exerciseName: "Pull-up (Assisted)", measurement: .assistedBodyweight,
                                sets: [set(8, .working, 30, .kilograms, 8), set(9, .working, 25, .kilograms, 6)]),
            ]),
        ]
        let weights = [(0.0, 80.0, MassUnit.kilograms), (0.4, 81.0, .kilograms), (2.0, 178.6, .pounds), (9.0, 79.0, .kilograms)].enumerated().map { index, entry in
            BodyMeasurement(id: UUID(uuidString: String(format: "66666666-6666-4666-8666-%012d", index)) ?? UUID(),
                            mass: RecordedMass(entry.1, entry.2), measuredAt: base.addingTimeInterval(entry.0 * 86_400 + 43_200),
                            timeZoneIdentifier: "UTC", createdAt: base, updatedAt: base)
        }
        try db.write { [template, sessions, weights] db in
            try ExerciseStore.saveCustom(custom, db, now: base)
            try TemplateStore.save(template, db, now: base)
            for session in sessions { try SessionStore.save(session, db, now: base) }
            for weight in weights { try MeasurementStore.save(weight, db, now: base) }
        }
        try Self.check(try Backup.encode(try db.read { try Backup.document($0, now: base) }), "fixtures/backup.json")

        let records = try db.read { try SessionStore.exerciseRecords(bench, $0) }
        let assistedRecords = try db.read { try SessionStore.exerciseRecords(assisted, $0) }
        struct Point: Encodable { let sessionId: String; let value: Double; let reps: Int? }
        func points(_ metric: ExerciseMetric, _ records: [ExerciseSessionRecord], _ measurement: ExerciseMeasurement) -> [Point] {
            ExerciseMetrics.series(metric, records: records, measurement: measurement).map {
                Point(sessionId: $0.sessionId.uuidString, value: ($0.value * 1_000_000).rounded() / 1_000_000, reps: $0.reps)
            }
        }
        let total = ExerciseMeasurement.externalLoad(.total)
        let daily = BodyWeightTrend.dailyMeans(weights)
        struct Daily: Encodable { let day: String; let meanKilograms: Double; let count: Int }
        struct Average: Encodable { let day: String; let kilograms: Double; let observedDays: Int }
        struct Expected: Encodable {
            let heaviestSet: [Point]; let volume: [Point]; let bestRepsAt100kg: [Point]
            let leastAssistance: [Point]; let assistedVolume: [Point]
            let dailyMeans: [Daily]; let rollingAverage: [Average]
        }
        func day(_ d: LocalDay) -> String { String(format: "%04d-%02d-%02d", d.year, d.month, d.day) }
        func round6(_ v: Double) -> Double { (v * 1_000_000).rounded() / 1_000_000 }
        let expected = Expected(
            heaviestSet: points(.heaviestSet, records, total),
            volume: points(.volume, records, total),
            bestRepsAt100kg: points(.bestRepsAtLoad(RecordedMass(100, .kilograms)), records, total),
            leastAssistance: points(.leastAssistance, assistedRecords, .assistedBodyweight),
            assistedVolume: points(.volume, assistedRecords, .assistedBodyweight),
            dailyMeans: daily.map { Daily(day: day($0.day), meanKilograms: round6($0.meanKilograms), count: $0.count) },
            rollingAverage: BodyWeightTrend.rollingAverage(daily).map { Average(day: day($0.day), kilograms: round6($0.kilograms), observedDays: $0.observedDays) }
        )
        try Self.check(try Self.json(expected), "fixtures/metrics-expected.json")
    }
}
