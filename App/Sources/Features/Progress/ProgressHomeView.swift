import Charts
import Domain
import Metrics
import Persistence
import SwiftUI

/// One logged exercise with a short trend of its default metric.
struct ExerciseTrend: Identifiable, Sendable {
    var id: UUID { logged.id }
    let logged: LoggedExercise
    let kind: ExerciseMetricKind
    let points: [MetricPoint]
}

struct ProgressHomeView: View {
    var body: some View {
        Live { db in
            let trends = try SessionStore.loggedExercises(db).map { logged in
                let measurement = logged.exercise.measurement
                let kind = ExerciseMetric.available(for: measurement)[0]
                let metric: ExerciseMetric = switch kind {
                case .heaviestSet: .heaviestSet
                case .leastAssistance: .leastAssistance
                case .totalReps: .totalReps
                default: .bestReps
                }
                let records = try SessionStore.exerciseRecords(logged.id, db)
                return ExerciseTrend(logged: logged, kind: kind, points: ExerciseMetrics.series(metric, records: records, measurement: measurement))
            }
            return (trends, try MeasurementStore.fetchAll(.bodyWeight, db))
        } content: { trends, weights in
            ProgressContent(trends: trends, weights: weights)
        }
        .background(Theme.background)
    }
}

private struct ProgressContent: View {
    @AppStorage(SettingsKey.massUnit) private var unit: MassUnit = .localeDefault
    let trends: [ExerciseTrend]
    let weights: [BodyMeasurement]
    @State private var search = ""

    private var filtered: [ExerciseTrend] {
        trends.filter { $0.logged.exercise.matches(search: search) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                PageHeader(eyebrow: nil, title: "Progress")

                NavigationLink { BodyWeightView() } label: { BodyWeightCard(entries: weights, unit: unit) }
                    .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: Spacing.s) {
                    SectionHeader(title: "Exercises") {
                        NavigationLink { ExerciseLibraryView() } label: {
                            Text("Browse all").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        }
                    }

                    if trends.isEmpty {
                        Card {
                            EmptyState(
                                symbol: "chart.line.uptrend.xyaxis",
                                title: "No exercise history yet",
                                message: "Finish a workout and every exercise you logged gets its own chart here."
                            )
                        }
                    } else {
                        if trends.count > 6 { SearchField(text: $search, prompt: "Search your exercises") }
                        VStack(spacing: 0) {
                            ForEach(Array(filtered.enumerated()), id: \.element.id) { index, trend in
                                if index > 0 { Hairline() }
                                NavigationLink { ExerciseDetailView(exercise: trend.logged.exercise) } label: {
                                    ExerciseTrendRow(trend: trend, unit: unit)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, Spacing.page)
            .padding(.bottom, Spacing.xxl)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.immediately)
    }
}

struct SearchField: View {
    @Binding var text: String
    let prompt: String

    var body: some View {
        HStack(spacing: Spacing.xs) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.tertiaryInk)
            TextField("", text: $text, prompt: Text(prompt).foregroundStyle(Theme.tertiaryInk))
                .foregroundStyle(Theme.ink)
                .autocorrectionDisabled()
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.tertiaryInk) }
                    .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, Spacing.s)
        .frame(minHeight: 40)
        .background(Theme.surface, in: .rect(cornerRadius: Radius.control))
    }
}

private struct BodyWeightCard: View {
    let entries: [BodyMeasurement]
    let unit: MassUnit

    private var summary: BodyWeightSummary { BodyWeightTrend.summary(entries, range: .threeMonths) }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.s) {
                HStack {
                    Eyebrow("Body weight")
                    Spacer()
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.tertiaryInk)
                }
                if let latest = summary.latest {
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(alignment: .firstTextBaseline, spacing: 4) {
                                Text(Format.number(latest.mass.value(in: unit), maxFractionDigits: 1))
                                    .font(.metric(.largeTitle))
                                    .foregroundStyle(Theme.ink)
                                Text(unit.symbol).font(.headline).foregroundStyle(Theme.secondaryInk)
                            }
                            if let change = summary.change {
                                Text("\(Format.signed(unit.fromKilograms(change.kilograms))) \(unit.symbol) over 3 months")
                                    .font(.metric(.footnote, weight: .medium))
                                    .foregroundStyle(Theme.secondaryInk)
                            } else {
                                Text("Latest, \(Format.relativeDay(latest.measuredAt, midSentence: true))")
                                    .font(.footnote)
                                    .foregroundStyle(Theme.secondaryInk)
                            }
                        }
                        Spacer(minLength: Spacing.m)
                        if summary.rollingAverage.count > 1 {
                            Chart(summary.rollingAverage, id: \.day) { point in
                                LineMark(x: .value("Day", point.day.date), y: .value("Average", point.kilograms))
                                    .foregroundStyle(Theme.ink)
                                    .interpolationMethod(.monotone)
                            }
                            .chartXAxis(.hidden)
                            .chartYAxis(.hidden)
                            .chartYScale(domain: .automatic(includesZero: false))
                            .frame(width: 120, height: 44)
                            .accessibilityHidden(true)
                        }
                    }
                } else {
                    Text("Log your weight to see a 7-day trend.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.secondaryInk)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens body weight")
    }
}

private struct ExerciseTrendRow: View {
    let trend: ExerciseTrend
    let unit: MassUnit

    private var recent: [MetricPoint] { Array(trend.points.suffix(10)) }

    var body: some View {
        HStack(spacing: Spacing.m) {
            VStack(alignment: .leading, spacing: 3) {
                Text(trend.logged.exercise.name)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(2)
                Text("Last \(Format.relativeDay(trend.logged.lastPerformedAt, midSentence: true))")
                    .font(.footnote)
                    .foregroundStyle(Theme.secondaryInk)
            }
            Spacer(minLength: Spacing.xs)
            if recent.count > 1 {
                Chart(recent) { point in
                    LineMark(x: .value("Date", point.date), y: .value("Value", point.value))
                        .foregroundStyle(Theme.secondaryInk)
                        .interpolationMethod(.monotone)
                }
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .chartYScale(domain: .automatic(includesZero: false))
                .frame(width: 44, height: 22)
                .accessibilityHidden(true)
            }
            if let last = trend.points.last {
                Text(latestText(last))
                    .font(.metric(.subheadline))
                    .foregroundStyle(Theme.ink)
                    .frame(minWidth: 64, alignment: .trailing)
            }
        }
        .padding(.vertical, Spacing.s)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    private func latestText(_ point: MetricPoint) -> String {
        trend.kind.isMass ? Format.kilograms(point.value, in: unit) : "\(Int(point.value)) reps"
    }
}
