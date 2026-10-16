import Foundation
import Testing
@testable import BanxoCore

struct CoreTests {
    let raw = """
    {"amount":"-12345678901234567890.12","currency":"EUR","accountLabel":"Compte","balanceKind":"booked","fetchedAt":"2026-10-16T10:00:00Z","sourceDate":"2026-10-16","consentExpiresAt":null,"status":"ready"}
    """
    func decode(_ text: String) throws -> BalanceSnapshot { try BalanceSnapshot.decode(Data(text.utf8)) }
    @Test func testExactNegativeDecimal() throws {
        let value = try decode(raw)
        expectEqual(value.amount, Decimal(string: "-12345678901234567890.12", locale: Locale(identifier: "en_US_POSIX")))
    }
    @Test func testMissingAmountNeverZero() throws {
        let value = try decode(raw.replacingOccurrences(of: "\"-12345678901234567890.12\"", with: "null"))
        expectNil(value.amount)
    }
    @Test func testMalformedAmountsRejected() {
        for amount in ["abc", "1,20", "1e3", "NaN", "", "1.2x", "1234567890123456789012345678901234567890123"] {
            expectThrows(try decode(raw.replacingOccurrences(of: "-12345678901234567890.12", with: amount)))
        }
    }
    @Test func testMalformedDateAndStatusRejected() {
        expectThrows(try decode(raw.replacingOccurrences(of: "2026-10-16T10:00:00Z", with: "yesterday")))
        expectThrows(try decode(raw.replacingOccurrences(of: "\"ready\"", with: "\"unknown\"")))
    }
    @Test func testStalenessAndReconnectPriority() throws {
        let value = try decode(raw)
        expectEqual(value.effectiveStatus(at: value.fetchedAt!.addingTimeInterval(8 * 3600)), .stale)
        expectEqual(value.effectiveStatus(at: value.fetchedAt!.addingTimeInterval(60)), .ready)
        let reconnect = try decode(raw.replacingOccurrences(of: "\"ready\"", with: "\"reconnect_required\""))
        expectEqual(reconnect.effectiveStatus(at: .distantFuture), .reconnectRequired)
    }
    @Test func testURLValidation() throws {
        expectNoThrow(try ServerConfiguration(serverURL: "https://example.com", token: "secret"))
        for url in ["http://example.com", "https://u:p@example.com", "https://example.com?x=1", "https://example.com/#x"] {
            expectThrows(try ServerConfiguration(serverURL: url, token: "secret"))
        }
        expectNoThrow(try ServerConfiguration(serverURL: "http://localhost:8787", token: "secret", allowLocalHTTP: true))
        expectThrows(try ServerConfiguration(serverURL: "https://example.com", token: "\n"))
    }
    @Test func testClientSendsBearerAndDecodes() async throws {
        let client = BalanceClient(transport: StubTransport(data: Data(raw.utf8), status: 200, inspect: true))
        let result = try await client.fetch(configuration: ServerConfiguration(serverURL: "https://example.com", token: "secret"))
        expectEqual(result.accountLabel, "Compte")
    }
    @Test func testClientRejectsFailure() async throws {
        let client = BalanceClient(transport: StubTransport(data: Data(raw.utf8), status: 401))
        do { _ = try await client.fetch(configuration: ServerConfiguration(serverURL: "https://example.com", token: "secret")); Issue.record("Échec attendu") } catch { expectEqual(error as? APIError, .unauthorized) }
    }
    @Test func testCacheAndOfflineFallback() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = SnapshotCache(directory: directory)
        let value = try decode(raw)
        try await cache.save(value)
        let loaded = try await cache.load()
        expectEqual(loaded, value)
        let repository = BalanceRepository(client: BalanceClient(transport: StubTransport(data: Data(), status: 500)), cache: cache)
        let result = await repository.refresh(configuration: try ServerConfiguration(serverURL: "https://example.com", token: "secret"))
        expectEqual(result.snapshot, value)
        expectTrue(result.isOffline)
        try await cache.clear()
        let cleared = try await cache.load()
        expectNil(cleared)
    }
    @Test func testFractionalDateAndNilPayload() throws {
        let value = try decode(raw.replacingOccurrences(of: "2026-10-16T10:00:00Z", with: "2026-10-16T10:00:00.123Z"))
        expectTrue(value.fetchedAt != nil)
        expectEqual(try BalanceSnapshot.decode(JSONEncoder().encode(value)), value)
        let empty = try decode("{\"amount\":null,\"currency\":\"EUR\",\"accountLabel\":\"\",\"balanceKind\":null,\"fetchedAt\":null,\"sourceDate\":null,\"consentExpiresAt\":null,\"status\":\"not_connected\"}")
        expectNil(empty.amount)
        expectEqual(empty.effectiveStatus(at: .distantFuture), .notConnected)
    }
    @Test func testNumericAmountAndInvalidCurrencyRejected() {
        expectThrows(try decode(raw.replacingOccurrences(of: "\"-12345678901234567890.12\"", with: "0.1")))
        expectThrows(try decode(raw.replacingOccurrences(of: "EUR", with: "EURO")))
    }
    @Test func testRedirectRejectedAsHTTPFailure() async throws {
        let client = BalanceClient(transport: StubTransport(data: Data(), status: 302))
        do { _ = try await client.fetch(configuration: ServerConfiguration(serverURL: "https://example.com", token: "secret")); Issue.record("Redirection refusée attendue") }
        catch { expectEqual(error as? APIError, .http(302)) }
    }
    @Test func testOfflineWithoutCacheHasNoBalance() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let result = await BalanceRepository(client: BalanceClient(transport: StubTransport(data: Data(), status: 500)), cache: SnapshotCache(directory: directory)).refresh(configuration: try ServerConfiguration(serverURL: "https://example.com", token: "secret"))
        expectNil(result.snapshot); expectTrue(result.isOffline)
    }
    @Test func testCachePermissions() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try await SnapshotCache(directory: directory).save(decode(raw))
        let attributes = try FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent("balance.json").path)
        expectEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
    }

    @Test func testDisconnectDiscardsResponseInFlight() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let config = try ServerConfiguration(serverURL: "https://example.com", token: "secret")
        let state = ConfigurationState(config.revision)
        let transport = SuspendedTransport(data: Data(raw.utf8))
        let cache = SnapshotCache(directory: directory, configurationID: config.revision)
        try await cache.save(decode(raw))
        let repository = BalanceRepository(client: BalanceClient(transport: transport), cache: cache, configurationIsCurrent: { state.isCurrent($0) })
        let pending = Task { await repository.refresh(configuration: config) }
        await transport.waitUntilStarted()
        try SharedCacheLock.withLock(directory: directory) { state.replace(nil); try SnapshotCache.removeAllSnapshots(directory: directory) }
        await transport.finish()
        let result = await pending.value
        expectNil(result.snapshot)
        expectNil(try await cache.load())
    }
    @Test func testSwitchServerCannotReadPreviousAccountOnFailure() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let first = try ServerConfiguration(serverURL: "https://first.example.com", token: "first")
        let second = try ServerConfiguration(serverURL: "https://second.example.com", token: "second")
        let oldCache = SnapshotCache(directory: directory, configurationID: first.revision)
        try await oldCache.save(decode(raw))
        let newCache = SnapshotCache(directory: directory, configurationID: second.revision)
        let result = await BalanceRepository(client: BalanceClient(transport: StubTransport(data: Data(), status: 500)), cache: newCache).refresh(configuration: second)
        expectNil(result.snapshot)
        expectTrue(first.revision != second.revision)
    }
    @Test func testSameCredentialsCreateNewRevisionAndRoundTripKeepsIt() throws {
        let first = try ServerConfiguration(serverURL: "https://example.com", token: "same")
        let second = try ServerConfiguration(serverURL: "https://example.com", token: "same")
        expectTrue(first.revision != second.revision)
        expectEqual(try JSONDecoder().decode(ServerConfiguration.self, from: JSONEncoder().encode(first)).revision, first.revision)
    }

}

struct StubTransport: HTTPTransport {
    var data: Data
    var status: Int
    var inspect = false
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        if inspect {
            expectEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
            expectEqual(request.url?.path, "/api/v1/balance")
        }
        return (data, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
}

func expectEqual<T: Equatable>(_ lhs: T, _ rhs: T) { #expect(lhs == rhs) }
func expectNil<T>(_ value: T?) { #expect(value == nil) }
func expectTrue(_ value: Bool) { #expect(value) }
func expectThrows<T>(_ expression: @autoclosure () throws -> T) { do { _ = try expression(); Issue.record("Erreur attendue") } catch {} }
func expectNoThrow<T>(_ expression: @autoclosure () throws -> T) { do { _ = try expression() } catch { Issue.record("Erreur inattendue: \(error)") } }

final class ConfigurationState: @unchecked Sendable {
    private let lock = NSLock()
    private var revision: UUID?
    init(_ revision: UUID?) { self.revision = revision }
    func replace(_ revision: UUID?) { lock.withLock { self.revision = revision } }
    func isCurrent(_ revision: UUID) -> Bool { lock.withLock { self.revision == revision } }
}
actor SuspendedTransport: HTTPTransport {
    let data: Data
    var started = false
    var startedWaiters: [CheckedContinuation<Void, Never>] = []
    var response: CheckedContinuation<Void, Never>?
    init(data: Data) { self.data = data }
    func waitUntilStarted() async {
        if started { return }
        await withCheckedContinuation { startedWaiters.append($0) }
    }
    func finish() { response?.resume(); response = nil }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        await withCheckedContinuation { continuation in
            response = continuation; started = true
            startedWaiters.forEach { $0.resume() }; startedWaiters = []
        }
        return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
