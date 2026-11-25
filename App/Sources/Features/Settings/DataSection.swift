import GRDB
import Persistence
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Backup, export and erase. All data lives on this phone, so these are the user's only copies
/// outside an iCloud device backup.
struct DataSection: View {
    @Environment(AppModel.self) private var app
    @State private var sharing: [URL] = []
    @State private var importing = false
    @State private var pendingImport: BackupDocument?
    @State private var importResult: String?
    @State private var confirmingErase = false
    @State private var confirmingEraseAgain = false

    var body: some View {
        Section {
            Group {
            Button("Export backup (JSON)") { export { [stamp] db, folder in
                let url = folder.appending(path: "setbook-backup-\(stamp).json")
                try Backup.encode(try Backup.document(db)).write(to: url)
                return [url]
            } }
            Button("Export spreadsheets (CSV)") { export { [stamp] db, folder in
                let sets = folder.appending(path: "setbook-sets-\(stamp).csv")
                let weight = folder.appending(path: "setbook-body-weight-\(stamp).csv")
                try CSVExport.sets(db).write(to: sets, atomically: true, encoding: .utf8)
                try CSVExport.bodyWeight(db).write(to: weight, atomically: true, encoding: .utf8)
                return [sets, weight]
            } }
            Button("Import backup") { importing = true }
            }
            .foregroundStyle(Theme.ink)
            Button("Erase all training data", role: .destructive) { confirmingErase = true }
        } header: {
            SectionLabel("Your data")
        } footer: {
            Text("Backups use the same format as the web app's export. Importing restores records by ID, so importing the same file twice doesn't create duplicates.")
        }
        .sheet(isPresented: Binding(get: { !sharing.isEmpty }, set: { if !$0 { sharing = [] } })) {
            ShareSheet(items: sharing).ignoresSafeArea()
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            do {
                let url = try result.get()
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                pendingImport = try Backup.decode(Data(contentsOf: url))
            } catch {
                app.errorMessage = AppModel.describe(error)
            }
        }
        .confirmationDialog(
            "Import this backup?",
            isPresented: Binding(get: { pendingImport != nil }, set: { if !$0 { pendingImport = nil } }),
            titleVisibility: .visible
        ) {
            Button("Import") { runImport() }
        } message: {
            if let document = pendingImport {
                Text("\(document.sessions.count) workouts, \(document.templates.count) templates, \(document.bodyMeasurements.count) weigh-ins and \(document.customExercises.count) custom exercises from \(Format.day(document.exportedAt)). Matching records on this phone are replaced by the backup's version.")
            }
        }
        .alert("Import finished", isPresented: Binding(get: { importResult != nil }, set: { if !$0 { importResult = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(importResult ?? "")
        }
        .confirmationDialog("Erase all data?", isPresented: $confirmingErase, titleVisibility: .visible) {
            Button("Erase all data", role: .destructive) { confirmingEraseAgain = true }
        } message: {
            Text("Deletes every workout, template, weigh-in and custom exercise, here and on every device you've signed in to. Export a backup first if you might want them.")
        }
        .alert("This can't be undone", isPresented: $confirmingEraseAgain) {
            Button("Cancel", role: .cancel) {}
            Button("Erase", role: .destructive) {
                app.perform { try Backup.eraseAll($0) }
                app.reloadActiveWorkout()
            }
        }
    }

    private var stamp: String {
        Date().formatted(.iso8601.year().month().day())
    }

    private func export(_ write: @escaping @Sendable (Database, URL) throws -> [URL]) {
        let folder = URL.temporaryDirectory.appending(path: "export-\(UUID().uuidString)")
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            sharing = try app.database.read { try write($0, folder) }
        } catch {
            app.errorMessage = AppModel.describe(error)
        }
    }

    private func runImport() {
        guard let document = pendingImport else { return }
        pendingImport = nil
        guard let summary = app.perform({ try Backup.restore(document, $0) }) else { return }
        app.reloadActiveWorkout()
        var message = "Restored \(summary.sessions) workouts, \(summary.templates) templates, \(summary.bodyMeasurements) weigh-ins and \(summary.exercises) custom exercises."
        if summary.skippedActiveWorkout {
            message += " The backup's in-progress workout was skipped because one is already in progress here."
        }
        importResult = message
    }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let items: [URL]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
