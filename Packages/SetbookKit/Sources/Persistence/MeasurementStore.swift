import Domain
import Foundation
import GRDB

public enum MeasurementStore {
    public static func fetchAll(_ kind: BodyMeasurementKind = .bodyWeight, _ db: Database) throws -> [BodyMeasurement] {
        try Row.fetchAll(db, sql: "SELECT * FROM body_measurement WHERE kind = ? ORDER BY measured_at DESC", arguments: [kind.rawValue])
            .map { row in
                guard let mass = row.mass(value: "value", unit: "unit") else {
                    throw StoreError.invalidRecord("body_measurement has no mass")
                }
                return BodyMeasurement(
                    id: try row.uuid("id"),
                    kind: try row.enumValue("kind"),
                    mass: mass,
                    measuredAt: row["measured_at"],
                    timeZoneIdentifier: row["time_zone"],
                    source: try row.enumValue("source"),
                    note: row["note"],
                    createdAt: row["created_at"],
                    updatedAt: row["updated_at"]
                )
            }
    }

    public static func fetch(_ id: UUID, _ db: Database) throws -> BodyMeasurement? {
        try fetchAll(.bodyWeight, db).first { $0.id == id }
    }

    public static func save(_ measurement: BodyMeasurement, _ db: Database, now: Date = Date()) throws {
        guard measurement.isValid else { throw StoreError.invalidRecord("Body weight must be greater than zero") }
        try db.execute(sql: """
            INSERT INTO body_measurement (id, kind, value, unit, measured_at, time_zone, source, note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                value = excluded.value, unit = excluded.unit, measured_at = excluded.measured_at,
                time_zone = excluded.time_zone, note = excluded.note, updated_at = excluded.updated_at
            """, arguments: [
                measurement.id.uuidString, measurement.kind.rawValue, measurement.mass.value, measurement.mass.unit.rawValue,
                measurement.measuredAt, measurement.timeZoneIdentifier, measurement.source.rawValue, measurement.note,
                measurement.createdAt, now,
            ])
    }

    public static func delete(_ id: UUID, _ db: Database) throws {
        try db.execute(sql: "DELETE FROM body_measurement WHERE id = ?", arguments: [id.uuidString])
    }
}
