import Domain
import Foundation
import GRDB
import Metrics

public struct SessionSummary: Identifiable, Hashable, Sendable {
    public let id: UUID
    public let name: String
    public let startedAt: Date
    public let finishedAt: Date?
    public let timeZoneIdentifier: String
    public let workingSetCount: Int

    public var duration: TimeInterval? { finishedAt.map { $0.timeIntervalSince(startedAt) } }
}

public struct LoggedExercise: Identifiable, Hashable, Sendable {
    public var id: UUID { exercise.id }
    public let exercise: Exercise
    public let lastPerformedAt: Date
    public let sessionCount: Int
}

public enum SessionStore {
    /// Exercises with at least one completed workout, most recently trained first.
    public static func loggedExercises(_ db: Database) throws -> [LoggedExercise] {
        let catalog = try ExerciseStore.catalog(db)
        return try Row.fetchAll(db, sql: """
            SELECT we.exercise_id, MAX(s.started_at) AS last, COUNT(DISTINCT s.id) AS sessions
            FROM workout_exercise we JOIN workout_session s ON s.id = we.session_id
            WHERE s.state = 'completed'
            GROUP BY we.exercise_id
            ORDER BY last DESC
            """).compactMap { row in
                guard let exercise = catalog[try row.uuid("exercise_id")] else { return nil }
                return LoggedExercise(exercise: exercise, lastPerformedAt: row["last"], sessionCount: row["sessions"])
            }
    }

    public static func fetch(_ id: UUID, _ db: Database) throws -> WorkoutSession? {
        try fetchSessions(db, whereClause: "id = ?", arguments: [id.uuidString]).first
    }

    public static func fetchActive(_ db: Database) throws -> WorkoutSession? {
        try fetchSessions(db, whereClause: "state = 'active'", arguments: []).first
    }

    /// Begins a new active workout. Only one may exist at a time.
    public static func start(_ session: WorkoutSession, _ db: Database) throws {
        guard session.state == .active else { throw StoreError.invalidRecord("New sessions must be active") }
        if try fetchActive(db) != nil { throw StoreError.activeWorkoutExists }
        try save(session, db)
    }

    /// Writes a whole session aggregate atomically (the caller's transaction).
    public static func save(_ session: WorkoutSession, _ db: Database, now: Date = Date()) throws {
        if session.state == .completed, session.completedSetCount == 0 {
            throw StoreError.invalidRecord("A completed workout needs at least one completed set")
        }
        for exercise in session.exercises {
            for set in exercise.sets where set.isCompleted {
                if let error = set.validate(for: exercise.measurement) {
                    throw StoreError.invalidRecord("\(exercise.exerciseName): \(error)")
                }
            }
        }

        try db.execute(sql: """
            INSERT INTO workout_session (id, name, state, source_template_id, source_template_revision,
                                         started_at, finished_at, time_zone, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name, state = excluded.state, started_at = excluded.started_at,
                finished_at = excluded.finished_at, notes = excluded.notes, updated_at = excluded.updated_at
            """, arguments: [
                session.id.uuidString, session.name, session.state.rawValue,
                session.sourceTemplate?.templateId.uuidString, session.sourceTemplate?.revision,
                session.startedAt, session.finishedAt, session.timeZoneIdentifier, session.notes,
                session.createdAt, now,
            ])
        try db.execute(sql: "DELETE FROM workout_exercise WHERE session_id = ?", arguments: [session.id.uuidString])

        for (position, exercise) in session.exercises.enumerated() {
            try db.execute(sql: """
                INSERT INTO workout_exercise (id, session_id, exercise_id, position, exercise_name,
                                              measurement_type, load_convention, notes, rest_seconds)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, arguments: [
                    exercise.id.uuidString, session.id.uuidString, exercise.exerciseId.uuidString, position,
                    exercise.exerciseName, exercise.measurement.type.rawValue, exercise.measurement.loadConvention?.rawValue,
                    exercise.notes, exercise.restSeconds,
                ])
            for (setPosition, set) in exercise.sets.enumerated() {
                try db.execute(sql: """
                    INSERT INTO workout_set (id, workout_exercise_id, position, set_type, target_reps_min, target_reps_max,
                                             target_load_value, target_load_unit, load_value, load_unit, reps, completed_at, rir)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, arguments: [
                        set.id.uuidString, exercise.id.uuidString, setPosition, set.type.rawValue,
                        set.targetReps?.min, set.targetReps?.max, set.targetLoad?.value, set.targetLoad?.unit.rawValue,
                        set.load?.value, set.load?.unit.rawValue, set.reps, set.completedAt, set.rir,
                    ])
            }
        }
    }

    public static func delete(_ id: UUID, _ db: Database) throws {
        try db.execute(sql: "DELETE FROM workout_session WHERE id = ?", arguments: [id.uuidString])
    }

    public static func fetchCompletedSummaries(_ db: Database) throws -> [SessionSummary] {
        try Row.fetchAll(db, sql: """
            SELECT s.id, s.name, s.started_at, s.finished_at, s.time_zone,
                   (SELECT COUNT(*) FROM workout_set ws JOIN workout_exercise we ON we.id = ws.workout_exercise_id
                    WHERE we.session_id = s.id AND ws.set_type = 'working' AND ws.completed_at IS NOT NULL) AS working_sets
            FROM workout_session s
            WHERE s.state = 'completed'
            ORDER BY s.started_at DESC
            """).map { row in
                SessionSummary(
                    id: try row.uuid("id"),
                    name: row["name"],
                    startedAt: row["started_at"],
                    finishedAt: row["finished_at"],
                    timeZoneIdentifier: row["time_zone"],
                    workingSetCount: row["working_sets"]
                )
            }
    }

    /// The latest completed workout containing this exercise, excluding the current session.
    /// `occurrence` pairs the k-th appearance of the exercise today with its k-th appearance then.
    public static func previousPerformance(
        exerciseId: UUID,
        excluding sessionId: UUID?,
        occurrence: Int = 0,
        _ db: Database
    ) throws -> PreviousPerformance? {
        guard let row = try Row.fetchOne(db, sql: """
            SELECT s.id, s.started_at FROM workout_session s
            WHERE s.state = 'completed' AND s.id IS NOT ?
              AND EXISTS (SELECT 1 FROM workout_exercise we WHERE we.session_id = s.id AND we.exercise_id = ?)
            ORDER BY s.started_at DESC LIMIT 1
            """, arguments: [sessionId?.uuidString, exerciseId.uuidString]) else { return nil }
        let id = try row.uuid("id")
        guard let session = try fetch(id, db) else { return nil }
        let occurrences = session.exercises.filter { $0.exerciseId == exerciseId }
        guard occurrences.indices.contains(occurrence) else { return nil }
        return PreviousPerformance(sessionId: id, date: row["started_at"], sets: occurrences[occurrence].sets)
    }

    /// Every completed session's sets for an exercise, combined per session, oldest first.
    public static func exerciseRecords(_ exerciseId: UUID, _ db: Database) throws -> [ExerciseSessionRecord] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT s.id AS session_id, s.name AS session_name, s.started_at, we.measurement_type, we.load_convention, ws.*
            FROM workout_set ws
            JOIN workout_exercise we ON we.id = ws.workout_exercise_id
            JOIN workout_session s ON s.id = we.session_id
            WHERE we.exercise_id = ? AND s.state = 'completed'
            ORDER BY s.started_at, we.position, ws.position
            """, arguments: [exerciseId.uuidString])
        var order: [UUID] = []
        var grouped: [UUID: (name: String, start: Date, measurement: ExerciseMeasurement, sets: [WorkoutSet])] = [:]
        for row in rows {
            let sessionId = try row.uuid("session_id")
            let set = try decodeSet(row)
            if grouped[sessionId] == nil {
                order.append(sessionId)
                grouped[sessionId] = (row["session_name"], row["started_at"],
                                      try row.measurement(type: "measurement_type", convention: "load_convention"), [])
            }
            grouped[sessionId]?.sets.append(set)
        }
        return order.compactMap { id in
            grouped[id].map { ExerciseSessionRecord(sessionId: id, sessionName: $0.name, startedAt: $0.start, measurement: $0.measurement, sets: $0.sets) }
        }
    }

    public static func fetchSessions(_ db: Database, whereClause: String, arguments: StatementArguments) throws -> [WorkoutSession] {
        let sessionRows = try Row.fetchAll(db, sql: "SELECT * FROM workout_session WHERE \(whereClause) ORDER BY started_at DESC", arguments: arguments)
        return try sessionRows.map { row in
            let id = try row.uuid("id")
            let setRows = try Row.fetchAll(db, sql: """
                SELECT ws.* FROM workout_set ws JOIN workout_exercise we ON we.id = ws.workout_exercise_id
                WHERE we.session_id = ? ORDER BY ws.position
                """, arguments: [id.uuidString])
            let setsByExercise = try Dictionary(grouping: setRows) { try $0.uuid("workout_exercise_id") }
            let exercises = try Row.fetchAll(db, sql: "SELECT * FROM workout_exercise WHERE session_id = ? ORDER BY position", arguments: [id.uuidString])
                .map { exerciseRow in
                    let rowId = try exerciseRow.uuid("id")
                    return WorkoutExercise(
                        id: rowId,
                        exerciseId: try exerciseRow.uuid("exercise_id"),
                        exerciseName: exerciseRow["exercise_name"],
                        measurement: try exerciseRow.measurement(type: "measurement_type", convention: "load_convention"),
                        notes: exerciseRow["notes"],
                        restSeconds: exerciseRow["rest_seconds"],
                        sets: try (setsByExercise[rowId] ?? []).map(decodeSet)
                    )
                }
            let templateId = row.optionalUUID("source_template_id")
            let templateRevision: Int? = row["source_template_revision"]
            return WorkoutSession(
                id: id,
                name: row["name"],
                state: try row.enumValue("state"),
                sourceTemplate: zip2(templateId, templateRevision).map { TemplateReference(templateId: $0, revision: $1) },
                startedAt: row["started_at"],
                finishedAt: row["finished_at"],
                timeZoneIdentifier: row["time_zone"],
                notes: row["notes"],
                exercises: exercises,
                createdAt: row["created_at"],
                updatedAt: row["updated_at"]
            )
        }
    }

    static func decodeSet(_ row: Row) throws -> WorkoutSet {
        WorkoutSet(
            id: try row.uuid("id"),
            type: try row.enumValue("set_type"),
            targetReps: row.repTarget(min: "target_reps_min", max: "target_reps_max"),
            targetLoad: row.mass(value: "target_load_value", unit: "target_load_unit"),
            load: row.mass(value: "load_value", unit: "load_unit"),
            reps: row["reps"],
            completedAt: row["completed_at"],
            rir: row["rir"]
        )
    }
}

private func zip2<A, B>(_ a: A?, _ b: B?) -> (A, B)? {
    guard let a, let b else { return nil }
    return (a, b)
}
