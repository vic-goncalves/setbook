import Charts
import Domain
import Metrics
import Persistence
import SwiftUI

/// An exercise's chart, records, recent sets and metadata.
struct ExerciseDetailView: View {
    let exercise: Exercise
    var onEdit: ((Exercise) -> Void)?

    var body: some View {
        Live(key: exercise.id.uuidString) { [id = exercise.id] in try SessionStore.exerciseRecords(id, $0) } content: { records in
            ExercisePerformance(exercise: exercise, records: records, onEdit: onEdit)
        }
        .background(Theme.background)
        .navigationBarTitleDisplayMode(.inline)
        .notebookNavigation()
    }
}

private struct ExercisePerformance: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @AppStorage(SettingsKey.massUnit) private var unit: MassUnit = .localeDefault
    let exercise: Exercise
    let records: [ExerciseSessionRecord]
    let onEdit: ((Exercise) -> Void)?

    @State private var kind: ExerciseMetricKind?
    @State private var range: ChartRange = .threeMonths
    @State private var atLoad: RecordedMass?
    @State private var selectedDate: Date?
    @State private var confirmingRemove = false

    private var measurement: ExerciseMeasurement { exercise.measurement }
    private var matching: [ExerciseSessionRecord] { records.filter { $0.measurement == measurement } }
    private var kinds: [ExerciseMetricKind] { ExerciseMetric.available(for: measurement) }
    private var activeKind: ExerciseMetricKind { kind ?? kinds[0] }
    private var loads: [RecordedMass] { ExerciseMetrics.distinctLoads(records: records, measurement: measurement) }

    private var metric: ExerciseMetric? {
        switch activeKind {
        case .heaviestSet: .heaviestSet
        case .volume: .volume
        case .bestRepsAtLoad: (atLoad ?? loads.first).map(ExerciseMetric.bestRepsAtLoad)
        case .bestReps: .bestReps
        case .totalReps: .totalReps
        case .leastAssistance: .leastAssistance
        }
    }

    private var points: [MetricPoint] {
        guard let metric else { return [] }
        let now = Date()
        return ExerciseMetrics.series(metric, records: records, measurement: measurement)
            .filter { range.contains($0.date, now: now) }
    }

    private var selected: MetricPoint? {
        guard let selectedDate else { return points.last }
        return points.min { abs($0.date.timeIntervalSince(selectedDate)) < abs($1.date.timeIntervalSince(selectedDate)) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Eyebrow("\(exercise.primaryMuscle.displayName), \(exercise.equipment.displayName)")
                    Text(exercise.name)
                        .font(.title.weight(.bold))
                        .tracking(-0.4)
                        .foregroundStyle(Theme.ink)
                }

                if matching.isEmpty {
                    Card {
                        EmptyState(
                            symbol: "chart.xyaxis.line",
                            title: "No completed sets yet",
                            message: records.isEmpty
                                ? "Complete a working set of \(exercise.name) and your progress appears here."
                                : "Past sets were logged with a different load convention, so they aren't charted together.",
                            actionTitle: app.activeWorkout == nil ? "Start a workout with it" : nil,
                            action: app.activeWorkout == nil ? { startWithExercise() } : nil
                        )
                    }
                } else {
                    chartBlock
                    recordsBlock
                    recentBlock
                }
                aboutBlock
            }
            .padding(.horizontal, Spacing.page)
            .padding(.bottom, Spacing.xxl)
        }
        .scrollIndicators(.hidden)
        .onChange(of: range) { selectedDate = nil }
        .onChange(of: activeKind) { selectedDate = nil }
        .confirmationDialog("Remove \(exercise.name)?", isPresented: $confirmingRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive) {
                let id = exercise.id
                app.perform { try ExerciseStore.remove(id, $0) }
                dismiss()
            }
        } message: {
            Text("If you've logged or planned it, it's archived instead, and your history stays intact.")
        }
    }

    // MARK: Chart

    private var chartBlock: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            if kinds.count > 1 {
                ChipPicker(options: kinds, selection: Binding(get: { activeKind }, set: { kind = $0 }), label: shortTitle)
            }

            VStack(alignment: .leading, spacing: Spacing.xxs) {
                HStack {
                    Eyebrow(activeKind.title(for: measurement))
                    Spacer()
                    if activeKind == .bestRepsAtLoad, !loads.isEmpty {
                        Menu {
                            Picker("Load", selection: Binding(get: { atLoad ?? loads[0] }, set: { atLoad = $0 })) {
                                ForEach(loads, id: \.self) { Text(Format.mass($0, in: unit)).tag($0) }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Text("at \(Format.mass(atLoad ?? loads[0], in: unit))")
                                Image(systemName: "chevron.up.chevron.down").font(.caption2)
                            }
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.ink)
                            .padding(.horizontal, Spacing.s)
                            .frame(minHeight: 30)
                            .background(Theme.raised, in: .capsule)
                        }
                    }
                }
                if let point = selected {
                    NavigationLink { WorkoutDetailView(sessionId: point.sessionId) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(valueText(point))
                                .font(.metric(.largeTitle))
                                .foregroundStyle(Theme.ink)
                            HStack(spacing: 4) {
                                Text("\(Format.day(point.date)), \(point.sessionName)")
                                Image(systemName: "chevron.right").font(.caption2.weight(.bold))
                            }
                            .font(.footnote)
                            .foregroundStyle(Theme.secondaryInk)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens the workout")
                }
            }

            chart.frame(height: 220)

            ChipPicker(options: ChartRange.allCases, selection: $range) { $0.rawValue }

            if let note = explanation {
                Text(note).font(.caption).foregroundStyle(Theme.tertiaryInk)
            }
        }
    }

    @ViewBuilder
    private var chart: some View {
        if points.isEmpty {
            Text(range == .all ? "No sessions with this metric." : "No sessions in this range.")
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryInk)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.surface, in: .rect(cornerRadius: Radius.control))
        } else {
            let values = points.map { display($0.value) }
            let low = values.min() ?? 0
            let high = values.max() ?? 1
            let pad = max((high - low) * 0.15, 1)
            Chart {
                ForEach(points) { point in
                    if points.count > 1 {
                        AreaMark(
                            x: .value("Date", point.date),
                            yStart: .value("Base", low - pad),
                            yEnd: .value(yLabel, display(point.value))
                        )
                        .foregroundStyle(LinearGradient(colors: [Theme.ink.opacity(0.18), Theme.ink.opacity(0)], startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.monotone)
                        LineMark(x: .value("Date", point.date), y: .value(yLabel, display(point.value)))
                            .foregroundStyle(Theme.ink)
                            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
                            .interpolationMethod(.monotone)
                    }
                    PointMark(x: .value("Date", point.date), y: .value(yLabel, display(point.value)))
                        .foregroundStyle(point.sessionId == selected?.sessionId ? Theme.ink : Theme.ink.opacity(0.5))
                        .symbolSize(point.sessionId == selected?.sessionId ? 90 : 18)
                }
                if let selected {
                    RuleMark(x: .value("Selected", selected.date))
                        .foregroundStyle(Theme.hairline)
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
            }
            .chartXSelection(value: $selectedDate)
            .chartYScale(domain: (low - pad)...(high + pad))
            .chartYAxis {
                AxisMarks(position: .trailing, values: .automatic(desiredCount: 4)) { _ in
                    AxisGridLine().foregroundStyle(Theme.hairline)
                    AxisValueLabel().foregroundStyle(Theme.tertiaryInk).font(.caption2)
                }
            }
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                    AxisValueLabel(format: .dateTime.month(.abbreviated).day()).foregroundStyle(Theme.tertiaryInk).font(.caption2)
                }
            }
            .accessibilityLabel("\(activeKind.title(for: measurement)) chart")
            .accessibilityValue(points.map { "\(Format.day($0.date)): \(valueText($0))" }.joined(separator: "; "))
        }
    }

    // MARK: Records and recent

    private var recordsBlock: some View {
        let prs = PersonalRecords(records: records, measurement: measurement)
        var tiles: [(String, String, Date)] = []
        if let best = prs.bestLoad, let load = best.load {
            let title = measurement == .assistedBodyweight ? "Least assistance" : (measurement == .weightedBodyweight ? "Heaviest added" : "Heaviest set")
            tiles.append((title, "\(Format.mass(load, in: unit)) x \(best.reps)", best.date))
        }
        if measurement.tracksLoad {
            for entry in prs.mostRepsByLoad.prefix(3) {
                if let load = entry.load { tiles.append(("Reps at \(Format.mass(load, in: unit))", "\(entry.reps)", entry.date)) }
            }
        } else if let most = prs.mostReps {
            tiles.append(("Most reps", "\(most.reps)", most.date))
        }
        return VStack(alignment: .leading, spacing: Spacing.s) {
            Eyebrow("Records")
            LazyVGrid(columns: [GridItem(.flexible(), spacing: Spacing.s), GridItem(.flexible(), spacing: Spacing.s)], spacing: Spacing.s) {
                ForEach(tiles, id: \.0) { tile in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(tile.0).font(.caption).foregroundStyle(Theme.secondaryInk).lineLimit(1)
                        Text(tile.1).font(.metric(.title3)).foregroundStyle(Theme.ink).lineLimit(1).minimumScaleFactor(0.7)
                        Text(Format.day(tile.2)).font(.caption2).foregroundStyle(Theme.tertiaryInk)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Spacing.s)
                    .background(Theme.surface, in: .rect(cornerRadius: Radius.control))
                    .accessibilityElement(children: .combine)
                }
            }
            Text("Completed working sets only. Each load has its own rep record, so a heavy single never outranks more reps at a lighter weight.")
                .font(.caption)
                .foregroundStyle(Theme.tertiaryInk)
        }
    }

    private var recentBlock: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Eyebrow("Recent")
            VStack(spacing: 0) {
                ForEach(Array(matching.suffix(6).reversed().enumerated()), id: \.element.sessionId) { index, record in
                    if index > 0 { Hairline() }
                    NavigationLink { WorkoutDetailView(sessionId: record.sessionId) } label: {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(Format.day(record.startedAt)).font(.footnote).foregroundStyle(Theme.secondaryInk)
                                Text(record.sets.filter { $0.isCompleted && $0.type == .working }.map { Format.set($0, unit: unit) }.joined(separator: "   "))
                                    .font(.metric(.subheadline, weight: .medium))
                                    .foregroundStyle(Theme.ink)
                                    .lineLimit(2)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.tertiaryInk)
                        }
                        .padding(.vertical, Spacing.s)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var aboutBlock: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Eyebrow("About")
            VStack(alignment: .leading, spacing: Spacing.xs) {
                aboutRow("Muscles", ([exercise.primaryMuscle] + exercise.secondaryMuscles).map(\.displayName).joined(separator: ", "))
                aboutRow("Equipment", exercise.equipment.displayName)
                aboutRow("Logged as", exercise.measurement.loadLabel.map { "\($0) and reps" } ?? "Reps only")
                if let explanation = exercise.measurement.loadExplanation {
                    Text(explanation).font(.caption).foregroundStyle(Theme.tertiaryInk)
                }
            }
            if !exercise.isBuiltIn, let onEdit {
                HStack(spacing: Spacing.s) {
                    Button("Edit") { onEdit(exercise) }.buttonStyle(.secondary)
                    Button("Remove") { confirmingRemove = true }.buttonStyle(.secondary).foregroundStyle(Theme.destructive)
                }
            }
        }
    }

    private func aboutRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.subheadline).foregroundStyle(Theme.secondaryInk)
            Spacer()
            Text(value).font(.subheadline).foregroundStyle(Theme.ink).multilineTextAlignment(.trailing)
        }
    }

    // MARK: Formatting

    private var yLabel: String { activeKind.isMass ? unit.symbol : "reps" }

    private var explanation: String? {
        switch (activeKind, measurement) {
        case (.leastAssistance, _): "Lower means less help from the machine or band. Less assistance at similar reps can indicate progress."
        case (.volume, .externalLoad(.perHand)): "Per-hand load x reps, summed over working sets. Not doubled."
        case (.volume, _): "Load x reps, summed over working sets."
        case (.heaviestSet, .weightedBodyweight): "Weight added to your body, not including bodyweight."
        case (.bestRepsAtLoad, _): "Only sessions that included this load are shown."
        default: nil
        }
    }

    private func shortTitle(_ kind: ExerciseMetricKind) -> String {
        switch kind {
        case .heaviestSet: measurement == .weightedBodyweight ? "Added load" : "Heaviest"
        case .volume: "Volume"
        case .bestRepsAtLoad: "Reps at load"
        case .bestReps: "Best reps"
        case .totalReps: "Total reps"
        case .leastAssistance: "Assistance"
        }
    }

    private func display(_ value: Double) -> Double {
        activeKind.isMass ? unit.fromKilograms(value) : value
    }

    private func valueText(_ point: MetricPoint) -> String {
        switch activeKind {
        case .heaviestSet, .leastAssistance:
            "\(Format.kilograms(point.value, in: unit))\(point.reps.map { " x \($0)" } ?? "")"
        case .volume:
            "\(Format.number(unit.fromKilograms(point.value), maxFractionDigits: 0)) \(unit.symbol)"
        case .bestRepsAtLoad, .bestReps, .totalReps:
            "\(Int(point.value)) reps"
        }
    }

    private func startWithExercise() {
        let exercise = exercise
        app.startWorkout { _ in
            var session = WorkoutSession.empty()
            session.name = exercise.name
            session.exercises = [WorkoutExercise(adding: exercise)]
            return session
        }
    }
}
