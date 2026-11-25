import Domain
import Persistence
import SwiftUI
import Workflow

struct WorkoutDetailView: View {
    let sessionId: UUID

    var body: some View {
        Live(key: sessionId.uuidString) { [sessionId] in try SessionStore.fetch(sessionId, $0) } content: { session in
            // Nil only after a delete, while this screen is popping; show nothing rather than
            // flashing a "deleted" state on the way out.
            if let session {
                WorkoutDetail(session: session)
            } else {
                Theme.background
            }
        }
        .background(Theme.background)
        .navigationBarTitleDisplayMode(.inline)
        .notebookNavigation()
    }
}

private struct WorkoutDetail: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @AppStorage(SettingsKey.massUnit) private var unit: MassUnit = .localeDefault
    let session: WorkoutSession

    @State private var editor: WorkoutController?
    @State private var confirmingDelete = false
    @State private var namingTemplate = false
    @State private var templateName = ""
    @State private var savedTemplate = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Eyebrow(dateLine)
                    Text(session.name)
                        .font(.largeTitle.weight(.bold))
                        .tracking(-0.5)
                        .foregroundStyle(Theme.ink)
                }

                HStack(alignment: .top) {
                    Stat(value: session.duration.map(Format.stopwatch) ?? "-", label: "Duration")
                    Spacer()
                    Stat(value: "\(session.completedWorkingSetCount)", label: "Working sets")
                    Spacer()
                    Stat(value: "\(session.exercises.count)", label: "Exercises")
                }
                .padding(Spacing.m)
                .background(Theme.surface, in: .rect(cornerRadius: Radius.card))
                .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Theme.hairline))

                if let notes = session.notes {
                    Text(notes).font(.subheadline).foregroundStyle(Theme.secondaryInk)
                }

                ForEach(session.exercises) { exercise in
                    exerciseBlock(exercise)
                }
            }
            .padding(.horizontal, Spacing.page)
            .padding(.bottom, Spacing.xxl)
        }
        .scrollIndicators(.hidden)
        .safeAreaInset(edge: .bottom) {
            if app.activeWorkout == nil {
                Button { repeatWorkout() } label: { Label("Repeat workout", systemImage: "arrow.clockwise") }
                    .buttonStyle(.primary)
                    .padding(.horizontal, Spacing.page)
                    .padding(.vertical, Spacing.s)
                    .background(Theme.background)
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { editor = app.makeController(session, mode: .editingCompleted) } label: { Label("Edit workout", systemImage: "pencil") }
                    Button {
                        templateName = session.name
                        namingTemplate = true
                    } label: { Label("Save as template", systemImage: "square.and.arrow.down") }
                    Button(role: .destructive) { confirmingDelete = true } label: { Label("Delete", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("Workout actions")
            }
        }
        .sheet(item: Binding(get: { editor.map(IdentifiedController.init) }, set: { editor = $0?.controller })) { identified in
            NavigationStack {
                WorkoutView(controller: identified.controller, onEnd: { editor = nil })
            }
        }
        .confirmationDialog("Delete this workout?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete workout", role: .destructive) {
                let id = session.id
                dismiss()
                app.perform { try SessionStore.delete(id, $0) }
            }
        } message: {
            Text("It will be removed from your history and charts. This can't be undone.")
        }
        .alert("Save as template", isPresented: $namingTemplate) {
            TextField("Template name", text: $templateName)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                let template = WorkoutTemplate(savingFrom: WorkoutSession.repeating(session, exercises: [:]), name: templateName)
                if app.perform({ try TemplateStore.save(template, $0) }) != nil { savedTemplate = true }
            }
        } message: {
            Text("Uses this workout's exercises, with your logged sets as the targets.")
        }
        .alert("Template saved", isPresented: $savedTemplate) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Find it on the Train tab.")
        }
    }

    private func exerciseBlock(_ exercise: WorkoutExercise) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(exercise.exerciseName)
                .font(.headline)
                .foregroundStyle(Theme.ink)
            if let notes = exercise.notes {
                Text(notes).font(.footnote).foregroundStyle(Theme.secondaryInk)
            }
            VStack(spacing: 0) {
                ForEach(Array(exercise.sets.enumerated()), id: \.element.id) { index, set in
                    let number = workingNumber(exercise.sets, index, type: \.type)
                    HStack(spacing: Spacing.m) {
                        Text(number)
                            .font(.metric(.subheadline))
                            .foregroundStyle(set.type == .warmup ? Theme.warmup : Theme.tertiaryInk)
                            .frame(width: 24, alignment: .leading)
                        Text(setText(set, exercise.measurement))
                            .font(.metric(.body, weight: .medium))
                            .foregroundStyle(set.type == .warmup ? Theme.secondaryInk : Theme.ink)
                        Spacer()
                        if let rir = set.rir {
                            Text("RIR \(rir)").font(.caption).foregroundStyle(Theme.secondaryInk)
                        }
                    }
                    .padding(.vertical, 7)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(set.type == .warmup ? "Warm-up" : "Set \(number)"), \(setText(set, exercise.measurement).replacingOccurrences(of: " x ", with: " times "))")
                }
            }
            .padding(.horizontal, Spacing.m)
            .padding(.vertical, Spacing.xs)
            .background(Theme.surface, in: .rect(cornerRadius: Radius.control))
        }
    }

    private var dateLine: String {
        var style = Date.FormatStyle(date: .complete, time: .shortened)
        style.timeZone = TimeZone(identifier: session.timeZoneIdentifier) ?? .current
        return session.startedAt.formatted(style)
    }

    private func setText(_ set: WorkoutSet, _ measurement: ExerciseMeasurement) -> String {
        guard let reps = set.reps else { return "-" }
        guard let load = set.load else { return "\(reps) reps" }
        let mass = Format.mass(load, in: unit)
        return switch measurement {
        case .weightedBodyweight: "+\(mass) x \(reps)"
        case .assistedBodyweight: "\(mass) assist x \(reps)"
        case .externalLoad(.perHand): "\(mass)/hand x \(reps)"
        default: "\(mass) x \(reps)"
        }
    }

    private func repeatWorkout() {
        let past = session
        app.startWorkout { db in
            WorkoutSession.repeating(past, exercises: try ExerciseStore.catalog(db))
        }
    }
}

private struct IdentifiedController: Identifiable {
    var id: ObjectIdentifier { ObjectIdentifier(controller) }
    let controller: WorkoutController
}
