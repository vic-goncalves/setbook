import Foundation
import Persistence

/// The network half of sync. Implemented by the API client in the app and by an in-memory
/// server in tests.
public protocol SyncTransport: Sendable {
    func push(_ mutations: [OutgoingMutation]) async throws -> [MutationOutcome]
    func pull(cursor: Int) async throws -> (changes: [RemoteChange], cursor: Int, hasMore: Bool)
}

public struct SyncReport: Sendable, Equatable {
    public var pushed = 0
    public var pulled = 0
    public var conflicts = 0
    public var pending = 0
}

/// Pushes queued local writes, then pulls server changes. Safe to call repeatedly and
/// concurrently: runs are serialised, and an interrupted run resumes with the same frozen
/// mutations, which the server de-duplicates.
public actor SyncEngine {
    private let database: AppDatabase
    private let transport: SyncTransport
    private var running: Task<SyncReport, Error>?

    public init(database: AppDatabase, transport: SyncTransport) {
        self.database = database
        self.transport = transport
    }

    @discardableResult
    public func sync() async throws -> SyncReport {
        if let running { return try await running.value }
        let task = Task { try await run() }
        running = task
        defer { running = nil }
        return try await task.value
    }

    private func run() async throws -> SyncReport {
        var report = SyncReport()

        // Push until nothing sendable is left. Each round sends at most one write per record.
        while true {
            let batch = try database.write { try SyncStore.nextMutations($0) }
            if batch.isEmpty { break }
            let outcomes = try await transport.push(batch)
            guard outcomes.count == batch.count else { throw URLError(.badServerResponse) }
            try database.write { db in
                for (mutation, outcome) in zip(batch, outcomes) {
                    try SyncStore.record(outcome, for: mutation, db)
                }
            }
            report.pushed += outcomes.count(where: { if case .applied = $0 { true } else { false } })
            if outcomes.allSatisfy({ if case .applied = $0 { false } else { true } }) { break }
        }

        var cursor = try database.read { try SyncStore.cursor($0) }
        while true {
            let page = try await transport.pull(cursor: cursor)
            try database.write { db in
                for change in page.changes {
                    do {
                        try SyncStore.apply(change, db)
                    } catch StoreError.activeWorkoutExists {
                        continue
                    }
                }
                try SyncStore.setCursor(page.cursor, db)
            }
            report.pulled += page.changes.count
            cursor = page.cursor
            if !page.hasMore { break }
        }

        (report.conflicts, report.pending) = try database.read { db in
            (try SyncStore.conflicts(db).count, try SyncStore.pendingCount(db))
        }
        return report
    }
}
