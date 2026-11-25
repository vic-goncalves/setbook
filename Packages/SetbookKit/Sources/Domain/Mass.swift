import Foundation

public enum MassUnit: String, Codable, Sendable, CaseIterable {
    case kilograms = "kg"
    case pounds = "lb"

    static let kilogramsPerPound = 0.45359237

    public var symbol: String { rawValue }

    public func toKilograms(_ value: Double) -> Double {
        switch self {
        case .kilograms: value
        case .pounds: value * Self.kilogramsPerPound
        }
    }

    public func fromKilograms(_ kilograms: Double) -> Double {
        switch self {
        case .kilograms: kilograms
        case .pounds: kilograms / Self.kilogramsPerPound
        }
    }
}

/// A mass exactly as the user entered it. The input value and unit are the source of truth;
/// kilograms is derived so that metrics can compare entries made in different units.
public struct RecordedMass: Hashable, Codable, Sendable {
    public var value: Double
    public var unit: MassUnit

    public init(_ value: Double, _ unit: MassUnit) {
        self.value = value
        self.unit = unit
    }

    public var kilograms: Double { unit.toKilograms(value) }

    /// Returns the original input when units match so 135 lb never displays as 134.99.
    public func value(in displayUnit: MassUnit) -> Double {
        displayUnit == unit ? value : displayUnit.fromKilograms(kilograms)
    }

    /// Loads entered in different units are the same load if they agree to within 1 g.
    public func isSameLoad(as other: RecordedMass) -> Bool {
        abs(kilograms - other.kilograms) < 0.001
    }
}
