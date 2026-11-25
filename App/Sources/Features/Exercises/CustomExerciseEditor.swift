import Domain
import Persistence
import SwiftUI

struct CustomExerciseEditor: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    let existing: Exercise?
    @State private var name: String
    @State private var primary: MuscleGroup
    @State private var secondary: Set<MuscleGroup>
    @State private var equipment: Equipment
    @State private var type: MeasurementType
    @State private var perHand: Bool
    @State private var measurementLocked = false

    init(existing: Exercise?, initialName: String = "") {
        self.existing = existing
        _name = State(initialValue: existing?.name ?? initialName)
        _primary = State(initialValue: existing?.primaryMuscle ?? .chest)
        _secondary = State(initialValue: Set(existing?.secondaryMuscles ?? []))
        _equipment = State(initialValue: existing?.equipment ?? .barbell)
        _type = State(initialValue: existing?.measurement.type ?? .externalLoadReps)
        _perHand = State(initialValue: existing?.measurement == .externalLoad(.perHand))
    }

    private var measurement: ExerciseMeasurement {
        switch type {
        case .externalLoadReps: .externalLoad(perHand ? .perHand : .total)
        case .bodyweightReps: .bodyweight
        case .weightedBodyweightReps: .weightedBodyweight
        case .assistedBodyweightReps: .assistedBodyweight
        }
    }

    var body: some View {
        Form {
            Section {
                TextField("Name", text: $name)
                    .font(.body.weight(.medium))
                    .submitLabel(.done)
            } footer: {
                Text("Make variants separate exercises, such as \"Incline Press (Dumbbell)\", so their progress isn't mixed.")
            }

            Section("Muscles") {
                Picker("Primary", selection: $primary) {
                    ForEach(MuscleGroup.allCases, id: \.self) { Text($0.displayName).tag($0) }
                }
                NavigationLink {
                    MultiSelectList(title: "Secondary", options: MuscleGroup.allCases.filter { $0 != primary }, label: \.displayName, selection: $secondary)
                } label: {
                    LabeledContent("Secondary", value: secondary.isEmpty ? "None" : secondary.map(\.displayName).sorted().joined(separator: ", "))
                }
            }

            Section {
                Picker("Equipment", selection: $equipment) {
                    ForEach(Equipment.allCases, id: \.self) { Text($0.displayName).tag($0) }
                }
                Picker("Logged as", selection: $type) {
                    Text("Weight and reps").tag(MeasurementType.externalLoadReps)
                    Text("Reps only").tag(MeasurementType.bodyweightReps)
                    Text("Added weight and reps").tag(MeasurementType.weightedBodyweightReps)
                    Text("Assistance and reps").tag(MeasurementType.assistedBodyweightReps)
                }
                .disabled(measurementLocked)
                if type == .externalLoadReps {
                    Picker("Weight entered", selection: $perHand) {
                        Text("Total").tag(false)
                        Text("Per hand").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .disabled(measurementLocked)
                }
            } header: {
                Text("Tracking")
            } footer: {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    if let explanation = measurement.loadExplanation { Text(explanation) }
                    if measurementLocked { Text("Tracking can't change after the exercise has been logged.") }
                }
            }
        }
        .notebookBackground()
        .notebookNavigation()
        .navigationTitle(existing == nil ? "New exercise" : "Edit exercise")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save", action: save)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .task {
            guard let id = existing?.id else { return }
            measurementLocked = (try? app.database.read { try ExerciseStore.hasLoggedHistory(id, $0) }) ?? false
        }
    }

    private func save() {
        var exercise = existing ?? Exercise(name: name, primaryMuscle: primary, equipment: equipment, measurement: measurement)
        exercise.name = name
        exercise.primaryMuscle = primary
        exercise.secondaryMuscles = MuscleGroup.allCases.filter { secondary.contains($0) && $0 != primary }
        exercise.equipment = equipment
        exercise.measurement = measurement
        let toSave = exercise
        if app.perform({ try ExerciseStore.saveCustom(toSave, $0) }) != nil {
            dismiss()
        }
    }
}

struct MultiSelectList<Option: Hashable>: View {
    let title: String
    let options: [Option]
    let label: KeyPath<Option, String>
    @Binding var selection: Set<Option>

    var body: some View {
        List(options, id: \.self) { option in
            Button {
                if selection.contains(option) { selection.remove(option) } else { selection.insert(option) }
            } label: {
                HStack {
                    Text(option[keyPath: label]).foregroundStyle(Theme.ink)
                    Spacer()
                    if selection.contains(option) {
                        Image(systemName: "checkmark").foregroundStyle(Theme.ink)
                    }
                }
                .frame(minHeight: 44)
            }
            .accessibilityAddTraits(selection.contains(option) ? .isSelected : [])
        }
        .notebookBackground()
        .notebookNavigation()
        .navigationTitle(title)
    }
}
