import Domain
import Persistence
import SwiftUI

/// The exercise catalog. In browse mode rows open details; in pick mode rows toggle selection.
struct ExerciseLibraryView: View {
    enum Mode {
        case browse
        case pick(onDone: ([Exercise]) -> Void)
    }

    var mode: Mode = .browse

    var body: some View {
        Live { try ExerciseStore.fetchAll($0) } content: { exercises in
            ExerciseList(exercises: exercises, mode: mode)
        }
        .background(Theme.background)
    }
}

private struct ExerciseList: View {
    @Environment(\.dismiss) private var dismiss
    let exercises: [Exercise]
    let mode: ExerciseLibraryView.Mode

    @State private var search = ""
    @State private var muscle: MuscleGroup?
    @State private var equipment: Equipment?
    @State private var selection: [Exercise] = []
    @State private var editing: Exercise?
    @State private var creating = false

    private var filtered: [Exercise] {
        exercises.filter { exercise in
            exercise.matches(search: search)
                && (muscle.map { exercise.primaryMuscle == $0 || exercise.secondaryMuscles.contains($0) } ?? true)
                && (equipment.map { exercise.equipment == $0 } ?? true)
        }
    }

    private var isPicking: Bool {
        if case .pick = mode { return true }
        return false
    }

    var body: some View {
        List {
            Section {
                filters
                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                    .listRowBackground(Theme.background)
                    .listRowSeparator(.hidden)
            }
            Section {
                if filtered.isEmpty {
                    EmptyState(
                        symbol: "magnifyingglass",
                        title: "No matches",
                        message: "Try another search, or create it as a custom exercise.",
                        actionTitle: "Create exercise",
                        action: { creating = true }
                    )
                    .notebookListRow()
                }
                ForEach(filtered) { exercise in
                    row(exercise).notebookListRow()
                }
            }
        }
        .listStyle(.plain)
        .notebookBackground()
        .notebookNavigation()
        .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search exercises")
        .navigationTitle(isPicking ? "Add exercises" : "Exercises")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { creating = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New custom exercise")
            }
            if case .pick(let onDone) = mode {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .bottomBar) {
                    Button(selection.isEmpty ? "Select exercises" : "Add \(selection.count)") {
                        onDone(selection)
                        dismiss()
                    }
                    .buttonStyle(.primary)
                    .disabled(selection.isEmpty)
                }
            }
        }
        .sheet(isPresented: $creating) {
            NavigationStack { CustomExerciseEditor(existing: nil, initialName: search) }
        }
        .sheet(item: $editing) { exercise in
            NavigationStack { CustomExerciseEditor(existing: exercise) }
        }
    }

    @ViewBuilder
    private func row(_ exercise: Exercise) -> some View {
        let selected = selection.contains { $0.id == exercise.id }
        let label = HStack(spacing: Spacing.s) {
            VStack(alignment: .leading, spacing: 2) {
                Text(exercise.name).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                Text(subtitle(exercise)).font(.footnote).foregroundStyle(Theme.secondaryInk)
            }
            Spacer()
            if isPicking {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(selected ? Theme.done : Theme.tertiaryInk)
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: 44)
        .contentShape(.rect)

        switch mode {
        case .pick:
            Button {
                if selected { selection.removeAll { $0.id == exercise.id } } else { selection.append(exercise) }
            } label: { label }
            .buttonStyle(.plain)
            .accessibilityAddTraits(selected ? .isSelected : [])
        case .browse:
            NavigationLink { ExerciseDetailView(exercise: exercise, onEdit: { editing = $0 }) } label: { label }
        }
    }

    private func subtitle(_ exercise: Exercise) -> String {
        var parts = [exercise.primaryMuscle.displayName, exercise.equipment.displayName]
        if !exercise.isBuiltIn { parts.append("Custom") }
        return parts.joined(separator: ", ")
    }

    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.xs) {
                Menu {
                    Button("Any muscle") { muscle = nil }
                    ForEach(MuscleGroup.allCases, id: \.self) { group in
                        Button(group.displayName) { muscle = group }
                    }
                } label: {
                    FilterChip(title: muscle?.displayName ?? "Muscle", active: muscle != nil)
                }
                Menu {
                    Button("Any equipment") { equipment = nil }
                    ForEach(Equipment.allCases, id: \.self) { item in
                        Button(item.displayName) { equipment = item }
                    }
                } label: {
                    FilterChip(title: equipment?.displayName ?? "Equipment", active: equipment != nil)
                }
            }
            .padding(.horizontal, Spacing.page)
            .padding(.vertical, Spacing.xs)
        }
    }
}

private struct FilterChip: View {
    let title: String
    let active: Bool

    var body: some View {
        HStack(spacing: 4) {
            Text(title)
            Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(active ? Theme.onPrimary : Theme.ink)
        .padding(.horizontal, Spacing.s)
        .frame(minHeight: 32)
        .background(active ? Theme.primaryFill : Theme.raised, in: .capsule)
    }
}
