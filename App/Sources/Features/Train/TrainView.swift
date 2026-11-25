import Domain
import Persistence
import SwiftUI
import Workflow

struct TrainView: View {
    var body: some View {
        Live { db in (try TemplateStore.fetchSummaries(db), try ExerciseStore.catalog(db)) } content: { templates, catalog in
            TrainContent(templates: templates, catalog: catalog)
        }
        .background(Theme.background)
    }
}

private struct TrainContent: View {
    @Environment(AppModel.self) private var app
    @AppStorage(SettingsKey.defaultRestSeconds) private var defaultRest = TemplateExercise.defaultRestSeconds
    let templates: [TemplateSummary]
    let catalog: [UUID: Exercise]

    @State private var editing: WorkoutTemplate?
    @State private var deleting: WorkoutTemplate?
    @State private var reordering = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                PageHeader(eyebrow: Date().formatted(.dateTime.weekday(.wide).month(.abbreviated).day()), title: "Train")

                if let workout = app.activeWorkout {
                    ActiveWorkoutCard(workout: workout) { app.isWorkoutPresented = true }
                } else {
                    Button { app.startWorkout { _ in .empty() } } label: {
                        Label("Start empty workout", systemImage: "plus")
                    }
                    .buttonStyle(.primary)
                }

                VStack(alignment: .leading, spacing: Spacing.s) {
                    SectionHeader(title: "Templates") {
                        HStack(spacing: Spacing.m) {
                            if templates.count > 1 {
                                Button("Reorder") { reordering = true }
                            }
                            Button { editing = WorkoutTemplate(name: "") } label: {
                                Label("New", systemImage: "plus")
                            }
                        }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    }

                    if templates.isEmpty {
                        Card {
                            EmptyState(
                                symbol: "list.bullet.rectangle",
                                title: "Save the routines you repeat",
                                message: "A template like Push or Legs starts with one tap and shows what you lifted last time.",
                                actionTitle: "Create template",
                                action: { editing = WorkoutTemplate(name: "") }
                            )
                        }
                    }

                    ForEach(templates) { summary in
                        TemplateCard(
                            summary: summary,
                            catalog: catalog,
                            canStart: app.activeWorkout == nil,
                            onStart: { start(summary.template) },
                            onEdit: { editing = summary.template },
                            onDuplicate: {
                                let copy = summary.template.duplicated()
                                app.perform { try TemplateStore.save(copy, $0) }
                            },
                            onDelete: { deleting = summary.template }
                        )
                    }
                }
            }
            .padding(.horizontal, Spacing.page)
            .padding(.bottom, Spacing.xxl)
            .animation(.snappy(duration: 0.35), value: templates.map(\.id))
            .animation(.snappy(duration: 0.35), value: app.activeWorkout == nil)
        }
        .scrollIndicators(.hidden)
        .sheet(item: $editing) { template in
            NavigationStack { TemplateEditorView(template: template, defaultRest: defaultRest) }
        }
        .sheet(isPresented: $reordering) {
            ReorderSheet(title: "Reorder templates", items: templates.map { ($0.id, $0.template.name) }) { ids in
                app.perform { try TemplateStore.reorder(ids, $0) }
            }
        }
        .confirmationDialog(
            "Delete \(deleting?.name ?? "template")?",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete template", role: .destructive) {
                if let id = deleting?.id { app.perform { try TemplateStore.delete(id, $0) } }
                deleting = nil
            }
        } message: {
            Text("Past workouts started from it stay in your history.")
        }
    }

    private func start(_ template: WorkoutTemplate) {
        app.startWorkout { db in
            WorkoutSession.starting(from: template, exercises: try ExerciseStore.catalog(db))
        }
    }
}

/// Large page title with a quiet eyebrow above it. Replaces the system large title, which
/// collides with toolbar buttons on scroll.
struct PageHeader: View {
    let eyebrow: String?
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            if let eyebrow { Eyebrow(eyebrow) }
            Text(title)
                .font(.largeTitle.weight(.bold))
                .tracking(-0.5)
                .foregroundStyle(Theme.ink)
                .accessibilityAddTraits(.isHeader)
        }
        .padding(.top, Spacing.xs)
    }
}

private struct TemplateCard: View {
    let summary: TemplateSummary
    let catalog: [UUID: Exercise]
    let canStart: Bool
    let onStart: () -> Void
    let onEdit: () -> Void
    let onDuplicate: () -> Void
    let onDelete: () -> Void

    private var template: WorkoutTemplate { summary.template }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.s) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(template.name)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Theme.ink)
                        Text(meta)
                            .font(.footnote)
                            .foregroundStyle(Theme.secondaryInk)
                    }
                    Spacer()
                    Menu {
                        Button(action: onEdit) { Label("Edit", systemImage: "pencil") }
                        Button(action: onDuplicate) { Label("Duplicate", systemImage: "plus.square.on.square") }
                        Button(role: .destructive, action: onDelete) { Label("Delete", systemImage: "trash") }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Theme.secondaryInk)
                            .frame(width: 44, height: 44)
                            .contentShape(.rect)
                    }
                    .accessibilityLabel("\(template.name) options")
                    .padding(.top, -10)
                    .padding(.trailing, -10)
                }

                if !template.exercises.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        ForEach(template.exercises.prefix(4)) { exercise in
                            HStack(spacing: Spacing.xs) {
                                Text("\(exercise.sets.count)")
                                    .font(.metric(.footnote))
                                    .foregroundStyle(Theme.tertiaryInk)
                                    .frame(minWidth: 16, alignment: .trailing)
                                Text(catalog[exercise.exerciseId]?.name ?? "Exercise")
                                    .font(.subheadline)
                                    .foregroundStyle(Theme.secondaryInk)
                                    .lineLimit(1)
                            }
                        }
                        if template.exercises.count > 4 {
                            Text("+\(template.exercises.count - 4) more")
                                .font(.footnote)
                                .foregroundStyle(Theme.tertiaryInk)
                                .padding(.leading, 24)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }

                HStack {
                    Spacer()
                    Button(action: onStart) {
                        Label("Start", systemImage: "play.fill").labelStyle(.titleAndIcon)
                    }
                    .buttonStyle(.pill)
                    .disabled(!canStart)
                    .opacity(canStart ? 1 : 0.4)
                    .accessibilityLabel("Start \(template.name)")
                }
            }
        }
        .contentShape(.rect(cornerRadius: Radius.card))
        .onTapGesture(perform: onEdit)
        .contextMenu {
            Button(action: onStart) { Label("Start", systemImage: "play") }.disabled(!canStart)
            Button(action: onEdit) { Label("Edit", systemImage: "pencil") }
            Button(action: onDuplicate) { Label("Duplicate", systemImage: "plus.square.on.square") }
            Button(role: .destructive, action: onDelete) { Label("Delete", systemImage: "trash") }
        }
    }

    private var meta: String {
        let count = template.exerciseCount
        let exercises = "\(count) exercise\(count == 1 ? "" : "s")"
        guard let last = summary.lastPerformedAt else { return "\(exercises), not done yet" }
        return "\(exercises), last \(Format.relativeDay(last, midSentence: true))"
    }
}

private struct ActiveWorkoutCard: View {
    let workout: WorkoutController
    let onResume: () -> Void

    var body: some View {
        Button(action: onResume) {
            VStack(alignment: .leading, spacing: Spacing.m) {
                HStack(spacing: 6) {
                    Circle().fill(Theme.done).frame(width: 7, height: 7)
                    Eyebrow("In progress", color: Theme.done)
                }
                HStack(alignment: .lastTextBaseline) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(workout.session.name)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Theme.ink)
                        Text("\(workout.session.completedSetCount) of \(workout.session.completedSetCount + workout.session.incompleteSetCount) sets done")
                            .font(.footnote)
                            .foregroundStyle(Theme.secondaryInk)
                    }
                    Spacer()
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(Format.stopwatch(context.date.timeIntervalSince(workout.session.startedAt)))
                            .font(.metric(.title))
                            .foregroundStyle(Theme.ink)
                    }
                }
                Text("Resume workout")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .foregroundStyle(Theme.onPrimary)
                    .background(Theme.primaryFill, in: .rect(cornerRadius: Radius.control))
            }
            .padding(Spacing.m)
            .background(Theme.surface, in: .rect(cornerRadius: Radius.card))
            .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Theme.done.opacity(0.35)))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Workout in progress, \(workout.session.name), \(workout.session.completedSetCount) sets done")
        .accessibilityHint("Opens the workout")
    }
}
