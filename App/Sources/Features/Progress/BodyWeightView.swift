import Charts
import Domain
import Metrics
import Persistence
import SwiftUI

struct BodyWeightView: View {
    var body: some View {
        Live { try MeasurementStore.fetchAll(.bodyWeight, $0) } content: { entries in
            BodyWeightContent(entries: entries)
        }
        .background(Theme.background)
        .navigationBarTitleDisplayMode(.inline)
        .notebookNavigation()
    }
}

private struct BodyWeightContent: View {
    @Environment(AppModel.self) private var app
    @AppStorage(SettingsKey.massUnit) private var unit: MassUnit = .localeDefault
    let entries: [BodyMeasurement]

    @State private var range: ChartRange = .threeMonths
    @State private var editing: BodyMeasurement?
    @State private var adding = false
    @State private var showingAll = false

    private var summary: BodyWeightSummary { BodyWeightTrend.summary(entries, range: range) }

    private var rawInRange: [BodyMeasurement] {
        let now = Date()
        return entries.filter { range.contains($0.measuredAt, now: now) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Eyebrow("Body weight")
                    headline
                }
                if entries.isEmpty {
                    Card {
                        EmptyState(
                            symbol: "scalemass",
                            title: "No weigh-ins yet",
                            message: "Log whenever you like. A 7-day average smooths out daily swings once you have a few days.",
                            actionTitle: "Log weight",
                            action: { adding = true }
                        )
                    }
                } else {
                    chart.frame(height: 220)
                    ChipPicker(options: ChartRange.allCases, selection: $range) { $0.rawValue }
                    legend
                    entryList
                }
            }
            .padding(.horizontal, Spacing.page)
            .padding(.bottom, Spacing.xxl)
        }
        .scrollIndicators(.hidden)
        .safeAreaInset(edge: .bottom) {
            if !entries.isEmpty {
                Button { adding = true } label: { Label("Log weight", systemImage: "plus") }
                    .buttonStyle(.primary)
                    .padding(.horizontal, Spacing.page)
                    .padding(.vertical, Spacing.s)
                    .background(Theme.background)
            }
        }
        .sheet(isPresented: $adding) { NavigationStack { WeightEntrySheet(existing: nil, defaultUnit: unit) } }
        .sheet(item: $editing) { entry in NavigationStack { WeightEntrySheet(existing: entry, defaultUnit: unit) } }
    }

    @ViewBuilder
    private var headline: some View {
        if let latest = summary.latest {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(Format.number(latest.mass.value(in: unit), maxFractionDigits: 1))
                        .font(.system(size: 52, weight: .semibold, design: .rounded).monospacedDigit())
                        .foregroundStyle(Theme.ink)
                    Text(unit.symbol).font(.title3.weight(.medium)).foregroundStyle(Theme.secondaryInk)
                }
                if let change = summary.change {
                    HStack(spacing: Spacing.xs) {
                        Text("\(Format.signed(unit.fromKilograms(change.kilograms))) \(unit.symbol)")
                            .font(.metric(.subheadline))
                            .foregroundStyle(Theme.ink)
                            .padding(.horizontal, Spacing.xs)
                            .padding(.vertical, 2)
                            .background(Theme.raised, in: .capsule)
                        Text("\(Format.day(change.from.date, timeZone: .gmt)) to \(Format.day(change.to.date, timeZone: .gmt))")
                            .font(.footnote)
                            .foregroundStyle(Theme.secondaryInk)
                    }
                } else {
                    Text("Weigh in on two or more days in this range to see a trend.")
                        .font(.footnote)
                        .foregroundStyle(Theme.secondaryInk)
                }
            }
            .accessibilityElement(children: .combine)
        } else {
            Text("Nothing logged")
                .font(.title.weight(.bold))
                .foregroundStyle(Theme.ink)
        }
    }

    @ViewBuilder
    private var chart: some View {
        if rawInRange.isEmpty {
            Text("No entries in this range.")
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryInk)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.surface, in: .rect(cornerRadius: Radius.control))
        } else {
            Chart {
                ForEach(rawInRange) { entry in
                    PointMark(x: .value("Date", entry.measuredAt), y: .value(unit.symbol, entry.mass.value(in: unit)))
                        .foregroundStyle(Theme.tertiaryInk)
                        .symbolSize(14)
                }
                ForEach(summary.rollingAverage, id: \.day) { point in
                    LineMark(x: .value("Date", point.day.date), y: .value("7-day average", unit.fromKilograms(point.kilograms)))
                        .foregroundStyle(Theme.ink)
                        .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
                        .interpolationMethod(.monotone)
                }
            }
            .chartYScale(domain: .automatic(includesZero: false))
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
            .accessibilityLabel("Body weight chart")
            .accessibilityValue(summary.change.map { "Change \(Format.kilograms($0.kilograms, in: unit))" } ?? "No trend")
        }
    }

    private var legend: some View {
        HStack(spacing: Spacing.m) {
            HStack(spacing: 5) {
                Circle().fill(Theme.tertiaryInk).frame(width: 6, height: 6)
                Text("Weigh-ins")
            }
            if !summary.rollingAverage.isEmpty {
                HStack(spacing: 5) {
                    Capsule().fill(Theme.ink).frame(width: 14, height: 2.5)
                    Text("7-day average of daily means")
                }
            }
        }
        .font(.caption)
        .foregroundStyle(Theme.secondaryInk)
        .accessibilityHidden(true)
    }

    private var entryList: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            SectionHeader(title: "Entries") {
                if entries.count > 8 {
                    Button(showingAll ? "Show less" : "Show all \(entries.count)") { showingAll.toggle() }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                }
            }
            VStack(spacing: 0) {
                ForEach(Array((showingAll ? entries : Array(entries.prefix(8))).enumerated()), id: \.element.id) { index, entry in
                    if index > 0 { Hairline() }
                    Button { editing = entry } label: { EntryRow(entry: entry, unit: unit) }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button { editing = entry } label: { Label("Edit", systemImage: "pencil") }
                            Button(role: .destructive) {
                                let id = entry.id
                                app.perform { try MeasurementStore.delete(id, $0) }
                            } label: { Label("Delete", systemImage: "trash") }
                        }
                }
            }
        }
    }
}

private struct EntryRow: View {
    let entry: BodyMeasurement
    let unit: MassUnit

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink)
                Text([formatted(.dateTime.hour().minute()), entry.note].compactMap { $0 }.joined(separator: ", "))
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryInk)
                    .lineLimit(1)
            }
            Spacer()
            Text(Format.mass(entry.mass, in: unit))
                .font(.metric(.body, weight: .medium))
                .foregroundStyle(Theme.ink)
        }
        .padding(.vertical, Spacing.s)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Edit entry")
    }

    private func formatted(_ style: Date.FormatStyle) -> String {
        var style = style
        style.timeZone = entry.timeZone
        return entry.measuredAt.formatted(style)
    }
}

private struct WeightEntrySheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let existing: BodyMeasurement?

    @State private var text: String
    @State private var unit: MassUnit
    @State private var date: Date
    @State private var note: String
    @State private var confirmingDelete = false
    @FocusState private var focused: Bool

    init(existing: BodyMeasurement?, defaultUnit: MassUnit) {
        self.existing = existing
        _text = State(initialValue: existing.map { Format.number($0.mass.value) } ?? "")
        _unit = State(initialValue: existing?.mass.unit ?? defaultUnit)
        _date = State(initialValue: existing?.measuredAt ?? Date())
        _note = State(initialValue: existing?.note ?? "")
    }

    private var value: Double? { NumberInput.decimal(text).flatMap { $0 > 0 ? $0 : nil } }

    var body: some View {
        Form {
            Section {
                HStack {
                    TextField("", text: $text, prompt: Text("0.0").foregroundStyle(Theme.tertiaryInk))
                        .keyboardType(.decimalPad)
                        .font(.system(size: 40, weight: .semibold, design: .rounded).monospacedDigit())
                        .foregroundStyle(Theme.ink)
                        .focused($focused)
                    Picker("Unit", selection: $unit) {
                        ForEach(MassUnit.allCases, id: \.self) { Text($0.symbol).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 110)
                }
                .listRowBackground(Theme.surface)
                DatePicker("When", selection: $date, in: ...Date())
                    .listRowBackground(Theme.surface)
                TextField("Note", text: $note)
                    .listRowBackground(Theme.surface)
            } footer: {
                if !text.isEmpty, value == nil { Text("Enter a weight above zero.").foregroundStyle(Theme.destructive) }
            }
            if existing != nil {
                Section {
                    Button("Delete entry", role: .destructive) { confirmingDelete = true }
                        .listRowBackground(Theme.surface)
                }
            }
        }
        .notebookBackground()
        .notebookNavigation()
        .navigationTitle(existing == nil ? "Log weight" : "Edit weight")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) { Button("Save", action: save).disabled(value == nil) }
        }
        .onAppear { if existing == nil { focused = true } }
        .confirmationDialog("Delete this entry?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                if let id = existing?.id { app.perform { try MeasurementStore.delete(id, $0) } }
                dismiss()
            }
        }
    }

    private func save() {
        guard let value else { return }
        var entry = existing ?? BodyMeasurement(mass: RecordedMass(value, unit), measuredAt: date)
        entry.mass = RecordedMass(value, unit)
        entry.measuredAt = date
        if existing == nil || existing?.measuredAt != date { entry.timeZoneIdentifier = TimeZone.current.identifier }
        entry.note = note.trimmingCharacters(in: .whitespaces).isEmpty ? nil : note
        let toSave = entry
        if app.perform({ try MeasurementStore.save(toSave, $0) }) != nil { dismiss() }
    }
}
