import Domain
import Persistence
import SwiftUI
import Workflow

enum SetFieldID: Hashable {
    case load(UUID)
    case reps(UUID)
}

/// Logs an active workout, or edits a finished one from history.
struct WorkoutView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
    @AppStorage(SettingsKey.massUnit) private var unit: MassUnit = .localeDefault
    @AppStorage(SettingsKey.defaultRestSeconds) private var defaultRest = TemplateExercise.defaultRestSeconds

    @Bindable var controller: WorkoutController
    /// Called after a history edit is saved, or after an active workout is finished or discarded.
    var onEnd: () -> Void = {}

    @FocusState private var focus: SetFieldID?
    @State private var picking = false
    @State private var reordering = false
    @State private var removingExercise: Int?
    @State private var confirmingIncomplete = false
    @State private var confirmingNothingDone = false
    @State private var confirmingDiscard = false
    @State private var finishPlan: WorkoutController.FinishPlan?
    @State private var nameText = ""
    @State private var rejectedSet: UUID?
    /// Set when the finish sheet saved; the workout closes once that sheet is fully gone,
    /// so two dismissals never animate on top of each other.
    @State private var endAfterSheet = false

    private var session: WorkoutSession { controller.session }

    private var isActive: Bool { controller.mode == .active }

    var body: some View {
        withDialogs(withSheets(list))
    }

    private var list: some View {
        List {
            header
            ForEach(Array(session.exercises.enumerated()), id: \.element.id) { index, exercise in
                exerciseBlock(index: index, exercise: exercise)
            }
            footer
        }
        .listStyle(.plain)
        .listSectionSpacing(0)
        .environment(\.defaultMinListRowHeight, 0)
        .notebookBackground()
        .scrollDismissesKeyboard(.interactively)
        .navigationBarTitleDisplayMode(.inline)
        .notebookNavigation()
        .toolbar { toolbar }
        .safeAreaInset(edge: .bottom) {
            if isActive, let timer = controller.restTimer, focus == nil {
                RestTimerCapsule(timer: timer, controller: controller)
                    .padding(.horizontal, Spacing.page)
                    .padding(.bottom, Spacing.xs)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: controller.restTimer == nil)
        .sensoryFeedback(trigger: session.completedSetCount) { old, new in new > old ? .success : nil }
        .onAppear { nameText = session.name }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            TextField("Workout name", text: $nameText)
                .font(.title.weight(.bold))
                .tracking(-0.4)
                .foregroundStyle(Theme.ink)
                .submitLabel(.done)
                .onSubmit { controller.rename(nameText) }
                .onChange(of: focus) { controller.rename(nameText) }

            if isActive {
                ProgressSummary(done: session.completedSetCount, total: session.completedSetCount + session.incompleteSetCount)
            } else {
                VStack(spacing: 0) {
                    DatePicker("Started", selection: Binding(get: { session.startedAt }, set: { controller.setStart($0) }))
                    Hairline().padding(.vertical, Spacing.xs)
                    DatePicker("Finished", selection: Binding(get: { session.finishedAt ?? session.startedAt }, set: { controller.setFinish($0) }), in: session.startedAt...)
                }
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryInk)
                .padding(Spacing.s)
                .background(Theme.surface, in: .rect(cornerRadius: Radius.control))
            }

            TextField("Add a note", text: Binding(get: { session.notes ?? "" }, set: { controller.setWorkoutNotes($0) }), axis: .vertical)
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryInk)
        }
        .padding(.top, Spacing.xs)
        .padding(.bottom, Spacing.m)
        .plainRow()
    }

    // MARK: Exercise

    @ViewBuilder
    private func exerciseBlock(index: Int, exercise: WorkoutExercise) -> some View {
        Section {
            exerciseHeader(index: index, exercise: exercise)
                .padding(.top, Spacing.l)
                .plainRow()

            ColumnHeader(measurement: exercise.measurement, unit: unit)
                .padding(.top, Spacing.s)
                .padding(.bottom, Spacing.xxs)
                .plainRow()

            ForEach(Array(exercise.sets.enumerated()), id: \.element.id) { setIndex, set in
                SetRow(
                    set: set,
                    number: workingNumber(exercise.sets, setIndex, type: \.type),
                    previous: controller.suggestion(exercise: index, set: setIndex).map { Format.set($0, unit: unit) },
                    placeholder: controller.placeholder(exercise: index, set: setIndex),
                    measurement: exercise.measurement,
                    unit: unit,
                    rejected: rejectedSet == set.id,
                    focus: $focus,
                    onLoad: { controller.setLoad($0, exercise: index, set: setIndex) },
                    onReps: { controller.setReps($0, exercise: index, set: setIndex) },
                    onToggleType: { controller.toggleType(exercise: index, set: setIndex) },
                    onComplete: {
                        let ok = controller.toggleComplete(exercise: index, set: setIndex)
                        rejectedSet = ok ? nil : set.id
                        if ok, focus == .load(set.id) || focus == .reps(set.id) { focus = nil }
                    }
                )
                .listRowInsets(EdgeInsets(top: 2, leading: Spacing.page - 8, bottom: 2, trailing: Spacing.page - 8))
                .listRowBackground(
                    RoundedRectangle(cornerRadius: Radius.field)
                        .fill(set.isCompleted ? Theme.doneSoft : Color.clear)
                        .padding(.horizontal, Spacing.page - 12)
                        .padding(.vertical, 1)
                )
                .listRowSeparator(.hidden)
                .swipeActions {
                    Button("Delete", role: .destructive) { controller.removeSet(exercise: index, set: setIndex) }
                }
            }

            Button { controller.addSet(exercise: index) } label: {
                Label("Add set", systemImage: "plus")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.secondaryInk)
                    .frame(maxWidth: .infinity, minHeight: 40)
                    .background(Theme.surface, in: .rect(cornerRadius: Radius.field))
            }
            .buttonStyle(.plain)
            .padding(.top, Spacing.xs)
            .plainRow()
        }
        .listSectionSeparator(.hidden)
    }

    private func exerciseHeader(index: Int, exercise: WorkoutExercise) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            // At accessibility sizes the options chip moves under the name so the name keeps
            // the full width instead of wrapping word by word.
            if typeSize.isAccessibilitySize {
                exerciseTitle(exercise)
                exerciseMenu(index: index, exercise: exercise)
            } else {
                HStack(alignment: .top, spacing: Spacing.s) {
                    exerciseTitle(exercise)
                    Spacer()
                    exerciseMenu(index: index, exercise: exercise)
                }
            }
            if exercise.measurement.loadConvention != .total, exercise.measurement.loadConvention != nil,
               let explanation = exercise.measurement.loadExplanation, controller.previous[exercise.id] == nil {
                Text(explanation).font(.caption).foregroundStyle(Theme.tertiaryInk)
            }
            TextField("Exercise note", text: Binding(
                get: { exercise.notes ?? "" },
                set: { controller.setExerciseNotes($0, exercise: index) }
            ), axis: .vertical)
            .font(.footnote)
            .foregroundStyle(Theme.secondaryInk)
        }
    }

    private func exerciseTitle(_ exercise: WorkoutExercise) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(exercise.exerciseName)
                .font(.headline)
                .foregroundStyle(Theme.ink)
            HStack(spacing: Spacing.xs) {
                if let previous = controller.previous[exercise.id] {
                    Text("Last \(Format.relativeDay(previous.date, midSentence: true))")
                } else {
                    Text("First time")
                }
                if let label = exercise.measurement.loadLabel, exercise.measurement.loadConvention != .total {
                    Text(label)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Theme.raised, in: .capsule)
                }
            }
            .font(.caption)
            .foregroundStyle(Theme.secondaryInk)
        }
    }

    private func exerciseMenu(index: Int, exercise: WorkoutExercise) -> some View {
        Menu {
            if isActive {
                Picker(selection: Binding(get: { exercise.restSeconds }, set: { controller.setRest($0, exercise: index) })) {
                    Text("Off").tag(Int?.none)
                    ForEach(RestOptions.seconds, id: \.self) { Text(Format.clock($0)).tag(Int?.some($0)) }
                } label: {
                    Label("Rest timer", systemImage: "timer")
                }
                .pickerStyle(.menu)
            }
            if session.exercises.count > 1 {
                Button { reordering = true } label: { Label("Reorder exercises", systemImage: "arrow.up.arrow.down") }
            }
            Button(role: .destructive) {
                if exercise.completedSets.isEmpty { controller.removeExercise(at: index) } else { removingExercise = index }
            } label: { Label("Remove exercise", systemImage: "trash") }
        } label: {
            HStack(spacing: 6) {
                if isActive {
                    Image(systemName: exercise.restSeconds == nil ? "timer.slash" : "timer")
                    Text(RestOptions.label(exercise.restSeconds)).font(.metric(.footnote, weight: .medium))
                }
                Image(systemName: "ellipsis")
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.secondaryInk)
            .padding(.horizontal, Spacing.s)
            .frame(minHeight: 32)
            .background(Theme.surface, in: .capsule)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .accessibilityLabel("Options for \(exercise.exerciseName), rest \(RestOptions.label(exercise.restSeconds))")
    }

    // MARK: Footer

    private var footer: some View {
        VStack(spacing: Spacing.m) {
            Button { picking = true } label: {
                Label("Add exercises", systemImage: "plus")
            }
            .buttonStyle(.secondary)
            if isActive {
                Button("Discard workout", role: .destructive) { confirmingDiscard = true }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.destructive)
                    .frame(minHeight: 44)
            }
        }
        .padding(.top, Spacing.xl)
        .padding(.bottom, Spacing.xxl)
        .plainRow()
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if isActive {
            ToolbarItem(placement: .topBarLeading) {
                Button { app.isWorkoutPresented = false } label: { Image(systemName: "chevron.down") }
                    .accessibilityLabel("Minimize workout")
            }
            ToolbarItem(placement: .principal) {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(Format.stopwatch(context.date.timeIntervalSince(session.startedAt)))
                        .font(.metric(.headline))
                        .foregroundStyle(Theme.ink)
                        .accessibilityLabel("Elapsed \(Format.duration(context.date.timeIntervalSince(session.startedAt)))")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Finish", action: requestFinish)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Theme.onPrimary)
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.done)
            }
        } else {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    controller.rename(nameText)
                    if controller.saveCompletedEdit() { onEnd() }
                }
                .fontWeight(.semibold)
            }
        }
        ToolbarItemGroup(placement: .keyboard) {
            Spacer()
            Button("Next") { focus = nextField(after: focus) }
            Button("Done") { focus = nil }.fontWeight(.semibold)
        }
    }

    // MARK: Sheets and dialogs

    private func withSheets(_ content: some View) -> some View {
        content
            .sheet(isPresented: $picking) {
                NavigationStack {
                    ExerciseLibraryView(mode: .pick { controller.addExercises($0, restSeconds: defaultRest) })
                }
            }
            .sheet(isPresented: $reordering) {
                ReorderSheet(title: "Reorder", items: session.exercises.map { ($0.id, $0.exerciseName) }) { ids in
                    controller.reorderExercises(ids)
                }
            }
            .sheet(
                item: Binding(get: { finishPlan.map(IdentifiedPlan.init) }, set: { finishPlan = $0?.plan }),
                onDismiss: {
                    if endAfterSheet { onEnd() }
                }
            ) { identified in
                FinishSheet(plan: identified.plan, unit: unit) { updateTemplate in
                    if controller.finish(identified.plan, updateTemplate: updateTemplate) {
                        endAfterSheet = true
                        finishPlan = nil
                    }
                }
            }
    }

    private func withDialogs(_ content: some View) -> some View {
        content
            .alert("Finish with unfinished sets?", isPresented: $confirmingIncomplete) {
                Button("Keep logging", role: .cancel) {}
                Button("Finish without them") { finishPlan = controller.finishPlan() }
            } message: {
                Text("\(session.incompleteSetCount) set\(session.incompleteSetCount == 1 ? " isn't" : "s aren't") marked done. They won't be saved or counted.")
            }
            .confirmationDialog("No sets completed yet", isPresented: $confirmingNothingDone, titleVisibility: .visible) {
                Button("Keep workout open", role: .cancel) {}
                Button("Discard workout", role: .destructive) { confirmingDiscard = true }
            } message: {
                Text("A workout needs at least one completed set to be saved.")
            }
            .confirmationDialog("Discard this workout?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Discard workout", role: .destructive) {
                    controller.discard()
                    onEnd()
                }
            } message: {
                Text("Everything logged in it will be deleted.")
            }
            .confirmationDialog(
                "Remove \(removingExercise.flatMap { session.exercises.indices.contains($0) ? session.exercises[$0].exerciseName : nil } ?? "exercise")?",
                isPresented: Binding(get: { removingExercise != nil }, set: { if !$0 { removingExercise = nil } }),
                titleVisibility: .visible
            ) {
                Button("Remove exercise", role: .destructive) {
                    if let index = removingExercise { controller.removeExercise(at: index) }
                    removingExercise = nil
                }
            } message: {
                Text("Its sets in this workout, including completed ones, will be removed.")
            }
            .alert("Couldn't save", isPresented: Binding(get: { controller.saveError != nil }, set: { if !$0 { controller.saveError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(controller.saveError ?? "")
            }
    }

    // MARK: Behavior

    private func requestFinish() {
        controller.rename(nameText)
        focus = nil
        if session.completedSetCount == 0 {
            confirmingNothingDone = true
        } else if session.incompleteSetCount > 0 {
            confirmingIncomplete = true
        } else {
            finishPlan = controller.finishPlan()
        }
    }

    /// Weight then reps within a set, then on to the next set and exercise.
    private func nextField(after current: SetFieldID?) -> SetFieldID? {
        let order = session.exercises.flatMap { exercise in
            exercise.sets.flatMap { set -> [SetFieldID] in
                exercise.measurement.tracksLoad ? [.load(set.id), .reps(set.id)] : [.reps(set.id)]
            }
        }
        guard let current, let index = order.firstIndex(of: current), index + 1 < order.count else { return nil }
        return order[index + 1]
    }
}

private struct IdentifiedPlan: Identifiable {
    var id: UUID { plan.finished.id }
    let plan: WorkoutController.FinishPlan
}

private extension View {
    func plainRow() -> some View {
        listRowInsets(EdgeInsets(top: 0, leading: Spacing.page, bottom: 0, trailing: Spacing.page))
            .listRowBackground(Theme.background)
            .listRowSeparator(.hidden)
    }
}

private struct ProgressSummary: View {
    let done: Int
    let total: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("\(done) of \(total) sets")
                    .font(.metric(.footnote, weight: .medium))
                    .foregroundStyle(Theme.secondaryInk)
                Spacer()
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.raised)
                    Capsule().fill(Theme.done)
                        .frame(width: total == 0 ? 0 : proxy.size.width * CGFloat(done) / CGFloat(total))
                }
            }
            .frame(height: 4)
            .animation(.snappy, value: done)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(done) of \(total) sets done")
    }
}

func loadColumnTitle(_ measurement: ExerciseMeasurement, unit: MassUnit) -> String? {
    switch measurement {
    case .externalLoad(.total): unit.symbol
    case .externalLoad(.perHand): "\(unit.symbol)/hand"
    case .weightedBodyweight: "+\(unit.symbol)"
    case .assistedBodyweight: "Assist"
    case .bodyweight: nil
    }
}

/// Column widths that grow with Dynamic Type, capped so the row still fits a phone.
private struct SetColumns {
    @ScaledMetric(relativeTo: .body) private var setRaw: CGFloat = 32
    @ScaledMetric(relativeTo: .body) private var loadRaw: CGFloat = 74
    @ScaledMetric(relativeTo: .body) private var repsRaw: CGFloat = 58
    @ScaledMetric(relativeTo: .body) private var checkRaw: CGFloat = 44

    var set: CGFloat { min(setRaw, 52) }
    var load: CGFloat { min(loadRaw, 104) }
    var reps: CGFloat { min(repsRaw, 80) }
    var check: CGFloat { min(checkRaw, 56) }
}

private struct ColumnHeader: View {
    let measurement: ExerciseMeasurement
    let unit: MassUnit
    private let columns = SetColumns()

    var body: some View {
        HStack(spacing: Spacing.xs) {
            Text("Set").frame(width: columns.set)
            Text("Previous").frame(maxWidth: .infinity, alignment: .leading)
            if let title = loadColumnTitle(measurement, unit: unit) {
                Text(title).frame(width: columns.load)
            }
            Text("Reps").frame(width: columns.reps)
            Color.clear.frame(width: columns.check, height: 1)
        }
        .textCase(.uppercase)
        .font(.caption2.weight(.semibold))
        .tracking(0.6)
        .foregroundStyle(Theme.tertiaryInk)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .padding(.horizontal, -8)
        .accessibilityHidden(true)
    }
}

private struct SetRow: View {
    let set: WorkoutSet
    let number: String
    let previous: String?
    let placeholder: (load: RecordedMass?, reps: Int?)
    let measurement: ExerciseMeasurement
    let unit: MassUnit
    let rejected: Bool
    var focus: FocusState<SetFieldID?>.Binding
    let onLoad: (RecordedMass?) -> Void
    let onReps: (Int?) -> Void
    let onToggleType: () -> Void
    let onComplete: () -> Void

    @State private var loadText = ""
    @State private var repsText = ""
    private let columns = SetColumns()

    var body: some View {
        HStack(spacing: Spacing.xs) {
            Button(action: onToggleType) {
                Text(number)
                    .font(.metric(.subheadline))
                    .foregroundStyle(set.type == .warmup ? Theme.warmup : (set.isCompleted ? Theme.done : Theme.secondaryInk))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(width: columns.set, height: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(set.type == .warmup ? "Warm-up set" : "Set \(number)")
            .accessibilityHint("Switches between warm-up and working set")

            Text(previous ?? "-")
                .font(.metric(.subheadline, weight: .regular))
                .foregroundStyle(Theme.tertiaryInk)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(previous.map { "Previous \($0.replacingOccurrences(of: " x ", with: " times "))" } ?? "No previous")

            if measurement.tracksLoad {
                SetField(
                    text: $loadText,
                    prompt: placeholder.load.map { Format.mass($0, in: unit, withUnit: false) } ?? "",
                    keyboard: .decimalPad,
                    accessibilityLabel: "\(measurement.loadLabel ?? "Weight") in \(unit.symbol)",
                    invalid: rejected && set.load == nil && placeholder.load == nil,
                    completed: set.isCompleted
                )
                .frame(width: columns.load)
                .focused(focus, equals: .load(set.id))
            }

            SetField(
                text: $repsText,
                prompt: placeholder.reps.map(String.init) ?? "",
                keyboard: .numberPad,
                accessibilityLabel: "Reps",
                invalid: rejected && set.reps == nil && placeholder.reps == nil,
                completed: set.isCompleted
            )
            .frame(width: columns.reps)
            .focused(focus, equals: .reps(set.id))

            Button(action: onComplete) {
                ZStack {
                    RoundedRectangle(cornerRadius: 9)
                        .fill(set.isCompleted ? Theme.done : Theme.field)
                        .frame(width: 32, height: 32)
                    Image(systemName: "checkmark")
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(set.isCompleted ? Theme.onPrimary : Theme.tertiaryInk)
                }
                .frame(width: columns.check, height: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(set.isCompleted ? "Completed" : "Mark set done")
            .accessibilityAddTraits(set.isCompleted ? .isSelected : [])
        }
        .onAppear(perform: syncFromModel)
        .onChange(of: set) { syncFromModel() }
        .onChange(of: unit) { loadText = NumberInput.text(set.load, unit: unit) }
        .onChange(of: loadText) {
            guard loadText != NumberInput.text(set.load, unit: unit) else { return }
            if loadText.isEmpty {
                onLoad(nil)
            } else if let value = NumberInput.decimal(loadText), value >= 0 {
                onLoad(RecordedMass(value, unit))
            }
        }
        .onChange(of: repsText) {
            guard NumberInput.integer(repsText) != set.reps else { return }
            if repsText.isEmpty {
                onReps(nil)
            } else if let reps = NumberInput.integer(repsText), reps >= 0 {
                onReps(reps)
            }
        }
    }

    /// Updates the text only when the model differs from what's typed, so half-typed input
    /// like "62." is never clobbered.
    private func syncFromModel() {
        if NumberInput.decimal(loadText) != set.load?.value(in: unit) || (loadText.isEmpty != (set.load == nil)) {
            loadText = NumberInput.text(set.load, unit: unit)
        }
        if NumberInput.integer(repsText) != set.reps {
            repsText = set.reps.map(String.init) ?? ""
        }
    }
}

/// Floating rest countdown. Stays out of the way of the set rows and never blocks logging.
private struct RestTimerCapsule: View {
    let timer: RestTimer
    let controller: WorkoutController

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = timer.remaining(at: context.date)
            let progress = Double(remaining) / Double(max(timer.duration, 1))
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.s) {
                    readout(remaining, progress: progress)
                    Spacer(minLength: 0)
                    controls(remaining)
                }
                VStack(alignment: .leading, spacing: Spacing.s) {
                    readout(remaining, progress: progress)
                    HStack(spacing: Spacing.xs) { controls(remaining) }
                }
            }
            .padding(.leading, Spacing.s)
            .padding(.trailing, Spacing.xs)
            .padding(.vertical, Spacing.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.raised, in: .rect(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Theme.hairline))
            .shadow(color: .black.opacity(0.5), radius: 20, y: 8)
        }
    }

    private func readout(_ remaining: Int, progress: Double) -> some View {
        HStack(spacing: Spacing.s) {
            ZStack {
                Circle().stroke(Theme.field, lineWidth: 3)
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(remaining == 0 ? Theme.done : Theme.ink, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Image(systemName: remaining == 0 ? "checkmark" : "timer")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(remaining == 0 ? Theme.done : Theme.secondaryInk)
            }
            .frame(width: 30, height: 30)
            VStack(alignment: .leading, spacing: 0) {
                Text(remaining == 0 ? "Rest over" : "Rest")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Theme.secondaryInk)
                Text(Format.clock(remaining))
                    .font(.metric(.title3))
                    .foregroundStyle(remaining == 0 ? Theme.done : Theme.ink)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(remaining == 0 ? "Rest over" : "Rest, \(remaining) seconds left")
    }

    @ViewBuilder
    private func controls(_ remaining: Int) -> some View {
        Group {
            Button("-15") { controller.adjustRest(by: -15) }
                .buttonStyle(.quietPill)
                .accessibilityLabel("Subtract 15 seconds")
            Button("+15") { controller.adjustRest(by: 15) }
                .buttonStyle(.quietPill)
                .accessibilityLabel("Add 15 seconds")
            Button(remaining == 0 ? "Done" : "Skip") { controller.skipRest() }
                .buttonStyle(.pill)
        }
        .font(.metric(.subheadline))
        .lineLimit(1)
        .fixedSize()
    }
}
