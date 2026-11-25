import Domain
import Foundation
import GRDB

/// Syncable record kinds. Raw values match the server's `entity` field.
public enum SyncEntity: String, Codable, Sendable, CaseIterable {
    case exercise, template, session, measurement
}

/// A write ready to send. Once built it never changes, so a retry is byte-identical and the
/// server can recognise it by `mutationId`.
public struct OutgoingMutation: Sendable, Equatable {
    public let outboxSeq: Int64
    public let mutationId: String
    public let entity: SyncEntity
    public let id: String
    public let baseRevision: Int
    public let deleted: Bool
    public let body: Data?
}

public enum MutationOutcome: Sendable, Equatable {
    case applied(revision: Int)
    case conflict(reason: String, server: RemoteRecord?)
    case rejected(message: String)
}

public struct RemoteRecord: Sendable, Equatable {
    public let revision: Int
    public let deleted: Bool
    public let body: Data?

    public init(revision: Int, deleted: Bool, body: Data?) {
        self.revision = revision
        self.deleted = deleted
        self.body = body
    }
}

public struct RemoteChange: Sendable, Equatable {
    public let entity: SyncEntity
    public let id: String
    public let record: RemoteRecord

    public init(entity: SyncEntity, id: String, record: RemoteRecord) {
        self.entity = entity
        self.id = id
        self.record = record
    }
}

public struct SyncConflict: Identifiable, Sendable, Equatable {
    public var id: String { "\(entity.rawValue)/\(entityId)" }
    public let entity: SyncEntity
    public let entityId: String
    public let reason: String
    public let message: String?
    public let title: String
}

/// Local half of sync: the outbox, known revisions, the pull cursor, and conflicts.
public enum SyncStore {
    // MARK: Outgoing

    /// The oldest pending write for each record that isn't blocked by a conflict, frozen
    /// into a mutation. Writes to the same record go one at a time, so each is based on the
    /// revision the previous one produced.
    public static func nextMutations(_ db: Database, limit: Int = 50) throws -> [OutgoingMutation] {
        let rows = try Row.fetchAll(db, sql: """
            SELECT o.* FROM outbox o
            WHERE o.seq = (SELECT MIN(seq) FROM outbox WHERE entity = o.entity AND entity_id = o.entity_id)
              AND NOT EXISTS (SELECT 1 FROM sync_conflict c WHERE c.entity = o.entity AND c.entity_id = o.entity_id)
            ORDER BY o.seq LIMIT ?
            """, arguments: [limit])
        return try rows.map { row in
            let seq: Int64 = row["seq"]
            let entity: SyncEntity = try row.enumValue("entity")
            let entityId: String = row["entity_id"]
            var mutationId: String? = row["mutation_id"]
            var payload: String? = row["payload"]
            var deleted: Bool = row["deleted"]
            if mutationId == nil {
                let body = try localBody(entity, entityId, db)
                mutationId = UUID().uuidString
                payload = body.map { String(decoding: $0, as: UTF8.self) }
                deleted = body == nil
                try db.execute(sql: "UPDATE outbox SET mutation_id = ?, payload = ?, deleted = ? WHERE seq = ?",
                               arguments: [mutationId, payload, deleted, seq])
            }
            return OutgoingMutation(
                outboxSeq: seq,
                mutationId: mutationId ?? "",
                entity: entity,
                id: entityId,
                baseRevision: try revision(entity, entityId, db),
                deleted: deleted,
                body: payload.map { Data($0.utf8) }
            )
        }
    }

    public static func record(_ outcome: MutationOutcome, for mutation: OutgoingMutation, _ db: Database) throws {
        switch outcome {
        case .applied(let revision):
            try setRevision(mutation.entity, mutation.id, revision, db)
            try db.execute(sql: "DELETE FROM outbox WHERE seq = ?", arguments: [mutation.outboxSeq])
        case .conflict(let reason, let server):
            try db.execute(sql: """
                INSERT OR REPLACE INTO sync_conflict (entity, entity_id, reason, message, server_revision, server_deleted, server_body, created_at)
                VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
                """, arguments: [mutation.entity.rawValue, mutation.id, reason, server?.revision, server?.deleted ?? false,
                                 server?.body.map { String(decoding: $0, as: UTF8.self) }, Date()])
        case .rejected(let message):
            try db.execute(sql: """
                INSERT OR REPLACE INTO sync_conflict (entity, entity_id, reason, message, created_at)
                VALUES (?, ?, 'rejected', ?, ?)
                """, arguments: [mutation.entity.rawValue, mutation.id, message, Date()])
        }
    }

    public static func pendingCount(_ db: Database) throws -> Int {
        try Int.fetchOne(db, sql: "SELECT COUNT(DISTINCT entity || entity_id) FROM outbox") ?? 0
    }

    /// Queues every syncable record, e.g. when local data that predates sign-in is adopted.
    public static func enqueueAll(_ db: Database) throws {
        let now = Date()
        try db.execute(sql: """
            INSERT INTO outbox (entity, entity_id, created_at)
            SELECT 'exercise', id, ?1 FROM exercise WHERE is_built_in = 0
            UNION ALL SELECT 'template', id, ?1 FROM workout_template
            UNION ALL SELECT 'session', id, ?1 FROM workout_session
            UNION ALL SELECT 'measurement', id, ?1 FROM body_measurement
            """, arguments: [now])
    }

    // MARK: Incoming

    public static func cursor(_ db: Database) throws -> Int {
        try String.fetchOne(db, sql: "SELECT value FROM sync_meta WHERE key = 'cursor'").flatMap(Int.init) ?? 0
    }

    public static func setCursor(_ cursor: Int, _ db: Database) throws {
        try db.execute(sql: "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('cursor', ?)", arguments: [String(cursor)])
    }

    /// Applies a server change unless this record has local writes or a conflict pending;
    /// those are settled by push, which will report a conflict if both sides changed.
    public static func apply(_ change: RemoteChange, _ db: Database) throws {
        let busy = try Bool.fetchOne(db, sql: """
            SELECT EXISTS(SELECT 1 FROM outbox WHERE entity = ?1 AND entity_id = ?2)
                OR EXISTS(SELECT 1 FROM sync_conflict WHERE entity = ?1 AND entity_id = ?2)
            """, arguments: [change.entity.rawValue, change.id]) ?? false
        guard !busy, change.record.revision > (try revision(change.entity, change.id, db)) else { return }
        try withTriggersSilenced(db) {
            try write(change.entity, change.id, change.record, db)
        }
        try setRevision(change.entity, change.id, change.record.revision, db)
    }

    // MARK: Conflicts

    public static func conflicts(_ db: Database) throws -> [SyncConflict] {
        try Row.fetchAll(db, sql: "SELECT * FROM sync_conflict ORDER BY created_at").map { row in
            let entity: SyncEntity = try row.enumValue("entity")
            let entityId: String = row["entity_id"]
            return SyncConflict(entity: entity, entityId: entityId, reason: row["reason"], message: row["message"],
                                title: try title(entity, entityId, db))
        }
    }

    /// Overwrites the server with this device's version.
    public static func keepLocal(_ entity: SyncEntity, _ entityId: String, _ db: Database) throws {
        guard let row = try Row.fetchOne(db, sql: "SELECT server_revision FROM sync_conflict WHERE entity = ? AND entity_id = ?",
                                         arguments: [entity.rawValue, entityId]) else { return }
        if let serverRevision: Int = row["server_revision"] { try setRevision(entity, entityId, serverRevision, db) }
        // Re-freeze from current local state against the new base revision.
        try db.execute(sql: "DELETE FROM outbox WHERE entity = ? AND entity_id = ?", arguments: [entity.rawValue, entityId])
        try db.execute(sql: "INSERT INTO outbox (entity, entity_id, created_at) VALUES (?, ?, ?)", arguments: [entity.rawValue, entityId, Date()])
        try db.execute(sql: "DELETE FROM sync_conflict WHERE entity = ? AND entity_id = ?", arguments: [entity.rawValue, entityId])
    }

    /// Replaces this device's version with the server's and drops the local edits.
    public static func useServer(_ entity: SyncEntity, _ entityId: String, _ db: Database) throws {
        guard let row = try Row.fetchOne(db, sql: "SELECT * FROM sync_conflict WHERE entity = ? AND entity_id = ?",
                                         arguments: [entity.rawValue, entityId]) else { return }
        try db.execute(sql: "DELETE FROM outbox WHERE entity = ? AND entity_id = ?", arguments: [entity.rawValue, entityId])
        try db.execute(sql: "DELETE FROM sync_conflict WHERE entity = ? AND entity_id = ?", arguments: [entity.rawValue, entityId])
        if let revision: Int = row["server_revision"] {
            let body: String? = row["server_body"]
            let record = RemoteRecord(revision: revision, deleted: row["server_deleted"], body: body.map { Data($0.utf8) })
            try withTriggersSilenced(db) { try write(entity, entityId, record, db) }
            try setRevision(entity, entityId, revision, db)
        }
    }

    // MARK: Internals

    static func revision(_ entity: SyncEntity, _ id: String, _ db: Database) throws -> Int {
        try Int.fetchOne(db, sql: "SELECT revision FROM record_revision WHERE entity = ? AND entity_id = ?", arguments: [entity.rawValue, id]) ?? 0
    }

    static func setRevision(_ entity: SyncEntity, _ id: String, _ revision: Int, _ db: Database) throws {
        try db.execute(sql: "INSERT OR REPLACE INTO record_revision (entity, entity_id, revision) VALUES (?, ?, ?)",
                       arguments: [entity.rawValue, id, revision])
    }

    static func withTriggersSilenced(_ db: Database, _ body: () throws -> Void) throws {
        try db.execute(sql: "UPDATE sync_flags SET applying = 1")
        defer { try? db.execute(sql: "UPDATE sync_flags SET applying = 0") }
        try body()
    }

    /// The record's current local JSON, or nil if it no longer exists (a deletion).
    static func localBody(_ entity: SyncEntity, _ id: String, _ db: Database) throws -> Data? {
        guard let uuid = UUID(uuidString: id) else { return nil }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601WithFractionalSeconds
        switch entity {
        case .exercise: return try ExerciseStore.fetch(uuid, db).flatMap { $0.isBuiltIn ? nil : try encoder.encode($0) }
        case .template: return try TemplateStore.fetch(uuid, db).map { try encoder.encode($0) }
        case .session: return try SessionStore.fetch(uuid, db).map { try encoder.encode($0) }
        case .measurement: return try MeasurementStore.fetch(uuid, db).map { try encoder.encode($0) }
        }
    }

    static func write(_ entity: SyncEntity, _ id: String, _ record: RemoteRecord, _ db: Database) throws {
        guard let uuid = UUID(uuidString: id) else { return }
        guard !record.deleted, let body = record.body else {
            switch entity {
            case .exercise:
                if (try? db.execute(sql: "DELETE FROM exercise WHERE id = ? AND is_built_in = 0", arguments: [uuid.uuidString])) == nil {
                    try ExerciseStore.remove(uuid, db)
                }
            case .template: try TemplateStore.delete(uuid, db)
            case .session: try SessionStore.delete(uuid, db)
            case .measurement: try MeasurementStore.delete(uuid, db)
            }
            return
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601WithFractionalSeconds
        switch entity {
        case .exercise:
            let exercise = try decoder.decode(Exercise.self, from: body)
            guard !exercise.isBuiltIn else { return }
            try ExerciseStore.upsert(exercise, db)
        case .template:
            try TemplateStore.replace(try decoder.decode(WorkoutTemplate.self, from: body), db)
        case .session:
            let session = try decoder.decode(WorkoutSession.self, from: body)
            if session.state == .active, let local = try SessionStore.fetchActive(db), local.id != session.id {
                // Another device started a workout while this one has its own going. Keep ours;
                // the user resolves it from the conflict list.
                throw StoreError.activeWorkoutExists
            }
            try SessionStore.save(session, db, now: session.updatedAt)
        case .measurement:
            try MeasurementStore.save(try decoder.decode(BodyMeasurement.self, from: body), db, now: (try decoder.decode(BodyMeasurement.self, from: body)).updatedAt)
        }
    }

    static func title(_ entity: SyncEntity, _ id: String, _ db: Database) throws -> String {
        guard let uuid = UUID(uuidString: id) else { return entity.rawValue.capitalized }
        switch entity {
        case .exercise: return try ExerciseStore.fetch(uuid, db)?.name ?? "Custom exercise"
        case .template: return try TemplateStore.fetch(uuid, db).map { "Template: \($0.name)" } ?? "Deleted template"
        case .session: return try SessionStore.fetch(uuid, db).map { "Workout: \($0.name)" } ?? "Deleted workout"
        case .measurement: return "Body weight entry"
        }
    }
}
