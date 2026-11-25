import Domain
import Foundation
import GRDB

public struct TemplateSummary: Identifiable, Hashable, Sendable {
    public var id: UUID { template.id }
    public let template: WorkoutTemplate
    public let lastPerformedAt: Date?
}

public enum TemplateStore {
    public static func fetchSummaries(_ db: Database) throws -> [TemplateSummary] {
        let lastPerformed = try Row.fetchAll(db, sql: """
            SELECT source_template_id, MAX(started_at) AS last
            FROM workout_session WHERE state = 'completed' AND source_template_id IS NOT NULL
            GROUP BY source_template_id
            """).reduce(into: [UUID: Date]()) { result, row in
                if let id = row.optionalUUID("source_template_id") { result[id] = row["last"] }
            }
        return try fetchAll(db).map { TemplateSummary(template: $0, lastPerformedAt: lastPerformed[$0.id]) }
    }

    public static func fetchAll(_ db: Database) throws -> [WorkoutTemplate] {
        let ids = try String.fetchAll(db, sql: "SELECT id FROM workout_template ORDER BY position, created_at")
        return try ids.compactMap { id in try UUID(uuidString: id).flatMap { try fetch($0, db) } }
    }

    public static func fetch(_ id: UUID, _ db: Database) throws -> WorkoutTemplate? {
        guard let row = try Row.fetchOne(db, sql: "SELECT * FROM workout_template WHERE id = ?", arguments: [id.uuidString]) else {
            return nil
        }
        let setRows = try Row.fetchAll(db, sql: """
            SELECT s.* FROM template_set s
            JOIN template_exercise e ON e.id = s.template_exercise_id
            WHERE e.template_id = ? ORDER BY s.position
            """, arguments: [id.uuidString])
        let setsByExercise = try Dictionary(grouping: setRows) { try $0.uuid("template_exercise_id") }
        let exercises = try Row.fetchAll(db, sql: "SELECT * FROM template_exercise WHERE template_id = ? ORDER BY position", arguments: [id.uuidString])
            .map { row in
                let exerciseRowId = try row.uuid("id")
                return TemplateExercise(
                    id: exerciseRowId,
                    exerciseId: try row.uuid("exercise_id"),
                    notes: row["notes"],
                    restSeconds: row["rest_seconds"],
                    sets: try (setsByExercise[exerciseRowId] ?? []).map { set in
                        TemplateSet(
                            id: try set.uuid("id"),
                            type: try set.enumValue("set_type"),
                            targetReps: set.repTarget(min: "target_reps_min", max: "target_reps_max"),
                            targetLoad: set.mass(value: "target_load_value", unit: "target_load_unit")
                        )
                    }
                )
            }
        return WorkoutTemplate(
            id: id,
            name: row["name"],
            notes: row["notes"],
            revision: row["revision"],
            exercises: exercises,
            createdAt: row["created_at"],
            updatedAt: row["updated_at"]
        )
    }

    /// Inserts or replaces a template. Saving an existing template bumps its revision so
    /// sessions can tell which version they were started from. Returns what was stored.
    @discardableResult
    public static func save(_ template: WorkoutTemplate, _ db: Database, now: Date = Date()) throws -> WorkoutTemplate {
        let name = template.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw StoreError.invalidRecord("Template name is required") }
        var saved = template
        saved.name = name
        saved.updatedAt = now

        if let existing = try Row.fetchOne(db, sql: "SELECT revision FROM workout_template WHERE id = ?", arguments: [template.id.uuidString]) {
            let previousRevision: Int = existing["revision"]
            saved.revision = previousRevision + 1
            try db.execute(sql: "UPDATE workout_template SET name = ?, notes = ?, revision = ?, updated_at = ? WHERE id = ?",
                           arguments: [saved.name, saved.notes, saved.revision, now, saved.id.uuidString])
            try db.execute(sql: "DELETE FROM template_exercise WHERE template_id = ?", arguments: [saved.id.uuidString])
        } else {
            let position = (try Int.fetchOne(db, sql: "SELECT MAX(position) FROM workout_template") ?? -1) + 1
            saved.revision = 1
            saved.createdAt = now
            try db.execute(sql: """
                INSERT INTO workout_template (id, name, notes, revision, position, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, arguments: [saved.id.uuidString, saved.name, saved.notes, saved.revision, position, now, now])
        }

        for (position, exercise) in saved.exercises.enumerated() {
            try db.execute(sql: """
                INSERT INTO template_exercise (id, template_id, exercise_id, position, notes, rest_seconds)
                VALUES (?, ?, ?, ?, ?, ?)
                """, arguments: [exercise.id.uuidString, saved.id.uuidString, exercise.exerciseId.uuidString, position, exercise.notes, exercise.restSeconds])
            for (setPosition, set) in exercise.sets.enumerated() {
                try db.execute(sql: """
                    INSERT INTO template_set (id, template_exercise_id, position, set_type, target_reps_min, target_reps_max, target_load_value, target_load_unit)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, arguments: [set.id.uuidString, exercise.id.uuidString, setPosition, set.type.rawValue,
                                     set.targetReps?.min, set.targetReps?.max, set.targetLoad?.value, set.targetLoad?.unit.rawValue])
            }
        }
        return saved
    }

    /// Writes a template exactly as given, keeping its revision and timestamps. Used for
    /// restores and synced copies, where bumping the revision would break session references.
    public static func replace(_ template: WorkoutTemplate, _ db: Database) throws {
        let position = try Int.fetchOne(db, sql: "SELECT position FROM workout_template WHERE id = ?", arguments: [template.id.uuidString])
        try delete(template.id, db)
        let saved = try save(template, db, now: template.updatedAt)
        try db.execute(sql: "UPDATE workout_template SET revision = ?, created_at = ?, position = COALESCE(?, position) WHERE id = ?",
                       arguments: [template.revision, template.createdAt, position, saved.id.uuidString])
    }

    public static func delete(_ id: UUID, _ db: Database) throws {
        try db.execute(sql: "DELETE FROM workout_template WHERE id = ?", arguments: [id.uuidString])
    }

    public static func reorder(_ ids: [UUID], _ db: Database) throws {
        for (position, id) in ids.enumerated() {
            try db.execute(sql: "UPDATE workout_template SET position = ? WHERE id = ?", arguments: [position, id.uuidString])
        }
    }
}
