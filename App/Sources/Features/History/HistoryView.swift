import Domain
import Persistence
import SwiftUI

struct HistoryView: View {
    var body: some View {
        Live { try SessionStore.fetchCompletedSummaries($0) } content: { sessions in
            HistoryContent(sessions: sessions)
        }
        .background(Theme.background)
        .navigationDestination(for: UUID.self) { WorkoutDetailView(sessionId: $0) }
    }
}

private struct HistoryContent: View {
    @Environment(AppModel.self) private var app
    let sessions: [SessionSummary]

    private var months: [(title: String, sessions: [SessionSummary])] {
        var result: [(String, [SessionSummary])] = []
        for session in sessions {
            let title = session.startedAt.formatted(.dateTime.month(.wide).year())
            if result.last?.0 == title {
                result[result.count - 1].1.append(session)
            } else {
                result.append((title, [session]))
            }
        }
        return result
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Spacing.l) {
                PageHeader(eyebrow: sessions.isEmpty ? nil : "\(sessions.count) workouts logged", title: "History")

                if sessions.isEmpty {
                    Card {
                        EmptyState(
                            symbol: "calendar",
                            title: "No workouts yet",
                            message: "Finished workouts land here, grouped by month, with every set you logged.",
                            actionTitle: app.activeWorkout == nil ? "Start empty workout" : nil,
                            action: app.activeWorkout == nil ? { app.startWorkout { _ in .empty() } } : nil
                        )
                    }
                }

                ForEach(months, id: \.title) { month in
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        SectionHeader(title: month.title) {
                            Text("\(month.sessions.count) workouts, \(month.sessions.reduce(0) { $0 + $1.workingSetCount }) sets")
                                .font(.metric(.caption, weight: .medium))
                                .foregroundStyle(Theme.tertiaryInk)
                        }
                        VStack(spacing: 0) {
                            ForEach(Array(month.sessions.enumerated()), id: \.element.id) { index, session in
                                if index > 0 { Hairline().padding(.leading, 64) }
                                NavigationLink(value: session.id) {
                                    HistoryRow(session: session)
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
    }
}

private struct HistoryRow: View {
    let session: SessionSummary

    private var timeZone: TimeZone { TimeZone(identifier: session.timeZoneIdentifier) ?? .current }

    var body: some View {
        HStack(spacing: Spacing.m) {
            VStack(spacing: 0) {
                Text(formatted(.dateTime.weekday(.abbreviated)).uppercased())
                    .font(.caption2.weight(.semibold))
                    .tracking(0.5)
                    .foregroundStyle(Theme.tertiaryInk)
                Text(formatted(.dateTime.day()))
                    .font(.metric(.title2))
                    .foregroundStyle(Theme.ink)
            }
            .frame(width: 48)

            VStack(alignment: .leading, spacing: 3) {
                Text(session.name)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                Text(detail)
                    .font(.metric(.footnote, weight: .regular))
                    .foregroundStyle(Theme.secondaryInk)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.tertiaryInk)
        }
        .padding(.vertical, Spacing.s)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(session.name), \(formatted(.dateTime.weekday(.wide).month().day())), \(detail)")
    }

    private func formatted(_ style: Date.FormatStyle) -> String {
        var style = style
        style.timeZone = timeZone
        return session.startedAt.formatted(style)
    }

    private var detail: String {
        [session.duration.map(Format.duration), "\(session.workingSetCount) sets"]
            .compactMap { $0 }
            .joined(separator: ", ")
    }
}
