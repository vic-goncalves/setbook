import SwiftUI
import Workflow

/// Keeps the in-progress workout one tap away from History and Progress.
struct ActiveWorkoutBar: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        if let workout = app.activeWorkout, !app.isWorkoutPresented {
            Button { app.isWorkoutPresented = true } label: {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    HStack(spacing: Spacing.s) {
                        Circle().fill(Theme.done).frame(width: 8, height: 8)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(workout.session.name).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                            Text(detail(workout, now: context.date))
                                .font(.metric(.caption, weight: .medium))
                                .foregroundStyle(Theme.secondaryInk)
                        }
                        Spacer()
                        Text("Resume")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.onPrimary)
                            .padding(.horizontal, Spacing.s)
                            .frame(minHeight: 30)
                            .background(Theme.primaryFill, in: .capsule)
                    }
                    .padding(.leading, Spacing.m)
                    .padding(.trailing, Spacing.xs)
                    .frame(minHeight: Spacing.gymTapTarget)
                    .background(Theme.raised, in: .rect(cornerRadius: 18))
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.hairline))
                    .shadow(color: .black.opacity(0.4), radius: 16, y: 6)
                    .padding(.horizontal, Spacing.s)
                    .padding(.bottom, Spacing.xs)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Workout in progress, \(workout.session.name)")
            .accessibilityHint("Opens the workout")
        }
    }

    private func detail(_ workout: WorkoutController, now: Date) -> String {
        var parts = [Format.stopwatch(now.timeIntervalSince(workout.session.startedAt))]
        if let timer = workout.restTimer, !timer.isFinished(at: now) {
            parts.append("rest \(Format.clock(timer.remaining(at: now)))")
        }
        return parts.joined(separator: "  ")
    }
}
