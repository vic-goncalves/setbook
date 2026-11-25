import Foundation
import Security

/// The signed-in account's credentials. Lives only in the Keychain.
struct StoredCredentials: Codable, Equatable, Sendable {
    var accessToken: String
    var refreshToken: String
    var accessExpiresAt: Date
    var userId: String
    var displayName: String?
    var email: String?
}

enum KeychainTokenStore {
    private static let service = "app.setbook.credentials"
    private static let account = "current"

    static func load() -> StoredCredentials? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(StoredCredentials.self, from: data)
    }

    static func save(_ credentials: StoredCredentials) {
        guard let data = try? JSONEncoder().encode(credentials) else { return }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        if SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            SecItemAdd(baseQuery.merging(attributes) { $1 } as CFDictionary, nil)
        }
    }

    static func delete() {
        SecItemDelete(baseQuery as CFDictionary)
    }

    private static var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
}
