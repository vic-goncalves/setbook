import Domain
import Persistence
import SwiftUI
import Workflow

struct FinishSheet: View {
    @Environment(\.dismiss) private var dismiss
    let plan: WorkoutController.FinishPlan
    let unit: MassUnit
    let onSave: (_ updateTemplate: Bool) -> Void

    @State private var updateTemplate = false

    private var session: WorkoutSession { plan.finished }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.l) {
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.done)
                            Eyebrow("Workout complete", color: Theme.done)
                        }
                        Text(session.name)
                            .font(.largeTitle.weight(.bold))
                            .tracking(-0.5)
                            .foregroundStyle(Theme.ink)
                    }

                    HStack(alignment: .top) {
                        Stat(value: Format.stopwatch(session.duration ?? 0), label: "Duration")
                        Spacer()
                        Stat(value: "\(session.completedWorkingSetCount)", label: "Working sets")
                        Spacer()
                        Stat(value: "\(session.exercises.count)", label: "Exercises")
                    }
                    .padding(Spacing.m)
                    .background(Theme.surface, in: .rect(cornerRadius: Radius.card))
                    .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Theme.hairline))

                    VStack(alignment: .leading, spacing: Spacing.s) {
                        Eyebrow("Best working set")
                        VStack(spacing: 0) {
                            ForEach(Array(session.exercises.enumerated()), id: \.element.id) { index, exercise in
                                if index > 0 { Hairline() }
                                HStack {
                                    Text(exercise.exerciseName).font(.subheadline).foregroundStyle(Theme.ink)
                                    Spacer()
                                    Text(bestSet(exercise)).font(.metric(.subheadline)).foregroundStyle(Theme.ink)
                                }
                                .padding(.vertical, Spacing.s)
                                .accessibilityElement(children: .combine)
                            }
                        }
                    }

                    if let proposal = plan.templateProposal {
                        Card {
                            VStack(alignment: .leading, spacing: Spacing.s) {
                                Toggle(isOn: $updateTemplate) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Update \u{201C}\(proposal.updatedTemplate.name)\u{201D}")
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(Theme.ink)
                                        Text("You changed this workout's structure.")
                                            .font(.caption)
                                            .foregroundStyle(Theme.secondaryInk)
                                    }
                                }
                                .tint(Theme.done)
                                Hairline()
                                ForEach(proposal.changes, id: \.self) { change in
                                    HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
                                        Image(systemName: "arrow.turn.down.right").font(.caption2)
                                        Text(change.description)
                                    }
                                    .font(.footnote)
                                    .foregroundStyle(Theme.secondaryInk)
                                }
                                Text("Off keeps the template as it was. Your logged weights and reps never change its targets on their own.")
                                    .font(.caption)
                                    .foregroundStyle(Theme.tertiaryInk)
                                    .padding(.top, Spacing.xxs)
                            }
                        }
                    }
                }
                .padding(.horizontal, Spacing.page)
                .padding(.vertical, Spacing.m)
            }
            .background(Theme.background)
            .notebookNavigation()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Back") { dismiss() } }
            }
            .safeAreaInset(edge: .bottom) {
                Button("Save workout") { onSave(updateTemplate) }
                    .buttonStyle(.primary)
                    .padding(.horizontal, Spacing.page)
                    .padding(.vertical, Spacing.s)
                    .background(Theme.background)
            }
        }
    }

    private func bestSet(_ exercise: WorkoutExercise) -> String {
        let working = exercise.completedSets.filter { $0.type == .working }
        let best = exercise.measurement.tracksLoad
            ? working.max { ($0.load?.kilograms ?? 0, $0.reps ?? 0) < ($1.load?.kilograms ?? 0, $1.reps ?? 0) }
            : working.max { ($0.reps ?? 0) < ($1.reps ?? 0) }
        return best.map { Format.set($0, unit: unit) } ?? "Warm-ups only"
    }
}
