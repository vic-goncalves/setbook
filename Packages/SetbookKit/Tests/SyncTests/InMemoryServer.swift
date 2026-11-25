import Foundation
import Persistence
@testable import Sync

/// Mirrors the Worker's push/pull semantics: per-record revisions, stale-base conflicts,
/// one active workout, idempotent mutation IDs and an ordered change log.
actor InMemoryServer {
    struct Stored { var revision: Int; var deleted: Bool; var body: Data? }

    private(set) var records: [String: Stored] = [:]
    private var log: [(seq: Int, key: String)] = []
    private var applied: [String: MutationOutcome] = [:]
    private var seq = 0

    private func key(_ entity: SyncEntity, _ id: String) -> String { "\(entity.rawValue)/\(id.uppercased())" }

    func push(_ mutations: [OutgoingMutation]) -> [MutationOutcome] {
        mutations.map { m in
            if let previous = applied[m.mutationId] { return previous }
            let k = key(m.entity, m.id)
            let current = records[k]
            guard m.baseRevision == (current?.revision ?? 0) else {
                return .conflict(reason: "stale", server: current.map { RemoteRecord(revision: $0.revision, deleted: $0.deleted, body: $0.body) })
            }
            if m.entity == .session, !m.deleted, let body = m.body, isActive(body),
               let other = records.first(where: { $0.key.hasPrefix("session/") && $0.key != k && !$0.value.deleted && $0.value.body.map(isActive) == true }) {
                return .conflict(reason: "active_exists", server: RemoteRecord(revision: other.value.revision, deleted: false, body: other.value.body))
            }
            let revision = (current?.revision ?? 0) + 1
            records[k] = Stored(revision: revision, deleted: m.deleted, body: m.deleted ? nil : m.body)
            seq += 1
            log.append((seq, k))
            let outcome = MutationOutcome.applied(revision: revision)
            applied[m.mutationId] = outcome
            return outcome
        }
    }

    func pull(cursor: Int, limit: Int = 500) -> (changes: [RemoteChange], cursor: Int, hasMore: Bool) {
        var latest: [String: Int] = [:]
        for entry in log where entry.seq > cursor { latest[entry.key] = entry.seq }
        let ordered = latest.sorted { $0.value < $1.value }.prefix(limit)
        let changes = ordered.compactMap { k, _ -> RemoteChange? in
            let parts = k.split(separator: "/")
            guard let entity = SyncEntity(rawValue: String(parts[0])), let stored = records[k] else { return nil }
            return RemoteChange(entity: entity, id: String(parts[1]), record: RemoteRecord(revision: stored.revision, deleted: stored.deleted, body: stored.body))
        }
        return (changes, ordered.last?.value ?? cursor, ordered.count == limit)
    }

    private func isActive(_ body: Data) -> Bool {
        (try? JSONSerialization.jsonObject(with: body) as? [String: Any])?["state"] as? String == "active"
    }
}

/// A transport over the in-memory server that can simulate a lost response: the server
/// applies the push, but the device never hears back.
final class TestTransport: SyncTransport, @unchecked Sendable {
    let server: InMemoryServer
    var dropNextPushResponse = false
    var offline = false
    private(set) var pushCount = 0

    init(_ server: InMemoryServer) { self.server = server }

    func push(_ mutations: [OutgoingMutation]) async throws -> [MutationOutcome] {
        if offline { throw URLError(.notConnectedToInternet) }
        pushCount += 1
        let outcomes = await server.push(mutations)
        if dropNextPushResponse {
            dropNextPushResponse = false
            throw URLError(.networkConnectionLost)
        }
        return outcomes
    }

    func pull(cursor: Int) async throws -> (changes: [RemoteChange], cursor: Int, hasMore: Bool) {
        if offline { throw URLError(.notConnectedToInternet) }
        return await server.pull(cursor: cursor)
    }
}
