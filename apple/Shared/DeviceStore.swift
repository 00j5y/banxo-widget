import Foundation
import Security
import BanxoCore

/// Les identifiants restent locaux à cet appareil et accessibles au widget après le premier déverrouillage.
enum DeviceStore {
    static var group: String { Bundle.main.object(forInfoDictionaryKey: "BanxoAppGroup") as? String ?? "" }
    static var keychainGroup: String { Bundle.main.object(forInfoDictionaryKey: "BanxoKeychainGroup") as? String ?? "" }
    static func cacheDirectory() throws -> URL {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { throw APIError.invalidConfiguration }
        return url.appendingPathComponent("Library/Application Support/Banxo", isDirectory: true)
    }
    static func cache(configuration: ServerConfiguration) throws -> SnapshotCache {
        SnapshotCache(directory: try cacheDirectory(), configurationID: configuration.revision)
    }
    static func isCurrent(_ revision: UUID) -> Bool { (try? load())?.revision == revision }
    static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "Banxo.Configuration", kSecAttrAccount as String: "server", kSecAttrAccessGroup as String: keychainGroup, kSecUseDataProtectionKeychain as String: true]
    }
    static func load() throws -> ServerConfiguration? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw StoreError.keychain(status) }
        let stored = try JSONDecoder().decode(ServerConfiguration.self, from: data)
        // Revalider aussi les données lues sur disque.
        return try ServerConfiguration(serverURL: stored.serverURL.absoluteString, token: stored.token, allowLocalHTTP: localHTTP, revision: stored.revision)
    }
    static func save(_ configuration: ServerConfiguration) throws {
        try SharedCacheLock.withLock(directory: cacheDirectory()) {
            let previous = try load()
            let attributes: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(configuration), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
            let update = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
            if update == errSecItemNotFound {
                let status = SecItemAdd(query.merging(attributes) { _, value in value } as CFDictionary, nil)
                guard status == errSecSuccess else { throw StoreError.keychain(status) }
            } else if update != errSecSuccess { throw StoreError.keychain(update) }
            if previous?.revision != configuration.revision { try SnapshotCache.removeAllSnapshots(directory: cacheDirectory()) }
        }
    }
    static func clear() throws {
        try SharedCacheLock.withLock(directory: cacheDirectory()) {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw StoreError.keychain(status) }
            try SnapshotCache.removeAllSnapshots(directory: cacheDirectory())
        }
    }
    static var localHTTP: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }
    enum StoreError: Error { case keychain(OSStatus) }
}
