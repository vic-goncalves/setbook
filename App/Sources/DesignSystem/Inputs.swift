import Domain
import SwiftUI

enum NumberInput {
    /// Accepts "135", "62.5" and "62,5". Nil for empty or unparseable text.
    static func decimal(_ text: String) -> Double? {
        let cleaned = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard !cleaned.isEmpty, let value = Double(cleaned), value.isFinite else { return nil }
        return value
    }

    static func integer(_ text: String) -> Int? {
        Int(text.trimmingCharacters(in: .whitespaces))
    }

    static func text(_ mass: RecordedMass?, unit: MassUnit) -> String {
        mass.map { Format.mass($0, in: unit, withUnit: false) } ?? ""
    }
}

/// A compact numeric field for set rows: large tabular digits, centered on a quiet well.
struct SetField: View {
    @Binding var text: String
    let prompt: String
    let keyboard: UIKeyboardType
    let accessibilityLabel: String
    var invalid = false
    var completed = false

    var body: some View {
        TextField("", text: $text, prompt: Text(prompt).foregroundStyle(Theme.tertiaryInk))
            .keyboardType(keyboard)
            .multilineTextAlignment(.center)
            .font(.metric(.body))
            .foregroundStyle(completed ? Theme.done : Theme.ink)
            .frame(minWidth: 52, minHeight: 40)
            .background(completed ? Color.clear : Theme.field, in: .rect(cornerRadius: Radius.field))
            .overlay {
                if invalid {
                    RoundedRectangle(cornerRadius: Radius.field).strokeBorder(Theme.destructive, lineWidth: 1.5)
                }
            }
            .accessibilityLabel(accessibilityLabel)
    }
}

/// A sheet for drag-reordering a list of named items. Rows are always in edit mode so the
/// drag handles are visible immediately; changes apply only on Done.
struct ReorderSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    @State var items: [(id: UUID, name: String)]
    let onDone: ([UUID]) -> Void

    var body: some View {
        NavigationStack {
            List {
                ForEach(items, id: \.id) { item in
                    Text(item.name)
                        .font(.body.weight(.medium))
                        .foregroundStyle(Theme.ink)
                        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                        .listRowBackground(Theme.surface)
                        .listRowSeparatorTint(Theme.hairline)
                }
                .onMove { items.move(fromOffsets: $0, toOffset: $1) }
            }
            .listStyle(.insetGrouped)
            .environment(\.editMode, .constant(.active))
            .notebookBackground()
            .notebookNavigation()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onDone(items.map(\.id))
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Theme.background)
        .presentationDragIndicator(.visible)
    }
}

enum RestOptions {
    static let seconds = [30, 45, 60, 90, 120, 150, 180, 240, 300]

    static func label(_ seconds: Int?) -> String {
        seconds.map(Format.clock) ?? "Off"
    }
}
