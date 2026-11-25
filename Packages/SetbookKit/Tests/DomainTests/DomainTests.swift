import Foundation
import Testing
@testable import Domain

let bench = Exercise(name: "Bench Press (Barbell)", primaryMuscle: .chest, equipment: .barbell, measurement: .externalLoad(.total))
let dip = Exercise(name: "Dip (Weighted)", primaryMuscle: .chest, equipment: .bodyweight, measurement: .weightedBodyweight)
let row = Exercise(name: "Row (Machine)", primaryMuscle: .back, equipment: .machine, measurement: .externalLoad(.total))

func completed(_ load: Double?, _ reps: Int, unit: MassUnit = .pounds, type: SetType = .working) -> WorkoutSet {
    WorkoutSet(type: type, load: load.map { RecordedMass($0, unit) }, reps: reps, completedAt: Date(timeIntervalSince1970: 1))
}

@Suite struct MassTests {
    @Test func preservesOriginalInputInSameUnit() {
        let mass = RecordedMass(135, .pounds)
        #expect(mass.value(in: .pounds) == 135)
        #expect(abs(mass.value(in: .kilograms) - 61.235) < 0.001)
    }

    @Test func comparesLoadsAcrossUnits() {
        #expect(RecordedMass(100, .kilograms).isSameLoad(as: RecordedMass(220.462262, .pounds)))
        #expect(!RecordedMass(100, .kilograms).isSameLoad(as: RecordedMass(220, .pounds)))
    }
}

@Suite struct MeasurementTests {
    @Test func rejectsImpossibleCombinations() {
        #expect(ExerciseMeasurement(type: .bodyweightReps, loadConvention: .perHand) == nil)
        #expect(ExerciseMeasurement(type: .externalLoadReps, loadConvention: nil) == nil)
        #expect(ExerciseMeasurement(type: .assistedBodyweightReps, loadConvention: .assistance) == .assistedBodyweight)
    }

    @Test func codableRoundTripAndInvalidDecode() throws {
        let encoded = try JSONEncoder().encode(ExerciseMeasurement.externalLoad(.perHand))
        #expect(try JSONDecoder().decode(ExerciseMeasurement.self, from: encoded) == .externalLoad(.perHand))
        let bad = Data(#"{"type":"bodyweight_reps","loadConvention":"added"}"#.utf8)
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(ExerciseMeasurement.self, from: bad) }
    }

    @Test func repTargetValidation() {
        #expect(RepTarget(min: 0, max: 5) == nil)
        #expect(RepTarget(min: 8, max: 6) == nil)
        #expect(RepTarget(min: 8, max: 12)?.displayText == "8-12")
        #expect(RepTarget.exactly(5)?.isExact == true)
    }

    @Test func setValidationByMeasurement() {
        #expect(completed(0, 8).validate(for: .weightedBodyweight) == nil, "zero added load is legitimate")
        #expect(completed(nil, 8).validate(for: .weightedBodyweight) == .missingLoad)
        #expect(completed(nil, 8).validate(for: .bodyweight) == nil)
        #expect(completed(10, 8).validate(for: .bodyweight) == .unexpectedLoad)
        #expect(completed(-5, 8).validate(for: .externalLoad(.total)) == .negativeLoad)
        #expect(completed(100, 0).validate(for: .externalLoad(.total)) == .nonPositiveReps)
    }
}

@Suite struct SessionTests {
    let catalog = [bench.id: bench, dip.id: dip, row.id: row]

    var push: WorkoutTemplate {
        WorkoutTemplate(name: "Push", revision: 3, exercises: [
            TemplateExercise(exerciseId: bench.id, restSeconds: 120, sets: [
                TemplateSet(type: .warmup, targetReps: .exactly(10), targetLoad: RecordedMass(95, .pounds)),
                TemplateSet(targetReps: RepTarget(min: 6, max: 8), targetLoad: RecordedMass(185, .pounds)),
                TemplateSet(targetReps: RepTarget(min: 6, max: 8), targetLoad: RecordedMass(185, .pounds)),
            ]),
            TemplateExercise(exerciseId: dip.id, restSeconds: nil, sets: [TemplateSet(targetReps: .exactly(10))]),
        ])
    }

    @Test func startingSnapshotsTemplateIndependently() {
        var template = push
        let session = WorkoutSession.starting(from: template, exercises: catalog)
        template.exercises.removeAll()
        template.name = "Changed"

        #expect(session.name == "Push")
        #expect(session.sourceTemplate == TemplateReference(templateId: template.id, revision: 3))
        #expect(session.exercises.map(\.exerciseName) == ["Bench Press (Barbell)", "Dip (Weighted)"])
        #expect(session.exercises[0].sets.count == 3)
        #expect(session.exercises[0].sets.allSatisfy { !$0.isCompleted && $0.load == nil && $0.reps == nil })
        #expect(session.exercises[0].sets[1].targetLoad == RecordedMass(185, .pounds))
        #expect(session.exercises[1].restSeconds == nil)
    }

    @Test func repeatingCopiesLoggedValuesAsIncompleteTargets() {
        var past = WorkoutSession.starting(from: push, exercises: catalog)
        past.exercises[0].sets = [completed(95, 10, type: .warmup), completed(185, 7), WorkoutSet()]
        past.exercises[1].sets = [WorkoutSet()]

        let next = WorkoutSession.repeating(past, exercises: catalog, now: Date(timeIntervalSince1970: 100))

        #expect(next.exercises.count == 1, "exercises with nothing completed are dropped")
        let sets = next.exercises[0].sets
        #expect(sets.map(\.type) == [.warmup, .working])
        #expect(sets.map(\.targetReps) == [.exactly(10), .exactly(7)])
        #expect(sets[1].targetLoad == RecordedMass(185, .pounds))
        #expect(sets.allSatisfy { !$0.isCompleted && $0.reps == nil && $0.load == nil })
        #expect(next.id != past.id)
    }

    @Test func finishingStripsIncompleteSetsAndRequiresOne() {
        var session = WorkoutSession.starting(from: push, exercises: catalog)
        #expect(session.finished() == nil)

        session.exercises[0].sets[1] = completed(185, 8)
        let finished = session.finished(at: Date())
        #expect(finished?.state == .completed)
        #expect(finished?.exercises.count == 1)
        #expect(finished?.exercises[0].sets.count == 1)
        #expect(finished?.completedWorkingSetCount == 1)
    }

    @Test func addSetCopiesPrescriptionNotPerformance() {
        var exercise = WorkoutExercise(adding: bench)
        exercise.sets = [WorkoutSet(targetReps: .exactly(5), targetLoad: RecordedMass(100, .kilograms), load: RecordedMass(100, .kilograms), reps: 5, completedAt: Date())]
        exercise.addSet()
        #expect(exercise.sets[1].targetReps == .exactly(5))
        #expect(exercise.sets[1].load == nil)
        #expect(!exercise.sets[1].isCompleted)
    }
}

@Suite struct TemplateUpdateTests {
    let catalog = [bench.id: bench, dip.id: dip, row.id: row]
    let names = [bench.id: bench.name, dip.id: dip.name, row.id: row.name]

    var template: WorkoutTemplate {
        WorkoutTemplate(name: "Push", exercises: [
            TemplateExercise(exerciseId: bench.id, sets: [TemplateSet(targetReps: .exactly(5)), TemplateSet(targetReps: .exactly(5))]),
            TemplateExercise(exerciseId: dip.id, notes: "Lean forward", sets: [TemplateSet(targetReps: .exactly(10))]),
        ])
    }

    func proposal(_ session: WorkoutSession, _ template: WorkoutTemplate) -> TemplateUpdateProposal? {
        TemplateUpdateProposal(template: template, session: session, exerciseName: { names[$0] ?? "?" })
    }

    @Test func actualPerformanceAloneProposesNothing() {
        let template = template
        var session = WorkoutSession.starting(from: template, exercises: catalog)
        session.exercises[0].sets[0] = WorkoutSet(targetReps: .exactly(5), load: RecordedMass(225, .pounds), reps: 7, completedAt: Date())
        #expect(proposal(session, template) == nil)
    }

    @Test func detectsStructuralChangesAndBumpsRevision() {
        let template = template
        var session = WorkoutSession.starting(from: template, exercises: catalog)
        session.exercises[0].addSet()
        session.exercises.swapAt(0, 1)
        session.exercises.append(WorkoutExercise(adding: row))

        let result = proposal(session, template)
        #expect(result?.changes.contains(.setCount(exercise: bench.name, from: 2, to: 3)) == true)
        #expect(result?.changes.contains(.added(exercise: row.name)) == true)
        #expect(result?.changes.contains(.reordered) == true)
        #expect(result?.updatedTemplate.revision == template.revision + 1)
        #expect(result?.updatedTemplate.exercises.map(\.exerciseId) == [dip.id, bench.id, row.id])
        #expect(result?.updatedTemplate.exercises[0].notes == "Lean forward", "template notes are kept")
    }

    @Test func detectsRemoval() {
        let template = template
        var session = WorkoutSession.starting(from: template, exercises: catalog)
        session.exercises.remove(at: 1)
        #expect(proposal(session, template)?.changes == [.removed(exercise: dip.name)])
    }
}

@Suite struct PreviousPerformanceTests {
    @Test func alignsByTypeAndOrdinal() {
        let previous = PreviousPerformance(sessionId: UUID(), date: Date(), sets: [
            completed(95, 10, type: .warmup), completed(185, 8), completed(185, 7), WorkoutSet(),
        ])
        let today = [WorkoutSet(type: .warmup), WorkoutSet(type: .warmup), WorkoutSet(), WorkoutSet(), WorkoutSet()]

        #expect(previous.sets.count == 3, "incomplete sets are not previous performance")
        #expect(previous.counterpart(forSetAt: 0, in: today)?.reps == 10)
        #expect(previous.counterpart(forSetAt: 1, in: today) == nil, "no second warm-up last time")
        #expect(previous.counterpart(forSetAt: 2, in: today)?.reps == 8)
        #expect(previous.counterpart(forSetAt: 3, in: today)?.reps == 7)
        #expect(previous.counterpart(forSetAt: 4, in: today) == nil)
    }
}

@Suite struct CatalogTests {
    @Test func idsAreStableUniqueVersion5() {
        let ids = ExerciseCatalog.all.map(\.id)
        #expect(Set(ids).count == ids.count)
        #expect(Set(ExerciseCatalog.all.map(\.name)).count == ids.count)
        #expect(ExerciseCatalog.builtInID(slug: "barbell-bench-press") == ExerciseCatalog.builtInID(slug: "barbell-bench-press"))
        #expect(ExerciseCatalog.builtInID(slug: "barbell-bench-press").uuidString.dropFirst(14).first == "5")
        #expect(ExerciseCatalog.all.count >= 60)
    }
}
