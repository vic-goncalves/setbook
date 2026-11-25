import Domain
import Foundation
import GRDB

public enum StoreError: Error, Equatable {
    case activeWorkoutExists
    case notFound
    case invalidRecord(String)
}

/// The app's single local store. All writes go through here; reads used by live UI are
/// exposed as `observe` so screens update when any write lands.
public final class AppDatabase: Sendable {
    let writer: any DatabaseWriter

    public init(_ writer: any DatabaseWriter) throws {
        self.writer = writer
        try Self.migrator.migrate(writer)
        try writer.write { db in try Self.seedCatalog(db) }
    }

    public static func onDisk(at url: URL) throws -> AppDatabase {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var config = Configuration()
        config.foreignKeysEnabled = true
        return try AppDatabase(DatabasePool(path: url.path, configuration: config))
    }

    public static func inMemory() throws -> AppDatabase {
        var config = Configuration()
        config.foreignKeysEnabled = true
        return try AppDatabase(DatabaseQueue(configuration: config))
    }

    public static var defaultURL: URL {
        URL.applicationSupportDirectory.appending(path: "Setbook/setbook.sqlite")
    }

    public func read<T: Sendable>(_ block: @Sendable (Database) throws -> T) throws -> T {
        try writer.read(block)
    }

    @discardableResult
    public func write<T: Sendable>(_ block: @Sendable (Database) throws -> T) throws -> T {
        try writer.write(block)
    }

    public func observe<T: Sendable>(_ fetch: @escaping @Sendable (Database) throws -> T) -> AsyncValueObservation<T> {
        ValueObservation.tracking(fetch).values(in: writer, scheduling: .immediate)
    }

    /// Built-ins are re-upserted on every launch so catalog fixes ship with app updates.
    /// IDs are stable, so history keeps pointing at the same exercise.
    static func seedCatalog(_ db: Database) throws {
        for exercise in ExerciseCatalog.all {
            try ExerciseStore.upsert(exercise, db)
        }
    }
}
