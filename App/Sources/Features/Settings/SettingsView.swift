import Domain
import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage(SettingsKey.massUnit) private var unit: MassUnit = .localeDefault
    @AppStorage(SettingsKey.defaultRestSeconds) private var defaultRest = 90
    @AppStorage(SettingsKey.restAlertsEnabled) private var alertsEnabled = false
    @State private var alertsDenied = false
    @Environment(AccountModel.self) private var account: AccountModel?

    var body: some View {
        NavigationStack {
            Form {
                if account != nil {
                    AccountSection()
                }

                Section {
                    Picker("Weight unit", selection: $unit) {
                        Text("Pounds (lb)").tag(MassUnit.pounds)
                        Text("Kilograms (kg)").tag(MassUnit.kilograms)
                    }
                } header: {
                    SectionLabel("Units")
                } footer: {
                    Text("Changes how weights are shown and the default for new entries. Past entries keep the unit they were logged in.")
                }

                Section {
                    Picker("Default rest", selection: $defaultRest) {
                        ForEach(RestOptions.seconds, id: \.self) { seconds in
                            Text(Format.clock(seconds)).tag(seconds)
                        }
                    }
                    Toggle("Alert when rest ends", isOn: Binding(get: { alertsEnabled }, set: { enabled in
                        guard enabled else { alertsEnabled = false; return }
                        Task {
                            let granted = await NotificationRestTimerHost.requestAuthorization()
                            alertsEnabled = granted
                            alertsDenied = !granted
                        }
                    }))
                    .tint(Theme.done)
                } header: {
                    SectionLabel("Rest timer")
                } footer: {
                    Text(alertsDenied
                         ? "Notifications are off for Setbook. Turn them on in iOS Settings to get rest alerts while the app is in the background."
                         : "Default rest applies to exercises you add. Each exercise can change it or turn it off.")
                }

                DataSection()

                Section {
                    LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "-")
                } footer: {
                    Text("Your training log is stored on this iPhone and synced to your Setbook account.")
                }
            }
            .notebookBackground()
            .notebookNavigation()
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}
