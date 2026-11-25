import Foundation
import Persistence
import Sync

enum APIError: LocalizedError, Equatable {
    case signedOut
    case server(status: Int, code: String, message: String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .signedOut: "Your session ended. Sign in again to keep syncing."
        case .server(_, _, let message): message
        case .invalidResponse: "The server sent an unexpected response."
        }
    }
}

struct APIUser: Decodable, Sendable {
    let id: String
    let displayName: String?
    let email: String?
}

private struct TokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Double
    let user: APIUser
}

/// Talks to the Setbook API. Attaches the access token, refreshes it once on expiry
/// (single-flight, so parallel requests never race to rotate), and persists rotated tokens.
actor APIClient: SyncTransport {
    let origin: URL
    private var credentials: StoredCredentials?
    private var refreshing: Task<StoredCredentials, Error>?
    private let session: URLSession
    private let onSignedOut: @Sendable () async -> Void

    init(origin: URL, credentials: StoredCredentials?, onSignedOut: @escaping @Sendable () async -> Void) {
        self.origin = origin
        self.credentials = credentials
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration)
        self.onSignedOut = onSignedOut
    }

    // MARK: Sign-in

    func exchange(code: String, verifier: String) async throws -> StoredCredentials {
        try await adopt(post("/v1/auth/exchange", ["code": code, "verifier": verifier]))
    }

    func devSignIn(name: String) async throws -> StoredCredentials {
        try await adopt(post("/v1/auth/dev", ["name": name]))
    }

    func signOut() async {
        if let refresh = credentials?.refreshToken {
            _ = try? await post("/v1/auth/logout", ["refreshToken": refresh])
        }
        credentials = nil
    }

    func deleteAccount() async throws {
        _ = try await authorized("DELETE", "/v1/me", body: nil)
        credentials = nil
    }

    // MARK: SyncTransport

    func push(_ mutations: [OutgoingMutation]) async throws -> [MutationOutcome] {
        let payload: [[String: Any]] = try mutations.map { m in
            var item: [String: Any] = ["mutationId": m.mutationId, "entity": m.entity.rawValue, "id": m.id, "baseRevision": m.baseRevision, "deleted": m.deleted]
            if let body = m.body { item["body"] = try JSONSerialization.jsonObject(with: body) }
            return item
        }
        let data = try await authorized("POST", "/v1/sync/push", body: try JSONSerialization.data(withJSONObject: ["mutations": payload]))
        guard let results = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["results"] as? [[String: Any]] else {
            throw APIError.invalidResponse
        }
        return try results.map { result in
            switch result["status"] as? String {
            case "applied":
                guard let revision = result["revision"] as? Int else { throw APIError.invalidResponse }
                return .applied(revision: revision)
            case "conflict":
                return .conflict(reason: result["reason"] as? String ?? "stale", server: try record(result["current"]))
            case "rejected":
                let error = result["error"] as? [String: Any]
                return .rejected(message: error?["message"] as? String ?? "The server rejected this change.")
            default:
                throw APIError.invalidResponse
            }
        }
    }

    func pull(cursor: Int) async throws -> (changes: [RemoteChange], cursor: Int, hasMore: Bool) {
        let data = try await authorized("GET", "/v1/sync/pull?cursor=\(cursor)", body: nil)
        guard let page = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let changes = page["changes"] as? [[String: Any]],
              let next = page["cursor"] as? Int else { throw APIError.invalidResponse }
        let parsed: [RemoteChange] = try changes.compactMap { change in
            guard let entity = (change["entity"] as? String).flatMap(SyncEntity.init(rawValue:)),
                  let id = change["id"] as? String,
                  let stored = try record(change) else { return nil }
            return RemoteChange(entity: entity, id: id, record: stored)
        }
        return (parsed, next, page["hasMore"] as? Bool ?? false)
    }

    // MARK: Plumbing

    private func record(_ value: Any?) throws -> RemoteRecord? {
        guard let dict = value as? [String: Any], let revision = dict["revision"] as? Int else { return nil }
        let body: Data? = try (dict["body"]).flatMap { $0 is NSNull ? nil : try JSONSerialization.data(withJSONObject: $0) }
        return RemoteRecord(revision: revision, deleted: dict["deleted"] as? Bool ?? false, body: body)
    }

    private func adopt(_ data: Data) throws -> StoredCredentials {
        let response = try JSONDecoder().decode(TokenResponse.self, from: data)
        let stored = StoredCredentials(
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            accessExpiresAt: Date().addingTimeInterval(response.expiresIn - 30),
            userId: response.user.id,
            displayName: response.user.displayName,
            email: response.user.email
        )
        credentials = stored
        KeychainTokenStore.save(stored)
        return stored
    }

    private func authorized(_ method: String, _ path: String, body: Data?) async throws -> Data {
        var current = try await validCredentials()
        do {
            return try await send(method, path, body: body, token: current.accessToken)
        } catch APIError.server(status: 401, _, _) {
            current = try await refresh(from: current)
            return try await send(method, path, body: body, token: current.accessToken)
        }
    }

    private func validCredentials() async throws -> StoredCredentials {
        guard let credentials else { throw APIError.signedOut }
        if credentials.accessExpiresAt > Date() { return credentials }
        return try await refresh(from: credentials)
    }

    private func refresh(from stale: StoredCredentials) async throws -> StoredCredentials {
        if let refreshing { return try await refreshing.value }
        let task = Task { () throws -> StoredCredentials in
            do {
                let data = try await post("/v1/auth/refresh", ["refreshToken": stale.refreshToken])
                return try adopt(data)
            } catch APIError.server(status: 401, _, _) {
                credentials = nil
                KeychainTokenStore.delete()
                await onSignedOut()
                throw APIError.signedOut
            }
        }
        refreshing = task
        defer { refreshing = nil }
        return try await task.value
    }

    private func post(_ path: String, _ json: [String: String]) async throws -> Data {
        try await send("POST", path, body: try JSONSerialization.data(withJSONObject: json), token: nil)
    }

    private func send(_ method: String, _ path: String, body: Data?, token: String?) async throws -> Data {
        guard let url = URL(string: path, relativeTo: origin) else { throw APIError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "content-type") }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let error = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? [String: Any]
            throw APIError.server(status: http.statusCode, code: error?["code"] as? String ?? "http_\(http.statusCode)",
                                  message: error?["message"] as? String ?? "The server returned an error (\(http.statusCode)).")
        }
        return data
    }
}
