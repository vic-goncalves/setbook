import Domain
import Foundation
import GRDB

/// A complete, versioned copy of the user's records. Built-in exercises are not included
/// because their IDs are stable and every install already has them.
public struct BackupDocument: Codable, Sendable, Equatable {
    public static let currentFormatVersion = 1

    public var formatVersion: Int
    public var exportedAt: Date
    public var customExercises: [Exercise]
    public var templates: [WorkoutTemplate]
    public var sessions: [WorkoutSession]
    public var bodyMeasurements: [BodyMeasurement]
}

public struct ImportSummary: Equatable, Sendable {
    public var exercises = 0
    public var templates = 0
    public var sessions = 0
    public var bodyMeasurements = 0
    public var skippedActiveWorkout = false
}

public enum BackupError: Error, Equatable {
    case unsupportedVersion(Int)
    case unreadable(String)
}

public enum Backup {
    public static func document(_ db: Database, now: Date = Date()) throws -> BackupDocument {
        BackupDocument(
            formatVersion: BackupDocument.currentFormatVersion,
            exportedAt: now,
            customExercises: try ExerciseStore.fetchAll(db, includeArchived: true).filter { !$0.isBuiltIn },
            templates: try TemplateStore.fetchAll(db),
            sessions: try SessionStore.fetchSessions(db, whereClause: "1", arguments: []).reversed(),
            bodyMeasurements: try MeasurementStore.fetchAll(.bodyWeight, db).reversed()
        )
    }

    public static func encode(_ document: BackupDocument) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601WithFractionalSeconds
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(document)
    }

    public static func decode(_ data: Data) throws -> BackupDocument {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601WithFractionalSeconds
        let document: BackupDocument
        do {
            document = try decoder.decode(BackupDocument.self, from: data)
        } catch {
            throw BackupError.unreadable(String(describing: error))
        }
        guard document.formatVersion <= BackupDocument.currentFormatVersion else {
            throw BackupError.unsupportedVersion(document.formatVersion)
        }
        return document
    }

    /// Restores records by ID, so importing the same file twice never duplicates anything.
    /// Runs in the caller's transaction: any invalid record rolls back the whole import.
    /// An active workout in the file is skipped if one is already in progress here.
    public static func restore(_ document: BackupDocument, _ db: Database) throws -> ImportSummary {
        var summary = ImportSummary()
        for exercise in document.customExercises {
            guard !exercise.isBuiltIn else { continue }
            try ExerciseStore.upsert(exercise, db)
            summary.exercises += 1
        }
        for template in document.templates {
            try TemplateStore.replace(template, db)
            summary.templates += 1
        }
        let localActive = try SessionStore.fetchActive(db)
        for session in document.sessions {
            if session.state == .active, let localActive, localActive.id != session.id {
                summary.skippedActiveWorkout = true
                continue
            }
            try SessionStore.save(session, db, now: session.updatedAt)
            summary.sessions += 1
        }
        for measurement in document.bodyMeasurements {
            try MeasurementStore.save(measurement, db, now: measurement.updatedAt)
            summary.bodyMeasurements += 1
        }
        return summary
    }

    /// Deletes every user record. Built-in exercises remain.
    public static func eraseAll(_ db: Database) throws {
        try db.execute(sql: """
            DELETE FROM workout_session;
            DELETE FROM workout_template;
            DELETE FROM body_measurement;
            DELETE FROM training_goal;
            DELETE FROM exercise WHERE is_built_in = 0;
            """)
    }
}

/// Flat CSV views for spreadsheets. Values are written in the unit they were entered in.
public enum CSVExport {
    public static func sets(_ db: Database) throws -> String {
        var lines = ["workout_id,workout_name,started_at,time_zone,exercise_id,exercise_name,load_convention,exercise_position,set_position,set_type,load,load_unit,reps,rir,completed_at"]
        let sessions = try SessionStore.fetchSessions(db, whereClause: "state = 'completed'", arguments: []).reversed()
        for session in sessions {
            for (exercisePosition, exercise) in session.exercises.enumerated() {
                for (setPosition, set) in exercise.sets.enumerated() {
                    let columns: [String] = [
                        session.id.uuidString, field(session.name), iso(session.startedAt), session.timeZoneIdentifier,
                        exercise.exerciseId.uuidString, field(exercise.exerciseName), exercise.measurement.loadConvention?.rawValue ?? "",
                        String(exercisePosition + 1), String(setPosition + 1), set.type.rawValue,
                        set.load.map { number($0.value) } ?? "", set.load?.unit.rawValue ?? "",
                        set.reps.map(String.init) ?? "", set.rir.map(String.init) ?? "", set.completedAt.map(iso) ?? "",
                    ]
                    lines.append(columns.joined(separator: ","))
                }
            }
        }
        return lines.joined(separator: "\n") + "\n"
    }

    public static func bodyWeight(_ db: Database) throws -> String {
        var lines = ["id,measured_at,time_zone,weight,unit,note"]
        for entry in try MeasurementStore.fetchAll(.bodyWeight, db).reversed() {
            let columns: [String] = [entry.id.uuidString, iso(entry.measuredAt), entry.timeZoneIdentifier, number(entry.mass.value), entry.mass.unit.rawValue, field(entry.note ?? "")]
            lines.append(columns.joined(separator: ","))
        }
        return lines.joined(separator: "\n") + "\n"
    }

    /// Quotes a value when it contains a comma, quote or newline (RFC 4180).
    static func field(_ value: String) -> String {
        guard value.contains(where: { $0 == "," || $0 == "\"" || $0.isNewline }) else { return value }
        return "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }

    static func iso(_ date: Date) -> String { date.formatted(.iso8601) }

    static func number(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(value)
    }
}

extension JSONEncoder.DateEncodingStrategy {
    /// ISO 8601 with milliseconds, the wire format shared with the server and web app.
    public static let iso8601WithFractionalSeconds = custom { date, encoder in
        var container = encoder.singleValueContainer()
        try container.encode(date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
    }
}

extension JSONDecoder.DateDecodingStrategy {
    public static let iso8601WithFractionalSeconds = custom { decoder in
        let container = try decoder.singleValueContainer()
        let string = try container.decode(String.self)
        if let date = try? Date(string, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) { return date }
        if let date = try? Date(string, strategy: Date.ISO8601FormatStyle()) { return date }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid date \(string)")
    }
}
