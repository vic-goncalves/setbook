import SwiftUI

enum AppTab: Hashable {
    case train, history, progress
}

struct RootView: View {
    @Environment(AppModel.self) private var app
    @State private var tab: AppTab = .train
    @State private var showingSettings = false

    var body: some View {
        @Bindable var app = app
        TabView(selection: $tab) {
            Tab("Train", systemImage: "dumbbell.fill", value: .train) {
                NavigationStack { TrainView().chrome(settings: settingsButton) }
            }
            Tab("History", systemImage: "calendar", value: .history) {
                NavigationStack { HistoryView().chrome(settings: settingsButton) }
                    .safeAreaInset(edge: .bottom) { ActiveWorkoutBar() }
            }
            Tab("Progress", systemImage: "chart.line.uptrend.xyaxis", value: .progress) {
                NavigationStack { ProgressHomeView().chrome(settings: settingsButton) }
                    .safeAreaInset(edge: .bottom) { ActiveWorkoutBar() }
            }
        }
        .tint(Theme.ink)
        .sheet(isPresented: $showingSettings) { SettingsView() }
        .fullScreenCover(isPresented: $app.isWorkoutPresented, onDismiss: app.workoutCoverDismissed) {
            if let workout = app.activeWorkout {
                NavigationStack {
                    WorkoutView(controller: workout, onEnd: app.endActiveWorkout)
                }
            }
        }
        .alert("Something went wrong", isPresented: Binding(
            get: { app.errorMessage != nil },
            set: { if !$0 { app.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(app.errorMessage ?? "")
        }
    }

    private var settingsButton: some View {
        Button { showingSettings = true } label: {
            Image(systemName: "gearshape")
        }
        .accessibilityLabel("Settings")
    }
}

private extension View {
    /// Tab roots draw their own large header, so the bar stays empty except for Settings.
    func chrome(settings: some View) -> some View {
        self
            .navigationBarTitleDisplayMode(.inline)
            .notebookNavigation()
            .toolbar { ToolbarItem(placement: .topBarTrailing) { settings } }
    }
}
