import Domain
import Foundation

/// One workout's contribution to an exercise's history. If the exercise appeared more than
/// once in a session, all of its sets are combined so the session is still a single point.
public struct ExerciseSessionRecord: Hashable, Sendable {
    public let sessionId: UUID
    public let sessionName: String
    public let startedAt: Date
    public let measurement: ExerciseMeasurement
    public let sets: [WorkoutSet]

    public init(sessionId: UUID, sessionName: String, startedAt: Date, measurement: ExerciseMeasurement, sets: [WorkoutSet]) {
        self.sessionId = sessionId
        self.sessionName = sessionName
        self.startedAt = startedAt
        self.measurement = measurement
        self.sets = sets
    }

    /// The only sets any metric may use: completed working sets with valid values.
    public var qualifyingSets: [WorkoutSet] {
        sets.filter { $0.isCompleted && $0.type == .working && $0.validate(for: measurement) == nil }
    }
}

public enum ExerciseMetric: Hashable, Sendable {
    /// Heaviest load among working sets (added load or total/per-hand load, by convention).
    case heaviestSet
    /// Sum of load x reps. Per-hand exercises report per-hand load x reps, never doubled.
    case volume
    /// Best reps at one specific load; sessions without that load produce no point.
    case bestRepsAtLoad(RecordedMass)
    case bestReps
    case totalReps
    /// Lowest assistance used, for assisted exercises. Lower is less help.
    case leastAssistance

    public static let definitionVersion = 1

    public static func available(for measurement: ExerciseMeasurement) -> [ExerciseMetricKind] {
        switch measurement {
        case .externalLoad: [.heaviestSet, .volume, .bestRepsAtLoad]
        case .bodyweight: [.bestReps, .totalReps]
        case .weightedBodyweight: [.heaviestSet, .bestRepsAtLoad, .bestReps]
        case .assistedBodyweight: [.leastAssistance, .bestRepsAtLoad, .bestReps]
        }
    }
}

public enum ExerciseMetricKind: String, Hashable, Sendable, CaseIterable {
    case heaviestSet, volume, bestRepsAtLoad, bestReps, totalReps, leastAssistance

    public func title(for measurement: ExerciseMeasurement) -> String {
        switch (self, measurement) {
        case (.heaviestSet, .weightedBodyweight): "Heaviest added load"
        case (.heaviestSet, _): "Heaviest set"
        case (.volume, .externalLoad(.perHand)): "Volume (per-hand load x reps)"
        case (.volume, _): "Volume (load x reps)"
        case (.bestRepsAtLoad, .assistedBodyweight): "Best reps at assistance"
        case (.bestRepsAtLoad, .weightedBodyweight): "Best reps at added load"
        case (.bestRepsAtLoad, _): "Best reps at load"
        case (.bestReps, _): "Best reps"
        case (.totalReps, _): "Total reps"
        case (.leastAssistance, _): "Least assistance"
        }
    }

    public var isMass: Bool {
        switch self {
        case .heaviestSet, .volume, .leastAssistance: true
        case .bestRepsAtLoad, .bestReps, .totalReps: false
        }
    }
}

public struct MetricPoint: Hashable, Sendable, Identifiable {
    public var id: UUID { sessionId }
    public let sessionId: UUID
    public let sessionName: String
    public let date: Date
    /// Kilograms for mass metrics (kg x reps for volume); a count for rep metrics.
    public let value: Double
    /// For load metrics, the reps achieved at the plotted load.
    public let reps: Int?
    public let supportingSets: [WorkoutSet]
}

public enum ExerciseMetrics {
    /// One point per session that has qualifying data. Sessions recorded under a different
    /// measurement convention are excluded so incompatible numbers never share a series.
    public static func series(
        _ metric: ExerciseMetric,
        records: [ExerciseSessionRecord],
        measurement: ExerciseMeasurement
    ) -> [MetricPoint] {
        records
            .filter { $0.measurement == measurement }
            .sorted { $0.startedAt < $1.startedAt }
            .compactMap { point(metric, record: $0) }
    }

    static func point(_ metric: ExerciseMetric, record: ExerciseSessionRecord) -> MetricPoint? {
        let sets = record.qualifyingSets
        guard !sets.isEmpty else { return nil }
        func make(_ value: Double, reps: Int?, supporting: [WorkoutSet]) -> MetricPoint {
            MetricPoint(sessionId: record.sessionId, sessionName: record.sessionName, date: record.startedAt, value: value, reps: reps, supportingSets: supporting)
        }

        switch metric {
        case .heaviestSet:
            guard record.measurement.loadConvention != .assistance,
                  let best = sets.max(by: heavierOrder), let load = best.load else { return nil }
            return make(load.kilograms, reps: best.reps, supporting: [best])
        case .leastAssistance:
            guard record.measurement == .assistedBodyweight,
                  let best = sets.min(by: lighterOrder), let load = best.load else { return nil }
            return make(load.kilograms, reps: best.reps, supporting: [best])
        case .volume:
            guard case .externalLoad = record.measurement else { return nil }
            let total = sets.reduce(0.0) { $0 + ($1.load?.kilograms ?? 0) * Double($1.reps ?? 0) }
            return make(total, reps: nil, supporting: sets)
        case .bestRepsAtLoad(let target):
            let atLoad = sets.filter { $0.load?.isSameLoad(as: target) == true }
            guard let best = atLoad.max(by: { ($0.reps ?? 0) < ($1.reps ?? 0) }), let reps = best.reps else { return nil }
            return make(Double(reps), reps: reps, supporting: [best])
        case .bestReps:
            guard let best = sets.max(by: { ($0.reps ?? 0) < ($1.reps ?? 0) }), let reps = best.reps else { return nil }
            return make(Double(reps), reps: reps, supporting: [best])
        case .totalReps:
            let total = sets.reduce(0) { $0 + ($1.reps ?? 0) }
            return make(Double(total), reps: total, supporting: sets)
        }
    }

    /// Heavier load wins; equal loads are broken by more reps.
    private static func heavierOrder(_ a: WorkoutSet, _ b: WorkoutSet) -> Bool {
        let (ka, kb) = (a.load?.kilograms ?? 0, b.load?.kilograms ?? 0)
        if abs(ka - kb) >= 0.001 { return ka < kb }
        return (a.reps ?? 0) < (b.reps ?? 0)
    }

    /// Less assistance wins; equal assistance is broken by more reps.
    private static func lighterOrder(_ a: WorkoutSet, _ b: WorkoutSet) -> Bool {
        let (ka, kb) = (a.load?.kilograms ?? 0, b.load?.kilograms ?? 0)
        if abs(ka - kb) >= 0.001 { return ka < kb }
        return (a.reps ?? 0) > (b.reps ?? 0)
    }

    /// Distinct loads used in qualifying sets, heaviest first, for the "at load" picker.
    public static func distinctLoads(records: [ExerciseSessionRecord], measurement: ExerciseMeasurement) -> [RecordedMass] {
        var result: [RecordedMass] = []
        for record in records where record.measurement == measurement {
            for load in record.qualifyingSets.compactMap(\.load) where !result.contains(where: { $0.isSameLoad(as: load) }) {
                result.append(load)
            }
        }
        return result.sorted { $0.kilograms > $1.kilograms }
    }
}

public struct PersonalRecords: Hashable, Sendable {
    public struct Entry: Hashable, Sendable {
        public let load: RecordedMass?
        public let reps: Int
        public let date: Date
        public let sessionId: UUID
    }

    /// Heaviest completed working load (with its reps). For assisted exercises, least assistance.
    public let bestLoad: Entry?
    /// Most reps at each distinct load, heaviest load first.
    public let mostRepsByLoad: [Entry]
    /// Most reps in one working set, for bodyweight exercises.
    public let mostReps: Entry?

    public init(records: [ExerciseSessionRecord], measurement: ExerciseMeasurement) {
        let matching = records.filter { $0.measurement == measurement }.sorted { $0.startedAt < $1.startedAt }
        var bestLoad: Entry?
        var byLoad: [Entry] = []
        var mostReps: Entry?

        for record in matching {
            for set in record.qualifyingSets {
                guard let reps = set.reps else { continue }
                let entry = Entry(load: set.load, reps: reps, date: record.startedAt, sessionId: record.sessionId)
                // Strictly better only, so the earliest session achieving a record keeps it.
                if reps > (mostReps?.reps ?? 0) { mostReps = entry }
                guard let load = set.load else { continue }
                if let current = bestLoad, let currentLoad = current.load {
                    let sameLoadMoreReps = load.isSameLoad(as: currentLoad) && reps > current.reps
                    let better = measurement == .assistedBodyweight
                        ? load.kilograms < currentLoad.kilograms - 0.001
                        : load.kilograms > currentLoad.kilograms + 0.001
                    if better || sameLoadMoreReps { bestLoad = entry }
                } else {
                    bestLoad = entry
                }
                if let index = byLoad.firstIndex(where: { $0.load?.isSameLoad(as: load) == true }) {
                    if reps > byLoad[index].reps { byLoad[index] = entry }
                } else {
                    byLoad.append(entry)
                }
            }
        }
        self.bestLoad = measurement.tracksLoad ? bestLoad : nil
        self.mostRepsByLoad = byLoad.sorted { ($0.load?.kilograms ?? 0) > ($1.load?.kilograms ?? 0) }
        self.mostReps = mostReps
    }
}
