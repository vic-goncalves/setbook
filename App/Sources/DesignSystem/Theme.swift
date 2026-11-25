import SwiftUI

/// Dark-only palette. Monochrome ink on near-black, with one signal color (green) reserved
/// for completed work and amber for warm-ups. Everything else is hierarchy through contrast.
enum Theme {
    static let background = Color(hex: 0x0B0B0C)
    static let surface = Color(hex: 0x151517)
    static let raised = Color(hex: 0x1D1D20)
    static let field = Color(hex: 0x242428)
    static let hairline = Color(hex: 0x2A2A2E)

    static let ink = Color(hex: 0xF5F5F4)
    static let secondaryInk = Color(hex: 0xA1A1A6)
    static let tertiaryInk = Color(hex: 0x6B6B72)

    /// Primary actions are ink-on-black inverted: a white button with black text.
    static let primaryFill = Color(hex: 0xF5F5F4)
    static let onPrimary = Color(hex: 0x0B0B0C)

    static let done = Color(hex: 0x4CC38A)
    static let doneSoft = Color(hex: 0x4CC38A).opacity(0.12)
    static let warmup = Color(hex: 0xE5A44B)
    static let destructive = Color(hex: 0xF0645A)

    /// Kept as an alias so links, toggles and chart highlights share one quiet tint.
    static let accent = ink
}

enum Spacing {
    static let xxs: CGFloat = 4
    static let xs: CGFloat = 8
    static let s: CGFloat = 12
    static let m: CGFloat = 16
    static let l: CGFloat = 24
    static let xl: CGFloat = 32
    static let xxl: CGFloat = 48
    static let page: CGFloat = 20
    /// Minimum height for anything tapped mid-set with sweaty hands.
    static let gymTapTarget: CGFloat = 52
}

enum Radius {
    static let card: CGFloat = 16
    static let control: CGFloat = 12
    static let field: CGFloat = 10
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

extension Font {
    /// Big numbers: rounded, tabular, so digits don't jitter as they change.
    static func metric(_ style: Font.TextStyle, weight: Font.Weight = .semibold) -> Font {
        .system(style, design: .rounded).weight(weight).monospacedDigit()
    }
}
