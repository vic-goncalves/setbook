import Domain
import GRDB
import Observation
import Persistence
import SwiftUI
import Workflow

@MainActor
@Observable
final class AppModel {
    let database: AppDatabase
    var errorMessage: String?
    /// The single in-progress workout, restored from the store at launch.
    private(set) var activeWorkout: WorkoutController?
    var isWorkoutPresented = false
    private var workoutEnded = false
    let timerHost: RestTimerHost

    init(database: AppDatabase, timerHost: RestTimerHost = NotificationRestTimerHost()) {
        self.database = database
        self.timerHost = timerHost
        if let session = try? database.read({ try SessionStore.fetchActive($0) }) {
            activeWorkout = makeController(session, mode: .active)
        }
    }

    func makeController(_ session: WorkoutSession, mode: WorkoutController.Mode) -> WorkoutController {
        WorkoutController(session: session, mode: mode, database: database, timerHost: timerHost, describeError: Self.describe)
    }

    /// Runs a write and surfaces failures as a dismissible alert instead of throwing into views.
    @discardableResult
    func perform<T: Sendable>(_ write: @Sendable (Database) throws -> T) -> T? {
        do {
            return try database.write(write)
        } catch {
            errorMessage = Self.describe(error)
            return nil
        }
    }

    func startWorkout(_ build: @Sendable (Database) throws -> WorkoutSession) {
        guard activeWorkout == nil else {
            errorMessage = Self.describe(StoreError.activeWorkoutExists)
            return
        }
        guard let session = perform({ db -> WorkoutSession in
            let session = try build(db)
            try SessionStore.start(session, db)
            return session
        }) else { return }
        activeWorkout = makeController(session, mode: .active)
        isWorkoutPresented = true
    }

    /// Re-reads the active workout after a bulk change such as import or erase.
    func reloadActiveWorkout() {
        isWorkoutPresented = false
        activeWorkout = (try? database.read { try SessionStore.fetchActive($0) }).flatMap { $0 }.map { makeController($0, mode: .active) }
        if activeWorkout == nil { timerHost.persist(nil) }
    }

    /// Closes the workout screen. The controller is released only after the cover has
    /// finished animating away (`workoutCoverDismissed`), so the screen never goes blank mid-dismiss.
    func endActiveWorkout() {
        workoutEnded = true
        isWorkoutPresented = false
    }

    func workoutCoverDismissed() {
        guard workoutEnded else { return }
        workoutEnded = false
        activeWorkout = nil
    }

    static func describe(_ error: Error) -> String {
        switch error {
        case StoreError.activeWorkoutExists: "Finish or discard your current workout first."
        case StoreError.invalidRecord(let reason): reason
        case StoreError.notFound: "That item no longer exists."
        case BackupError.unsupportedVersion: "This backup was made by a newer version of Setbook."
        case BackupError.unreadable: "This file isn't a Setbook backup."
        default: error.localizedDescription
        }
    }
}
