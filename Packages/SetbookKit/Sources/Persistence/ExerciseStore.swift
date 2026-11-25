import Domain
import Foundation
import GRDB

public enum ExerciseStore {
    public static func fetchAll(_ db: Database, includeArchived: Bool = false) throws -> [Exercise] {
        let sql = includeArchived
            ? "SELECT * FROM exercise ORDER BY name COLLATE NOCASE"
            : "SELECT * FROM exercise WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE"
        return try Row.fetchAll(db, sql: sql).map(decode)
    }

    public static func fetch(_ id: UUID, _ db: Database) throws -> Exercise? {
        try Row.fetchOne(db, sql: "SELECT * FROM exercise WHERE id = ?", arguments: [id.uuidString]).map(decode)
    }

    /// Lookup table including archived exercises, so historical references always resolve.
    public static func catalog(_ db: Database) throws -> [UUID: Exercise] {
        Dictionary(uniqueKeysWithValues: try fetchAll(db, includeArchived: true).map { ($0.id, $0) })
    }

    public static func hasLoggedHistory(_ id: UUID, _ db: Database) throws -> Bool {
        try Bool.fetchOne(db, sql: "SELECT EXISTS(SELECT 1 FROM workout_exercise WHERE exercise_id = ?)", arguments: [id.uuidString]) ?? false
    }

    /// Saves a custom exercise. Measurement type and load convention are locked once the
    /// exercise has logged history, so one performance series never mixes conventions.
    public static func saveCustom(_ exercise: Exercise, _ db: Database, now: Date = Date()) throws {
        guard !exercise.isBuiltIn else { throw StoreError.invalidRecord("Built-in exercises are read-only") }
        let name = exercise.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw StoreError.invalidRecord("Name is required") }
        if let existing = try fetch(exercise.id, db) {
            guard !existing.isBuiltIn else { throw StoreError.invalidRecord("Built-in exercises are read-only") }
            if existing.measurement != exercise.measurement, try hasLoggedHistory(exercise.id, db) {
                throw StoreError.invalidRecord("Measurement can't change after the exercise has been logged")
            }
        }
        var saved = exercise
        saved.name = name
        saved.updatedAt = now
        try upsert(saved, db)
    }

    /// Deletes an unused custom exercise, or archives it if anything references it.
    public static func remove(_ id: UUID, _ db: Database, now: Date = Date()) throws {
        guard let exercise = try fetch(id, db), !exercise.isBuiltIn else { return }
        let referenced = try Bool.fetchOne(db, sql: """
            SELECT EXISTS(SELECT 1 FROM workout_exercise WHERE exercise_id = ?1)
                OR EXISTS(SELECT 1 FROM template_exercise WHERE exercise_id = ?1)
                OR EXISTS(SELECT 1 FROM training_goal WHERE exercise_id = ?1)
            """, arguments: [id.uuidString]) ?? false
        if referenced {
            try db.execute(sql: "UPDATE exercise SET archived_at = ?, updated_at = ? WHERE id = ?", arguments: [now, now, id.uuidString])
        } else {
            try db.execute(sql: "DELETE FROM exercise WHERE id = ?", arguments: [id.uuidString])
        }
    }

    public static func unarchive(_ id: UUID, _ db: Database, now: Date = Date()) throws {
        try db.execute(sql: "UPDATE exercise SET archived_at = NULL, updated_at = ? WHERE id = ?", arguments: [now, id.uuidString])
    }

    public static func upsert(_ exercise: Exercise, _ db: Database) throws {
        try db.execute(sql: """
            INSERT INTO exercise (id, name, primary_muscle, secondary_muscles, equipment, measurement_type,
                                  load_convention, is_built_in, archived_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name, primary_muscle = excluded.primary_muscle,
                secondary_muscles = excluded.secondary_muscles, equipment = excluded.equipment,
                measurement_type = excluded.measurement_type, load_convention = excluded.load_convention,
                archived_at = excluded.archived_at, updated_at = excluded.updated_at
            """, arguments: [
                exercise.id.uuidString, exercise.name, exercise.primaryMuscle.rawValue,
                exercise.secondaryMuscles.map(\.rawValue).joined(separator: ","), exercise.equipment.rawValue,
                exercise.measurement.type.rawValue, exercise.measurement.loadConvention?.rawValue,
                exercise.isBuiltIn, exercise.archivedAt, exercise.createdAt, exercise.updatedAt,
            ])
    }

    static func decode(_ row: Row) throws -> Exercise {
        let secondary: String = row["secondary_muscles"] ?? ""
        return Exercise(
            id: try row.uuid("id"),
            name: row["name"],
            primaryMuscle: try row.enumValue("primary_muscle"),
            secondaryMuscles: secondary.split(separator: ",").compactMap { MuscleGroup(rawValue: String($0)) },
            equipment: try row.enumValue("equipment"),
            measurement: try row.measurement(type: "measurement_type", convention: "load_convention"),
            isBuiltIn: row["is_built_in"],
            archivedAt: row["archived_at"],
            createdAt: row["created_at"],
            updatedAt: row["updated_at"]
        )
    }
}
