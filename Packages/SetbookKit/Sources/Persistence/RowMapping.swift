import Domain
import Foundation
import GRDB

extension Row {
    func uuid(_ column: String) throws -> UUID {
        guard let string: String = self[column], let uuid = UUID(uuidString: string) else {
            throw StoreError.invalidRecord("\(column) is not a UUID")
        }
        return uuid
    }

    func optionalUUID(_ column: String) -> UUID? {
        (self[column] as String?).flatMap(UUID.init(uuidString:))
    }

    func enumValue<T: RawRepresentable>(_ column: String) throws -> T where T.RawValue == String {
        guard let raw: String = self[column], let value = T(rawValue: raw) else {
            throw StoreError.invalidRecord("\(column) has unknown value")
        }
        return value
    }

    func optionalEnum<T: RawRepresentable>(_ column: String) -> T? where T.RawValue == String {
        (self[column] as String?).flatMap(T.init(rawValue:))
    }

    func mass(value valueColumn: String, unit unitColumn: String) -> RecordedMass? {
        guard let value: Double = self[valueColumn], let unit: MassUnit = optionalEnum(unitColumn) else { return nil }
        return RecordedMass(value, unit)
    }

    func repTarget(min minColumn: String, max maxColumn: String) -> RepTarget? {
        guard let min: Int = self[minColumn], let max: Int = self[maxColumn] else { return nil }
        return RepTarget(min: min, max: max)
    }

    func measurement(type typeColumn: String, convention conventionColumn: String) throws -> ExerciseMeasurement {
        let type: MeasurementType = try enumValue(typeColumn)
        let convention: LoadConvention? = optionalEnum(conventionColumn)
        guard let measurement = ExerciseMeasurement(type: type, loadConvention: convention) else {
            throw StoreError.invalidRecord("invalid measurement \(type) / \(String(describing: convention))")
        }
        return measurement
    }
}

/// Builds a `?, ?, ?` placeholder list for IN clauses.
func placeholders(_ count: Int) -> String {
    Array(repeating: "?", count: count).joined(separator: ", ")
}
