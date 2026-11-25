import Persistence
import Workflow
import SwiftUI

@main
struct SetbookApp: App {
    @State private var launch = Launch.start()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                switch launch {
                case .account(let account):
                    AccountRoot(account: account)
                case .local(let app):
                    localRoot(app)
                case .failed(let message):
                    StorageFailureView(message: message)
                }
            }
            .tint(Theme.ink)
            .preferredColorScheme(.dark)
        }
        .onChange(of: scenePhase) {
            if scenePhase == .active, case .account(let account) = launch { account.scheduleSync(after: .zero) }
        }
    }

    @ViewBuilder
    private func localRoot(_ app: AppModel) -> some View {
        Group {
            #if DEBUG
            if let screen = demoScreen {
                DemoScreen(name: screen)
            } else {
                RootView()
            }
            #else
            RootView()
            #endif
        }
        .environment(app)
    }
}

private struct AccountRoot: View {
    let account: AccountModel

    var body: some View {
        Group {
            if let app = account.app {
                RootView().environment(app)
            } else {
                SignInView()
            }
        }
        .environment(account)
    }
}

#if DEBUG
private var demoScreen: String? {
    let arguments = ProcessInfo.processInfo.arguments
    guard let index = arguments.firstIndex(of: "-demoScreen"), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}
#endif

enum Launch {
    /// Normal use: signed-in accounts with sync.
    case account(AccountModel)
    /// UI tests and demo data: an in-memory log with no account or network.
    case local(AppModel)
    case failed(String)

    @MainActor
    static func start() -> Launch {
        do {
            let arguments = ProcessInfo.processInfo.arguments
            if arguments.contains("-uiTesting") {
                return .local(AppModel(database: try AppDatabase.inMemory(), timerHost: InMemoryRestTimerHost()))
            }
            #if DEBUG
            if arguments.contains("-demo") {
                let database = try AppDatabase.inMemory()
                try database.write { try DemoData.seed($0) }
                if arguments.contains("-demoWorkout") {
                    try database.write { _ = try DemoData.startWorkout($0) }
                }
                let timer = arguments.contains("-demoWorkout") ? RestTimer(endsAt: Date().addingTimeInterval(87), duration: 150) : nil
                let model = AppModel(database: database, timerHost: InMemoryRestTimerHost(timer))
                model.isWorkoutPresented = arguments.contains("-demoWorkout")
                return .local(model)
            }
            #endif
            return .account(AccountModel(origin: apiOrigin(arguments)))
        } catch {
            return .failed(String(describing: error))
        }
    }

    /// The API from Info.plist (set by SETBOOK_API_ORIGIN in project.yml), overridable with
    /// `-apiOrigin http://localhost:8787` for local development.
    static func apiOrigin(_ arguments: [String]) -> URL {
        if let index = arguments.firstIndex(of: "-apiOrigin"), index + 1 < arguments.count, let url = URL(string: arguments[index + 1]) {
            return url
        }
        let configured = Bundle.main.object(forInfoDictionaryKey: "SetbookAPIOrigin") as? String
        return URL(string: configured ?? "") ?? URL(fileURLWithPath: "/", isDirectory: true)
    }
}

/// Shown instead of crashing if the store cannot open, so the data file is never touched.
private struct StorageFailureView: View {
    let message: String

    var body: some View {
        EmptyState(
            symbol: "externaldrive.badge.exclamationmark",
            title: "Your training log couldn't be opened",
            message: "Nothing has been deleted. Try reopening the app.\n\n\(message)"
        )
        .frame(maxHeight: .infinity)
        .background(Theme.background)
    }
}
