import SwiftUI

// MARK: Buttons

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: Spacing.gymTapTarget)
            .foregroundStyle(isEnabled ? Theme.onPrimary : Theme.tertiaryInk)
            .background(isEnabled ? Theme.primaryFill : Theme.raised, in: .rect(cornerRadius: Radius.control))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(Theme.ink)
            .background(Theme.raised, in: .rect(cornerRadius: Radius.control))
            .overlay(RoundedRectangle(cornerRadius: Radius.control).strokeBorder(Theme.hairline))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// A compact pill for in-card actions such as "Start" or "Finish".
struct PillButtonStyle: ButtonStyle {
    var prominent = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, Spacing.m)
            .frame(minHeight: 36)
            .foregroundStyle(prominent ? Theme.onPrimary : Theme.ink)
            .background(prominent ? Theme.primaryFill : Theme.raised, in: .capsule)
            .opacity(configuration.isPressed ? 0.8 : 1)
            .contentShape(.capsule)
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var primary: PrimaryButtonStyle { PrimaryButtonStyle() }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
    static var secondary: SecondaryButtonStyle { SecondaryButtonStyle() }
}

extension ButtonStyle where Self == PillButtonStyle {
    static var pill: PillButtonStyle { PillButtonStyle() }
    static var quietPill: PillButtonStyle { PillButtonStyle(prominent: false) }
}

// MARK: Containers and labels

/// A raised surface with a hairline edge. Used sparingly, for things you act on.
struct Card<Content: View>: View {
    var padding: CGFloat = Spacing.m
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: .rect(cornerRadius: Radius.card))
            .overlay(RoundedRectangle(cornerRadius: Radius.card).strokeBorder(Theme.hairline))
    }
}

/// Small uppercase label that names a section without competing with its content.
struct Eyebrow: View {
    let text: String
    var color: Color = Theme.secondaryInk

    init(_ text: String, color: Color = Theme.secondaryInk) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .tracking(0.8)
            .foregroundStyle(color)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Kept for List section headers.
struct SectionLabel: View {
    let title: String

    init(_ title: String) { self.title = title }

    var body: some View {
        Eyebrow(title).textCase(nil)
    }
}

struct SectionHeader<Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Eyebrow(title)
            Spacer()
            trailing
        }
    }
}

extension SectionHeader where Trailing == EmptyView {
    init(_ title: String) {
        self.title = title
        self.trailing = EmptyView()
    }
}

/// A labelled number: "182.4 lb" over "Latest".
struct Stat: View {
    let value: String
    let label: String
    var unit: String?
    var size: Font.TextStyle = .title2

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(.metric(size)).foregroundStyle(Theme.ink)
                if let unit {
                    Text(unit).font(.subheadline.weight(.medium)).foregroundStyle(Theme.secondaryInk)
                }
            }
            Text(label).font(.caption).foregroundStyle(Theme.secondaryInk)
        }
        .accessibilityElement(children: .combine)
    }
}

struct EmptyState: View {
    let symbol: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: Spacing.s) {
            Image(systemName: symbol)
                .font(.system(size: 26, weight: .light))
                .foregroundStyle(Theme.tertiaryInk)
                .frame(width: 56, height: 56)
                .background(Theme.raised, in: .circle)
                .accessibilityHidden(true)
            Text(title)
                .font(.headline)
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryInk)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.pill)
                    .padding(.top, Spacing.xs)
            }
        }
        .padding(.vertical, Spacing.xl)
        .padding(.horizontal, Spacing.l)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// Segmented choice rendered as quiet capsules; the native segmented control is too
/// heavy on a near-black background.
struct ChipPicker<Value: Hashable>: View {
    let options: [Value]
    @Binding var selection: Value
    let label: (Value) -> String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(options, id: \.self) { option in
                    let selected = option == selection
                    Button {
                        selection = option
                    } label: {
                        Text(label(option))
                            .font(.footnote.weight(selected ? .semibold : .medium))
                            .foregroundStyle(selected ? Theme.onPrimary : Theme.secondaryInk)
                            .padding(.horizontal, Spacing.s)
                            .frame(minHeight: 32)
                            .background(selected ? Theme.primaryFill : Theme.raised, in: .capsule)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
        }
        .scrollClipDisabled()
    }
}

struct Hairline: View {
    var body: some View {
        Rectangle().fill(Theme.hairline).frame(height: 1)
    }
}

extension View {
    /// The page background for scroll views and lists.
    func notebookBackground() -> some View {
        scrollContentBackground(.hidden).background(Theme.background)
    }

    func notebookListRow() -> some View {
        listRowBackground(Theme.background)
            .listRowSeparatorTint(Theme.hairline)
    }

    /// Opaque dark navigation bar matching the page, so content never collides with titles.
    func notebookNavigation() -> some View {
        toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}
