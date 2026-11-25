#if DEBUG
import Domain
import Foundation
import GRDB
import Persistence

/// Realistic sample history for previews and simulator screenshots. Only reachable from
/// DEBUG builds launched with `-demo`, always into an in-memory store.
enum DemoData {
    static func id(_ slug: String) -> UUID { ExerciseCatalog.builtInID(slug: slug) }

    static func seed(_ db: Database, now: Date = Date()) throws {
        let push = WorkoutTemplate(name: "Push", notes: "Chest, shoulders, triceps", exercises: [
            TemplateExercise(exerciseId: id("barbell-bench-press"), restSeconds: 150, sets: [
                TemplateSet(type: .warmup, targetReps: .exactly(10), targetLoad: RecordedMass(95, .pounds)),
                TemplateSet(targetReps: RepTarget(min: 5, max: 8), targetLoad: RecordedMass(185, .pounds)),
                TemplateSet(targetReps: RepTarget(min: 5, max: 8), targetLoad: RecordedMass(185, .pounds)),
                TemplateSet(targetReps: RepTarget(min: 5, max: 8), targetLoad: RecordedMass(185, .pounds)),
            ]),
            TemplateExercise(exerciseId: id("dumbbell-shoulder-press"), sets: [
                TemplateSet(targetReps: RepTarget(min: 8, max: 12)), TemplateSet(targetReps: RepTarget(min: 8, max: 12)),
            ]),
            TemplateExercise(exerciseId: id("weighted-dip"), sets: [TemplateSet(targetReps: .exactly(8)), TemplateSet(targetReps: .exactly(8))]),
            TemplateExercise(exerciseId: id("triceps-pushdown"), restSeconds: 60, sets: [TemplateSet(targetReps: .exactly(12)), TemplateSet(targetReps: .exactly(12))]),
        ])
        let pull = WorkoutTemplate(name: "Pull", exercises: [
            TemplateExercise(exerciseId: id("barbell-deadlift"), restSeconds: 180, sets: [TemplateSet(targetReps: .exactly(5)), TemplateSet(targetReps: .exactly(5))]),
            TemplateExercise(exerciseId: id("assisted-pull-up"), sets: [TemplateSet(targetReps: .exactly(8)), TemplateSet(targetReps: .exactly(8))]),
            TemplateExercise(exerciseId: id("seated-cable-row"), sets: [TemplateSet(targetReps: RepTarget(min: 10, max: 12))]),
        ])
        let legs = WorkoutTemplate(name: "Legs", exercises: [
            TemplateExercise(exerciseId: id("barbell-back-squat"), restSeconds: 180, sets: [TemplateSet(targetReps: .exactly(5)), TemplateSet(targetReps: .exactly(5)), TemplateSet(targetReps: .exactly(5))]),
            TemplateExercise(exerciseId: id("romanian-deadlift"), sets: [TemplateSet(targetReps: .exactly(8)), TemplateSet(targetReps: .exactly(8))]),
        ])
        for template in [push, pull, legs] { try TemplateStore.save(template, db, now: now) }
        let catalog = try ExerciseStore.catalog(db)

        let calendar = Calendar.current
        for week in 0..<14 {
            let progress = Double(week)
            for (offset, template) in [(0, push), (2, pull), (4, legs)].map({ ($0.0, $0.1) }) {
                guard let start = calendar.date(byAdding: .day, value: -((13 - week) * 7) + offset - 6, to: now),
                      start < now.addingTimeInterval(-3600) else { continue }
                var session = WorkoutSession.starting(from: template, exercises: catalog, now: start.addingTimeInterval(17 * 3600))
                for e in session.exercises.indices {
                    let base: Double = switch session.exercises[e].measurement {
                    case .externalLoad(.perHand): 40 + progress * 1.25
                    case .weightedBodyweight: 10 + (progress / 2).rounded(.down) * 5
                    case .assistedBodyweight: max(10, 70 - progress * 4)
                    default: 155 + progress * 2.5 + Double(e == 0 && template.name == "Legs" ? 60 : 0) + Double(template.name == "Pull" && e == 0 ? 90 : 0)
                    }
                    for s in session.exercises[e].sets.indices {
                        let warmup = session.exercises[e].sets[s].type == .warmup
                        let load = warmup ? (base * 0.5).rounded() : (base / 5).rounded() * 5
                        session.exercises[e].sets[s].load = session.exercises[e].measurement.tracksLoad ? RecordedMass(load, .pounds) : nil
                        session.exercises[e].sets[s].reps = warmup ? 10 : max(3, 8 - s % 3 + (week % 3 == 0 ? 1 : 0))
                        session.exercises[e].sets[s].completedAt = start.addingTimeInterval(17 * 3600 + Double(e * 600 + s * 150))
                    }
                }
                if let finished = session.finished(at: start.addingTimeInterval(17 * 3600 + 3900)) {
                    try SessionStore.save(finished, db)
                }
            }
        }

        var weight = 184.0
        for day in stride(from: 90, through: 0, by: -1) where day % 3 != 1 {
            guard let date = calendar.date(byAdding: .day, value: -day, to: now) else { continue }
            weight += Double((day * 7919) % 11 - 5) * 0.12 - 0.04
            let morning = calendar.date(bySettingHour: 7, minute: 10, second: 0, of: date) ?? date
            try MeasurementStore.save(BodyMeasurement(mass: RecordedMass((weight * 10).rounded() / 10, .pounds), measuredAt: morning), db)
        }
    }

    /// An in-progress Push workout with a few sets done, for the logging screen.
    static func startWorkout(_ db: Database, now: Date = Date()) throws -> WorkoutSession {
        guard let push = try TemplateStore.fetchAll(db).first(where: { $0.name == "Push" }) else { throw StoreError.notFound }
        var session = WorkoutSession.starting(from: push, exercises: try ExerciseStore.catalog(db), now: now.addingTimeInterval(-1260))
        session.exercises[0].sets[0].load = RecordedMass(95, .pounds)
        session.exercises[0].sets[0].reps = 10
        session.exercises[0].sets[0].completedAt = now.addingTimeInterval(-900)
        session.exercises[0].sets[1].load = RecordedMass(190, .pounds)
        session.exercises[0].sets[1].reps = 8
        session.exercises[0].sets[1].completedAt = now.addingTimeInterval(-60)
        try SessionStore.start(session, db)
        return session
    }
}
#endif

#if DEBUG
import SwiftUI

/// Opens one screen directly for simulator screenshots: `-demo -demoScreen bench`.
struct DemoScreen: View {
    @Environment(AppModel.self) private var app
    let name: String

    var body: some View {
        NavigationStack {
            switch name {
            case "history": HistoryView()
            case "historyDetail":
                Live { try SessionStore.fetchCompletedSummaries($0).first?.id } content: { id in
                    if let id { WorkoutDetailView(sessionId: id) }
                }
            case "progress": ProgressHomeView()
            case "bench": ExerciseDetailView(exercise: exercise("barbell-bench-press"))
            case "assisted": ExerciseDetailView(exercise: exercise("assisted-pull-up"))
            case "pullup": ExerciseDetailView(exercise: exercise("pull-up"))
            case "bodyWeight": BodyWeightView()
            case "templateEditor":
                Live { try TemplateStore.fetchAll($0).first } content: { template in
                    if let template { TemplateEditorView(template: template, defaultRest: 90) }
                }
            case "library": ExerciseLibraryView()
            case "settings": SettingsView()
            default: Text("Unknown demo screen \(name)")
            }
        }
    }

    private func exercise(_ slug: String) -> Exercise {
        ExerciseCatalog.all.first { $0.id == DemoData.id(slug) } ?? ExerciseCatalog.all[0]
    }
}
#endif
