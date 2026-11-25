import Domain
import Persistence
import SwiftUI

struct TemplateEditorView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @AppStorage(SettingsKey.massUnit) private var unit: MassUnit = .localeDefault

    private let original: WorkoutTemplate
    private let isNew: Bool
    private let defaultRest: Int
    @State private var draft: WorkoutTemplate
    @State private var catalog: [UUID: Exercise] = [:]
    @State private var invalidSets: Set<UUID> = []
    @State private var picking = false
    @State private var reordering = false
    @State private var confirmingDiscard = false

    init(template: WorkoutTemplate, defaultRest: Int) {
        original = template
        isNew = template.name.isEmpty && template.exercises.isEmpty
        self.defaultRest = defaultRest
        _draft = State(initialValue: template)
    }

    private var canSave: Bool {
        !draft.name.trimmingCharacters(in: .whitespaces).isEmpty && invalidSets.isEmpty && (isNew || draft != original)
    }

    var body: some View {
        List {
            Section {
                TextField("Template name, e.g. Push", text: $draft.name)
                    .font(.title.weight(.bold))
                    .foregroundStyle(Theme.ink)
                TextField("Notes", text: Binding(get: { draft.notes ?? "" }, set: { draft.notes = $0.isEmpty ? nil : $0 }), axis: .vertical)
                    .foregroundStyle(Theme.secondaryInk)
            }
            .notebookListRow()

            ForEach($draft.exercises) { $exercise in
                exerciseSection($exercise)
            }

            Section {
                Button { picking = true } label: {
                    Label("Add exercises", systemImage: "plus").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.secondary)
                .listRowBackground(Theme.background)
                .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .environment(\.defaultMinListRowHeight, 0)
        .notebookBackground()
        .notebookNavigation()
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(isNew ? "New template" : "Edit template")
        .navigationBarTitleDisplayMode(.inline)
        .interactiveDismissDisabled(draft != original)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") {
                    if draft != original { confirmingDiscard = true } else { dismiss() }
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save", action: save).disabled(!canSave)
            }
            if draft.exercises.count > 1 {
                ToolbarItem(placement: .secondaryAction) {
                    Button("Reorder exercises") { reordering = true }
                }
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { hideKeyboard() }
            }
        }
        .task {
            catalog = (try? app.database.read { try ExerciseStore.catalog($0) }) ?? [:]
        }
        .sheet(isPresented: $picking) {
            NavigationStack {
                ExerciseLibraryView(mode: .pick { exercises in
                    draft.exercises += exercises.map { TemplateExercise(exerciseId: $0.id, restSeconds: defaultRest) }
                })
            }
        }
        .sheet(isPresented: $reordering) {
            ReorderSheet(title: "Reorder", items: draft.exercises.map { ($0.id, name($0.exerciseId)) }) { ids in
                draft.exercises.sort { (ids.firstIndex(of: $0.id) ?? 0) < (ids.firstIndex(of: $1.id) ?? 0) }
            }
        }
        .confirmationDialog("Discard changes?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("Discard changes", role: .destructive) { dismiss() }
        }
    }

    private func name(_ id: UUID) -> String { catalog[id]?.name ?? "Exercise" }

    @ViewBuilder
    private func exerciseSection(_ exercise: Binding<TemplateExercise>) -> some View {
        let exerciseId = exercise.wrappedValue.id
        let measurement = catalog[exercise.wrappedValue.exerciseId]?.measurement ?? .bodyweight
        Section {
            TextField("Exercise notes", text: Binding(
                get: { exercise.wrappedValue.notes ?? "" },
                set: { exercise.wrappedValue.notes = $0.isEmpty ? nil : $0 }
            ), axis: .vertical)
            .font(.subheadline)
            .foregroundStyle(Theme.secondaryInk)
            .notebookListRow()

            TemplateSetHeader(measurement: measurement, unit: unit)
                .listRowInsets(EdgeInsets(top: Spacing.s, leading: Spacing.page, bottom: 2, trailing: Spacing.page))
                .listRowBackground(Theme.background)
                .listRowSeparator(.hidden)

            ForEach(Array(exercise.wrappedValue.sets.enumerated()), id: \.element.id) { index, _ in
                TemplateSetRow(
                    set: exercise.sets[index],
                    number: workingNumber(exercise.wrappedValue.sets, index),
                    measurement: measurement,
                    unit: unit,
                    onValidity: { setId, valid in
                        if valid { invalidSets.remove(setId) } else { invalidSets.insert(setId) }
                    }
                )
                .listRowInsets(EdgeInsets(top: 3, leading: Spacing.page, bottom: 3, trailing: Spacing.page))
                .listRowBackground(Theme.background)
                .listRowSeparator(.hidden)
                .swipeActions {
                    Button("Delete", role: .destructive) {
                        let removed = exercise.wrappedValue.sets[index].id
                        invalidSets.remove(removed)
                        exercise.wrappedValue.sets.remove(at: index)
                    }
                }
            }

            Button {
                let last = exercise.wrappedValue.sets.last
                exercise.wrappedValue.sets.append(TemplateSet(type: last?.type ?? .working, targetReps: last?.targetReps, targetLoad: last?.targetLoad))
            } label: {
                Label("Add set", systemImage: "plus").font(.subheadline.weight(.medium)).frame(maxWidth: .infinity, minHeight: 40)
            }
            .buttonStyle(.secondary)
            .listRowBackground(Theme.background)
            .listRowSeparator(.hidden)
        } header: {
            HStack {
                Text(name(exercise.wrappedValue.exerciseId))
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
                Spacer()
                Menu {
                    Picker("Rest timer", selection: exercise.restSeconds) {
                        Text("Off").tag(Int?.none)
                        ForEach(RestOptions.seconds, id: \.self) { Text(Format.clock($0)).tag(Int?.some($0)) }
                    }
                    Button("Remove exercise", role: .destructive) {
                        draft.exercises.removeAll { $0.id == exerciseId }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: exercise.wrappedValue.restSeconds == nil ? "timer.slash" : "timer")
                        Text(RestOptions.label(exercise.wrappedValue.restSeconds)).font(.metric(.footnote, weight: .medium))
                        Image(systemName: "ellipsis")
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.secondaryInk)
                    .padding(.horizontal, Spacing.s)
                    .frame(minHeight: 32)
                    .background(Theme.surface, in: .capsule)
                    .frame(minHeight: 44)
                }
                .accessibilityLabel("Options for \(name(exercise.wrappedValue.exerciseId)), rest \(RestOptions.label(exercise.wrappedValue.restSeconds))")
            }
            .textCase(nil)
        }
    }

    private func save() {
        let template = draft
        if app.perform({ try TemplateStore.save(template, $0) }) != nil {
            dismiss()
        }
    }
}

/// "W" for warm-ups, otherwise the working-set number.
func workingNumber<S>(_ sets: [S], _ index: Int, type: (S) -> SetType) -> String {
    if type(sets[index]) == .warmup { return "W" }
    return "\(sets[..<index].filter { type($0) == .working }.count + 1)"
}

private func workingNumber(_ sets: [TemplateSet], _ index: Int) -> String {
    workingNumber(sets, index, type: \.type)
}

private struct TemplateSetHeader: View {
    let measurement: ExerciseMeasurement
    let unit: MassUnit

    var body: some View {
        HStack(spacing: Spacing.xs) {
            Text("Set").frame(width: 40)
            Text("Target reps").frame(maxWidth: .infinity)
            if let label = measurement.loadLabel {
                Text("\(label) (\(unit.symbol))").frame(width: 110)
            }
        }
        .textCase(.uppercase)
        .font(.caption2.weight(.semibold))
        .tracking(0.6)
        .foregroundStyle(Theme.tertiaryInk)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .accessibilityHidden(true)
    }
}

private struct TemplateSetRow: View {
    @Binding var set: TemplateSet
    let number: String
    let measurement: ExerciseMeasurement
    let unit: MassUnit
    let onValidity: (UUID, Bool) -> Void

    @State private var minText = ""
    @State private var maxText = ""
    @State private var loadText = ""

    private var repsValid: Bool {
        let min = NumberInput.integer(minText)
        let max = NumberInput.integer(maxText)
        switch (minText.isEmpty, maxText.isEmpty) {
        case (true, true): return true
        case (false, true): return min.flatMap(RepTarget.exactly) != nil
        case (true, false): return false
        case (false, false): return min.flatMap { lo in max.flatMap { RepTarget(min: lo, max: $0) } } != nil
        }
    }

    private var loadValid: Bool {
        loadText.isEmpty || (NumberInput.decimal(loadText).map { $0 >= 0 } ?? false)
    }

    var body: some View {
        HStack(spacing: Spacing.xs) {
            Button {
                set.type = set.type == .warmup ? .working : .warmup
            } label: {
                Text(number)
                    .font(.body.monospacedDigit().weight(.semibold))
                    .foregroundStyle(set.type == .warmup ? Theme.warmup : Theme.ink)
                    .frame(width: 40, height: 40)
                    .background(Theme.field, in: .rect(cornerRadius: Radius.field))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(set.type == .warmup ? "Warm-up set" : "Working set \(number)")
            .accessibilityHint("Switches between warm-up and working set")

            HStack(spacing: 4) {
                SetField(text: $minText, prompt: "8", keyboard: .numberPad, accessibilityLabel: "Minimum reps", invalid: !repsValid)
                Text("to").font(.caption).foregroundStyle(Theme.tertiaryInk)
                SetField(text: $maxText, prompt: "-", keyboard: .numberPad, accessibilityLabel: "Maximum reps, optional", invalid: !repsValid)
            }
            .frame(maxWidth: .infinity)

            if measurement.tracksLoad {
                SetField(text: $loadText, prompt: "-", keyboard: .decimalPad, accessibilityLabel: "Target \(measurement.loadLabel ?? "load") in \(unit.symbol), optional", invalid: !loadValid)
                    .frame(width: 110)
            }
        }
        .onAppear {
            minText = set.targetReps.map { "\($0.min)" } ?? ""
            maxText = set.targetReps.flatMap { $0.isExact ? nil : "\($0.max)" } ?? ""
            loadText = NumberInput.text(set.targetLoad, unit: unit)
        }
        .onChange(of: minText) { commit() }
        .onChange(of: maxText) { commit() }
        .onChange(of: loadText) { commit() }
    }

    private func commit() {
        let min = NumberInput.integer(minText)
        let max = maxText.isEmpty ? min : NumberInput.integer(maxText)
        set.targetReps = min.flatMap { lo in max.flatMap { RepTarget(min: lo, max: $0) } }
        // Only rewrite the load when the text actually changed, so an untouched 60 kg target
        // isn't converted into a rounded pound value just by opening the editor.
        if measurement.tracksLoad, loadText != NumberInput.text(set.targetLoad, unit: unit) {
            set.targetLoad = NumberInput.decimal(loadText).flatMap { $0 >= 0 ? RecordedMass($0, unit) : nil }
        }
        onValidity(set.id, repsValid && loadValid)
    }
}

@MainActor
func hideKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}
