import Domain
import Foundation
import Testing
@testable import Metrics

func set(_ load: Double?, _ reps: Int, unit: MassUnit = .pounds, type: SetType = .working, done: Bool = true) -> WorkoutSet {
    WorkoutSet(type: type, load: load.map { RecordedMass($0, unit) }, reps: reps, completedAt: done ? Date(timeIntervalSince1970: 1) : nil)
}

func record(_ day: Double, _ sets: [WorkoutSet], measurement: ExerciseMeasurement = .externalLoad(.total)) -> ExerciseSessionRecord {
    ExerciseSessionRecord(sessionId: UUID(), sessionName: "W", startedAt: Date(timeIntervalSince1970: day * 86_400), measurement: measurement, sets: sets)
}

@Suite struct ExerciseMetricTests {
    let load = ExerciseMeasurement.externalLoad(.total)

    @Test func heaviestSetIgnoresWarmupsAndIncompleteAndBreaksTiesByReps() {
        let r = record(1, [set(315, 1, type: .warmup), set(405, 1, done: false), set(225, 5), set(225, 8), set(185, 12)])
        let points = ExerciseMetrics.series(.heaviestSet, records: [r], measurement: load)
        #expect(points.count == 1)
        #expect(abs(points[0].value - RecordedMass(225, .pounds).kilograms) < 1e-9)
        #expect(points[0].reps == 8)
    }

    @Test func volumeSumsWorkingSetsOnly() {
        let r = record(1, [set(100, 10, type: .warmup), set(200, 5), set(200, 5), set(200, 5, done: false)])
        let points = ExerciseMetrics.series(.volume, records: [r], measurement: load)
        #expect(abs(points[0].value - RecordedMass(2000, .pounds).kilograms) < 1e-9)
    }

    @Test func sameDaySessionsStaySeparateAndMissingSessionsAreNotZero() {
        let records = [
            record(1, [set(100, 5)]),
            record(1.4, [set(110, 5)]),
            record(9, [set(100, 5, type: .warmup)]),
            record(10, [set(120, 5)]),
        ]
        let points = ExerciseMetrics.series(.heaviestSet, records: records, measurement: load)
        #expect(points.count == 3)
        #expect(points.allSatisfy { $0.value > 0 })
    }

    @Test func bestRepsAtLoadMatchesAcrossUnitsAndSkipsSessionsWithoutIt() {
        let records = [
            record(1, [set(100, 6, unit: .kilograms)]),
            record(2, [set(90, 10, unit: .kilograms)]),
            record(3, [set(220.462262, 8, unit: .pounds)]),
        ]
        let points = ExerciseMetrics.series(.bestRepsAtLoad(RecordedMass(100, .kilograms)), records: records, measurement: load)
        #expect(points.map(\.value) == [6, 8])
    }

    @Test func excludesSessionsLoggedUnderAnotherConvention() {
        let records = [record(1, [set(50, 10)], measurement: .externalLoad(.perHand)), record(2, [set(100, 10)])]
        #expect(ExerciseMetrics.series(.heaviestSet, records: records, measurement: load).count == 1)
    }

    @Test func assistedUsesLeastAssistanceAndNoVolume() {
        let assisted = ExerciseMeasurement.assistedBodyweight
        let records = [record(1, [set(50, 8), set(40, 6)], measurement: assisted)]
        let least = ExerciseMetrics.series(.leastAssistance, records: records, measurement: assisted)
        #expect(abs(least[0].value - RecordedMass(40, .pounds).kilograms) < 1e-9)
        #expect(ExerciseMetrics.series(.volume, records: records, measurement: assisted).isEmpty)
        #expect(ExerciseMetrics.series(.heaviestSet, records: records, measurement: assisted).isEmpty)
        #expect(!ExerciseMetric.available(for: assisted).contains(.volume))
    }

    @Test func bodyweightDefaultsToRepsAndHasNoLoadMetrics() {
        let bw = ExerciseMeasurement.bodyweight
        #expect(ExerciseMetric.available(for: bw).first == .bestReps)
        let points = ExerciseMetrics.series(.bestReps, records: [record(1, [set(nil, 12), set(nil, 9)], measurement: bw)], measurement: bw)
        #expect(points.map(\.value) == [12])
        #expect(ExerciseMetrics.series(.totalReps, records: [record(1, [set(nil, 12), set(nil, 9)], measurement: bw)], measurement: bw).map(\.value) == [21])
    }

    @Test func weightedBodyweightLabelsAddedLoad() {
        #expect(ExerciseMetricKind.heaviestSet.title(for: .weightedBodyweight) == "Heaviest added load")
        #expect(ExerciseMetricKind.volume.title(for: .externalLoad(.perHand)) == "Volume (per-hand load x reps)")
        let weighted = ExerciseMeasurement.weightedBodyweight
        let points = ExerciseMetrics.series(.heaviestSet, records: [record(1, [set(0, 12), set(25, 6)], measurement: weighted)], measurement: weighted)
        #expect(points[0].reps == 6)
    }

    @Test func personalRecordsAreFactual() {
        let records = [record(1, [set(225, 8)]), record(2, [set(245, 1), set(225, 10)]), record(3, [set(245, 1)])]
        let prs = PersonalRecords(records: records, measurement: load)
        #expect(prs.bestLoad?.load == RecordedMass(245, .pounds))
        #expect(prs.bestLoad?.sessionId == records[1].sessionId, "a tie does not move the record")
        #expect(prs.mostRepsByLoad.map(\.reps) == [1, 10])
    }
}

@Suite struct BodyWeightTests {
    let utc = TimeZone(identifier: "UTC") ?? .gmt

    func weigh(_ kg: Double, day: Int, hour: Int = 8, unit: MassUnit = .kilograms) -> BodyMeasurement {
        let date = Date(timeIntervalSince1970: Double(day) * 86_400 + Double(hour) * 3600)
        return BodyMeasurement(mass: RecordedMass(unit.fromKilograms(kg), unit), measuredAt: date, timeZoneIdentifier: "UTC")
    }

    @Test func multipleDailyEntriesAreAveragedOnce() {
        let daily = BodyWeightTrend.dailyMeans([weigh(80, day: 0, hour: 7), weigh(82, day: 0, hour: 20), weigh(81, day: 1)])
        #expect(daily.map(\.meanKilograms) == [81, 81])
        #expect(daily.map(\.count) == [2, 1])
    }

    @Test func rollingAverageUsesOnlyObservedDaysInWindow() {
        let daily = BodyWeightTrend.dailyMeans([
            weigh(80, day: 0), weigh(82, day: 0), weigh(90, day: 3), weigh(70, day: 7), weigh(60, day: 20),
        ])
        let average = BodyWeightTrend.rollingAverage(daily)
        #expect(average.map(\.observedDays) == [1, 2, 2, 1])
        #expect(average[1].kilograms == 85.5, "daily mean 81 and 90, not the raw 80/82/90")
        #expect(average[2].kilograms == 80, "day 0 falls outside D-6...D for day 7")
        #expect(average[3].kilograms == 60, "no filling across the gap")
    }

    @Test func noTrendClaimWithFewerThanTwoDays() {
        let now = Date(timeIntervalSince1970: 10 * 86_400)
        let summary = BodyWeightTrend.summary([weigh(80, day: 9), weigh(81, day: 9, hour: 18)], range: .oneMonth, now: now)
        #expect(summary.rollingAverage.isEmpty)
        #expect(summary.change == nil)
        #expect(summary.daily.count == 1)
    }

    @Test func changeAndUnitsDoNotAlterMeasurements() {
        let now = Date(timeIntervalSince1970: 10 * 86_400)
        let entries = [weigh(80, day: 1, unit: .pounds), weigh(79, day: 8)]
        let summary = BodyWeightTrend.summary(entries, range: .oneMonth, now: now)
        #expect(abs((summary.change?.kilograms ?? 0) - -1) < 1e-9)
        #expect(entries[0].mass.unit == .pounds)
        #expect(summary.latest?.id == entries[1].id)
    }
}
