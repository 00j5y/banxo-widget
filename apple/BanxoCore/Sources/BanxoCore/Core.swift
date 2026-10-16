import Foundation
import Darwin

/// État transmis par le serveur, sans solde inventé.
public enum BalanceStatus: String, Codable, Sendable { case ready, stale, reconnectRequired = "reconnect_required", notConnected = "not_connected", error }
public enum BalanceKind: String, Codable, Sendable { case booked, available }

/// Instantané conservant le montant décimal exact reçu sous forme de chaîne.
public struct BalanceSnapshot: Codable, Sendable, Equatable {
    public let amount: Decimal?
    public let currency: String
    public let accountLabel: String
    public let balanceKind: BalanceKind?
    public let fetchedAt: Date?
    public let sourceDate: String?
    public let consentExpiresAt: Date?
    public let status: BalanceStatus
    enum CodingKeys: String, CodingKey { case amount, currency, accountLabel, balanceKind, fetchedAt, sourceDate, consentExpiresAt, status }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let text = try c.decodeIfPresent(String.self, forKey: .amount) {
            let digits = text.filter(\.isNumber).drop(while: { $0 == "0" })
            guard text.range(of: #"^-?[0-9]+(\.[0-9]+)?$"#, options: .regularExpression) != nil,
                  digits.count <= 38, let value = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")), !value.isNaN else {
                throw DecodingError.dataCorruptedError(forKey: .amount, in: c, debugDescription: "Montant décimal invalide")
            }
            amount = value
        } else { amount = nil }
        currency = try c.decode(String.self, forKey: .currency)
        guard currency.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil else { throw APIError.invalidPayload }
        accountLabel = try c.decode(String.self, forKey: .accountLabel)
        balanceKind = try c.decodeIfPresent(BalanceKind.self, forKey: .balanceKind)
        sourceDate = try c.decodeIfPresent(String.self, forKey: .sourceDate)
        status = try c.decode(BalanceStatus.self, forKey: .status)
        func date(_ key: CodingKeys) throws -> Date? {
            guard let text = try c.decodeIfPresent(String.self, forKey: key) else { return nil }
            let standard = ISO8601DateFormatter()
            let fractional = ISO8601DateFormatter(); fractional.formatOptions.insert(.withFractionalSeconds)
            guard let result = standard.date(from: text) ?? fractional.date(from: text) else { throw APIError.invalidPayload }
            return result
        }
        fetchedAt = try date(.fetchedAt)
        consentExpiresAt = try date(.consentExpiresAt)
    }
    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(amount.map { NSDecimalNumber(decimal: $0).stringValue }, forKey: .amount)
        try c.encode(currency, forKey: .currency); try c.encode(accountLabel, forKey: .accountLabel)
        try c.encode(balanceKind, forKey: .balanceKind); try c.encode(sourceDate, forKey: .sourceDate)
        try c.encode(status, forKey: .status)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions.insert(.withFractionalSeconds)
        try c.encode(fetchedAt.map { formatter.string(from: $0) }, forKey: .fetchedAt)
        try c.encode(consentExpiresAt.map { formatter.string(from: $0) }, forKey: .consentExpiresAt)
    }
    public static func decode(_ data: Data) throws -> Self { try JSONDecoder().decode(Self.self, from: data) }
    public func effectiveStatus(at date: Date = .now) -> BalanceStatus {
        guard status == .ready else { return status }
        guard let fetchedAt else { return .stale }
        return date.timeIntervalSince(fetchedAt) >= 8 * 3600 ? .stale : .ready
    }
}

public enum APIError: Error, Equatable, Sendable { case invalidConfiguration, invalidPayload, unauthorized, http(Int), invalidResponse }
/// Les exceptions HTTP sont strictement limitées aux boucles locales de développement.
public struct ServerConfiguration: Codable, Sendable {
    public let revision: UUID
    public let serverURL: URL
    public let token: String
    public init(serverURL: String, token: String, allowLocalHTTP: Bool = false, revision: UUID = UUID()) throws {
        guard let url = URL(string: serverURL), let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.scheme == "https" || (allowLocalHTTP && url.scheme == "http" && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host)),
              !token.isEmpty, token.unicodeScalars.allSatisfy({ $0.value >= 33 && $0.value <= 126 }) else { throw APIError.invalidConfiguration }
        self.revision = revision; self.serverURL = url; self.token = token
    }
}

public protocol HTTPTransport: Sendable { func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) }
/// Aucun transfert de Bearer lors d'une redirection, même vers le même hôte.
public final class SessionTransport: NSObject, HTTPTransport, URLSessionTaskDelegate, Sendable {
    public override init() { super.init() }
    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil; configuration.httpCookieStorage = nil
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        return (data, http)
    }
}
public struct BalanceClient: Sendable {
    let transport: any HTTPTransport
    public init(transport: any HTTPTransport = SessionTransport()) { self.transport = transport }
    public func fetch(configuration: ServerConfiguration) async throws -> BalanceSnapshot {
        var request = URLRequest(url: configuration.serverURL.appendingPathComponent("api/v1/balance"))
        request.setValue("Bearer \(configuration.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData; request.timeoutInterval = 25
        let (data, response) = try await transport.send(request)
        guard response.statusCode != 401 && response.statusCode != 403 else { throw APIError.unauthorized }
        guard response.statusCode == 200 else { throw APIError.http(response.statusCode) }
        guard data.count < 64 * 1024 else { throw APIError.invalidPayload }
        return try BalanceSnapshot.decode(data)
    }
}


/// Verrou interprocessus commun au trousseau et aux instantanés.
public enum SharedCacheLock {
    public static func withLock<T>(directory: URL, _ action: () throws -> T) throws -> T {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let descriptor = open(directory.appendingPathComponent(".lock").path, O_CREAT | O_RDWR, 0o600)
        guard descriptor >= 0 else { throw POSIXError(.EIO) }
        defer { close(descriptor) }
        guard flock(descriptor, LOCK_EX) == 0 else { throw POSIXError(.EIO) }
        defer { _ = flock(descriptor, LOCK_UN) }
        return try action()
    }
}

/// L'acteur protège ce processus, flock coordonne les processus et le remplacement JSON reste atomique.
public actor SnapshotCache {
    let root: URL
    let configurationID: UUID?
    var directory: URL { configurationID.map { root.appendingPathComponent($0.uuidString, isDirectory: true) } ?? root }
    var file: URL { directory.appendingPathComponent("balance.json") }
    public init(directory: URL, configurationID: UUID? = nil) { root = directory; self.configurationID = configurationID }
    @discardableResult
    public func save(_ snapshot: BalanceSnapshot, ifCurrent: @Sendable () -> Bool = { true }) throws -> Bool {
        try SharedCacheLock.withLock(directory: root) {
            guard ifCurrent() else { return false }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            var directoryURL = directory
            var resourceValues = URLResourceValues(); resourceValues.isExcludedFromBackup = true
            try directoryURL.setResourceValues(resourceValues)
            let data = try JSONEncoder().encode(snapshot)
            #if os(iOS)
            try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            #else
            try data.write(to: file, options: .atomic)
            #endif
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            return true
        }
    }
    public func load(ifCurrent: @Sendable () -> Bool = { true }) throws -> BalanceSnapshot? {
        try SharedCacheLock.withLock(directory: root) {
            guard ifCurrent(), FileManager.default.fileExists(atPath: file.path) else { return nil }
            let data = try Data(contentsOf: file)
            guard data.count < 64 * 1024 else { throw APIError.invalidPayload }
            return try BalanceSnapshot.decode(data)
        }
    }
    public func clear() throws {
        try SharedCacheLock.withLock(directory: root) {
            if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
        }
    }
    /// À appeler uniquement sous SharedCacheLock, afin de conserver le même inode de verrou.
    public static func removeAllSnapshots(directory: URL) throws {
        for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) where url.lastPathComponent != ".lock" {
            try FileManager.default.removeItem(at: url)
        }
    }
}
public struct RefreshResult: Sendable { public let snapshot: BalanceSnapshot?; public let isOffline: Bool; public let unauthorized: Bool }
public struct BalanceRepository: Sendable {
    let client: BalanceClient
    let cache: SnapshotCache
    let configurationIsCurrent: @Sendable (UUID) -> Bool
    public init(client: BalanceClient = BalanceClient(), cache: SnapshotCache, configurationIsCurrent: @escaping @Sendable (UUID) -> Bool = { _ in true }) {
        self.client = client; self.cache = cache; self.configurationIsCurrent = configurationIsCurrent
    }
    public func refresh(configuration: ServerConfiguration) async -> RefreshResult {
        let valid: @Sendable () -> Bool = { configurationIsCurrent(configuration.revision) }
        do {
            guard valid() else { return RefreshResult(snapshot: nil, isOffline: false, unauthorized: false) }
            let snapshot = try await client.fetch(configuration: configuration)
            let saved = try await cache.save(snapshot, ifCurrent: valid)
            guard saved, valid() else { return RefreshResult(snapshot: nil, isOffline: false, unauthorized: false) }
            return RefreshResult(snapshot: snapshot, isOffline: false, unauthorized: false)
        } catch {
            let cached = try? await cache.load(ifCurrent: valid)
            guard valid() else { return RefreshResult(snapshot: nil, isOffline: false, unauthorized: false) }
            return RefreshResult(snapshot: cached, isOffline: true, unauthorized: (error as? APIError) == .unauthorized)
        }
    }
}
