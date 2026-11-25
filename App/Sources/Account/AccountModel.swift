import Foundation
import Observation
import Persistence
import Sync
import Workflow

struct SyncStatus: Equatable {
    var isSyncing = false
    var lastSyncedAt: Date?
    var pending = 0
    var conflicts: [SyncConflict] = []
    var error: String?
}

/// Signed-in state, the account's local database, and background sync.
@MainActor
@Observable
final class AccountModel {
    enum State {
        case signedOut
        case signedIn(AppModel)
    }

    private(set) var state: State = .signedOut
    private(set) var credentials: StoredCredentials?
    private(set) var status = SyncStatus()
    var signInError: String?
    var isSigningIn = false

    let origin: URL
    private var client: APIClient?
    private var engine: SyncEngine?
    private var watchers: [Task<Void, Never>] = []
    private var scheduled: Task<Void, Never>?
    private let googleSignIn = GoogleSignIn()

    /// Batches edits: a burst of set completions becomes one push a few seconds later.
    private static let syncDelay: Duration = .seconds(8)

    init(origin: URL) {
        self.origin = origin
        if let stored = KeychainTokenStore.load() {
            open(stored)
        }
        #if DEBUG
        // Simulator end-to-end checks: `-devSignIn <name>` signs in against a local server,
        // `-devSeed` fills the account with sample data (which then syncs up).
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "-devSignIn"), index + 1 < arguments.count, credentials == nil {
            let name = arguments[index + 1]
            let seed = arguments.contains("-devSeed")
            Task {
                await devSignIn(name: name)
                if seed, let app {
                    app.perform { try DemoData.seed($0) }
                    scheduleSync(after: .zero)
                }
            }
        }
        #endif
    }

    var app: AppModel? {
        if case .signedIn(let app) = state { app } else { nil }
    }

    // MARK: Sign-in

    func signInWithGoogle() async {
        signInError = nil
        isSigningIn = true
        defer { isSigningIn = false }
        do {
            let result = try await googleSignIn.start(origin: origin)
            let client = makeClient(credentials: nil)
            open(try await client.exchange(code: result.code, verifier: result.verifier))
        } catch GoogleSignIn.Failure.cancelled {
            return
        } catch {
            signInError = error.localizedDescription
        }
    }

    func devSignIn(name: String) async {
        signInError = nil
        isSigningIn = true
        defer { isSigningIn = false }
        do {
            open(try await makeClient(credentials: nil).devSignIn(name: name))
        } catch {
            signInError = error.localizedDescription
        }
    }

    /// Signs out and removes this account's data from the phone. Callers warn first when
    /// changes haven't synced.
    func signOut() async {
        await client?.signOut()
        closeAccount(deleteLocalData: true)
    }

    func deleteAccount() async throws {
        try await client?.deleteAccount()
        closeAccount(deleteLocalData: true)
    }

    // MARK: Sync

    func syncNow() async {
        guard let engine, !status.isSyncing else { return }
        status.isSyncing = true
        defer { status.isSyncing = false }
        do {
            let report = try await engine.sync()
            status.lastSyncedAt = Date()
            status.error = nil
            status.pending = report.pending
        } catch APIError.signedOut {
            status.error = APIError.signedOut.errorDescription
        } catch let error as URLError where [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost].contains(error.code) {
            status.error = "Offline. Changes are saved on this phone and will sync later."
        } catch {
            status.error = error.localizedDescription
        }
        refreshConflicts()
    }

    func scheduleSync(after delay: Duration = AccountModel.syncDelay) {
        scheduled?.cancel()
        scheduled = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await self?.syncNow()
        }
    }

    func resolve(_ conflict: SyncConflict, keepLocal: Bool) {
        guard let app else { return }
        let entity = conflict.entity
        let id = conflict.entityId
        app.perform { db in
            if keepLocal { try SyncStore.keepLocal(entity, id, db) } else { try SyncStore.useServer(entity, id, db) }
        }
        app.reloadActiveWorkout()
        refreshConflicts()
        scheduleSync(after: .zero)
    }

    // MARK: Internals

    private func makeClient(credentials: StoredCredentials?) -> APIClient {
        let client = APIClient(origin: origin, credentials: credentials) { [weak self] in
            await self?.sessionEnded()
        }
        self.client = client
        return client
    }

    private func open(_ stored: StoredCredentials) {
        do {
            let database = try Self.openDatabase(for: stored.userId)
            let client = client ?? makeClient(credentials: stored)
            if self.client !== client { self.client = client }
            credentials = stored
            engine = SyncEngine(database: database, transport: client)
            state = .signedIn(AppModel(database: database))
            watch(database)
            scheduleSync(after: .zero)
        } catch {
            signInError = "Couldn't open your training log: \(error.localizedDescription)"
        }
    }

    /// Re-queues everything when the refresh token stops working, so nothing is lost; the
    /// data stays on the phone until the user signs in again.
    private func sessionEnded() {
        status.error = APIError.signedOut.errorDescription
        signInError = "Your session ended. Sign in again; your data on this phone is safe."
        closeAccount(deleteLocalData: false)
    }

    private func closeAccount(deleteLocalData: Bool) {
        watchers.forEach { $0.cancel() }
        watchers = []
        scheduled?.cancel()
        let userId = credentials?.userId
        state = .signedOut
        engine = nil
        client = nil
        credentials = nil
        status = SyncStatus()
        KeychainTokenStore.delete()
        NotificationRestTimerHost().persist(nil)
        if deleteLocalData, let userId {
            let url = Self.databaseURL(for: userId)
            for suffix in ["", "-wal", "-shm"] {
                try? FileManager.default.removeItem(at: URL(fileURLWithPath: url.path + suffix))
            }
        }
    }

    private func watch(_ database: AppDatabase) {
        watchers.forEach { $0.cancel() }
        watchers = [
            Task { [weak self] in
                do {
                    for try await pending in database.observe({ try SyncStore.pendingCount($0) }) {
                        guard let self else { return }
                        self.status.pending = pending
                        if pending > 0 { self.scheduleSync() }
                    }
                } catch {}
            },
            Task { [weak self] in
                do {
                    for try await conflicts in database.observe({ try SyncStore.conflicts($0) }) {
                        self?.status.conflicts = conflicts
                    }
                } catch {}
            },
        ]
    }

    private func refreshConflicts() {
        guard let app else { return }
        status.conflicts = (try? app.database.read { try SyncStore.conflicts($0) }) ?? []
    }

    static func databaseURL(for userId: String) -> URL {
        URL.applicationSupportDirectory.appending(path: "Setbook/accounts/\(userId.lowercased()).sqlite")
    }

    /// Opens the account's own database. A log created before accounts existed is adopted by
    /// the first account that signs in, and queued so it uploads.
    static func openDatabase(for userId: String) throws -> AppDatabase {
        let url = databaseURL(for: userId)
        let legacy = AppDatabase.defaultURL
        var adopted = false
        if !FileManager.default.fileExists(atPath: url.path), FileManager.default.fileExists(atPath: legacy.path) {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            for suffix in ["", "-wal", "-shm"] where FileManager.default.fileExists(atPath: legacy.path + suffix) {
                try FileManager.default.moveItem(atPath: legacy.path + suffix, toPath: url.path + suffix)
            }
            adopted = true
        }
        let database = try AppDatabase.onDisk(at: url)
        if adopted {
            try database.write { try SyncStore.enqueueAll($0) }
        }
        return database
    }
}
