import Persistence
import SwiftUI

/// Account, sync status and conflict resolution, shown at the top of Settings.
struct AccountSection: View {
    @Environment(AccountModel.self) private var account
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingSignOut = false
    @State private var confirmingDelete = false
    @State private var deleteError: String?

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 2) {
                Text(account.credentials?.displayName ?? "Signed in").foregroundStyle(Theme.ink)
                if let email = account.credentials?.email {
                    Text(email).font(.footnote).foregroundStyle(Theme.secondaryInk)
                }
            }
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(statusTitle).foregroundStyle(Theme.ink)
                    if let error = account.status.error {
                        Text(error).font(.caption).foregroundStyle(Theme.secondaryInk)
                    }
                }
                Spacer()
                if account.status.isSyncing {
                    ProgressView()
                } else {
                    Button("Sync now") { Task { await account.syncNow() } }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                }
            }
            if !account.status.conflicts.isEmpty {
                NavigationLink {
                    ConflictsView()
                } label: {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.warmup)
                        Text("\(account.status.conflicts.count) change\(account.status.conflicts.count == 1 ? "" : "s") need your choice")
                            .foregroundStyle(Theme.ink)
                    }
                }
            }
            Button("Sign out") {
                if account.status.pending > 0 { confirmingSignOut = true } else { Task { await account.signOut() } }
            }
            .foregroundStyle(Theme.ink)
            Button("Delete account", role: .destructive) { confirmingDelete = true }
        } header: {
            SectionLabel("Account")
        } footer: {
            Text("Synced with the Setbook web app. Changes made offline upload when you're back online.")
        }
        .confirmationDialog("Sign out with unsynced changes?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("Sync, then sign out") {
                Task {
                    await account.syncNow()
                    if account.status.pending == 0 { await account.signOut() } else { confirmingSignOut = true }
                }
            }
            Button("Sign out and discard them", role: .destructive) { Task { await account.signOut() } }
        } message: {
            Text("\(account.status.pending) change\(account.status.pending == 1 ? " hasn't" : "s haven't") reached the server. Signing out removes this account's data from this phone.")
        }
        .confirmationDialog("Delete your account?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete account and all data", role: .destructive) {
                Task {
                    do {
                        try await account.deleteAccount()
                    } catch {
                        deleteError = error.localizedDescription
                    }
                }
            }
        } message: {
            Text("Permanently deletes every workout, template and weigh-in from the server and this phone. Export a backup first if you want one.")
        }
        .alert("Couldn't delete account", isPresented: Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(deleteError ?? "")
        }
    }

    private var statusTitle: String {
        let status = account.status
        if status.isSyncing { return "Syncing" }
        if status.pending > 0 { return "\(status.pending) change\(status.pending == 1 ? "" : "s") waiting to sync" }
        if let last = status.lastSyncedAt { return "Synced \(last.formatted(.relative(presentation: .named)))" }
        return "Not synced yet"
    }
}

struct ConflictsView: View {
    @Environment(AccountModel.self) private var account

    var body: some View {
        List {
            Section {
                ForEach(account.status.conflicts) { conflict in
                    VStack(alignment: .leading, spacing: Spacing.s) {
                        Text(conflict.title).font(.headline).foregroundStyle(Theme.ink)
                        Text(explanation(conflict)).font(.footnote).foregroundStyle(Theme.secondaryInk)
                        HStack(spacing: Spacing.s) {
                            Button("Keep this phone's") { account.resolve(conflict, keepLocal: true) }
                                .buttonStyle(.pill)
                                .disabled(conflict.reason == "rejected")
                            Button(conflict.reason == "rejected" ? "Discard change" : "Use the other version") {
                                account.resolve(conflict, keepLocal: false)
                            }
                            .buttonStyle(.quietPill)
                        }
                    }
                    .padding(.vertical, Spacing.xs)
                }
            } footer: {
                Text("Nothing is merged automatically. Your choice replaces the other copy everywhere.")
            }
        }
        .notebookBackground()
        .notebookNavigation()
        .navigationTitle("Sync conflicts")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func explanation(_ conflict: SyncConflict) -> String {
        switch conflict.reason {
        case "active_exists": "A workout was started on another device while this one was in progress."
        case "rejected": "The server refused this change: \(conflict.message ?? "it was invalid")."
        default: "This changed on another device after this phone last synced."
        }
    }
}
